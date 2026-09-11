import { NextResponse } from "next/server";

/**
 * If APM_AGENT_API_KEY is set, agent-facing write routes require it in the
 * `x-apm-agent-key` header (see agents/proxy-servers/shared/apiClient.ts). Unset by
 * default so the demo runs with zero configuration on localhost.
 */
export function requireAgentKey(request: Request): NextResponse | null {
  const expected = process.env.APM_AGENT_API_KEY;
  if (!expected) return null;
  const provided = request.headers.get("x-apm-agent-key");
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized: missing or invalid x-apm-agent-key" }, { status: 401 });
  }
  return null;
}
