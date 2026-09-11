import { createPublicClient, createWalletClient, decodeEventLog, http, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { IDENTITY_REGISTRY_ABI } from "./erc8004Abi";

/**
 * The app's side of ERC-8004 registration and the buy-gate check — see
 * contracts/doc/erc8004/ERC8004.md. Mirrors app/src/lib/x402.ts's shape (same
 * network()/rpcUrl() pattern, same "throw a clear NotConfigured error" convention) since both
 * modules read/verify state from the same Somnia RPC.
 */

type SomniaNetwork = "testnet" | "mainnet";

const NETWORK_DEFAULTS: Record<SomniaNetwork, { rpcUrl: string }> = {
  testnet: { rpcUrl: "https://dream-rpc.somnia.network" },
  mainnet: { rpcUrl: "" },
};

export class Erc8004NotConfiguredError extends Error {
  constructor() {
    super(
      "ERC8004_IDENTITY_REGISTRY_ADDRESS is not set — deploy contracts/src/erc-8004/IdentityRegistry.sol " +
        "(see contracts/doc/erc8004/ERC8004.md / npm run deploy:erc8004) and set its address in " +
        "app/.env before registering or checking agent identities.",
    );
    this.name = "Erc8004NotConfiguredError";
  }
}

function network(): SomniaNetwork {
  return (process.env.SOMNIA_NETWORK ?? "testnet").toLowerCase() === "mainnet" ? "mainnet" : "testnet";
}

function rpcUrl(): string {
  const net = network();
  const url = process.env.SOMNIA_RPC_URL || NETWORK_DEFAULTS[net].rpcUrl;
  if (!url) throw new Error(`No default RPC URL for Somnia ${net} — set SOMNIA_RPC_URL in app/.env.`);
  return url;
}

export function identityRegistryAddress(): Address {
  const addr = process.env.ERC8004_IDENTITY_REGISTRY_ADDRESS;
  if (!addr) throw new Erc8004NotConfiguredError();
  return addr as Address;
}

function publicClient() {
  return createPublicClient({ transport: http(rpcUrl()) });
}

/** Live on-chain check backing both the UI's registration badge and the buy-route's fast-fail
 * pre-check — the authoritative gate is X402FeeVault.payFee() itself (see
 * contracts/doc/erc8004/ERC8004.md), this is only ever a UX nicety. */
export async function isRegisteredAgent(walletAddress: Address): Promise<boolean> {
  const balance = await publicClient().readContract({
    address: identityRegistryAddress(),
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "balanceOf",
    args: [walletAddress],
  });
  return balance > BigInt(0);
}

/** Upper bound on how many agentIds `findRegisteredAgentId` probes before giving up — an
 * `eth_getLogs`-based search hit the public Somnia RPC's 1000-block range cap almost immediately
 * (scanning from genesis on a live testnet), and paging around that turned into dozens of slow
 * sequential round trips even for one recent registration. Probing `ownerOf` directly instead is
 * both simpler and cheaper: `agentId`s are minted incrementally from 1 (`IdentityRegistry.sol`),
 * so this is one cheap `eth_call` per candidate id with no block-range limit to work around at
 * all — this cap just keeps a wallet that was never actually registered from probing forever. */
const MAX_AGENT_ID_PROBE = 500;

/**
 * Recovers `owner`'s `agentId` by probing `ownerOf(1)`, `ownerOf(2)`, ... — the fallback for when
 * the app's own store never learned about a registration (e.g. it happened directly against the
 * contract, outside this app's `/api/register-agent` / `register_erc8004_identity` paths, or the
 * follow-up report-back call failed after the on-chain leg had already succeeded). The chain is
 * the source of truth for "is this wallet registered"; the store is only a cache of it — see
 * `isRegisteredAgent` above and contracts/doc/erc8004/ERC8004.md. Stops at the first
 * `TokenDoesNotExist` revert (past the last minted agentId) or at `MAX_AGENT_ID_PROBE`, whichever
 * comes first.
 */
export async function findRegisteredAgentId(owner: Address): Promise<string | undefined> {
  const client = publicClient();
  const address = identityRegistryAddress();

  for (let agentId = 1; agentId <= MAX_AGENT_ID_PROBE; agentId++) {
    let currentOwner: Address;
    try {
      currentOwner = await client.readContract({
        address,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "ownerOf",
        args: [BigInt(agentId)],
      });
    } catch {
      break; // TokenDoesNotExist — past the last minted agentId, nothing further to check.
    }
    if (currentOwner.toLowerCase() === owner.toLowerCase()) return agentId.toString();
  }
  return undefined;
}

/**
 * Registers `agentURI` on IdentityRegistry, signed server-side from `privateKey` — the human-UI
 * path (`POST /api/register-agent`), which resolves an agent's App-custodied key exactly like
 * every other app-triggered on-chain action here (see app/src/lib/engine.ts's
 * `resolvePrivateKey`). Autonomous agents instead sign this themselves, from their own key held
 * only in agents/proxy-servers — see agents/proxy-servers/shared/wallet.ts's `registerAgentIdentity`.
 */
export async function registerAgentOnChain(
  privateKey: `0x${string}`,
  agentURI: string,
): Promise<{ erc8004AgentId: string; txHash: Hash; walletAddress: Address }> {
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl());
  const client = publicClient();
  const walletClient = createWalletClient({ account, transport });

  const txHash = await walletClient.writeContract({
    address: identityRegistryAddress(),
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "register",
    args: [agentURI],
    chain: null,
  });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
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

  return { erc8004AgentId: erc8004AgentId.toString(), txHash, walletAddress: account.address };
}

/** Builds the same self-contained, no-hosting-needed `agentURI` shape as
 * agents/proxy-servers/shared/wallet.ts's `buildAgentURI` — kept in sync manually, small enough not to
 * warrant a shared package across the app/agents/proxy-servers workspace boundary. */
export function buildAgentURI(agentId: string): string {
  const registration = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: agentId,
    description: `Agentic Prediction Market agent "${agentId}"`,
    services: [{ name: "A2A", endpoint: process.env.APM_PUBLIC_URL ?? "http://localhost:3000" }],
    x402Support: true,
    active: true,
    supportedTrust: ["crypto-economic"],
  };
  const json = Buffer.from(JSON.stringify(registration)).toString("base64");
  return `data:application/json;base64,${json}`;
}
