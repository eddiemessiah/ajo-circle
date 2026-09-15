// Creates the agent wallet once and stores the key in .env (git-ignored). Prints only the address.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const path = ".env";
const env = existsSync(path) ? readFileSync(path, "utf8") : "";
const existing = env.match(/^AGENT_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m);

if (existing) {
  console.log(`Agent wallet already exists: ${privateKeyToAccount(existing[1] as `0x${string}`).address}`);
} else {
  if (/^AGENT_PRIVATE_KEY=/m.test(env)) {
    console.error("AGENT_PRIVATE_KEY is present in .env but empty or malformed. Remove that line, then run this again.");
    process.exit(1);
  }
  const key = generatePrivateKey();
  appendFileSync(path, `${env && !env.endsWith("\n") ? "\n" : ""}AGENT_PRIVATE_KEY=${key}\n`);
  console.log(`Created agent wallet: ${privateKeyToAccount(key).address}`);
  console.log("The key is in .env. Back it up somewhere safe; it is never committed.");
}
