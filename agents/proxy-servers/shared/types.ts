/**
 * Mirrors the JSON the app's REST API returns (see `app/src/lib/engine.ts`
 * and `app/src/app/api/**`). Kept independent from `@apm/market-engine` on
 * purpose: proxy-servers only ever talks HTTP to the app, never the chain or
 * the mock engine directly — see proxy-servers/README.md.
 */

export type MarketStatus = "LISTED" | "TRADING" | "LOCKED" | "RESOLVED" | "VOIDED";
export type BinarySide = "BUY_YES" | "SELL_YES" | "BUY_NO" | "SELL_NO";
export type OrderType = "LIMIT" | "MARKET" | "POST_ONLY" | "FILL_OR_KILL";
export type Outcome = "YES" | "NO";

export interface MarketSummary {
  id: string;
  symbol: string;
  question: string;
  category: string;
  status: MarketStatus;
  createdAt: number;
  expiresAt: number;
  yesPrice: number;
  noPrice: number;
  volume: number;
  liquidity: number;
  createdBy?: string;
  resolvedOutcome?: Outcome | "VOID";
}

export interface OrderBookSnapshot {
  marketId: string;
  bids: { price: number; quantity: number }[];
  asks: { price: number; quantity: number }[];
  updatedAt: number;
}

export interface Position {
  marketId: string;
  yesShares: number;
  noShares: number;
}

export interface ActivityEntry {
  agentId: string;
  timestamp: number;
  kind: "reasoning" | "action" | "error";
  message: string;
  data?: Record<string, unknown>;
}
