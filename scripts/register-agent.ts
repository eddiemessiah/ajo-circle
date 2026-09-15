// Registers the Ajo Circle agent in the ERC-8004 Identity Registry on Celo mainnet.
// Dry run by default. Sends only with: npm run register-agent -- --send
import {
  concat,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseEventLogs,
  zeroAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { toDataSuffix } from "@celo/attribution-tags";

try {
  process.loadEnvFile();
} catch {}

const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const USDT_FEE_ADAPTER = "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72"; // feeCurrency must be the adapter, not the token

const registryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

// Returns an exit code instead of calling process.exit, which crashes Node on Windows
// while fetch sockets are still closing.
async function main(): Promise<number> {
  const key = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  if (!key) {
    console.error("No AGENT_PRIVATE_KEY in .env. Run `npm run wallet` first.");
    return 1;
  }

  const send = process.argv.includes("--send");
  const account = privateKeyToAccount(key);
  const transport = http(process.env.CELO_RPC_URL);
  const publicClient = createPublicClient({ chain: celo, transport });
  const walletClient = createWalletClient({ chain: celo, transport, account });

  const web = process.env.PUBLIC_BASE_URL || "https://github.com/eddiemessiah/ajo-circle";
  const metadata = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Ajo Circle",
    description:
      "Runs rotating savings circles (ajo, esusu, chama) in Telegram groups. Each round, members pay that round's recipient directly in USDT, USA₮ or cNGN on Celo. The agent schedules, reminds and verifies payments on-chain; it never holds funds.",
    services: [
      { name: "web", endpoint: web },
      { name: "source", endpoint: "https://github.com/eddiemessiah/ajo-circle" },
    ],
    supportedTrust: ["reputation"],
  };
  // data: URIs are content-addressed, so the metadata can't be swapped after registration.
  const agentURI = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString("base64")}`;

  const [celoBalance, usdtBalance] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  ]);
  console.log(`Agent wallet ${account.address}`);
  console.log(`Balances: ${formatEther(celoBalance)} CELO, ${formatUnits(usdtBalance, 6)} USDT`);
  console.log(`Metadata: ${JSON.stringify(metadata, null, 2)}`);

  if (celoBalance === 0n && usdtBalance === 0n) {
    console.error("The wallet has no CELO and no USDT to pay the network fee. Send it about 0.10 USDT on Celo, then run this again.");
    return 1;
  }

  const callData = encodeFunctionData({ abi: registryAbi, functionName: "register", args: [agentURI] });
  const tag = process.env.ATTRIBUTION_TAG;
  const data = tag ? concat([callData, toDataSuffix(tag)]) : callData;
  const feeCurrency = celoBalance > 0n ? undefined : USDT_FEE_ADAPTER;

  const gas = await publicClient.estimateGas({ account, to: IDENTITY_REGISTRY, data, feeCurrency });
  console.log(`Estimated gas ${gas}, fee paid in ${feeCurrency ? "USDT" : "CELO"}${tag ? `, tagged ${tag}` : ", untagged (no ATTRIBUTION_TAG yet)"}`);

  if (!send) {
    console.log("\nDry run only. Re-run with `npm run register-agent -- --send` to register on Celo mainnet.");
    return 0;
  }

  const hash = await walletClient.sendTransaction({ to: IDENTITY_REGISTRY, data, gas: (gas * 12n) / 10n, feeCurrency });
  console.log(`Sent ${hash}. Waiting for confirmation...`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    console.error(`Registration reverted: https://celoscan.io/tx/${hash}`);
    return 1;
  }
  const minted = parseEventLogs({ abi: registryAbi, logs: receipt.logs, eventName: "Transfer" }).find(
    (log) => log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() && log.args.from === zeroAddress,
  );
  if (!minted) {
    console.error(`Confirmed, but no mint event found. Check https://celoscan.io/tx/${hash}`);
    return 1;
  }
  const agentId = minted.args.tokenId.toString();
  console.log(`\nRegistered agent #${agentId}`);
  console.log(`8004scan: https://8004scan.io/agents/celo/${agentId}`);
  console.log(`Celoscan: https://celoscan.io/nft/${IDENTITY_REGISTRY.toLowerCase()}/${agentId}`);
  console.log(`Add ERC8004_AGENT_ID=${agentId} to .env`);
  return 0;
}

process.exitCode = await main();
