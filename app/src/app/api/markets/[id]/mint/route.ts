import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine";
import { requireAgentKey } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAgentKey(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json();
  const { amount, agentId } = (body ?? {}) as { amount?: number; agentId?: string };
  if (!amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
  try {
    const result = await getEngine(agentId).mintSet({ marketId: id, amount, agentId });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
