import { NextResponse } from "next/server";
import { requireAgentKey } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { resolvePrivateKey } from "@/lib/engine";
import { Erc8004NotConfiguredError, buildAgentURI, registerAgentOnChain } from "@/lib/erc8004";

/**
 * The human-UI registration path (the "Register" tab, app/src/app/register-agent/page.tsx) —
 * mirrors /api/faucet's shape: pick a known agent, the app signs with whichever App-custodied
 * key app/src/lib/engine.ts already resolves for it (ADA_AGENT_WALLET_PRIVATE_KEY/_NOMI/shared), rather
 * than adding a browser-wallet-connect flow this app has no other use for. See
 * contracts/doc/erc8004/ERC8004.md — for the buy-gate to actually pass, this must end up being
 * the same wallet address the agent trades x402 with.
 */
export async function POST(request: Request) {
  const unauthorized = requireAgentKey(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => ({}));
  const { agentId } = (body ?? {}) as { agentId?: string };
  if (!agentId) return NextResponse.json({ error: "agentId is required" }, { status: 400 });

  const store = getStore();
  const agent = store.getAgent(agentId);
  if (!agent) return NextResponse.json({ error: "Agent not found — register it first via POST /api/agents/register" }, { status: 404 });

  const privateKey = resolvePrivateKey(agentId);
  if (!privateKey) {
    return NextResponse.json(
      { error: `No App-custodied wallet configured for "${agentId}" — set SOMNIA_PRIVATE_KEY (or a dedicated per-agent key) in app/.env.` },
      { status: 400 },
    );
  }

  try {
    const agentURI = buildAgentURI(agentId);
    const { erc8004AgentId, txHash, walletAddress } = await registerAgentOnChain(privateKey, agentURI);
    store.bindAgentErc8004Id(agentId, erc8004AgentId, txHash);
    return NextResponse.json({ erc8004AgentId, txHash, walletAddress, agentURI }, { status: 200 });
  } catch (err) {
    if (err instanceof Erc8004NotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
