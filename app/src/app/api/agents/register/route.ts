import { NextResponse } from "next/server";
import { getStore, type AgentRecord } from "@/lib/store";
import { requireAgentKey } from "@/lib/auth";

export async function POST(request: Request) {
  const unauthorized = requireAgentKey(request);
  if (unauthorized) return unauthorized;

  const body = await request.json();
  const { id, name, role, persona, avatarEmoji, walletAddress } = (body ?? {}) as Partial<AgentRecord>;
  if (!id || !name || !role || !persona) {
    return NextResponse.json({ error: "id, name, role, and persona are required" }, { status: 400 });
  }
  if (role !== "creator" && role !== "bettor") {
    return NextResponse.json({ error: 'role must be "creator" or "bettor"' }, { status: 400 });
  }
  const record = getStore().registerAgent({ id, name, role, persona, avatarEmoji, walletAddress });
  return NextResponse.json({ agent: record }, { status: 201 });
}
