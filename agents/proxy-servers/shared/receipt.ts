import type { BinarySide } from "./types.js";

/**
 * Builds the one order-execution receipt every front door renders identically:
 * the internal CLI (`demo-agents/cli/`), the external-agent CLIs bundled with
 * Hermes Agent / OpenClaw (`agent-skills/hermes-agent/cli/`, `agent-skills/open-claw/cli/`),
 * Open WebUI chat (via
 * `llmLoop.ts`), and the raw JSON an MCP-connected external agent host sees.
 * Built once here — inside `place_order`'s own `tool.run()` in `shared/tools.ts`
 * — instead of left to each front door (or, worse, an LLM's own free-text
 * narration) to reconstruct the price/quantity/tx-hash/market-title fields
 * from scratch, which is how the same fill ends up described inconsistently
 * (or with fields quietly dropped) depending on who's telling the story.
 */

const EXPLORER_BASE_URL: Record<"testnet" | "mainnet", string> = {
  testnet: "https://shannon-explorer.somnia.network",
  mainnet: "https://explorer.somnia.network",
};

export function explorerTxUrl(txHash: string): string {
  const network = (process.env.SOMNIA_NETWORK ?? "testnet").toLowerCase() === "mainnet" ? "mainnet" : "testnet";
  return `${EXPLORER_BASE_URL[network]}/tx/${txHash}`;
}

function splitSide(side: BinarySide): { action: "BUY" | "SELL"; outcome: "YES" | "NO" } {
  const [action, outcome] = side.split("_") as ["BUY" | "SELL", "YES" | "NO"];
  return { action, outcome };
}

export interface OrderReceipt {
  action: "BUY" | "SELL";
  outcome: "YES" | "NO";
  marketId: string;
  marketQuestion?: string;
  requestedQuantity: number;
  requestedPrice: number;
  filledQuantity: number;
  avgFillPrice?: number;
  orderId?: string;
  txHash?: string;
  feeAmount?: number;
  feeTxHash?: string;
  timestamp: number;
}

export function buildOrderReceipt(input: {
  side: BinarySide;
  marketId: string;
  marketQuestion?: string;
  price: number;
  quantity: number;
  fill: { orderId?: string; filledQuantity: number; avgFillPrice?: number; txHash?: string; payment?: { feeAmount: number; txHash?: string } };
  timestamp: number;
}): OrderReceipt {
  const { action, outcome } = splitSide(input.side);
  return {
    action,
    outcome,
    marketId: input.marketId,
    marketQuestion: input.marketQuestion,
    requestedQuantity: input.quantity,
    requestedPrice: input.price,
    filledQuantity: input.fill.filledQuantity,
    avgFillPrice: input.fill.avgFillPrice,
    orderId: input.fill.orderId,
    txHash: input.fill.txHash,
    feeAmount: input.fill.payment?.feeAmount,
    feeTxHash: input.fill.payment?.txHash,
    timestamp: input.timestamp,
  };
}

/** Renders as plain labeled lines (bare explorer URLs, no markdown-table/link syntax) so it reads
 * cleanly whether it lands in Open WebUI (full markdown), a CLI terminal, or a messenger gateway
 * (Slack/Telegram/Discord) that only auto-links bare URLs rather than rendering `[text](url)`. */
export function formatOrderReceipt(r: OrderReceipt): string {
  const fillPrice = r.avgFillPrice ?? r.requestedPrice;
  const cost = r.filledQuantity * fillPrice;

  const status =
    r.filledQuantity === 0
      ? "🕓 Order Placed — Resting on Book"
      : r.filledQuantity < r.requestedQuantity
        ? "⚠️ Order Partially Filled"
        : "✅ Order Filled";

  const field = (label: string, value: string) => `${label}:`.padEnd(16) + value;

  const lines = [
    `${status} — ${r.action} ${r.outcome}`,
    field("Market", r.marketQuestion ?? "(unknown)"),
    field("Market ID", r.marketId),
    field(
      "Quantity",
      `${r.filledQuantity} ${r.outcome} shares${r.filledQuantity !== r.requestedQuantity ? ` (of ${r.requestedQuantity} requested)` : ""}`,
    ),
    field("Fill Price", fillPrice.toFixed(3)),
    field(`Total ${r.action === "BUY" ? "Cost" : "Proceeds"}`, `${cost.toFixed(4)} tUSDC`),
  ];
  if (r.feeAmount !== undefined) lines.push(field("Platform Fee", `${r.feeAmount.toFixed(6)} tUSDC`));
  if (r.orderId) lines.push(field("Order ID", r.orderId));
  if (r.txHash) lines.push(field("Order Tx", explorerTxUrl(r.txHash)));
  if (r.feeTxHash) lines.push(field("Fee Tx", explorerTxUrl(r.feeTxHash)));
  lines.push(field("Executed", new Date(r.timestamp * 1000).toISOString()));
  return lines.join("\n");
}
