import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { createEngine, type MarketEngine } from "@apm/market-engine";
import { createPublicClient, createWalletClient, decodeEventLog, erc20Abi, http, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Resolves the wallet a given agentId trades BUY_YES/BUY_NO with — the
 * genuinely new thing this package holds, per contracts/doc/x402/X402.md.
 * Mirrors app/src/lib/engine.ts's AGENT_WALLET_ENV pattern, relocated here
 * because the buy-side wallet now lives with the agent, not the app; every
 * other action (SELL_*, mint_set, redeem, faucet) is still App-custodied and
 * untouched by this file.
 *
 * An agent with no configured key here has no wallet at all — apiClient's
 * `placeOrder` falls back to the original single-call, App-custodied
 * behavior for it (and for anything running against `MARKET_ENGINE=mock`,
 * where a real wallet has no meaning). See proxy-servers/README.md.
 */

const ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));

/**
 * Re-reads `proxy-servers/.env` fresh and merges any changed values into
 * `process.env` (`override: true`). A plain `import "dotenv/config"` only
 * ever loads once, at process startup — for a short-lived CLI invocation
 * that's fine, but a long-running process (a chat server, the ticking loop)
 * would otherwise keep whatever `.env` looked like when it started forever,
 * no matter how many times the file gets edited afterward. That's a real bug
 * this repo hit repeatedly: `ERC8004_IDENTITY_REGISTRY_ADDRESS` and
 * `SAGE_AGENT_WALLET_PRIVATE_KEY` both landed in `.env` after their chat
 * servers had already started, so — until the process was manually
 * restarted — every call kept resolving the pre-edit (missing) value, with
 * no indication anything was stale.
 *
 * Called at the top of every function in this file that reads a
 * dotenv-provided var, so a key added or fixed mid-session takes effect on
 * the very next call — no restart needed. A synchronous file read + parse of
 * a few dozen lines is negligible next to the network calls these functions
 * go on to make.
 */
function refreshEnv(): void {
  loadDotenv({ path: ENV_PATH, override: true });
}

const AGENT_WALLET_ENV: Record<string, string> = {
  "agent-ada": "ADA_AGENT_WALLET_PRIVATE_KEY",
  "agent-nomi": "NOMI_AGENT_WALLET_PRIVATE_KEY",
  // Sage never buys (place_order is excluded from CREATOR_TOOLS in shared/tools.ts) but does keep
  // register_erc8004_identity — this only matters for giving her that on-chain identity from a
  // wallet genuinely her own, not the shared fallback everything-else-unlisted resolves to.
  "agent-sage": "SAGE_AGENT_WALLET_PRIVATE_KEY",
};

type SomniaNetwork = "testnet" | "mainnet";

const NETWORK_DEFAULTS: Record<SomniaNetwork, { chainId: number; rpcUrl: string }> = {
  testnet: { chainId: 50312, rpcUrl: "https://dream-rpc.somnia.network" },
  mainnet: { chainId: 5031, rpcUrl: "" },
};

/** Minimal ABI slice this file needs — mirrors contracts/src/X402FeeVault.sol. */
const X402_FEE_VAULT_ABI = [
  {
    type: "function",
    name: "payFee",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "paymentRef", type: "bytes32" },
      { name: "marketId", type: "string" },
    ],
    outputs: [],
  },
] as const;

/** Minimal ABI slice this file needs — mirrors contracts/src/erc-8004/IdentityRegistry.sol. */
const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
    anonymous: false,
  },
] as const;

function network(): SomniaNetwork {
  return (process.env.SOMNIA_NETWORK ?? "testnet").toLowerCase() === "mainnet" ? "mainnet" : "testnet";
}

function rpcUrl(): string {
  const net = network();
  const url = process.env.SOMNIA_RPC_URL || NETWORK_DEFAULTS[net].rpcUrl;
  if (!url) throw new Error(`No default RPC URL for Somnia ${net} — set SOMNIA_RPC_URL in proxy-servers/.env.`);
  return url;
}

/** See contracts/doc/erc8004/ERC8004.md — deployed via `npm run deploy:erc8004`. */
function identityRegistryAddress(): Address {
  refreshEnv();
  const addr = process.env.ERC8004_IDENTITY_REGISTRY_ADDRESS;
  if (!addr) {
    throw new Error(
      "ERC8004_IDENTITY_REGISTRY_ADDRESS is not set — deploy contracts/src/erc-8004/IdentityRegistry.sol " +
        "(see contracts/doc/erc8004/ERC8004.md / npm run deploy:erc8004) and set its address in " +
        "proxy-servers/.env before calling register_erc8004_identity.",
    );
  }
  return addr as Address;
}

/** A self-contained, no-hosting-needed `agentURI` embedding the ERC-8004 agent-registration JSON
 * (contracts/doc/erc8004/ERC8004.md) as a `data:` URI — any client that resolves it gets the JSON
 * back directly from the URI itself. */
function buildAgentURI(agentId: string): string {
  const registration = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: agentId,
    description: `Agentic Prediction Market agent "${agentId}"`,
    services: [{ name: "A2A", endpoint: process.env.APM_API_URL ?? "http://localhost:3000" }],
    x402Support: true,
    active: true,
    supportedTrust: ["crypto-economic"],
  };
  const json = Buffer.from(JSON.stringify(registration)).toString("base64");
  return `data:application/json;base64,${json}`;
}

/** The env var an agentId's own wallet private key is read from, dedicated
 * per built-in persona (agent-ada/agent-nomi never share one another's key
 * or fall back to a shared one — that would undercut the whole point of
 * giving each its own identity) or a single shared var for anything else
 * (external MCP agents — one process per identity already, so one var is
 * enough; Sage, who never buys). */
