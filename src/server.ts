import { Hono } from "hono";
import { getAddress, isAddress, isHash } from "viem";
import type { Circle, Store } from "./store.js";
import { TOKENS, attributionSuffix, toBaseUnits, verifyPayment } from "./chain.js";
import { homePage, linkPage, payPage } from "./pages.js";

type Deps = {
  store: Store;
  announceRound: (circle: Circle) => Promise<void>;
  notify: (circle: Circle, text: string) => Promise<void>;
};

export function createApp({ store, announceRound, notify }: Deps) {
  const app = new Hono();

  app.get("/", (c) => c.html(homePage()));

  app.get("/link/:token", (c) => {
    const token = c.req.param("token");
    const link = store.peekLinkToken(token);
    const circle = link && store.getCircle(link.circleId);
    return c.html(linkPage({ token, circleName: circle ? circle.name : null }));
  });

  app.post("/api/link", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.token !== "string" || typeof body.address !== "string" || !isAddress(body.address)) {
      return c.json({ error: "bad_request" }, 400);
    }
    const result = store.consumeLinkToken(body.token, getAddress(body.address));
    if ("error" in result) return c.json({ error: result.error }, 409);
    await notify(result.circle, `${result.member.name} connected a wallet.`).catch(() => {});
    return c.json({ ok: true, circleName: result.circle.name });
  });

  app.get("/pay/:id/:round", (c) => {
    const circle = store.getCircle(c.req.param("id"));
    const round = Number(c.req.param("round"));
    if (!circle || circle.status !== "active" || round !== circle.round) {
      return c.html(payPage({ state: "closed" }), 404);
    }
    const token = TOKENS[circle.token];
    const recipient = store.recipient(circle);
    return c.html(
      payPage({
        state: "open",
        circleId: circle.id,
        round,
        rounds: circle.members.length,
        circleName: circle.name,
        recipientName: recipient.name,
        amount: circle.amount,
        amountBase: toBaseUnits(circle.amount, circle.token).toString(),
        token,
        suffix: attributionSuffix(),
      }),
    );
  });

  // Tells the pay page whether the connected wallet belongs to someone who owes this round.
  // POST so the wallet address stays out of URLs and access logs.
  app.post("/api/pay-check", async (c) => {
    const body = await c.req.json().catch(() => null);
    const circle = typeof body?.id === "string" ? store.getCircle(body.id) : undefined;
    const address = typeof body?.address === "string" ? body.address : "";
    if (!circle || circle.status !== "active" || Number(body.round) !== circle.round) return c.json({ state: "closed" });
    if (!isAddress(address)) return c.json({ state: "not_member" });
    const member = store.memberByAddress(circle, address);
    const recipient = store.recipient(circle);
    if (!member) return c.json({ state: "not_member" });
    if (member.tgId === recipient.tgId) return c.json({ state: "recipient" });
    if (store.paymentsFor(circle).some((p) => p.tgId === member.tgId)) return c.json({ state: "paid" });
    return c.json({ state: "owes", payTo: recipient.address });
  });

  // Payment truth comes from the chain, not the browser: we read the Transfer log ourselves.
  app.post("/api/confirm", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.id !== "string" || !isHash(body.txHash)) return c.json({ error: "bad_request" }, 400);
    const circle = store.getCircle(body.id);
    if (!circle || circle.status !== "active" || Number(body.round) !== circle.round) {
      return c.json({ error: "round_closed" }, 409);
    }
    const recipient = store.recipient(circle);
    const result = await verifyPayment({
      hash: body.txHash,
      token: circle.token,
      to: recipient.address!,
      minAmount: toBaseUnits(circle.amount, circle.token),
    });
    if (!result.ok) return c.json({ error: result.reason }, 422);

    const member = store.memberByAddress(circle, result.from);
    if (!member || member.tgId === recipient.tgId) return c.json({ error: "payer_not_in_circle" }, 422);

    const recorded = store.recordPayment(circle, {
      round: circle.round,
      tgId: member.tgId,
      txHash: body.txHash,
      amount: result.amount.toString(),
      tagged: result.tagged,
      at: new Date().toISOString(),
    });
    if (recorded === "duplicate") return c.json({ ok: true, duplicate: true });

    const sym = TOKENS[circle.token].symbol;
    const unpaid = store.unpaid(circle).map((m) => m.name);
    await notify(
      circle,
      `${member.name} paid ${circle.amount} ${sym} to ${recipient.name}. ${unpaid.length ? `Waiting on ${unpaid.join(", ")}.` : "Everyone has paid this round."}`,
    ).catch(() => {});

    const next = store.advanceIfComplete(circle);
    if (next === "advanced") await announceRound(circle).catch(() => {});
    if (next === "finished") await notify(circle, `${circle.name} is complete. Every member has received the pot once.`).catch(() => {});
    return c.json({ ok: true });
  });

  return app;
}
