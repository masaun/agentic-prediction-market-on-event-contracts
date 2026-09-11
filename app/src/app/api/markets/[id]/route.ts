import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const market = await getEngine().getMarket(id);
  if (!market) return NextResponse.json({ error: "Market not found" }, { status: 404 });
  return NextResponse.json({ market });
}
