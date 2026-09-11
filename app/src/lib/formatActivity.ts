import type { LiveActivityEntry } from "@/lib/useLiveFeed";
import { formatCountdown, formatPct, shortId } from "@/lib/format";

/**
 * Tools that actually change market state. Read-only lookups (list_markets,
 * get_market, get_order_book, get_positions) are deliberately excluded from
 * both the "Live agent activity" feed and each agent's "Activity log" —
 * publishing what an agent is looking at, not just what it does, would leak
 * its research/strategy to competing agents watching the feed.
 */
const MUTATING_TOOLS = new Set(["create_market", "place_order", "mint_set", "redeem", "faucet", "register_erc8004_identity"]);

/**
 * Whether an activity entry should ever reach the UI. Narrative "reasoning"
 * entries are hidden outright — that's exactly where an agent's rationale
 * ("why this probability, why now") would leak to competitors, and it's also
 * where a chat client's title/tags/follow-up generation (see
 * agents/proxy-servers/shared/chatServer.ts) can round-trip through as a stray JSON
 * blob. Only state-changing actions (see MUTATING_TOOLS) are shown.
 */
export function isVisibleActivity(entry: LiveActivityEntry): boolean {
  if (entry.kind === "reasoning") return false;
  if (entry.kind === "action") {
    const tool = entry.data?.tool;
    return typeof tool === "string" && MUTATING_TOOLS.has(tool);
  }
  return true;
}

/** Renders a visible activity entry into a human-readable sentence. */
export function formatActivityMessage(entry: LiveActivityEntry): string {
  if (entry.kind === "action") return formatAction(entry);
  return entry.message;
}

function sideLabel(side: string): string {
  switch (side) {
    case "BUY_YES":
      return "Buy YES";
    case "SELL_YES":
      return "Sell YES";
    case "BUY_NO":
      return "Buy NO";
    case "SELL_NO":
      return "Sell NO";
    default:
      return side;
  }
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  if (v && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function describeToolCall(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case "create_market": {
      const parts = [String(input.category)];
      if (typeof input.expiresInSec === "number") parts.push(`expires in ${formatCountdown(Date.now() / 1000 + input.expiresInSec)}`);
      if (typeof input.initialProbability === "number") parts.push(`initial YES ${formatPct(input.initialProbability)}`);
      return `Created a new market: "${input.question}" (${parts.join(", ")})`;
    }
    case "place_order": {
      const orderType = input.orderType ? String(input.orderType) : "LIMIT";
      return `Placed a ${orderType} order — ${sideLabel(String(input.side))} ${formatValue(input.quantity)} shares @ ${formatPct(
        Number(input.price),
      )} on market ${shortId(String(input.marketId))}`;
    }
    case "mint_set":
      return `Minted ${formatValue(input.amount)} complete YES/NO share sets on market ${shortId(String(input.marketId))}`;
    case "redeem":
      return `Redeemed ${input.outcome} shares on market ${shortId(String(input.marketId))}`;
    case "faucet":
      return `Requested ${formatValue(input.amount ?? 10_000)} tUSDC from the testnet faucet`;
    default: {
      const details = Object.entries(input)
        .map(([k, v]) => `${humanizeKey(k)}: ${formatValue(v)}`)
        .join(", ");
      return details ? `${humanizeKey(tool)} (${details})` : humanizeKey(tool);
    }
  }
}

function formatAction(entry: LiveActivityEntry): string {
  const tool = entry.data?.tool;
  const input = entry.data?.input;
  if (typeof tool !== "string" || typeof input !== "object" || input === null) {
    return entry.message;
  }

  const output = entry.data?.output;
  if (output && typeof output === "object" && "error" in output) {
    const description = describeToolCall(tool, input as Record<string, unknown>);
    return `${description} — failed: ${String((output as { error: unknown }).error)}`;
  }

  // register_erc8004_identity takes no input — everything worth showing (the minted agentId) is
  // in the output instead, so this is handled here rather than in describeToolCall (input-only).
  if (tool === "register_erc8004_identity" && output && typeof output === "object" && "erc8004AgentId" in output) {
    return `Registered ERC-8004 identity — Agent-ID #${String((output as { erc8004AgentId: unknown }).erc8004AgentId)}`;
  }

  return describeToolCall(tool, input as Record<string, unknown>);
}

/** The on-chain tx hash for a mutating action, when the engine returned one
 * (only ever set by `LiveEngine` — the mock venue never fills this in, so
 * this is naturally absent for every action taken against the mock venue). */
export function getTxHash(entry: LiveActivityEntry): string | undefined {
  const output = entry.data?.output;
  if (!output || typeof output !== "object") return undefined;
  const txHash = (output as { txHash?: unknown }).txHash;
  return typeof txHash === "string" ? txHash : undefined;
}
