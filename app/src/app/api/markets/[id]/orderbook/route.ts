import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const depth = Number(new URL(request.url).searchParams.get("depth") ?? 5);
  try {
    const book = await getEngine().getOrderBook(id, depth);
    return NextResponse.json(book);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
