import { z } from "zod";
import * as api from "./apiClient.js";
import { buildOrderReceipt, formatOrderReceipt } from "./receipt.js";
import type { BinarySide, MarketStatus, Outcome, OrderType } from "./types.js";

/**
 * Every tool an agent can call, defined once and consumed two ways:
 *  - `jsonSchema` feeds Anthropic's tool-use `input_schema` (see llmLoop.ts) —
 *    the reference runtime this repo runs by default.
 *  - `zodShape` feeds the MCP server (see mcpServer.ts), which is how you
 *    point an external agent host — Hermes Agent, OpenClaw, or anything else
 *    that speaks MCP — at these same market actions instead.
 * Both wrap `proxy-servers/shared/apiClient.ts`, which only ever talks HTTP
 * to the app (`APM_API_URL`) — no chain or engine code lives in this
 * package, live or mock.
 */

export interface ToolContext {
  agentId: string;
}

export interface ToolSpec<Input = unknown> {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  zodShape: z.ZodRawShape;
  run: (input: Input, ctx: ToolContext) => Promise<unknown>;
}

const marketStatusEnum = ["LISTED", "TRADING", "LOCKED", "RESOLVED", "VOIDED"] as const;
const sideEnum = ["BUY_YES", "SELL_YES", "BUY_NO", "SELL_NO"] as const;
const orderTypeEnum = ["LIMIT", "MARKET", "POST_ONLY", "FILL_OR_KILL"] as const;
const outcomeEnum = ["YES", "NO"] as const;

const listMarketsTool: ToolSpec<{ status?: MarketStatus }> = {
  name: "list_markets",
  description:
    "List prediction markets (DreamDEX Event Contracts). Optionally filter by lifecycle status. " +
    "Use this first to see what's tradable before creating a market or placing an order.",
  jsonSchema: {
    type: "object",
    properties: { status: { type: "string", enum: marketStatusEnum } },
  },
  zodShape: { status: z.enum(marketStatusEnum).optional() },
  run: (input) => api.listMarkets(input.status),
};

const getMarketTool: ToolSpec<{ marketId: string }> = {
  name: "get_market",
  description: "Get full detail on one market by id, including current YES/NO price and status.",
  jsonSchema: {
    type: "object",
    properties: { marketId: { type: "string" } },
    required: ["marketId"],
  },
  zodShape: { marketId: z.string() },
  run: (input) => api.getMarket(input.marketId),
};

const getOrderBookTool: ToolSpec<{ marketId: string; depth?: number }> = {
  name: "get_order_book",
  description: "Get the resting bid/ask depth around the current price for one market.",
  jsonSchema: {
    type: "object",
    properties: {
      marketId: { type: "string" },
      depth: { type: "number", description: "Levels per side, default 5" },
    },
    required: ["marketId"],
  },
  zodShape: { marketId: z.string(), depth: z.number().int().positive().optional() },
  run: (input) => api.getOrderBook(input.marketId, input.depth),
};

const createMarketTool: ToolSpec<{
  question: string;
  category: string;
  expiresInSec: number;
  initialProbability?: number;
}> = {
  name: "create_market",
  description:
    "Propose and open a new binary (YES/NO) prediction market. Only meaningful for a creator agent. " +
    "Write a specific, unambiguously resolvable question with a clear deadline baked into the wording. " +
    "Against a live DreamDEX venue (MARKET_ENGINE=live) this always fails: DreamDEX gates market creation " +
    "behind an operator-owned admin surface, not a permissionless call any wallet can make — treat that " +
    "failure as expected and permanent for the turn, not something to retry.",
  jsonSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The YES/NO question, phrased to be unambiguously resolvable." },
      category: { type: "string", description: "Short topic label, e.g. Crypto, Macro, Sports." },
      expiresInSec: { type: "number", description: "Seconds from now until the market locks." },
      initialProbability: { type: "number", description: "Seed YES probability in [0,1], default 0.5." },
    },
    required: ["question", "category", "expiresInSec"],
  },
  zodShape: {
    question: z.string().min(8),
    category: z.string().min(1),
    expiresInSec: z.number().int().positive(),
    initialProbability: z.number().min(0).max(1).optional(),
  },
  run: (input, ctx) => api.createMarket({ ...input, createdBy: ctx.agentId }),
};

const placeOrderTool: ToolSpec<{
  marketId: string;
  side: BinarySide;
  price: number;
  quantity: number;
  orderType?: OrderType;
}> = {
  name: "place_order",
  description:
    "Place an order on a market's order book. BUY_YES/SELL_NO bet the event happens; SELL_YES/BUY_NO bet " +
    "it doesn't. `price` is the probability you're willing to pay, in [0,1].",
  jsonSchema: {
    type: "object",
    properties: {
      marketId: { type: "string" },
      side: { type: "string", enum: sideEnum },
      price: { type: "number", description: "Probability price in [0,1]." },
      quantity: { type: "number", description: "Outcome shares to trade." },
      orderType: { type: "string", enum: orderTypeEnum, description: "Default LIMIT." },
    },
    required: ["marketId", "side", "price", "quantity"],
  },
  zodShape: {
    marketId: z.string(),
    side: z.enum(sideEnum),
    price: z.number().min(0).max(1),
    quantity: z.number().positive(),
    orderType: z.enum(orderTypeEnum).optional(),
  },
  run: async (input, ctx) => {
    const fill = await api.placeOrder({ ...input, agentId: ctx.agentId });
    const market = await api.getMarket(input.marketId).catch(() => undefined);
    const receipt = buildOrderReceipt({
      side: input.side,
      marketId: input.marketId,
      marketQuestion: market?.question,
      price: input.price,
      quantity: input.quantity,
      fill,
      timestamp: Date.now() / 1000,
    });
    return { ...fill, marketQuestion: market?.question, receipt: formatOrderReceipt(receipt) };
  },
};

