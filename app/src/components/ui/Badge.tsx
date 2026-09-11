import type { ReactNode } from "react";

const TONES = {
  default: "bg-surface-2 text-muted border-border",
  yes: "bg-yes-bg text-yes border-yes/30",
  no: "bg-no-bg text-no border-no/30",
  accent: "bg-accent/10 text-accent border-accent/30",
  live: "bg-yes-bg text-yes border-yes/30",
} as const;

export function Badge({ tone = "default", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}
