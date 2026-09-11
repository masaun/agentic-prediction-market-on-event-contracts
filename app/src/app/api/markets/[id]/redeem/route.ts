import { NextResponse } from "next/server";
import type { Outcome } from "@apm/market-engine";
import { getEngine } from "@/lib/engine";
import { requireAgentKey } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAgentKey(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json();
  const { outcome, agentId } = (body ?? {}) as { outcome?: Outcome; agentId?: string };
  if (!outcome) return NextResponse.json({ error: "outcome (YES|NO) is required" }, { status: 400 });
  try {
    const result = await getEngine(agentId).redeem({ marketId: id, outcome, agentId });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
