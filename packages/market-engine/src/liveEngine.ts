import {
  SomniaMarkets,
  SOMNIA_MAINNET_ADDRESSES,
  SOMNIA_TESTNET_ADDRESSES,
  upProbability,
  toHuman,
  fromHuman,
} from "@somnia-chain/markets-sdk";
// eslint-disable-next-line import/no-unresolved -- subpath export, see package "exports"
import { somniaMainnet, somniaShannon } from "@somnia-chain/markets-sdk/chains";
import type { BinaryMarket, SomniaMarketsAddresses, WatchHandle } from "@somnia-chain/markets-sdk";
import type { Chain } from "viem";
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

/** tUSDC's on-chain decimals (see contracts/README.md) — the SDK doesn't
 * expose a lookup for it, so this stays a literal matching the deployed
 * collateral token rather than an extra indexer round-trip per faucet call. */
const TUSDC_DECIMALS = 6;

/** DreamDEX's on-chain `faucet(uint256 amount)` cap; calls above it revert
 * with `FaucetCapExceeded`. See docs.dreamdex.io/developers/event-contracts. */
const FAUCET_CAP_TUSDC = 10_000;

export type SomniaNetwork = "mainnet" | "testnet";

export interface LiveEngineConfig {
  network: SomniaNetwork;
  indexerUrl?: string;
  wsRpcUrl?: string;
  /**
   * The wallet every trade this instance places executes from. DreamDEX
   * Event Contracts attribute on-chain fills to ONE address per key — there
   * is no permissionless per-agent wallet at the contract level — so a
   * `LiveEngine` built with one key only ever trades as that one on-chain
   * account. `app/src/lib/engine.ts` gives Ada and Nomi genuinely separate
   * on-chain positions by doing exactly what this comment used to only
   * suggest: it builds one `LiveEngine` per distinct key (`ADA_AGENT_WALLET_PRIVATE_KEY`
   * / `NOMI_AGENT_WALLET_PRIVATE_KEY`, both falling back to the shared
   * `SOMNIA_PRIVATE_KEY`) and picks the instance per request by `agentId`,
   * caching each on `globalThis` the same way the old single-engine cache did.
   */
  privateKey?: `0x${string}`;
}

const NETWORK_DEFAULTS: Record<
  SomniaNetwork,
  { indexerUrl: string; wsRpcUrl: string; chain: Chain; addresses: SomniaMarketsAddresses }
> = {
  testnet: {
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
    chain: somniaShannon,
    addresses: SOMNIA_TESTNET_ADDRESSES,
  },
  mainnet: {
    indexerUrl: "https://prd.smk.somnia.host/v1/graphql",
    wsRpcUrl: "wss://api.infra.mainnet.somnia.network/ws",
    chain: somniaMainnet,
    addresses: SOMNIA_MAINNET_ADDRESSES,
  },
};

const STATUS_MAP: Record<string, MarketStatus> = {
  Listed: "LISTED",
  Trading: "TRADING",
  Locked: "LOCKED",
  Settling: "LOCKED",
  Resolved: "RESOLVED",
  Voided: "VOIDED",
  Finalized: "RESOLVED",
};

/**
 * Thrown by operations DreamDEX gates behind protocol-operator permissions
 * (e.g. deploying a MarketCreator via `MarketCreatorAdmin.createMarketCreator`
 * + `registerSeries`) that a demo agent wallet cannot perform permissionlessly.
 * Run against `MARKET_ENGINE=mock` to let the creator agent's flow run
 * end-to-end instead.
 */
export class NotSupportedInLiveModeError extends Error {
  constructor(op: string) {
    super(
      `${op} is not supported against live DreamDEX Event Contracts: on Somnia Markets, deploying ` +
        `new binary markets goes through the operator-owned MarketCreatorAdmin surface ` +
        `(createMarketCreator → registerSeries → triggerRoll), not a permissionless call any wallet can ` +
        `make. Set MARKET_ENGINE=mock to run the creator agent against the in-memory venue instead, or wire ` +
        `MarketCreatorAdmin credentials yourself if you operate a DreamDEX venue.`,
    );
    this.name = "NotSupportedInLiveModeError";
  }
}

/**
 * Wraps `@somnia-chain/markets-sdk`'s unified (ccxt-style) exchange surface
 * as a `MarketEngine` against real Somnia Event Contracts. Reads need no
 * signer; writes (`placeOrder`, `mintSet`, `redeem`) require `privateKey`.
 */
export class LiveEngine implements MarketEngine {
  readonly mode = "live" as const;

  private exchange: SomniaMarkets;
  private loaded = false;
  private symbolById = new Map<string, string>();

  constructor(config: LiveEngineConfig) {
    const defaults = NETWORK_DEFAULTS[config.network];
    this.exchange = new SomniaMarkets({
      indexerUrl: config.indexerUrl ?? defaults.indexerUrl,
      wsRpcUrl: config.wsRpcUrl ?? defaults.wsRpcUrl,
      chain: defaults.chain,
      addresses: defaults.addresses,
      privateKey: config.privateKey,
    });
  }

