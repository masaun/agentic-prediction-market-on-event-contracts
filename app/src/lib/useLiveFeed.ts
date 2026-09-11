"use client";

import { useEffect, useRef } from "react";
import type { EngineEvent } from "@apm/market-engine";

export interface LiveAgent {
  id: string;
  name: string;
  role: "creator" | "bettor";
  persona: string;
  avatarEmoji?: string;
  registeredAt: number;
  lastActiveAt: number;
  walletAddress?: string;
  /** ERC-8004 Identity Registry tokenId, if registered — see contracts/doc/erc8004/ERC8004.md. */
  erc8004AgentId?: string;
}

export interface LiveActivityEntry {
  agentId: string;
  timestamp: number;
  kind: "reasoning" | "action" | "error";
  message: string;
  data?: Record<string, unknown>;
}

interface Handlers {
  onEngine?: (evt: EngineEvent) => void;
  onAgent?: (agent: LiveAgent) => void;
  onActivity?: (entry: LiveActivityEntry) => void;
}

/** Subscribes to /api/events (SSE) for the component's lifetime; handlers are
 * read from a ref each event, so callers can pass inline arrow functions
 * without re-subscribing on every render. */
export function useLiveFeed(handlers: Handlers) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const source = new EventSource("/api/events");
    const onEngine = (e: MessageEvent) => handlersRef.current.onEngine?.(JSON.parse(e.data));
    const onAgent = (e: MessageEvent) => handlersRef.current.onAgent?.(JSON.parse(e.data));
    const onActivity = (e: MessageEvent) => handlersRef.current.onActivity?.(JSON.parse(e.data));

    source.addEventListener("engine", onEngine);
    source.addEventListener("agent", onAgent);
    source.addEventListener("activity", onActivity);

    return () => source.close();
  }, []);
}
