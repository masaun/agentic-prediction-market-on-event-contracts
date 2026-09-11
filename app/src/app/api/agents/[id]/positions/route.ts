import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const positions = await getEngine(id).getPositions(id);
  return NextResponse.json({ positions });
}
