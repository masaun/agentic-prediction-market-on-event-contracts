/**
 * Engine-agnostic shapes the rest of the platform (Next.js API routes, agent
 * tools) programs against. `MockEngine` and `LiveEngine` both implement
 * `MarketEngine` so every caller works unmodified in either mode.
 */

export type MarketStatus = "LISTED" | "TRADING" | "LOCKED" | "RESOLVED" | "VOIDED";

export type BinarySide = "BUY_YES" | "SELL_YES" | "BUY_NO" | "SELL_NO";

export type OrderType = "LIMIT" | "MARKET" | "POST_ONLY" | "FILL_OR_KILL";

export type Outcome = "YES" | "NO";

export interface MarketSummary {
  id: string;
  /** DreamDEX-style trading symbol, e.g. "WILL-ETH-5K-BY-DEC31/USDC#YES". */
  symbol: string;
  question: string;
  category: string;
  status: MarketStatus;
  createdAt: number;
  expiresAt: number;
  /** Probability the market implies for YES, in [0, 1]. */
  yesPrice: number;
  noPrice: number;
  volume: number;
  liquidity: number;
  createdBy?: string;
  resolvedOutcome?: Outcome | "VOID";
  poolAddress?: string;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookSnapshot {
  marketId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  updatedAt: number;
}

export interface Trade {
  id: string;
  marketId: string;
  side: BinarySide;
  price: number;
  quantity: number;
  agentId?: string;
  timestamp: number;
  txHash?: string;
}

export interface Position {
  marketId: string;
  yesShares: number;
  noShares: number;
}

export interface CreateMarketInput {
  question: string;
  category: string;
  expiresInSec: number;
  createdBy: string;
  /** Optional seed probability for the mock order book, in [0, 1]. Defaults to 0.5. */
  initialProbability?: number;
}

export interface CreateMarketOutput {
  marketId: string;
  txHash?: string;
}

export interface PlaceOrderInput {
  marketId: string;
  side: BinarySide;
  /** Human-unit probability price in [0, 1]. */
  price: number;
  quantity: number;
  orderType?: OrderType;
  agentId?: string;
}

export interface PlaceOrderOutput {
  orderId?: string;
  filledQuantity: number;
  avgFillPrice?: number;
  txHash?: string;
}

export interface MintSetInput {
  marketId: string;
  amount: number;
  agentId?: string;
}

export interface RedeemInput {
  marketId: string;
  outcome: Outcome;
  agentId?: string;
}

export interface RedeemOutput {
  payout: number;
  txHash?: string;
}

export interface FaucetInput {
  /** Human-unit tUSDC to mint; omitted mints the on-chain cap (10,000). */
  amount?: number;
}

export interface FaucetOutput {
  /** Human-unit tUSDC actually minted. */
  amount: number;
  txHash?: string;
  /** The wallet credited, when known (live mode only). */
  walletAddress?: string;
}

export type EngineEvent =
  | { type: "market_created"; market: MarketSummary }
  | { type: "trade"; trade: Trade }
  | { type: "market_resolved"; marketId: string; outcome: Outcome | "VOID" };

export interface MarketEngine {
  readonly mode: "live" | "mock";

  listMarkets(filter?: { status?: MarketStatus }): Promise<MarketSummary[]>;
  getMarket(id: string): Promise<MarketSummary | null>;
  getOrderBook(id: string, depth?: number): Promise<OrderBookSnapshot>;
  getTrades(id: string, limit?: number): Promise<Trade[]>;

  createMarket(input: CreateMarketInput): Promise<CreateMarketOutput>;
  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderOutput>;
  mintSet(input: MintSetInput): Promise<{ txHash?: string }>;
  getPositions(agentId: string): Promise<Position[]>;
  redeem(input: RedeemInput): Promise<RedeemOutput>;
  /** Mint testnet tUSDC to the venue's configured wallet (Somnia testnet only). */
  faucet(input?: FaucetInput): Promise<FaucetOutput>;

  onEvent(cb: (evt: EngineEvent) => void): () => void;
}
