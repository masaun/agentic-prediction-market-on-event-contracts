export * from "./types";
export { MockEngine } from "./mockEngine";
export { LiveEngine, NotSupportedInLiveModeError, type LiveEngineConfig, type SomniaNetwork } from "./liveEngine";

import type { MarketEngine } from "./types";
import { MockEngine } from "./mockEngine";
import { LiveEngine, type SomniaNetwork } from "./liveEngine";

export interface CreateEngineOptions {
  mode: "live" | "mock";
  network?: SomniaNetwork;
  indexerUrl?: string;
  wsRpcUrl?: string;
  privateKey?: `0x${string}`;
}

/** Builds the `MarketEngine` selected by `MARKET_ENGINE` — see `app/src/lib/engine.ts`. */
export function createEngine(opts: CreateEngineOptions): MarketEngine {
  if (opts.mode === "mock") return new MockEngine();
  return new LiveEngine({
    network: opts.network ?? "testnet",
    indexerUrl: opts.indexerUrl,
    wsRpcUrl: opts.wsRpcUrl,
    privateKey: opts.privateKey,
  });
}
