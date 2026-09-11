"use client";

import Link from "next/link";
import { useAgentsMap } from "@/lib/agentsCache";
import { shortId } from "@/lib/format";
import { explorerAddressUrl, type SomniaNetwork } from "@/lib/explorer";

export function AgentTag({
  agentId,
  linked = true,
  network = "testnet",
}: {
  agentId?: string;
  linked?: boolean;
  network?: SomniaNetwork;
}) {
  const agents = useAgentsMap();
  if (!agentId) return <span className="text-muted text-sm">—</span>;

  const agent = agents[agentId];
  const label = agent ? `${agent.avatarEmoji ?? "🤖"} ${agent.name}` : `🔗 ${shortId(agentId)}`;
  const classes = "text-sm font-medium text-foreground/90 hover:text-accent transition-colors";

  if (!linked) return <span className={classes}>{label}</span>;
  if (agent) {
    return (
      <Link href={`/agents/${agent.id}`} className={classes}>
        {label}
      </Link>
    );
  }
  // Unrecognized agentId is a raw on-chain address (live mode) — link out to
  // the Somnia block explorer instead of an internal /agents page that
  // wouldn't have anything to show.
  return (
    <a href={explorerAddressUrl(agentId, network)} target="_blank" rel="noopener noreferrer" className={classes}>
      {label}
    </a>
  );
}