  private async ensureLoaded(reload = false) {
    if (this.loaded && !reload) return;
    await this.exchange.loadMarkets(reload);
    this.symbolById.clear();
    for (const m of Object.values(this.exchange.markets)) {
      if (m.type === "binary") this.symbolById.set(m.id, m.symbol);
    }
    this.loaded = true;
  }

  private toSummary(info: BinaryMarket): MarketSummary {
    const yesPrice = upProbability(info.lastPrice, info.quoteDecimals) ?? 0.5;
    return {
      id: info.marketId,
      symbol: `${info.asset}/${"USDC"}`,
      question: info.question,
      category: info.asset,
      status: STATUS_MAP[info.status] ?? "LISTED",
      createdAt: Number(info.createdAtTimestamp),
      expiresAt: Number(info.expiry),
      yesPrice: Number(yesPrice.toFixed(4)),
      noPrice: Number((1 - yesPrice).toFixed(4)),
      volume: toHuman(info.cumulativeQuoteVolume, info.quoteDecimals),
      liquidity: toHuman(info.backing, info.quoteDecimals),
      createdBy: info.creator ?? undefined,
      resolvedOutcome:
        info.status === "Voided"
          ? "VOID"
          : info.winningOutcome === 0
            ? "YES"
            : info.winningOutcome === 1
              ? "NO"
              : undefined,
      poolAddress: info.poolAddress,
    };
  }

  async listMarkets(filter?: { status?: MarketStatus }): Promise<MarketSummary[]> {
    await this.ensureLoaded();
    const rows = await this.exchange.fetchMarkets();
    const binaries = rows
      .filter((m) => m.type === "binary")
      .map((m) => this.toSummary(m.info as BinaryMarket));
    return filter?.status ? binaries.filter((m) => m.status === filter.status) : binaries;
  }

  async getMarket(id: string): Promise<MarketSummary | null> {
    const info = await this.exchange.client.getBinaryMarket(id);
    return info ? this.toSummary(info) : null;
  }

  private async symbolFor(marketId: string): Promise<string> {
    await this.ensureLoaded();
    const symbol = this.symbolById.get(marketId);
    if (!symbol) throw new Error(`Unknown or non-binary market: ${marketId}`);
    return symbol;
  }

  async getOrderBook(id: string, depth = 5): Promise<OrderBookSnapshot> {
    const symbol = await this.symbolFor(id);
    const book = await this.exchange.fetchOrderBook(`${symbol}#YES`, depth);
    return {
      marketId: id,
      bids: book.bids.map(([price, quantity]) => ({ price, quantity })),
      asks: book.asks.map(([price, quantity]) => ({ price, quantity })),
      updatedAt: (book.timestamp ?? Date.now()) / 1000,
    };
  }

  async getTrades(id: string, limit = 50): Promise<Trade[]> {
    const symbol = await this.symbolFor(id);
    const fills = await this.exchange.fetchTrades(`${symbol}#YES`, undefined, limit);
    return fills.map((f) => ({
      id: f.id,
      marketId: id,
      side: f.side === "sell" ? "SELL_YES" : "BUY_YES",
      price: f.price,
      quantity: f.amount,
      timestamp: f.timestamp / 1000,
      txHash: f.txHash,
    }));
  }

  async createMarket(_input: CreateMarketInput): Promise<CreateMarketOutput> {
    throw new NotSupportedInLiveModeError("createMarket");
  }

