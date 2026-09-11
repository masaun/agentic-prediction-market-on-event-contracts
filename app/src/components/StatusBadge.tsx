import type { MarketStatus } from "@apm/market-engine";
import { Badge } from "@/components/ui/Badge";

const CONFIG: Record<MarketStatus, { tone: "accent" | "live" | "default" | "yes" | "no"; label: string }> = {
  LISTED: { tone: "default", label: "Listed" },
  TRADING: { tone: "live", label: "Trading" },
  LOCKED: { tone: "accent", label: "Locked" },
  RESOLVED: { tone: "default", label: "Resolved" },
  VOIDED: { tone: "default", label: "Voided" },
};

export function StatusBadge({ status }: { status: MarketStatus }) {
  const { tone, label } = CONFIG[status];
  return (
    <Badge tone={tone}>
      {status === "TRADING" && <span className="h-1.5 w-1.5 rounded-full bg-yes animate-pulse" />}
      {label}
    </Badge>
  );
}
