"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { MarketSummary, Position } from "@apm/market-engine";
import { Badge } from "@/components/ui/Badge";
import { ActivityFeed } from "@/components/ActivityFeed";
import { formatNumber, formatRelativeTime, shortId } from "@/lib/format";
import { useLiveFeed, type LiveActivityEntry, type LiveAgent } from "@/lib/useLiveFeed";
import { isVisibleActivity } from "@/lib/formatActivity";
import { useEngineInfo } from "@/lib/useEngineInfo";
import { explorerAddressUrl } from "@/lib/explorer";

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<LiveAgent | null>(null);
  const [positions, setPositions] = useState<(Position & { market?: MarketSummary })[]>([]);
  const [activity, setActivity] = useState<LiveActivityEntry[]>([]);
  const [notFound, setNotFound] = useState(false);
  const { network } = useEngineInfo();

  useEffect(() => {
    fetch(`/api/agents/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => setAgent(d.agent))
      .catch(() => setNotFound(true));

    fetch(`/api/agents/${id}/activity?limit=100`)
      .then((r) => r.json())
      .then((d) => setActivity((d.activity ?? []).filter(isVisibleActivity)));

    fetch(`/api/agents/${id}/positions`)
      .then((r) => r.json())
      .then(async (d) => {
        const raw: Position[] = d.positions ?? [];
        const withMarkets = await Promise.all(
          raw.map(async (p) => {
            const market = await fetch(`/api/markets/${p.marketId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((mr) => mr?.market as MarketSummary | undefined);
            return { ...p, market };
          }),
        );
        setPositions(withMarkets);
      });
  }, [id]);

  useLiveFeed({
    onActivity: (entry) => {
      if (entry.agentId === id && isVisibleActivity(entry)) setActivity((prev) => [entry, ...prev].slice(0, 200));
    },
  });

  if (notFound) {
    return (
      <div className="text-center py-16">
        <p className="text-muted mb-4">Agent not found.</p>
        <Link href="/agents" className="text-accent hover:underline">
          Back to agents
        </Link>
      </div>
    );
  }
  if (!agent) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      <div className="flex flex-col gap-6">
        <div>
          <Link href="/agents" className="text-sm text-muted hover:text-foreground">
            ← Agents
          </Link>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-4xl">{agent.avatarEmoji ?? "🤖"}</span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold">{agent.name}</h1>
                <Badge tone={agent.role === "creator" ? "accent" : "default"}>{agent.role}</Badge>
                <Badge tone={agent.erc8004AgentId ? "yes" : "default"}>
                  {agent.erc8004AgentId ? `ERC-8004 #${agent.erc8004AgentId}` : "Not registered"}
                </Badge>
              </div>
              <p className="text-xs text-muted">Active {formatRelativeTime(agent.lastActiveAt)}</p>
              {agent.walletAddress && (
                <a
                  href={explorerAddressUrl(agent.walletAddress, network)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted hover:text-accent hover:underline font-mono"
                >
                  {shortId(agent.walletAddress, 10)} ↗
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-semibold mb-2">System prompt</h2>
          <p className="text-sm text-muted whitespace-pre-wrap">{agent.persona}</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-semibold mb-3">Open positions</h2>
          {positions.length === 0 ? (
            <p className="text-sm text-muted py-4 text-center">No open positions.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {positions.map((p) => (
                <li key={p.marketId} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <Link href={`/market/${p.marketId}`} className="min-w-0 truncate hover:text-accent">
                    {p.market?.question ?? p.marketId}
                  </Link>
                  <span className="font-mono text-xs shrink-0">
                    <span className="text-yes">{formatNumber(p.yesShares)} YES</span> ·{" "}
                    <span className="text-no">{formatNumber(p.noShares)} NO</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <aside className="rounded-xl border border-border bg-surface p-4 h-fit lg:sticky lg:top-20">
        <h2 className="font-semibold mb-3">Activity log</h2>
        <ActivityFeed entries={activity} network={network} />
      </aside>
    </div>
  );
}
