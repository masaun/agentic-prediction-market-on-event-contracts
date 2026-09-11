"use client";

import { useEffect, useState } from "react";
import type { LiveAgent } from "./useLiveFeed";

/** A tiny module-level cache so every component that needs "agent id -> name/
 * avatar" (market cards, activity feeds, trade rows) shares one fetch of
 * /api/agents instead of each issuing its own. Agents are registered once at
 * process start and rarely change mid-demo, so a session-lived cache with a
 * manual bust is enough — no need for SWR/React Query here. */

let cache: Record<string, LiveAgent> | null = null;
let inflight: Promise<Record<string, LiveAgent>> | null = null;

async function load(): Promise<Record<string, LiveAgent>> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch("/api/agents")
      .then((r) => r.json())
      .then(({ agents }: { agents: LiveAgent[] }) => {
        const map: Record<string, LiveAgent> = {};
        for (const a of agents) map[a.id] = a;
        cache = map;
        return map;
      });
  }
  return inflight;
}

export function bustAgentsCache() {
  cache = null;
  inflight = null;
}

export function useAgentsMap(): Record<string, LiveAgent> {
  const [map, setMap] = useState<Record<string, LiveAgent>>(cache ?? {});
  useEffect(() => {
    let alive = true;
    load().then((m) => {
      if (alive) setMap(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  return map;
}
