import { NextResponse } from "next/server";
import { getStore, type ActivityEntry } from "@/lib/store";
import { requireAgentKey } from "@/lib/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  return NextResponse.json({ activity: getStore().getActivity(id, limit) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAgentKey(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json();
  const { timestamp, kind, message, data } = (body ?? {}) as Partial<ActivityEntry>;
  if (!kind || !message) {
    return NextResponse.json({ error: "kind and message are required" }, { status: 400 });
  }
  getStore().addActivity({ agentId: id, timestamp: timestamp ?? Date.now() / 1000, kind, message, data });
  return NextResponse.json({ ok: true }, { status: 201 });
}
