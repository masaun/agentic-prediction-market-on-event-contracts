import { createEngine, type MarketEngine, type SomniaNetwork } from "@apm/market-engine";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

/**
 * One process-wide `MarketEngine` per distinct wallet, cached on `globalThis`
 * so Next's dev-mode module reloading doesn't spin up a second mock venue
 * (and lose its in-memory markets) on every file save.
 */

declare global {
  var __apmEngines: Map<string, MarketEngine> | undefined;
}

function engineCache(): Map<string, MarketEngine> {
  if (!globalThis.__apmEngines) globalThis.__apmEngines = new Map();
  return globalThis.__apmEngines;
}

/**
 * Maps a built-in agent's id to the env var carrying its own wallet, so Ada
 * and Nomi each pay for `mint_set`/`place_order`/`faucet` from their own
 * funded address instead of sharing one wallet. Any agentId not listed here
 * — Sage (create_market is operator-gated live anyway), an external MCP
 * agent, or no agentId at all — falls back to the shared `SOMNIA_PRIVATE_KEY`,
 * same as before this existed. See "Giving Ada and Nomi their own wallets" in
 * the root README for why the keys live here and not in agents/proxy-servers.
 */
const AGENT_WALLET_ENV: Record<string, string> = {
  "agent-ada": "ADA_AGENT_WALLET_PRIVATE_KEY",
  "agent-nomi": "NOMI_AGENT_WALLET_PRIVATE_KEY",
  // Sage never places DreamDEX orders, but does register an ERC-8004 identity — this is the
  // App-custodied counterpart to agents/proxy-servers/shared/wallet.ts's own SAGE_AGENT_WALLET_PRIVATE_KEY,
  // same relationship Ada/Nomi already have between their two wallet mechanisms.
  "agent-sage": "SAGE_AGENT_WALLET_PRIVATE_KEY",
};

/** Exported for `app/src/lib/erc8004.ts`'s `/api/register-agent` route, which signs an
 * IdentityRegistry.register() call from the same App-custodied wallet this file already resolves
 * for DreamDEX writes — see "ERC-8004 identity" in the root README. */
export function resolvePrivateKey(agentId?: string): `0x${string}` | undefined {
  const dedicatedEnvVar = agentId ? AGENT_WALLET_ENV[agentId] : undefined;
  const dedicated = dedicatedEnvVar ? process.env[dedicatedEnvVar] : undefined;
  return (dedicated || process.env.SOMNIA_PRIVATE_KEY) as `0x${string}` | undefined;
}

/**
 * The address `POST /api/register-agent` actually signs `IdentityRegistry.register()` from for
 * this agentId — i.e. what its ERC-8004 registration status should be checked against even before
 * the store has a `walletAddress` bound for it (e.g. a fresh agent that registered but has never
 * yet made an x402 payment, which is the only other thing that binds `walletAddress`). Returns
 * `undefined` only if no App-custodied key resolves at all (`resolvePrivateKey` itself unset).
 */
export function resolveAppCustodiedAddress(agentId?: string): Address | undefined {
  const key = resolvePrivateKey(agentId);
  return key ? privateKeyToAccount(key).address : undefined;
}

function build(privateKey: `0x${string}` | undefined): MarketEngine {
  const network = (process.env.SOMNIA_NETWORK ?? "testnet") as SomniaNetwork;
  if (!privateKey) {
    console.warn(
      "[engine] MARKET_ENGINE=live but no private key resolved for this wallet — reads will work, but " +
        "placeOrder/mintSet/redeem/faucet will throw (SignerRequiredError) until one is set.",
    );
  }
  return createEngine({
    mode: "live",
    network,
    // "" (an unset-but-present .env var, e.g. `SOMNIA_INDEXER_URL=`) must not reach the SDK as an
    // override — it treats any string as one, including empty, and throws NotConfiguredError instead
    // of falling back to its own default.
    indexerUrl: process.env.SOMNIA_INDEXER_URL || undefined,
    wsRpcUrl: process.env.SOMNIA_WS_RPC_URL || undefined,
    privateKey,
  });
}

/**
 * `agentId` picks which wallet a live-mode write executes from (see
 * `AGENT_WALLET_ENV`); omit it for reads or for callers with no agent
 * identity — they get the shared/default wallet. Mock mode ignores it
 * entirely and always returns the one shared in-memory venue, since
 * `MockEngine` already tracks per-agent share positions itself.
 */
export function getEngine(agentId?: string): MarketEngine {
  const mode = (process.env.MARKET_ENGINE ?? "mock").toLowerCase();
  const cache = engineCache();

  if (mode !== "live") {
    let engine = cache.get("mock");
    if (!engine) {
      engine = createEngine({ mode: "mock" });
      cache.set("mock", engine);
      console.log(`[engine] running in "${engine.mode}" mode`);
    }
    return engine;
  }

  const privateKey = resolvePrivateKey(agentId);
  const cacheKey = privateKey ?? "live-unfunded";
  let engine = cache.get(cacheKey);
  if (!engine) {
    engine = build(privateKey);
    cache.set(cacheKey, engine);
    console.log(`[engine] running in "${engine.mode}" mode${agentId ? ` (wallet for ${agentId})` : " (default wallet)"}`);
  }
  return engine;
}
