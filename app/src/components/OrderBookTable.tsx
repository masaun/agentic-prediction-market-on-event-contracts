import type { OrderBookSnapshot } from "@apm/market-engine";
import { formatNumber, formatPct } from "@/lib/format";

function Side({ label, levels, tone }: { label: string; levels: OrderBookSnapshot["bids"]; tone: "yes" | "no" }) {
  const barColor = tone === "yes" ? "bg-yes-bg" : "bg-no-bg";
  const textColor = tone === "yes" ? "text-yes" : "text-no";
  const maxQty = Math.max(1, ...levels.map((l) => l.quantity));
  return (
    <div className="flex-1">
      <div className="text-xs text-muted uppercase tracking-wide mb-1">{label}</div>
      <div className="flex flex-col gap-1">
        {levels.map((level, i) => (
          <div key={i} className="relative flex items-center justify-between text-sm px-2 py-1 rounded overflow-hidden">
            <div
              className={`absolute inset-y-0 left-0 ${barColor} opacity-60`}
              style={{ width: `${(level.quantity / maxQty) * 100}%` }}
            />
            <span className={`relative font-mono ${textColor}`}>{formatPct(level.price)}</span>
            <span className="relative font-mono text-muted">{formatNumber(level.quantity)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OrderBookTable({ book }: { book: OrderBookSnapshot }) {
  return (
    <div className="flex gap-4">
      <Side label="Bids (YES)" levels={book.bids} tone="yes" />
      <Side label="Asks (NO)" levels={book.asks} tone="no" />
    </div>
  );
}
