"use client";

import { useEffect, useState } from "react";
import type { SomniaNetwork } from "@/lib/explorer";

export interface EngineInfo {
  mode: "live" | "mock" | null;
  network: SomniaNetwork;
}

/** Which venue trades run against, and — when live — which Somnia network to
 * link tx hashes against. Defaults to "testnet" before `/api/health` resolves
 * and whenever running in mock mode (no real chain to link to either way). */
export function useEngineInfo(): EngineInfo {
  const [info, setInfo] = useState<EngineInfo>({ mode: null, network: "testnet" });
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setInfo({ mode: d.engineMode ?? null, network: (d.network ?? "testnet") as SomniaNetwork }))
      .catch(() => {});
  }, []);
  return info;
}
