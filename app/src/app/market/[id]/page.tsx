"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { MarketSummary, OrderBookSnapshot, Trade } from "@apm/market-engine";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/StatusBadge";
import { PriceBar } from "@/components/PriceBar";
import { OrderBookTable } from "@/components/OrderBookTable";
import { TradesList } from "@/components/TradesList";
import { AgentTag } from "@/components/AgentTag";
import { CopyButton } from "@/components/CopyButton";
import { formatCompact, formatCountdown, shortMiddle } from "@/lib/format";
import { useLiveFeed } from "@/lib/useLiveFeed";
import { useEngineInfo } from "@/lib/useEngineInfo";

export default function MarketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [market, setMarket] = useState<MarketSummary | null>(null);
  const [book, setBook] = useState<OrderBookSnapshot | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [notFound, setNotFound] = useState(false);
  const { network } = useEngineInfo();

  const refresh = () => {
    fetch(`/api/markets/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => setMarket(d.market))
      .catch(() => setNotFound(true));
    fetch(`/api/markets/${id}/orderbook`)
      .then((r) => r.json())
      .then(setBook)
      .catch(() => {});
    fetch(`/api/markets/${id}/orders`)
      .then((r) => r.json())
      .then((d) => setTrades(d.trades ?? []))
      .catch(() => {});
  };

  useEffect(refresh, [id]);

  useLiveFeed({
    onEngine: (evt) => {
      if (evt.type === "trade" && evt.trade.marketId === id) {
        setTrades((prev) => [evt.trade, ...prev].slice(0, 50));
        refresh();
      } else if (evt.type === "market_resolved" && evt.marketId === id) {
        refresh();
      }
    },
  });

  if (notFound) {
    return (
      <div className="text-center py-16">
        <p className="text-muted mb-4">Market not found.</p>
        <Link href="/" className="text-accent hover:underline">
          Back to markets
        </Link>
      </div>
    );
  }
  if (!market) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      <div className="flex flex-col gap-6">
        <div>
          <Link href="/" className="text-sm text-muted hover:text-foreground">
            ← Markets
          </Link>
          <div className="flex items-center gap-2 mt-2 mb-2">
            <Badge>{market.category}</Badge>
            <StatusBadge status={market.status} />
          </div>
          <h1 className="text-2xl font-semibold leading-tight mb-2">{market.question}</h1>
          <div className="flex items-center gap-1.5 text-xs text-muted mb-2 font-mono">
            <span title={market.id}>Market ID: {shortMiddle(market.id)}</span>
            <CopyButton value={market.id} />
          </div>
          <div className="flex items-center gap-4 text-sm text-muted flex-wrap">
            {market.createdBy && (
              <span className="flex items-center gap-1">
                Created by <AgentTag agentId={market.createdBy} network={network} />
              </span>
            )}
            <span>Vol {formatCompact(market.volume)}</span>
            <span>Liquidity {formatCompact(market.liquidity)}</span>
            <span>{market.status === "TRADING" ? `Locks in ${formatCountdown(market.expiresAt)}` : null}</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <PriceBar yesPrice={market.yesPrice} />
          {market.resolvedOutcome && (
            <p className="mt-3 text-sm">
              Resolved:{" "}
              <span className={market.resolvedOutcome === "YES" ? "text-yes" : market.resolvedOutcome === "NO" ? "text-no" : "text-muted"}>
                {market.resolvedOutcome}
              </span>
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-semibold mb-3">Order book</h2>
          {book ? <OrderBookTable book={book} /> : <p className="text-sm text-muted">No book yet.</p>}
        </div>
      </div>

      <aside className="rounded-xl border border-border bg-surface p-4 h-fit">
        <h2 className="font-semibold mb-3">Recent trades</h2>
        <TradesList trades={trades} network={network} />
      </aside>
    </div>
  );
}