function resolvePrivateKey(agentId: string): `0x${string}` | undefined {
  refreshEnv();
  const dedicatedEnvVar = AGENT_WALLET_ENV[agentId];
  const dedicated = dedicatedEnvVar ? process.env[dedicatedEnvVar] : undefined;
  const fallback = dedicatedEnvVar ? undefined : process.env.AGENT_WALLET_PRIVATE_KEY;
  return (dedicated || fallback) as `0x${string}` | undefined;
}

export function hasOwnWallet(agentId: string): boolean {
  return resolvePrivateKey(agentId) !== undefined;
}

export function resolveAddress(agentId: string): Address | undefined {
  const key = resolvePrivateKey(agentId);
  return key ? privateKeyToAccount(key).address : undefined;
}

const tradingEngineCache = new Map<string, MarketEngine>();

/** A LiveEngine built from this agent's own key — used to place the actual
 * DreamDEX order (step 2 of the x402 buy flow) directly against Somnia,
 * bypassing the App entirely. Reuses the exact same class
 * app/src/lib/engine.ts builds for App-custodied wallets. */
export function resolveTradingEngine(agentId: string): MarketEngine | undefined {
  const key = resolvePrivateKey(agentId);
  if (!key) return undefined;
  let engine = tradingEngineCache.get(key);
  if (!engine) {
    engine = createEngine({
      mode: "live",
      network: network(),
      indexerUrl: process.env.SOMNIA_INDEXER_URL || undefined,
      wsRpcUrl: process.env.SOMNIA_WS_RPC_URL || undefined,
      privateKey: key,
    });
    tradingEngineCache.set(key, engine);
  }
  return engine;
}

/**
 * Step 1 of the x402 buy flow: pays the platform fee straight into
 * X402FeeVault from this agent's own wallet — approving the vault first if
 * its current allowance is insufficient (tUSDC has no EIP-3009/permit; see
 * contracts/doc/x402/X402.md §2). Both are real, agent-broadcast, agent-paid
 * transactions — nothing here is signed or submitted on the agent's behalf
 * by anything else.
 */
export async function payPlatformFee(input: {
  agentId: string;
  vaultAddress: Address;
  tokenAddress: Address;
  feeAmountAtomic: bigint;
  nonce: Hash;
  marketId: string;
}): Promise<{ txHash: Hash }> {
  const key = resolvePrivateKey(input.agentId);
  if (!key) throw new Error(`No wallet configured for agent "${input.agentId}" (see proxy-servers/.env.example)`);
  const account = privateKeyToAccount(key);
  const transport = http(rpcUrl());
  const publicClient = createPublicClient({ transport });
  const walletClient = createWalletClient({ account, transport });

  const allowance = await publicClient.readContract({
    address: input.tokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, input.vaultAddress],
  });
  if (allowance < input.feeAmountAtomic) {
    const approveHash = await walletClient.writeContract({
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [input.vaultAddress, 2n ** 256n - 1n],
      chain: null,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const txHash = await walletClient.writeContract({
    address: input.vaultAddress,
    abi: X402_FEE_VAULT_ABI,
    functionName: "payFee",
    args: [input.feeAmountAtomic, input.nonce, input.marketId],
    chain: null,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  // `waitForTransactionReceipt` resolves even for a reverted tx (status: "reverted") — it doesn't
  // throw on its own, so a payFee() revert (e.g. NotRegisteredAgent, see
  // contracts/doc/erc8004/ERC8004.md) would otherwise be silently treated as a successful payment.
  if (receipt.status !== "success") {
    throw new Error(
      `payFee (${txHash}) reverted on-chain — is wallet ${account.address} ERC-8004 registered? ` +
        `Call register_erc8004_identity first (see contracts/doc/erc8004/ERC8004.md).`,
    );
  }
  return { txHash };
}

/**
 * Registers `agentId`'s own wallet with the ERC-8004 Identity Registry — the on-chain
 * precondition `X402FeeVault.payFee` now enforces before any `BUY_YES`/`BUY_NO` fee payment can
 * succeed. See contracts/doc/erc8004/ERC8004.md. A real, agent-broadcast, agent-paid transaction,
 * same as `payPlatformFee` above — nothing here is signed on the agent's behalf by anything else.
 */
export async function registerAgentIdentity(
  agentId: string,
): Promise<{ erc8004AgentId: bigint; txHash: Hash; agentURI: string; walletAddress: Address }> {
  const key = resolvePrivateKey(agentId);
  if (!key) throw new Error(`No wallet configured for agent "${agentId}" (see proxy-servers/.env.example)`);
  const account = privateKeyToAccount(key);
  const transport = http(rpcUrl());
  const publicClient = createPublicClient({ transport });
  const walletClient = createWalletClient({ account, transport });

  const agentURI = buildAgentURI(agentId);
  const txHash = await walletClient.writeContract({
    address: identityRegistryAddress(),
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "register",
    args: [agentURI],
    chain: null,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`IdentityRegistry.register (${txHash}) reverted on-chain for wallet ${account.address}.`);
  }

  let erc8004AgentId: bigint | undefined;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: IDENTITY_REGISTRY_ABI, data: log.data, topics: log.topics, eventName: "Registered" });
      erc8004AgentId = decoded.args.agentId;
      break;
    } catch {
      // Not a Registered log — keep scanning.
    }
  }
  if (erc8004AgentId === undefined) {
    throw new Error(`No Registered event found in transaction ${txHash} — did register() actually run?`);
  }

  return { erc8004AgentId, txHash, agentURI, walletAddress: account.address };
}
