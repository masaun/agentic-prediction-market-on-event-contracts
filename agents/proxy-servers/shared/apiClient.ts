import type {
  ActivityEntry,
  BinarySide,
  MarketStatus,
  MarketSummary,
  OrderBookSnapshot,
  OrderType,
  Outcome,
  Position,
} from "./types.js";
import { hasOwnWallet, payPlatformFee, registerAgentIdentity, resolveTradingEngine } from "./wallet.js";

const BASE_URL = process.env.APM_API_URL ?? "http://localhost:3000";
const AGENT_KEY = process.env.APM_AGENT_API_KEY;

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(AGENT_KEY ? { "x-apm-agent-key": AGENT_KEY } : {}),
    ...extra,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`APM API ${init?.method ?? "GET"} ${path} -> ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

/** Shape of the `PaymentRequirements` app/src/lib/x402.ts quotes in its 402
 * response body — see contracts/doc/x402/X402.md. */
interface X402PaymentRequirements {
  x402Version: 1;
  scheme: string;
  network: string;
  resource: string;
  asset: string;
  payTo: string;
  maxAmountRequired: string;
  extra: { marketId: string; nonce: string; validBefore: number };
}

export async function listMarkets(status?: MarketStatus): Promise<MarketSummary[]> {
  const qs = status ? `?status=${status}` : "";
  const { markets } = await request<{ markets: MarketSummary[] }>(`/api/markets${qs}`);
  return markets;
}

export async function getMarket(marketId: string): Promise<MarketSummary> {
  const { market } = await request<{ market: MarketSummary }>(`/api/markets/${marketId}`);
  return market;
}

export async function getOrderBook(marketId: string, depth = 5): Promise<OrderBookSnapshot> {
  return request<OrderBookSnapshot>(`/api/markets/${marketId}/orderbook?depth=${depth}`);
}

export async function createMarket(input: {
  question: string;
  category: string;
  expiresInSec: number;
  createdBy: string;
  initialProbability?: number;
}): Promise<{ marketId: string }> {
  return request(`/api/markets`, { method: "POST", body: JSON.stringify(input) });
}

/**
 * BUY_YES/BUY_NO from an agent with its own configured wallet (see
 * proxy-servers/shared/wallet.ts) run the full x402 flow from
 * contracts/doc/x402/X402.md: pay the platform fee on-chain from that
 * wallet, get the App to verify it, then place the DreamDEX order directly
 * from that same wallet, bypassing the App entirely for the trade itself.
 *
 * Everything else — SELL_YES/SELL_NO, or any agent with no configured wallet
 * (including every agent running against MARKET_ENGINE=mock, where a real
 * wallet has no meaning) — is the original single-call, App-custodied path,
 * unchanged.
 */
export async function placeOrder(input: {
  marketId: string;
  side: BinarySide;
  price: number;
  quantity: number;
  orderType?: OrderType;
  agentId: string;
}): Promise<{
  orderId?: string;
  filledQuantity: number;
  avgFillPrice?: number;
  txHash?: string;
  payment?: { feeAmount: number; txHash?: string };
}> {
  const { marketId, ...body } = input;
  const isBuy = input.side === "BUY_YES" || input.side === "BUY_NO";

  if (!isBuy || !hasOwnWallet(input.agentId)) {
    return request(`/api/markets/${marketId}/orders`, { method: "POST", body: JSON.stringify(body) });
  }

  const buyPath = `/api/markets/${marketId}/buy`;
  const buyBody = JSON.stringify({ side: input.side, price: input.price, quantity: input.quantity, agentId: input.agentId });

  const challenge = await fetch(`${BASE_URL}${buyPath}`, { method: "POST", headers: authHeaders(), body: buyBody });
  if (challenge.status !== 402) {
    const text = await challenge.text().catch(() => "");
    throw new Error(`APM API POST ${buyPath} -> expected 402 Payment Required, got ${challenge.status}: ${text}`);
  }
  const { accepts } = (await challenge.json()) as { accepts?: X402PaymentRequirements[] };
  const requirements = accepts?.[0];
  if (!requirements) throw new Error(`APM API POST ${buyPath} returned 402 with no payment requirements`);

  const { txHash: feeTxHash } = await payPlatformFee({
    agentId: input.agentId,
    vaultAddress: requirements.payTo as `0x${string}`,
    tokenAddress: requirements.asset as `0x${string}`,
    feeAmountAtomic: BigInt(requirements.maxAmountRequired),
    nonce: requirements.extra.nonce as `0x${string}`,
    marketId: requirements.extra.marketId,
  });

  const paymentHeader = Buffer.from(JSON.stringify({ txHash: feeTxHash, nonce: requirements.extra.nonce })).toString("base64");
  const cleared = await fetch(`${BASE_URL}${buyPath}`, {
    method: "POST",
    headers: authHeaders({ "x-payment": paymentHeader }),
    body: buyBody,
  });
  if (!cleared.ok) {
    const text = await cleared.text().catch(() => "");
    throw new Error(`APM API POST ${buyPath} (with payment) -> ${cleared.status}: ${text}`);
  }
  const clearance = (await cleared.json()) as { feeAmount: number; txHash: string };

  const engine = resolveTradingEngine(input.agentId);
  if (!engine) throw new Error(`No trading engine resolved for agent "${input.agentId}" despite a configured wallet`);
  const fill = await engine.placeOrder({
    marketId,
    side: input.side,
    price: input.price,
    quantity: input.quantity,
    orderType: input.orderType,
    agentId: input.agentId,
  });

  return {
    orderId: fill.orderId,
    filledQuantity: fill.filledQuantity,
    avgFillPrice: fill.avgFillPrice,
    txHash: fill.txHash,
    payment: { feeAmount: clearance.feeAmount, txHash: clearance.txHash },
  };
}

export async function mintSet(input: { marketId: string; amount: number; agentId: string }): Promise<{ txHash?: string }> {
  const { marketId, ...body } = input;
  return request(`/api/markets/${marketId}/mint`, { method: "POST", body: JSON.stringify(body) });
}

export async function getPositions(agentId: string): Promise<Position[]> {
  const { positions } = await request<{ positions: Position[] }>(`/api/agents/${agentId}/positions`);
  return positions;
}

export async function redeem(input: { marketId: string; outcome: Outcome; agentId: string }): Promise<{ payout: number }> {
  const { marketId, ...body } = input;
  return request(`/api/markets/${marketId}/redeem`, { method: "POST", body: JSON.stringify(body) });
}

export async function faucet(input: {
  amount?: number;
  agentId?: string;
}): Promise<{ amount: number; txHash?: string; walletAddress?: string }> {
  return request(`/api/faucet`, { method: "POST", body: JSON.stringify(input) });
}

export async function registerAgent(input: {
  id: string;
  name: string;
  role: "creator" | "bettor";
  persona: string;
  avatarEmoji?: string;
}): Promise<void> {
  await request(`/api/agents/register`, { method: "POST", body: JSON.stringify(input) });
}

export async function reportActivity(entry: ActivityEntry): Promise<void> {
  await request(`/api/agents/${entry.agentId}/activity`, { method: "POST", body: JSON.stringify(entry) });
}

/**
 * Live on-chain registration status for this agent's wallet — `GET /api/agents/:id/erc8004`
 * always re-checks `IdentityRegistry.balanceOf`/`ownerOf` rather than trusting the app's own
 * cached record, so this reflects reality even if registration happened outside this chat session
 * entirely (another session, the CLI, `cast send` directly — see contracts/doc/erc8004/ERC8004.md's
 * "Registration status is checked on-chain, not just read from the store"). Call this before
 * `registerErc8004Identity` to avoid minting a redundant second identity if one already exists.
 */
export async function getErc8004Status(
  agentId: string,
): Promise<{ registered: boolean; erc8004AgentId?: string; walletAddress?: string }> {
  return request(`/api/agents/${agentId}/erc8004`);
}

/**
 * Registers this agent's own wallet with the ERC-8004 Identity Registry directly on-chain (see
 * proxy-servers/shared/wallet.ts's `registerAgentIdentity` and contracts/doc/erc8004/ERC8004.md),
 * then reports the minted `erc8004AgentId` back to the app so it shows up on `/agents/:id` — the
 * app never signs or broadcasts this transaction itself, same division of labor as the x402 buy
 * flow's on-chain leg.
 */
export async function registerErc8004Identity(
  agentId: string,
): Promise<{ erc8004AgentId: string; txHash: string; agentURI: string; walletAddress: string }> {
  const { erc8004AgentId, txHash, agentURI, walletAddress } = await registerAgentIdentity(agentId);
  await request(`/api/agents/${agentId}/erc8004`, {
    method: "POST",
    body: JSON.stringify({ erc8004AgentId: erc8004AgentId.toString(), txHash, walletAddress }),
  });
  return { erc8004AgentId: erc8004AgentId.toString(), txHash, agentURI, walletAddress };
}
