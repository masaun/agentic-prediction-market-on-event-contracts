import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  BinarySide,
  CreateMarketInput,
  CreateMarketOutput,
  EngineEvent,
  FaucetInput,
  FaucetOutput,
  MarketEngine,
  MarketStatus,
  MarketSummary,
  MintSetInput,
  Outcome,
  OrderBookSnapshot,
  PlaceOrderInput,
  PlaceOrderOutput,
  Position,
  RedeemInput,
  RedeemOutput,
  Trade,
} from "./types";

/** Mirrors the live venue's on-chain `faucet(uint256 amount)` cap so the mock
 * form behaves the same as against real DreamDEX Event Contracts. */
const FAUCET_CAP_TUSDC = 10_000;

/** Seconds a market spends LOCKED (no new orders) before it settles. Mirrors
 * DreamDEX's post-expiry settlement window, compressed for a live demo. */
const SETTLEMENT_WINDOW_SEC = 45;

/** How much a single fill moves the mid-price, scaled by the market's depth. */
const IMPACT_SCALE = 0.35;

interface MockMarket {
  id: string;
  symbol: string;
  question: string;
  category: string;
  createdAt: number;
  expiresAt: number;
  createdBy?: string;
  yesPrice: number;
  liquidity: number;
  volume: number;
  poolAddress: string;
  resolvedOutcome?: Outcome | "VOID";
  resolvedAt?: number;
}

interface AgentBook {
  [marketId: string]: { yes: number; no: number };
}

function clampPrice(p: number): number {
  return Math.min(0.99, Math.max(0.01, p));
}

