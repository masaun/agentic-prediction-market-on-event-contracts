"use client";

import { useState } from "react";
import type { FaucetOutput } from "@apm/market-engine";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/explorer";
import { shortId } from "@/lib/format";
import { useEngineInfo } from "@/lib/useEngineInfo";
import { useAgentsMap } from "@/lib/agentsCache";

const FAUCET_CAP_TUSDC = 10_000;
const SHARED_WALLET = "";

export default function FaucetPage() {
  const { mode, network } = useEngineInfo();
  const agents = useAgentsMap();
  const [amount, setAmount] = useState(FAUCET_CAP_TUSDC);
  const [agentId, setAgentId] = useState(SHARED_WALLET);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FaucetOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, agentId: agentId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Faucet request failed");
      setResult(data as FaucetOutput);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Faucet</h1>
        <p className="text-sm text-muted">
          Mint testnet tUSDC — the collateral token this venue trades against on Somnia Testnet. Capped at{" "}
          {FAUCET_CAP_TUSDC.toLocaleString()} tUSDC per call.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Fund wallet for</span>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value={SHARED_WALLET}>Shared / default wallet</option>
            {Object.values(agents).map((a) => (
              <option key={a.id} value={a.id}>
                {a.avatarEmoji ?? "🤖"} {a.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Amount (tUSDC)</span>
          <input
            type="number"
            min={1}
            max={FAUCET_CAP_TUSDC}
            value={amount}
            onChange={(e) => setAmount(Math.min(FAUCET_CAP_TUSDC, Math.max(0, Number(e.target.value))))}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <button
          onClick={submit}
          disabled={loading || amount <= 0}
          className="rounded-lg bg-accent text-background font-medium text-sm px-4 py-2 transition-opacity disabled:opacity-50 hover:opacity-90"
        >
          {loading ? "Requesting…" : `Get ${amount.toLocaleString()} tUSDC`}
        </button>

        {mode === "mock" && (
          <p className="text-xs text-muted">
            Running against the mock venue — this credits a simulated balance, not a real on-chain transaction.
          </p>
        )}

        {error && <p className="text-sm text-no">{error}</p>}

        {result && (
          <div className="text-sm border-t border-border pt-3 flex flex-col gap-1">
            <p className="text-yes font-medium">Minted {result.amount.toLocaleString()} tUSDC.</p>
            {result.txHash && (
              <a
                href={explorerTxUrl(result.txHash, network)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:underline font-mono"
                title={result.txHash}
              >
                {shortId(result.txHash, 10)} ↗
              </a>
            )}
            {result.walletAddress && (
              <a
                href={explorerAddressUrl(result.walletAddress, network)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted hover:text-accent hover:underline font-mono"
              >
                Wallet: {shortId(result.walletAddress, 10)} ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
