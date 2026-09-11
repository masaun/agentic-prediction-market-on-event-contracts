import { NextResponse } from "next/server";
import type { BinarySide, OrderType } from "@apm/market-engine";
import { getEngine } from "@/lib/engine";
import { requireAgentKey } from "@/lib/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  const trades = await getEngine().getTrades(id, limit);
  return NextResponse.json({ trades });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAgentKey(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json();
  const { side, price, quantity, orderType, agentId } = (body ?? {}) as {
    side?: BinarySide;
    price?: number;
    quantity?: number;
    orderType?: OrderType;
    agentId?: string;
  };
  if (!side || price === undefined || !quantity) {
    return NextResponse.json({ error: "side, price, and quantity are required" }, { status: 400 });
  }
  try {
    const result = await getEngine(agentId).placeOrder({ marketId: id, side, price, quantity, orderType, agentId });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
