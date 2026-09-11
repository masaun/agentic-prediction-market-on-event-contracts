import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine";
import { requireAgentKey } from "@/lib/auth";

export async function POST(request: Request) {
  const unauthorized = requireAgentKey(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => ({}));
  const { amount, agentId } = (body ?? {}) as { amount?: number; agentId?: string };
  try {
    const result = await getEngine(agentId).faucet(amount ? { amount } : undefined);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
