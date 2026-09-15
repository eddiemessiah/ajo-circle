import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { Address, Hash } from "viem";
import type { TokenKey } from "./chain.js";

export type Member = { tgId: number; name: string; address?: Address };

export type Payment = {
  round: number;
  tgId: number;
  txHash: Hash;
  amount: string; // base units, as a string
  tagged: boolean;
  at: string;
};

export type Circle = {
  id: string;
  chatId: number;
  name: string;
  token: TokenKey;
  amount: string; // human units per member per round, e.g. "20" or "5000"
  cadenceDays: number;
  creatorTgId: number;
  members: Member[]; // join order is payout order
  status: "forming" | "active" | "done";
  round: number; // 1-based while active, 0 while forming
  roundStartedAt?: string;
  payments: Payment[];
  createdAt: string;
};

type LinkToken = { circleId: string; tgId: number; expiresAt: number };
type Db = { circles: Circle[]; linkTokens: Record<string, LinkToken> };

const LINK_TTL_MS = 30 * 60 * 1000;

// A JSON file is enough for a handful of circles; swap for SQLite/Postgres before real scale.
export class Store {
  private db: Db;

  constructor(private readonly path = "data/db.json") {
    this.db = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as Db)
      : { circles: [], linkTokens: {} };
  }

  private save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    renameSync(tmp, this.path);
  }

  getCircle(id: string) {
    return this.db.circles.find((c) => c.id === id);
  }

  circleForChat(chatId: number) {
    return this.db.circles.find((c) => c.chatId === chatId && c.status !== "done");
  }

  createCircle(input: {
    chatId: number;
    name: string;
    token: TokenKey;
    amount: string;
    creator: { tgId: number; name: string };
  }): Circle {
    const circle: Circle = {
      id: randomBytes(5).toString("hex"),
      chatId: input.chatId,
      name: input.name,
      token: input.token,
      amount: input.amount,
      cadenceDays: 7,
      creatorTgId: input.creator.tgId,
      members: [{ tgId: input.creator.tgId, name: input.creator.name }],
      status: "forming",
      round: 0,
      payments: [],
      createdAt: new Date().toISOString(),
    };
    this.db.circles.push(circle);
    this.save();
    return circle;
  }

  addMember(circle: Circle, member: { tgId: number; name: string }): "added" | "exists" | "closed" {
    if (circle.status !== "forming") return "closed";
    if (circle.members.some((m) => m.tgId === member.tgId)) return "exists";
    circle.members.push(member);
    this.save();
    return "added";
  }

  issueLinkToken(circle: Circle, tgId: number): string {
    const now = Date.now();
    for (const [t, v] of Object.entries(this.db.linkTokens)) if (v.expiresAt < now) delete this.db.linkTokens[t];
    const token = randomBytes(16).toString("base64url");
    this.db.linkTokens[token] = { circleId: circle.id, tgId, expiresAt: now + LINK_TTL_MS };
    this.save();
    return token;
  }

  peekLinkToken(token: string): LinkToken | undefined {
    const link = this.db.linkTokens[token];
    return link && link.expiresAt >= Date.now() ? link : undefined;
  }

  consumeLinkToken(token: string, address: Address): { circle: Circle; member: Member } | { error: string } {
    const link = this.peekLinkToken(token);
    if (!link) return { error: "link_expired" };
    const circle = this.getCircle(link.circleId);
    const member = circle?.members.find((m) => m.tgId === link.tgId);
    if (!circle || !member) return { error: "member_not_found" };
    const taken = circle.members.some(
      (m) => m.tgId !== member.tgId && m.address?.toLowerCase() === address.toLowerCase(),
    );
    if (taken) return { error: "wallet_in_use" };
    member.address = address;
    delete this.db.linkTokens[token];
    this.save();
    return { circle, member };
  }

  begin(circle: Circle): string | null {
    if (circle.status !== "forming") return "This circle has already started.";
    if (circle.members.length < 2) return "A circle needs at least 2 members.";
    const missing = circle.members.filter((m) => !m.address);
    if (missing.length) return `Still waiting for a wallet from: ${missing.map((m) => m.name).join(", ")}.`;
    circle.status = "active";
    circle.round = 1;
    circle.roundStartedAt = new Date().toISOString();
    this.save();
    return null;
  }

  recipient(circle: Circle, round = circle.round): Member {
    return circle.members[(round - 1) % circle.members.length];
  }

  memberByAddress(circle: Circle, address: Address) {
    return circle.members.find((m) => m.address?.toLowerCase() === address.toLowerCase());
  }

  paymentsFor(circle: Circle, round = circle.round) {
    return circle.payments.filter((p) => p.round === round);
  }

  // The recipient doesn't pay into their own round: that would be a transfer to self.
  unpaid(circle: Circle, round = circle.round): Member[] {
    const recipient = this.recipient(circle, round);
    const paid = new Set(this.paymentsFor(circle, round).map((p) => p.tgId));
    return circle.members.filter((m) => m.tgId !== recipient.tgId && !paid.has(m.tgId));
  }

  recordPayment(circle: Circle, payment: Payment): "recorded" | "duplicate" {
    const seenHash = this.db.circles.some((c) =>
      c.payments.some((p) => p.txHash.toLowerCase() === payment.txHash.toLowerCase()),
    );
    const alreadyPaid = circle.payments.some((p) => p.round === payment.round && p.tgId === payment.tgId);
    if (seenHash || alreadyPaid) return "duplicate";
    circle.payments.push(payment);
    this.save();
    return "recorded";
  }

  advanceIfComplete(circle: Circle): "advanced" | "finished" | "pending" {
    if (circle.status !== "active" || this.unpaid(circle).length > 0) return "pending";
    if (circle.round >= circle.members.length) {
      circle.status = "done";
      this.save();
      return "finished";
    }
    circle.round += 1;
    circle.roundStartedAt = new Date().toISOString();
    this.save();
    return "advanced";
  }
}
