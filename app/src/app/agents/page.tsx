"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { shortId } from "@/lib/format";
import { explorerAddressUrl, explorerTokenUrl, explorerTxUrl } from "@/lib/explorer";
import { useEngineInfo } from "@/lib/useEngineInfo";
import { useLiveFeed, type LiveAgent } from "@/lib/useLiveFeed";

/** `GET /api/agents/:id/erc8004`'s response shape — see that route. Checked live on-chain (with
 * store self-heal) every time this page loads, not just read from the agent record's own cached
 * `erc8004AgentId` — see the comment on that route for why a store-only read isn't reliable
 * (registrations that happen outside this app's own paths would otherwise show "Unregistered"
 * forever). */
interface Erc8004Status {
  registered: boolean;
  erc8004AgentId?: string;
  walletAddress?: string;
  identityRegistryAddress?: string;
  erc8004TxHash?: string;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<LiveAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<Record<string, Erc8004Status | "error">>({});
  const requestedRef = useRef<Set<string>>(new Set());
  const { network } = useEngineInfo();

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => setAgents(d.agents ?? []))
      .finally(() => setLoading(false));
  }, []);

  useLiveFeed({
    onAgent: (agent) => setAgents((prev) => [agent, ...prev.filter((a) => a.id !== agent.id)]),
    onActivity: (entry) =>
      setAgents((prev) => prev.map((a) => (a.id === entry.agentId ? { ...a, lastActiveAt: entry.timestamp } : a))),
  });

  // One `GET /api/agents/:id/erc8004` per agent, in parallel, whenever the agent list changes —
  // `requestedRef` (a ref, not state — no re-render, no cascading-setState-in-effect lint issue)
  // tracks which ids have already been requested this session, so switching tabs or a live
  // "agent" SSE event doesn't re-check every agent from scratch. An id absent from `statuses`
  // simply means "still loading" — there's no separate loading sentinel to keep in sync.
  useEffect(() => {
    for (const a of agents) {
      if (requestedRef.current.has(a.id)) continue;
      requestedRef.current.add(a.id);
      fetch(`/api/agents/${a.id}/erc8004`)
        .then((r) => r.json())
        .then((d: Erc8004Status) => setStatuses((prev) => ({ ...prev, [a.id]: d })))
        .catch(() => setStatuses((prev) => ({ ...prev, [a.id]: "error" })));
    }
  }, [agents]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Agents</h1>
        <p className="text-sm text-muted">The autonomous creators and traders running this venue.</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : agents.length === 0 ? (
        <p className="text-sm text-muted py-12 text-center border border-dashed border-border rounded-xl">
          No agents registered yet — run <code>npm run demo:agents</code> from agent-servers/.
        </p>
      ) : (
        <div>
          <h2 className="text-sm font-semibold mb-2">ERC-8004 registration status</h2>
          <p className="text-xs text-muted mb-3">
            Live on-chain check against{" "}
            <code>IdentityRegistry.balanceOf</code> on Somnia {network ?? "testnet"} — see{" "}
            <code>contracts/doc/erc8004/ERC8004.md</code>.
          </p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Wallet</th>
                  <th className="px-3 py-2 font-medium">ERC-8004 status</th>
                  <th className="px-3 py-2 font-medium">Agent-ID</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const status = statuses[a.id];
                  const loading2 = status === undefined;
                  const errored = status === "error";
                  const registered = typeof status === "object" && status.registered;
                  const walletAddress = typeof status === "object" ? status.walletAddress : undefined;
                  const erc8004AgentId = typeof status === "object" ? status.erc8004AgentId : undefined;
                  const identityRegistryAddress = typeof status === "object" ? status.identityRegistryAddress : undefined;
                  const erc8004TxHash = typeof status === "object" ? status.erc8004TxHash : undefined;
                  return (
                    <tr key={a.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <Link href={`/agents/${a.id}`} className="hover:text-accent hover:underline">
                          {a.avatarEmoji ?? "🤖"} {a.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted">{a.role}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {walletAddress ? (
                          <a
                            href={explorerAddressUrl(walletAddress, network ?? "testnet")}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-accent hover:underline"
                          >
                            {shortId(walletAddress, 10)} ↗
                          </a>
                        ) : (
                          <span className="text-muted">— no wallet resolved —</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {loading2 ? (
                          <Badge>Checking…</Badge>
                        ) : errored ? (
                          <Badge tone="no">Check failed</Badge>
                        ) : registered && erc8004TxHash ? (
                          <a
                            href={explorerTxUrl(erc8004TxHash, network ?? "testnet")}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:opacity-80"
                            title={erc8004TxHash}
                          >
                            <Badge tone="yes">Registered ↗</Badge>
                          </a>
                        ) : (
                          <Badge tone={registered ? "yes" : "no"}>{registered ? "Registered" : "Unregistered"}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {erc8004AgentId && identityRegistryAddress ? (
                          <a
                            href={explorerTokenUrl(identityRegistryAddress, erc8004AgentId, network ?? "testnet")}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-accent hover:underline"
                          >
                            #{erc8004AgentId} ↗
                          </a>
                        ) : erc8004AgentId ? (
                          `#${erc8004AgentId}`
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted mt-2">
            NOTE: Currently, only the 3 demo agents (Nomi, Ada, Saga) are displayed on the table above. Once
            external agents like Hermes Agent, OpenClaw-based agents would register the ERC8004 IdentityRegistry
            contract on Somnia testnet, those agents will be displayed in the table above.
          </p>
        </div>
      )}
    </div>
  );
}
