"use client";

import { useState } from "react";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/explorer";
import { shortId } from "@/lib/format";
import { useEngineInfo } from "@/lib/useEngineInfo";
import { useAgentsMap } from "@/lib/agentsCache";

interface RegisterResult {
  erc8004AgentId: string;
  txHash: string;
  walletAddress: string;
}

export default function RegisterAgentPage() {
  const { network } = useEngineInfo();
  const agents = useAgentsMap();
  const agentList = Object.values(agents);
  const [agentId, setAgentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = agentId ? agents[agentId] : undefined;

  const submit = async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/register-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Registration failed");
      setResult(data as RegisterResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Register Agent (via ERC-8004)</h1>
        <p className="text-sm text-muted">
          Mints an Agent-ID NFT on the ERC-8004 Identity Registry — required before an agent can buy YES/NO
          shares (X402FeeVault.payFee reverts for unregistered wallets). See{" "}
          <code>contracts/doc/erc8004/ERC8004.md</code>.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Agent</span>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">Select an agent…</option>
            {agentList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.avatarEmoji ?? "🤖"} {a.name} {a.erc8004AgentId ? `(already #${a.erc8004AgentId})` : ""}
              </option>
            ))}
          </select>
          {agentList.length === 0 && (
            <span className="text-xs text-muted">
              No agents registered yet — run <code>npm run demo:agents</code> from agent-servers/ first.
            </span>
          )}
        </label>

        {selected?.erc8004AgentId && (
          <p className="text-xs text-muted">
            {selected.name} already holds Agent-ID #{selected.erc8004AgentId} — registering again is a no-op
            on this app&rsquo;s side (the binding never overwrites), though the on-chain call itself would
            still mint a second NFT.
          </p>
        )}

        <button
          onClick={submit}
          disabled={loading || !agentId}
          className="rounded-lg bg-accent text-background font-medium text-sm px-4 py-2 transition-opacity disabled:opacity-50 hover:opacity-90"
        >
          {loading ? "Registering…" : "Register"}
        </button>

        <p className="text-xs text-muted">
          Signs from this agent&rsquo;s App-custodied wallet (<code>ADA_AGENT_WALLET_PRIVATE_KEY</code>/
          <code>_NOMI</code>/shared) — for the buy-gate to pass, that must be the same wallet the agent pays
          x402 fees from (<code>ADA_AGENT_WALLET_PRIVATE_KEY</code> etc. in <code>agent-servers/.env</code>). Set
          both env vars to the same key if you want one wallet doing both.
        </p>

        {error && <p className="text-sm text-no">{error}</p>}

        {result && (
          <div className="text-sm border-t border-border pt-3 flex flex-col gap-1">
            <p className="text-yes font-medium">Registered — Agent-ID #{result.erc8004AgentId}</p>
            <a
              href={explorerTxUrl(result.txHash, network)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent hover:underline font-mono"
              title={result.txHash}
            >
              {shortId(result.txHash, 10)} ↗
            </a>
            <a
              href={explorerAddressUrl(result.walletAddress, network)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted hover:text-accent hover:underline font-mono"
            >
              Wallet: {shortId(result.walletAddress, 10)} ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
