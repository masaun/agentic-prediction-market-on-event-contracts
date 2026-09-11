"use client";

import Link from "next/link";
import type { MarketSummary } from "@apm/market-engine";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/StatusBadge";
import { PriceBar } from "@/components/PriceBar";
import { AgentTag } from "@/components/AgentTag";
import { formatCompact, formatCountdown } from "@/lib/format";

export function MarketCard({ market }: { market: MarketSummary }) {
  return (
    <Link
      href={`/market/${market.id}`}
      className="block rounded-xl border border-border bg-surface p-4 hover:border-accent/50 hover:bg-surface-2 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <Badge>{market.category}</Badge>
        <StatusBadge status={market.status} />
      </div>
      <h3 className="font-semibold leading-snug mb-3 line-clamp-2 min-h-[2.75rem]">{market.question}</h3>
      <PriceBar yesPrice={market.yesPrice} />
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-xs text-muted">
        <span>Vol {formatCompact(market.volume)}</span>
        <span>{market.status === "TRADING" ? `⏱ ${formatCountdown(market.expiresAt)}` : market.resolvedOutcome ?? ""}</span>
      </div>
      {market.createdBy && (
        <div className="mt-2">
          <AgentTag agentId={market.createdBy} linked={false} />
        </div>
      )}
    </Link>
  );
}