const mintSetTool: ToolSpec<{ marketId: string; amount: number }> = {
  name: "mint_set",
  description:
    "Deposit collateral to mint an equal number of YES and NO shares on a market (a complete set). " +
    "Useful to bootstrap inventory before market-making both sides, or before selling one side outright.",
  jsonSchema: {
    type: "object",
    properties: { marketId: { type: "string" }, amount: { type: "number" } },
    required: ["marketId", "amount"],
  },
  zodShape: { marketId: z.string(), amount: z.number().positive() },
  run: (input, ctx) => api.mintSet({ ...input, agentId: ctx.agentId }),
};

const getPositionsTool: ToolSpec<Record<string, never>> = {
  name: "get_positions",
  description: "List your own open YES/NO share positions across every market.",
  jsonSchema: { type: "object", properties: {} },
  zodShape: {},
  run: (_input, ctx) => api.getPositions(ctx.agentId),
};

const redeemTool: ToolSpec<{ marketId: string; outcome: Outcome }> = {
  name: "redeem",
  description:
    "Redeem settled shares for collateral once a market has RESOLVED or VOIDED. No-ops (payout 0) if you " +
    "hold none of the given outcome.",
  jsonSchema: {
    type: "object",
    properties: { marketId: { type: "string" }, outcome: { type: "string", enum: outcomeEnum } },
    required: ["marketId", "outcome"],
  },
  zodShape: { marketId: z.string(), outcome: z.enum(outcomeEnum) },
  run: (input, ctx) => api.redeem({ ...input, agentId: ctx.agentId }),
};

const getErc8004StatusTool: ToolSpec<Record<string, never>> = {
  name: "get_erc8004_status",
  description:
    "Check whether this agent's own wallet is currently registered with the ERC-8004 Identity Registry, and " +
    "its Agent-ID if so. This is a live on-chain check, not this conversation's own memory of past " +
    "register_erc8004_identity attempts — registration can happen outside this chat entirely (another " +
    "session, the CLI, directly against the contract), so past failures in this thread don't necessarily " +
    "mean you're still unregistered now, and a past success here doesn't guarantee it either. Call this " +
    "before register_erc8004_identity to avoid minting a redundant second identity if one already exists.",
  jsonSchema: { type: "object", properties: {} },
  zodShape: {},
  run: (_input, ctx) => api.getErc8004Status(ctx.agentId),
};

const registerErc8004IdentityTool: ToolSpec<Record<string, never>> = {
  name: "register_erc8004_identity",
  description:
    "Register this agent's own wallet with the ERC-8004 Identity Registry, minting an Agent-ID NFT on-chain " +
    "(see contracts/doc/erc8004/ERC8004.md). Call get_erc8004_status first — this always mints a *new* " +
    "Agent-ID with no check for an existing one, so calling it again after already registering just creates " +
    "a redundant second identity rather than failing or no-opping. Call this once, before your first " +
    "place_order BUY_YES/BUY_NO — the platform fee payment (X402FeeVault.payFee) now reverts for any wallet " +
    "that hasn't registered, so an unregistered buy attempt will fail. Requires this agent to have its own " +
    "wallet configured (ADA_AGENT_WALLET_PRIVATE_KEY/NOMI_AGENT_WALLET_PRIVATE_KEY/AGENT_WALLET_PRIVATE_KEY) " +
    "— no-op error otherwise.",
  jsonSchema: { type: "object", properties: {} },
  zodShape: {},
  run: (_input, ctx) => api.registerErc8004Identity(ctx.agentId),
};

const faucetTool: ToolSpec<{ amount?: number }> = {
  name: "faucet",
  description:
    "Mint testnet tUSDC (Somnia testnet only) to your own wallet, up to a 10,000 tUSDC cap per call. Use " +
    "this before mint_set/place_order if a call fails because your wallet is unfunded.",
  jsonSchema: {
    type: "object",
    properties: {
      amount: { type: "number", description: "tUSDC to mint, up to 10,000. Omit to mint the full 10,000 cap." },
    },
  },
  zodShape: { amount: z.number().positive().max(10_000).optional() },
  run: (input, ctx) => api.faucet({ ...(input ?? {}), agentId: ctx.agentId }),
};

export const ALL_TOOLS: ToolSpec<any>[] = [
  listMarketsTool,
  getMarketTool,
  getOrderBookTool,
  createMarketTool,
  placeOrderTool,
  mintSetTool,
  getPositionsTool,
  redeemTool,
  faucetTool,
  getErc8004StatusTool,
  registerErc8004IdentityTool,
];

export const TRADING_TOOLS = ALL_TOOLS.filter((t) => t.name !== "create_market");
export const CREATOR_TOOLS = ALL_TOOLS.filter((t) => t.name !== "place_order" && t.name !== "mint_set" && t.name !== "redeem");
