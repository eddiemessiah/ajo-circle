import { Bot, InlineKeyboard, type Context } from "grammy";
import type { Circle, Store } from "./store.js";
import { TOKENS, type TokenKey } from "./chain.js";

const AMOUNT = /^\d+(\.\d{1,6})?$/;

const HELP = [
  "Ajo Circle runs a rotating savings circle in your Telegram group.",
  "Each round, one member receives the pot. Everyone else pays them directly from their own wallet. I never hold the money.",
  "",
  "In your group:",
  "/newcircle 20 USDT Friday Ajo: start a circle (USDT, USAT or cNGN)",
  "/join: join the circle and connect your wallet privately",
  "/begin: lock the member order and start round 1 (creator only)",
  "/status: who has paid this round",
  "/remind: nudge members who haven't paid yet",
].join("\n");

type From = { id: number; first_name: string; last_name?: string; username?: string };

export function displayName(from: From) {
  return from.username ? `@${from.username}` : [from.first_name, from.last_name].filter(Boolean).join(" ");
}

function dueDate(circle: Circle) {
  const due = new Date(Date.parse(circle.roundStartedAt ?? circle.createdAt) + circle.cadenceDays * 864e5);
  return due.toUTCString().slice(0, 16);
}

export function createBot(opts: { token: string; baseUrl: string; store: Store }) {
  const { store, baseUrl } = opts;
  const bot = new Bot(opts.token);
  const inGroup = (ctx: Context) => ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";

  async function promptWalletLink(ctx: Context, circle: Circle, from: From) {
    const token = store.issueLinkToken(circle, from.id);
    const deepLink = `https://t.me/${bot.botInfo.username}?start=link_${token}`;
    await ctx.reply(`${displayName(from)}, connect the wallet you'll pay and receive with. The link opens a private chat with me.`, {
      reply_markup: new InlineKeyboard().url("Connect my wallet", deepLink),
    });
  }

  function statusText(circle: Circle) {
    const sym = TOKENS[circle.token].symbol;
    if (circle.status === "forming") {
      const rows = circle.members.map((m, i) => `${i + 1}. ${m.name}: ${m.address ? "wallet connected" : "waiting for wallet"}`);
      return [`${circle.name}: ${circle.amount} ${sym} per member, every ${circle.cadenceDays} days. Not started yet.`, ...rows].join("\n");
    }
    if (circle.status === "done") return `${circle.name} is complete. Every member has received the pot once.`;
    const recipient = store.recipient(circle);
    const paid = store.paymentsFor(circle).map((p) => circle.members.find((m) => m.tgId === p.tgId)?.name ?? "member");
    const unpaid = store.unpaid(circle).map((m) => m.name);
    return [
      `${circle.name} · round ${circle.round} of ${circle.members.length}`,
      `${recipient.name} receives ${circle.amount} ${sym} from each member. Due ${dueDate(circle)}.`,
      `Paid: ${paid.length ? paid.join(", ") : "nobody yet"}`,
      `Waiting on: ${unpaid.length ? unpaid.join(", ") : "nobody"}`,
    ].join("\n");
  }

  async function announceRound(circle: Circle) {
    const recipient = store.recipient(circle);
    const sym = TOKENS[circle.token].symbol;
    const text = [
      `Round ${circle.round} of ${circle.members.length}: ${recipient.name} receives this round.`,
      `Everyone else, pay ${circle.amount} ${sym} to ${recipient.name} by ${dueDate(circle)}.`,
      "The money goes straight from your wallet to theirs.",
    ].join("\n");
    await bot.api.sendMessage(circle.chatId, text, {
      reply_markup: new InlineKeyboard().url("Pay my share", `${baseUrl}/pay/${circle.id}/${circle.round}`),
    });
  }

  async function notify(circle: Circle, text: string) {
    await bot.api.sendMessage(circle.chatId, text);
  }

  bot.command("start", async (ctx) => {
    const payload = ctx.match ?? "";
    if (ctx.chat.type === "private" && payload.startsWith("link_")) {
      const token = payload.slice("link_".length);
      const link = store.peekLinkToken(token);
      if (!link || link.tgId !== ctx.from?.id) {
        return ctx.reply("This wallet link has expired or belongs to someone else. Send /join in your circle's group to get a new one.");
      }
      return ctx.reply("Open this in MiniPay or another Celo wallet to connect the wallet you'll use for this circle.", {
        reply_markup: new InlineKeyboard().url("Connect wallet", `${baseUrl}/link/${token}`),
      });
    }
    return ctx.reply(HELP);
  });

  bot.command("help", (ctx) => ctx.reply(HELP));

  bot.command("newcircle", async (ctx) => {
    if (!inGroup(ctx) || !ctx.from) return ctx.reply("Add me to your circle's Telegram group and run /newcircle there.");
    if (store.circleForChat(ctx.chat.id)) return ctx.reply("This group already has a circle. Send /status to see it.");
    const [amount, tokenRaw, ...nameParts] = (ctx.match ?? "").trim().split(/\s+/);
    const token = (Object.keys(TOKENS) as TokenKey[]).find((k) => k.toLowerCase() === tokenRaw?.toLowerCase());
    if (!amount || !AMOUNT.test(amount) || Number(amount) <= 0 || !token) {
      return ctx.reply("Usage: /newcircle <amount> <USDT|USAT|cNGN> [name]\nExample: /newcircle 20 USDT Friday Ajo");
    }
    const creator = { tgId: ctx.from.id, name: displayName(ctx.from) };
    const name = nameParts.join(" ").slice(0, 40) || "Our Ajo";
    const circle = store.createCircle({ chatId: ctx.chat.id, name, token, amount, creator });
    await ctx.reply(
      [
        `${circle.name} is set up: ${amount} ${TOKENS[token].symbol} per member, every ${circle.cadenceDays} days.`,
        `${creator.name} is member 1. Everyone who's in, send /join. Payouts follow join order.`,
        `When everyone has connected a wallet, ${creator.name} sends /begin.`,
      ].join("\n"),
    );
    await promptWalletLink(ctx, circle, ctx.from);
  });

  bot.command("join", async (ctx) => {
    if (!inGroup(ctx) || !ctx.from) return ctx.reply("Send /join in your circle's group.");
    const circle = store.circleForChat(ctx.chat.id);
    if (!circle) return ctx.reply("There's no circle in this group yet. Start one with /newcircle 20 USDT Friday Ajo");
    const result = store.addMember(circle, { tgId: ctx.from.id, name: displayName(ctx.from) });
    if (result === "closed") return ctx.reply("This circle has already started. Ask the creator to start a new one after it finishes.");
    const member = circle.members.find((m) => m.tgId === ctx.from!.id)!;
    if (result === "exists" && member.address) return ctx.reply(`${member.name}, you're already in with a wallet connected.`);
    if (result === "added") await ctx.reply(`${member.name} joined as member ${circle.members.length}.`);
    await promptWalletLink(ctx, circle, ctx.from);
  });

  bot.command("begin", async (ctx) => {
    if (!inGroup(ctx) || !ctx.from) return;
    const circle = store.circleForChat(ctx.chat.id);
    if (!circle) return ctx.reply("There's no circle in this group yet.");
    if (circle.creatorTgId !== ctx.from.id) return ctx.reply("Only the person who created the circle can start it.");
    const error = store.begin(circle);
    if (error) return ctx.reply(error);
    await announceRound(circle);
  });

  bot.command("status", async (ctx) => {
    if (!inGroup(ctx)) return ctx.reply("Send /status in your circle's group.");
    const circle = store.circleForChat(ctx.chat.id);
    return ctx.reply(circle ? statusText(circle) : "There's no circle in this group yet.");
  });

  bot.command("remind", async (ctx) => {
    if (!inGroup(ctx)) return;
    const circle = store.circleForChat(ctx.chat.id);
    if (!circle || circle.status !== "active") return ctx.reply("There's no active round to remind people about.");
    const unpaid = store.unpaid(circle);
    if (!unpaid.length) return ctx.reply("Everyone has paid this round.");
    const recipient = store.recipient(circle);
    await ctx.reply(`Reminder: ${unpaid.map((m) => m.name).join(", ")}, ${recipient.name} is waiting on your ${circle.amount} ${TOKENS[circle.token].symbol}. Due ${dueDate(circle)}.`, {
      reply_markup: new InlineKeyboard().url("Pay my share", `${baseUrl}/pay/${circle.id}/${circle.round}`),
    });
  });

  bot.catch((err) => console.error("bot error", err.error));

  return { bot, announceRound, notify };
}
