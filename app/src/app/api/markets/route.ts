import { NextResponse } from "next/server";
import type { MarketStatus } from "@apm/market-engine";
import { getEngine } from "@/lib/engine";
import { requireAgentKey } from "@/lib/auth";

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") as MarketStatus | null;
  const markets = await getEngine().listMarkets(status ? { status } : undefined);
  return NextResponse.json({ markets });
}

export async function POST(request: Request) {
  const unauthorized = requireAgentKey(request);
  if (unauthorized) return unauthorized;

  const body = await request.json();
  const { question, category, expiresInSec, createdBy, initialProbability } = body ?? {};
  if (!question || !category || !expiresInSec || !createdBy) {
    return NextResponse.json(
      { error: "question, category, expiresInSec, and createdBy are required" },
      { status: 400 },
    );
  }
  try {
    const result = await getEngine().createMarket({ question, category, expiresInSec, createdBy, initialProbability });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
