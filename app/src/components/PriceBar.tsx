import { formatPct } from "@/lib/format";

export function PriceBar({ yesPrice, size = "md" }: { yesPrice: number; size?: "sm" | "md" }) {
  const yesPct = Math.round(yesPrice * 100);
  const height = size === "sm" ? "h-1.5" : "h-2";
  return (
    <div className="w-full">
      <div className="flex justify-between text-sm mb-1">
        <span className="font-semibold text-yes">YES {formatPct(yesPrice)}</span>
        <span className="font-semibold text-no">NO {formatPct(1 - yesPrice)}</span>
      </div>
      <div className={`w-full ${height} rounded-full overflow-hidden bg-no-bg flex`}>
        <div className="bg-yes h-full" style={{ width: `${yesPct}%` }} />
      </div>
    </div>
  );
}
