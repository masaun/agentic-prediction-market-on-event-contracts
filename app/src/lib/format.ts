export function formatPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatCountdown(expiresAtSec: number, nowSec = Date.now() / 1000): string {
  const diff = expiresAtSec - nowSec;
  if (diff <= 0) return "Ended";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const s = Math.floor(diff % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatRelativeTime(tsSec: number, nowSec = Date.now() / 1000): string {
  const diff = Math.max(0, nowSec - tsSec);
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function shortId(id: string, len = 8): string {
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

/** Truncates a long hex id to "prefix...suffix", e.g. "0x00...0015779". */
export function shortMiddle(id: string, headLen = 4, tailLen = 8): string {
  return id.length > headLen + tailLen + 3 ? `${id.slice(0, headLen)}...${id.slice(-tailLen)}` : id;
}
