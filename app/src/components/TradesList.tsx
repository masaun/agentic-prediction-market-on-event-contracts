import type { Trade } from "@apm/market-engine";
import { AgentTag } from "@/components/AgentTag";
import { formatNumber, formatPct, formatRelativeTime, shortId } from "@/lib/format";
import { explorerTxUrl, type SomniaNetwork } from "@/lib/explorer";

const SIDE_LABEL: Record<Trade["side"], { label: string; tone: "yes" | "no" }> = {
  BUY_YES: { label: "Bought YES", tone: "yes" },
  SELL_YES: { label: "Sold YES", tone: "no" },
  BUY_NO: { label: "Bought NO", tone: "no" },
  SELL_NO: { label: "Sold NO", tone: "yes" },
};

export function TradesList({ trades, network = "testnet" }: { trades: Trade[]; network?: SomniaNetwork }) {
  if (trades.length === 0) return <p className="text-sm text-muted py-6 text-center">No trades yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {trades.map((t) => {
        const side = SIDE_LABEL[t.side];
        return (
          <li key={t.id} className="flex items-center justify-between py-2 text-sm gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={side.tone === "yes" ? "text-yes" : "text-no"}>{side.label}</span>
              <AgentTag agentId={t.agentId} network={network} />
            </div>
            <div className="flex items-center gap-3 font-mono text-muted shrink-0">
              <span>{formatNumber(t.quantity)} @ {formatPct(t.price)}</span>
              <span className="text-xs">{formatRelativeTime(t.timestamp)}</span>
              {t.txHash && (
                <a
                  href={explorerTxUrl(t.txHash, network)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline"
                  title={t.txHash}
                >
                  {shortId(t.txHash, 10)} ↗
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
