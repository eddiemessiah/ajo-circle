// Usage: npm run verify-tag -- 0x<txHash>
import { createPublicClient, http, isHash } from "viem";
import { celo } from "viem/chains";
import { verifyTx } from "@celo/attribution-tags";

try {
  process.loadEnvFile();
} catch {}

async function main(): Promise<number> {
  const hash = process.argv[2];
  if (!hash || !isHash(hash)) {
    console.error("Usage: npm run verify-tag -- 0x<transaction hash>");
    return 2;
  }

  const client = createPublicClient({ chain: celo, transport: http(process.env.CELO_RPC_URL) });
  const result = await verifyTx({ client, hash });
  const expected = process.env.ATTRIBUTION_TAG;

  if (!result) {
    console.error("No attribution tag in this transaction's calldata. It will not be counted.");
    return 1;
  }
  console.log(`Codes on-chain: ${result.codes.join(", ")}`);
  if (expected && !result.codes.includes(expected)) {
    console.error(`Your registered tag ${expected} is NOT among them.`);
    return 1;
  }
  console.log(expected ? `Registered tag ${expected} confirmed.` : "Set ATTRIBUTION_TAG in .env to check it against your registered tag.");
  return 0;
}

process.exitCode = await main();
