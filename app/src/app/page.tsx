"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketStatus, MarketSummary } from "@apm/market-engine";
import { MarketCard } from "@/components/MarketCard";
import { ActivityFeed } from "@/components/ActivityFeed";
import { useLiveFeed, type LiveActivityEntry } from "@/lib/useLiveFeed";
import { isVisibleActivity } from "@/lib/formatActivity";
import { useEngineInfo } from "@/lib/useEngineInfo";

const FILTERS: { label: string; value: MarketStatus | "ALL" }[] = [
  { label: "All", value: "ALL" },
  { label: "Trading", value: "TRADING" },
  { label: "Locked", value: "LOCKED" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Voided", value: "VOIDED" },
];

export default function HomePage() {
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [filter, setFilter] = useState<MarketStatus | "ALL">("ALL");
  const [activity, setActivity] = useState<LiveActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { mode, network } = useEngineInfo();

  useEffect(() => {
    fetch("/api/markets")
      .then((r) => r.json())
      .then((d) => setMarkets(d.markets ?? []))
      .finally(() => setLoading(false));
  }, []);

  useLiveFeed({
    onEngine: (evt) => {
      if (evt.type === "market_created") {
        setMarkets((prev) => [evt.market, ...prev]);
      } else if (evt.type === "trade") {
        setMarkets((prev) =>
          prev.map((m) => (m.id === evt.trade.marketId ? { ...m, volume: m.volume + evt.trade.quantity * evt.trade.price } : m)),
        );
      } else if (evt.type === "market_resolved") {
        setMarkets((prev) =>
          prev.map((m) =>
            m.id === evt.marketId
              ? { ...m, status: evt.outcome === "VOID" ? "VOIDED" : "RESOLVED", resolvedOutcome: evt.outcome }
              : m,
          ),
        );
      }
    },
    onActivity: (entry) => {
      if (isVisibleActivity(entry)) setActivity((prev) => [entry, ...prev].slice(0, 30));
    },
  });

  const visible = useMemo(
    () => (filter === "ALL" ? markets : markets.filter((m) => m.status === filter)),
    [markets, filter],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      <div>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold">Markets</h1>
            <p className="text-sm text-muted">
              {mode === "live"
                ? `Real DreamDEX Event Contracts on Somnia ${network ?? "testnet"}, traded by AI agents.`
                : "DreamDEX Event Contracts, created and traded by AI agents."}
            </p>
          </div>
          <div className="flex gap-1 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                  filter === f.value
                    ? "bg-surface-2 border-accent/40 text-foreground"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted">Loading markets…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted py-12 text-center border border-dashed border-border rounded-xl">
            {mode === "live" ? (
              <>No markets currently listed on DreamDEX (Somnia {network ?? "testnet"}) — nothing to trade yet, check back once new markets are listed.</>
            ) : (
              <>
                No markets here yet — start a creator agent (<code>npm run agent:creator</code>) to populate the venue.
              </>
            )}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {visible.map((m) => (
              <MarketCard key={m.id} market={m} />
            ))}
          </div>
        )}
      </div>

      <aside className="lg:sticky lg:top-20 h-fit rounded-xl border border-border bg-surface p-4">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-yes animate-pulse" /> Live agent activity
        </h2>
        <ActivityFeed entries={activity} emptyLabel="Waiting for agents to act…" network={network} />
      </aside>
    </div>
  );
}
