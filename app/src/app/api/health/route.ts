import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine";

export async function GET() {
  const engine = getEngine();
  return NextResponse.json({
    ok: true,
    engineMode: engine.mode,
    // Only meaningful in "live" mode — the explorer link network for tx hashes.
    network: engine.mode === "live" ? (process.env.SOMNIA_NETWORK ?? "testnet") : null,
    time: Date.now() / 1000,
  });
}