function slugify(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

/**
 * A fully in-memory venue that mirrors `MarketEngine` so agents and UI code
 * behave identically whether they're pointed at this or `LiveEngine`. Prices
 * move with a simple price-impact model (no real order book matching); status
 * is derived from wall-clock time on every read, same as DreamDEX's on-chain
 * markets — see the SDK gotcha "status transitions are time-derived."
 */
export class MockEngine implements MarketEngine {
  readonly mode = "mock" as const;

  private markets = new Map<string, MockMarket>();
  private trades = new Map<string, Trade[]>();
  private positions = new Map<string, AgentBook>();
  private emitter = new EventEmitter();
  private seq = 0;

  constructor(seedDemoMarkets = true) {
    this.emitter.setMaxListeners(50);
    if (seedDemoMarkets) this.seedDemoMarkets();
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}-${randomUUID().slice(0, 6)}`;
  }

  private emit(evt: EngineEvent) {
    this.emitter.emit("event", evt);
  }

  onEvent(cb: (evt: EngineEvent) => void): () => void {
    this.emitter.on("event", cb);
    return () => this.emitter.off("event", cb);
  }

  /** Derives the live status of a market from wall-clock time, resolving it
   * (once, and caching the roll) the first time a read observes it past its
   * settlement window. */
  private materialize(m: MockMarket): MarketSummary {
    const now = Date.now() / 1000;
    let status: MarketStatus;
    if (now < m.expiresAt) {
      status = "TRADING";
    } else if (now < m.expiresAt + SETTLEMENT_WINDOW_SEC) {
      status = "LOCKED";
    } else {
      if (!m.resolvedOutcome) {
        if (m.volume <= 0) {
          m.resolvedOutcome = "VOID";
        } else {
          m.resolvedOutcome = Math.random() < m.yesPrice ? "YES" : "NO";
        }
        m.resolvedAt = now;
        this.emit({ type: "market_resolved", marketId: m.id, outcome: m.resolvedOutcome });
      }
      status = m.resolvedOutcome === "VOID" ? "VOIDED" : "RESOLVED";
    }
    return {
      id: m.id,
      symbol: m.symbol,
      question: m.question,
      category: m.category,
      status,
      createdAt: m.createdAt,
      expiresAt: m.expiresAt,
      yesPrice: Number(m.yesPrice.toFixed(4)),
      noPrice: Number((1 - m.yesPrice).toFixed(4)),
      volume: Number(m.volume.toFixed(2)),
      liquidity: Number(m.liquidity.toFixed(2)),
      createdBy: m.createdBy,
      resolvedOutcome: m.resolvedOutcome,
      poolAddress: m.poolAddress,
    };
  }

  private seedDemoMarkets() {
    const now = Date.now() / 1000;
    const seeds: Array<{ q: string; cat: string; p: number; hrs: number }> = [
      { q: "Will ETH close above $5,000 by Dec 31?", cat: "Crypto", p: 0.42, hrs: 6 },
      { q: "Will the Fed cut rates at the next FOMC meeting?", cat: "Macro", p: 0.61, hrs: 4 },
      { q: "Will Somnia mainnet TPS exceed 1M this quarter?", cat: "Somnia", p: 0.35, hrs: 8 },
      { q: "Will a new all-time high BTC price print this month?", cat: "Crypto", p: 0.28, hrs: 3 },
    ];
    for (const s of seeds) {
      const id = this.nextId("mkt");
      this.markets.set(id, {
        id,
        symbol: `${slugify(s.q)}/USDC#YES`,
        question: s.q,
        category: s.cat,
        createdAt: now,
        expiresAt: now + s.hrs * 3600,
        createdBy: "system-seed",
        yesPrice: s.p,
        liquidity: 5000,
        volume: 0,
        poolAddress: `0xmock${id}`,
      });
      this.trades.set(id, []);
    }
  }

  async listMarkets(filter?: { status?: MarketStatus }): Promise<MarketSummary[]> {
    const all = [...this.markets.values()].map((m) => this.materialize(m));
    all.sort((a, b) => b.createdAt - a.createdAt);
    return filter?.status ? all.filter((m) => m.status === filter.status) : all;
  }

  async getMarket(id: string): Promise<MarketSummary | null> {
    const m = this.markets.get(id);
    return m ? this.materialize(m) : null;
  }

  async getOrderBook(id: string, depth = 5): Promise<OrderBookSnapshot> {
    const m = this.markets.get(id);
    if (!m) throw new Error(`Unknown market: ${id}`);
    const spread = 0.01;
    const bids = Array.from({ length: depth }, (_, i) => ({
      price: clampPrice(m.yesPrice - spread * (i + 1)),
      quantity: Math.max(1, Math.round((m.liquidity / depth) * (1 - i / depth) * 10) / 10),
    }));
    const asks = Array.from({ length: depth }, (_, i) => ({
      price: clampPrice(m.yesPrice + spread * (i + 1)),
      quantity: Math.max(1, Math.round((m.liquidity / depth) * (1 - i / depth) * 10) / 10),
    }));
    return { marketId: id, bids, asks, updatedAt: Date.now() / 1000 };
  }

  async getTrades(id: string, limit = 50): Promise<Trade[]> {
    return (this.trades.get(id) ?? []).slice(-limit).reverse();
  }

  async createMarket(input: CreateMarketInput): Promise<CreateMarketOutput> {
    if (input.expiresInSec <= 0) throw new Error("expiresInSec must be > 0");
    const now = Date.now() / 1000;
    const id = this.nextId("mkt");
    const market: MockMarket = {
      id,
      symbol: `${slugify(input.question)}/USDC#YES`,
      question: input.question,
      category: input.category,
      createdAt: now,
      expiresAt: now + input.expiresInSec,
      createdBy: input.createdBy,
      yesPrice: clampPrice(input.initialProbability ?? 0.5),
      liquidity: 1000,
      volume: 0,
      poolAddress: `0xmock${id}`,
    };
    this.markets.set(id, market);
    this.trades.set(id, []);
    this.positions.forEach((book) => {
      book[id] = book[id] ?? { yes: 0, no: 0 };
    });
    this.emit({ type: "market_created", market: this.materialize(market) });
    return { marketId: id };
  }

  private book(agentId: string): AgentBook {
    let b = this.positions.get(agentId);
    if (!b) {
      b = {};
      this.positions.set(agentId, b);
    }
    return b;
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderOutput> {
    const m = this.markets.get(input.marketId);
    if (!m) throw new Error(`Unknown market: ${input.marketId}`);
    const status = this.materialize(m).status;
    if (status !== "TRADING") {
      throw new Error(`Market ${input.marketId} is ${status}, not accepting orders`);
    }
    if (input.quantity <= 0) throw new Error("quantity must be > 0");
    if (input.price < 0 || input.price > 1) throw new Error("price must be in [0, 1]");

    const pushesUp = input.side === "BUY_YES" || input.side === "SELL_NO";
    const impact = (input.quantity / (m.liquidity + input.quantity)) * IMPACT_SCALE;
    const fillPrice = m.yesPrice;
    m.yesPrice = clampPrice(m.yesPrice + (pushesUp ? impact : -impact));
    m.liquidity += input.quantity * 0.5;
    m.volume += input.quantity * fillPrice;

    const agentId = input.agentId ?? "anonymous";
    const posBook = this.book(agentId);
    const pos = (posBook[input.marketId] ??= { yes: 0, no: 0 });
    switch (input.side) {
      case "BUY_YES":
        pos.yes += input.quantity;
        break;
      case "SELL_YES":
        pos.yes -= input.quantity;
        break;
      case "BUY_NO":
        pos.no += input.quantity;
        break;
      case "SELL_NO":
        pos.no -= input.quantity;
        break;
    }

    const trade: Trade = {
      id: this.nextId("trd"),
      marketId: input.marketId,
      side: input.side,
      price: Number(fillPrice.toFixed(4)),
      quantity: input.quantity,
      agentId: input.agentId,
      timestamp: Date.now() / 1000,
    };
    this.trades.get(input.marketId)!.push(trade);
    this.emit({ type: "trade", trade });

    return { orderId: trade.id, filledQuantity: input.quantity, avgFillPrice: trade.price };
  }

  async mintSet(input: MintSetInput): Promise<{ txHash?: string }> {
    const m = this.markets.get(input.marketId);
    if (!m) throw new Error(`Unknown market: ${input.marketId}`);
    if (input.amount <= 0) throw new Error("amount must be > 0");
    const agentId = input.agentId ?? "anonymous";
    const pos = (this.book(agentId)[input.marketId] ??= { yes: 0, no: 0 });
    pos.yes += input.amount;
    pos.no += input.amount;
    m.liquidity += input.amount;
    return {};
  }

  async faucet(input: FaucetInput = {}): Promise<FaucetOutput> {
    const amount = input.amount ?? FAUCET_CAP_TUSDC;
    if (amount <= 0) throw new Error("amount must be > 0");
    if (amount > FAUCET_CAP_TUSDC) {
      throw new Error(`amount exceeds the ${FAUCET_CAP_TUSDC.toLocaleString()} tUSDC faucet cap`);
    }
    return { amount };
  }

  async getPositions(agentId: string): Promise<Position[]> {
    const book = this.positions.get(agentId) ?? {};
    return Object.entries(book)
      .filter(([, p]) => p.yes !== 0 || p.no !== 0)
      .map(([marketId, p]) => ({ marketId, yesShares: p.yes, noShares: p.no }));
  }

  async redeem(input: RedeemInput): Promise<RedeemOutput> {
    const m = this.markets.get(input.marketId);
    if (!m) throw new Error(`Unknown market: ${input.marketId}`);
    const summary = this.materialize(m);
    if (summary.status !== "RESOLVED" && summary.status !== "VOIDED") {
      throw new Error(`Market ${input.marketId} has not settled yet (status: ${summary.status})`);
    }
    const agentId = input.agentId ?? "anonymous";
    const pos = (this.book(agentId)[input.marketId] ??= { yes: 0, no: 0 });
    const shares = input.outcome === "YES" ? pos.yes : pos.no;
    if (shares <= 0) return { payout: 0 };

    let payout = 0;
    if (summary.status === "VOIDED") {
      payout = shares * 0.5;
    } else if (summary.resolvedOutcome === input.outcome) {
      payout = shares * 1;
    } else {
      payout = 0;
    }
    if (input.outcome === "YES") pos.yes = 0;
    else pos.no = 0;
    return { payout: Number(payout.toFixed(2)) };
  }
}
