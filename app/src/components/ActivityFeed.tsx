"use client";

import { AgentTag } from "@/components/AgentTag";
import { formatRelativeTime, shortId } from "@/lib/format";
import { formatActivityMessage, getTxHash, isVisibleActivity } from "@/lib/formatActivity";
import { explorerTxUrl, type SomniaNetwork } from "@/lib/explorer";
import type { LiveActivityEntry } from "@/lib/useLiveFeed";

const KIND_ICON: Record<LiveActivityEntry["kind"], string> = {
  reasoning: "💭",
  action: "⚡",
  error: "⚠️",
};

export function ActivityFeed({
  entries,
  emptyLabel = "No activity yet.",
  network = "testnet",
}: {
  entries: LiveActivityEntry[];
  emptyLabel?: string;
  network?: SomniaNetwork;
}) {
  const visible = entries.filter(isVisibleActivity);
  if (visible.length === 0) {
    return <p className="text-sm text-muted py-6 text-center">{emptyLabel}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {visible.map((entry, i) => {
        const txHash = getTxHash(entry);
        return (
          <li key={`${entry.agentId}-${entry.timestamp}-${i}`} className="flex gap-2 text-sm">
            <span className="mt-0.5">{KIND_ICON[entry.kind]}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <AgentTag agentId={entry.agentId} network={network} />
                <span className="text-xs text-muted">{formatRelativeTime(entry.timestamp)}</span>
              </div>
              <p className={`mt-0.5 ${entry.kind === "error" ? "text-no" : "text-foreground/85"} break-words`}>
                {formatActivityMessage(entry)}
              </p>
              {txHash && (
                <a
                  href={explorerTxUrl(txHash, network)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline font-mono"
                  title={txHash}
                >
                  {shortId(txHash, 10)} ↗
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
