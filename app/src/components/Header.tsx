"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={`text-sm font-medium px-3 py-1.5 rounded-full transition-colors ${
        active ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

export function Header() {
  const [engineMode, setEngineMode] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setEngineMode(d.engineMode))
      .catch(() => setEngineMode(null));
  }, []);

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="text-lg">🔮</span>
          <span>Agentic Prediction Market</span>
        </Link>
        <nav className="flex items-center gap-1">
          <NavLink href="/">Markets</NavLink>
          <NavLink href="/agents">Agents</NavLink>
          <NavLink href="/register-agent">Register</NavLink>
          <NavLink href="/faucet">Faucet</NavLink>
        </nav>
        <div className="hidden sm:block">
          {engineMode && <Badge tone={engineMode === "live" ? "yes" : "accent"}>{engineMode === "live" ? "Live · Somnia" : "Mock venue"}</Badge>}
        </div>
      </div>
    </header>
  );
}