  private static refAndSide(symbol: string, side: BinarySide): { ref: string; side: "buy" | "sell" } {
    switch (side) {
      case "BUY_YES":
        return { ref: `${symbol}#YES`, side: "buy" };
      case "SELL_YES":
        return { ref: `${symbol}#YES`, side: "sell" };
      case "BUY_NO":
        return { ref: `${symbol}#NO`, side: "buy" };
      case "SELL_NO":
        return { ref: `${symbol}#NO`, side: "sell" };
    }
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderOutput> {
    const symbol = await this.symbolFor(input.marketId);
    const { ref, side } = LiveEngine.refAndSide(symbol, input.side);
    const order = await this.exchange.createOrder(
      ref,
      input.orderType === "MARKET" ? "market" : "limit",
      side,
      input.quantity,
      input.orderType === "MARKET" ? undefined : input.price,
      { postOnly: input.orderType === "POST_ONLY", timeInForce: input.orderType === "FILL_OR_KILL" ? "FOK" : undefined },
    );
    return {
      orderId: order.id,
      filledQuantity: order.filled,
      avgFillPrice: order.price,
      txHash: order.txHash,
    };
  }

  async mintSet(input: MintSetInput): Promise<{ txHash?: string }> {
    const symbol = await this.symbolFor(input.marketId);
    const res = await this.exchange.mintSet(symbol, input.amount);
    return { txHash: (res as { hash?: string }).hash };
  }

  async faucet(input: FaucetInput = {}): Promise<FaucetOutput> {
    const amount = input.amount ?? FAUCET_CAP_TUSDC;
    if (amount <= 0) throw new Error("amount must be > 0");
    if (amount > FAUCET_CAP_TUSDC) {
      throw new Error(`amount exceeds the ${FAUCET_CAP_TUSDC.toLocaleString()} tUSDC faucet cap`);
    }
    const res = await this.exchange.trader.faucet({ amount: fromHuman(amount, TUSDC_DECIMALS) });
    return { amount, txHash: res.hash, walletAddress: this.exchange.walletAddress };
  }

  async getPositions(_agentId: string): Promise<Position[]> {
    await this.ensureLoaded();
    const balances = await this.exchange.fetchBalance();
    const positions = new Map<string, Position>();
    for (const [marketId, symbol] of this.symbolById) {
      const yes = balances[`${symbol}#YES`]?.total ?? 0;
      const no = balances[`${symbol}#NO`]?.total ?? 0;
      if (yes !== 0 || no !== 0) positions.set(marketId, { marketId, yesShares: yes, noShares: no });
    }
    return [...positions.values()];
  }

  async redeem(input: RedeemInput): Promise<RedeemOutput> {
    const symbol = await this.symbolFor(input.marketId);
    const balances = await this.exchange.fetchBalance();
    const shares = balances[`${symbol}#${input.outcome}`]?.total ?? 0;
    if (shares <= 0) return { payout: 0 };
    const res = await this.exchange.redeem(symbol, shares);
    const market = await this.getMarket(input.marketId);
    const payout = market?.status === "VOIDED" ? shares * 0.5 : shares;
    return { payout, txHash: (res as { hash?: string }).hash };
  }

  /**
   * Diffs `listMarkets()`/`getTrades()` snapshots against a locally-tracked
   * baseline, re-run whenever `client.subscribeLive` says the live store
   * changed. Goes through the same human-unit exchange calls `listMarkets`/
   * `getTrades` already use (rather than the raw bigint `client.getLiveFills`
   * tier) so this can't drift from what a one-shot read already returns —
   * the cost is one extra indexer round-trip per market per diff instead of
   * a zero-RTT local read, acceptable at demo scale (a handful of markets,
   * ticks tens of seconds apart).
   */
  onEvent(cb: (evt: EngineEvent) => void): () => void {
    const DEBOUNCE_MS = 500;
    let stopped = false;
    let seeded = false;
    let diffing = false;
    let rerunPending = false;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const knownStatus = new Map<string, MarketStatus>();
    const knownTradeIds = new Map<string, Set<string>>();
    let handle: WatchHandle | undefined;
    let unsubscribe: (() => void) | undefined;

    const diff = async () => {
      if (stopped) return;
      if (diffing) {
        rerunPending = true;
        return;
      }
      diffing = true;
      try {
        const markets = await this.listMarkets();
        for (const m of markets) {
          const prevStatus = knownStatus.get(m.id);
          knownStatus.set(m.id, m.status);
          if (seeded) {
            if (prevStatus === undefined) {
              cb({ type: "market_created", market: m });
            } else if (
              prevStatus !== m.status &&
              (m.status === "RESOLVED" || m.status === "VOIDED")
            ) {
              cb({ type: "market_resolved", marketId: m.id, outcome: (m.resolvedOutcome ?? "VOID") as Outcome | "VOID" });
            }
          }

          const seen = knownTradeIds.get(m.id) ?? new Set<string>();
          const isNewMarketToUs = !knownTradeIds.has(m.id);
          knownTradeIds.set(m.id, seen);
          const trades = await this.getTrades(m.id, 40);
          for (const t of trades) {
            if (seen.has(t.id)) continue;
            seen.add(t.id);
            if (seeded && !isNewMarketToUs) cb({ type: "trade", trade: t });
          }
        }
        seeded = true;
      } catch {
        // Transient indexer hiccup — the next live-store signal retries.
      } finally {
        diffing = false;
        if (!stopped && rerunPending) {
          rerunPending = false;
          void diff();
        }
      }
    };

    const scheduleDiff = () => {
      if (stopped) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void diff(), DEBOUNCE_MS);
    };

    void (async () => {
      await this.ensureLoaded();
      if (stopped) return;
      handle = await this.exchange.client.watchMarkets({ discover: true });
      if (stopped) {
        handle.stop();
        return;
      }
      await diff(); // seed the baseline silently before wiring the live signal
      unsubscribe = this.exchange.client.subscribeLive(scheduleDiff);
    })();

    return () => {
      stopped = true;
      clearTimeout(debounceTimer);
      unsubscribe?.();
      handle?.stop();
    };
  }
}
