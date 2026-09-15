import { createPublicClient, erc20Abi, http, parseEventLogs, parseUnits, type Address, type Hash, type Hex } from "viem";
import { celo } from "viem/chains";
import { toDataSuffix, verifyTx } from "@celo/attribution-tags";

export type TokenKey = "USDT" | "USAT" | "cNGN";

export type TokenInfo = {
  key: TokenKey;
  symbol: string;
  address: Address;
  decimals: number;
  minipay: boolean; // MiniPay only holds USDT/USDC/USDm
  feeCurrency?: Address; // CIP-64 adapter, used for the network fee inside MiniPay
};

// Addresses: x402.celo.org/skill.md and Celopedia contracts.md.
// Decimals read on-chain (decimals()) on 2026-09-15: all three are 6.
export const TOKENS: Record<TokenKey, TokenInfo> = {
  USDT: {
    key: "USDT",
    symbol: "USDT",
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    decimals: 6,
    minipay: true,
    feeCurrency: "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72",
  },
  USAT: {
    key: "USAT",
    symbol: "USA₮",
    address: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771",
    decimals: 6,
    minipay: false,
  },
  cNGN: {
    key: "cNGN",
    symbol: "cNGN",
    address: "0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f",
    decimals: 6,
    minipay: false,
  },
};

const makeClient = () => createPublicClient({ chain: celo, transport: http(process.env.CELO_RPC_URL) });
let client: ReturnType<typeof makeClient> | undefined;
export const publicClient = () => (client ??= makeClient());

export function toBaseUnits(amount: string, token: TokenKey): bigint {
  return parseUnits(amount, TOKENS[token].decimals);
}

// Null until the Celo Builders registration returns our tag. Pay pages refuse to send without it,
// because a transaction sent untagged can never be counted.
export function attributionSuffix(): Hex | null {
  const tag = process.env.ATTRIBUTION_TAG;
  if (!tag) return null;
  try {
    return toDataSuffix(tag);
  } catch (err) {
    console.error(`ATTRIBUTION_TAG "${tag}" is not a valid code`, err);
    return null;
  }
}

export async function verifyPayment(input: {
  hash: Hash;
  token: TokenKey;
  to: Address;
  minAmount: bigint;
}): Promise<{ ok: true; from: Address; amount: bigint; tagged: boolean } | { ok: false; reason: string }> {
  const c = publicClient();
  let receipt;
  try {
    receipt = await c.waitForTransactionReceipt({ hash: input.hash, timeout: 60_000 });
  } catch {
    return { ok: false, reason: "tx_not_found" };
  }
  if (receipt.status !== "success") return { ok: false, reason: "tx_reverted" };

  const token = TOKENS[input.token];
  // Filtering on the recipient also skips the fee debit a CIP-64 USDT transaction emits.
  const match = parseEventLogs({ abi: erc20Abi, logs: receipt.logs, eventName: "Transfer" }).find(
    (log) =>
      log.address.toLowerCase() === token.address.toLowerCase() &&
      log.args.to.toLowerCase() === input.to.toLowerCase() &&
      log.args.value >= input.minAmount,
  );
  if (!match) return { ok: false, reason: "no_matching_transfer" };

  const tag = process.env.ATTRIBUTION_TAG;
  const decoded = tag ? await verifyTx({ client: c, hash: input.hash }) : null;
  return { ok: true, from: match.args.from, amount: match.args.value, tagged: !!tag && !!decoded?.codes.includes(tag) };
}
