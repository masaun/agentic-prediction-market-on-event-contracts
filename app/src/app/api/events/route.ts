import { getEngine } from "@/lib/engine";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events: market lifecycle (created/trade/resolved) plus agent
 * lifecycle (registered/activity), so the UI updates live as agents act
 * instead of polling. See src/lib/useLiveFeed.ts for the client side.
 */
export async function GET() {
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const offEngine = getEngine().onEvent((evt) => send("engine", evt));
      const offAgent = getStore().onAgent((agent) => send("agent", agent));
      const offActivity = getStore().onActivity((entry) => send("activity", entry));
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(`: ping\n\n`)), 25_000);

      cleanup = () => {
        offEngine();
        offAgent();
        offActivity();
        clearInterval(heartbeat);
      };
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
