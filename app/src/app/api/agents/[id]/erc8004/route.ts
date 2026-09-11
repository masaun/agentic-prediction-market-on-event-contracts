import { NextResponse } from "next/server";
import type { Address } from "viem";
import { requireAgentKey } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { Erc8004NotConfiguredError, findRegisteredAgentId, identityRegistryAddress, isRegisteredAgent } from "@/lib/erc8004";
import { resolveAppCustodiedAddress } from "@/lib/engine";

/**
 * Records/reads an agent's ERC-8004 registration — see contracts/doc/erc8004/ERC8004.md.
 * The actual on-chain `register()` call is signed elsewhere (agents/proxy-servers/shared/wallet.ts for
 * autonomous agents, POST /api/register-agent for the human-UI path); this route only binds the
 * result onto the app's own agent record so it shows up on /agents/:id.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAgentKey(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { erc8004AgentId, txHash, walletAddress } = (body ?? {}) as {
    erc8004AgentId?: string;
    txHash?: string;
    walletAddress?: string;
  };
  if (!erc8004AgentId) {
    return NextResponse.json({ error: "erc8004AgentId is required" }, { status: 400 });
  }

  const store = getStore();
  const agent = store.getAgent(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  store.bindAgentErc8004Id(id, erc8004AgentId, txHash);
  // The autonomous path (register_erc8004_identity) registers from the agent's own x402 trading
  // wallet — recording it here too, not just erc8004AgentId, means GET below can confirm
  // registration on-chain without waiting on a later x402 payment to bind it opportunistically.
  if (walletAddress) store.bindAgentWallet(id, walletAddress);
  return NextResponse.json({ agent: store.getAgent(id), txHash }, { status: 200 });
}

/**
 * The chain is the source of truth for "is this wallet registered" — never just whether the store
 * already has `erc8004AgentId` bound. That mattered in practice: a wallet registered directly
 * against the contract (`cast send`, a script, anything outside this app's own
 * `/api/register-agent` / `register_erc8004_identity` paths) — or one where the on-chain
 * `register()` succeeded but the follow-up report-back call failed — would otherwise show
 * "Unregistered" forever, since nothing ever told the store. So this always checks on-chain once
 * *any* wallet address is resolvable.
 *
 * Persisting back to the store (self-heal) only happens starting from an address the store
 * already had **confirmed** (`agent.walletAddress`, bound by an explicit registration report or
 * an observed x402 payment) — never from `resolveAppCustodiedAddress`'s fallback. That fallback is
 * only "whichever wallet `POST /api/register-agent` would currently sign from for this agentId" —
 * env config an operator can (and did, in practice) change later, e.g. giving an agent that
 * previously had no dedicated key one of its own. Persisting a fallback-derived address as if it
 * were confirmed would wrongly and *permanently* pin that agent to whatever wallet happened to be
 * the fallback at the moment it was first checked (`bindAgentWallet`/`bindAgentErc8004Id` never
 * overwrite), silently surviving — and shadowing — a later env fix. The fallback address is still
 * reported live below, just never written back.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const agent = store.getAgent(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const confirmedWalletAddress = agent.walletAddress as Address | undefined;
  const walletAddress = confirmedWalletAddress ?? resolveAppCustodiedAddress(id);
  if (!walletAddress) {
    return NextResponse.json({ registered: false, erc8004AgentId: agent.erc8004AgentId });
  }

  try {
    const registered = await isRegisteredAgent(walletAddress);
    if (!registered) {
      return NextResponse.json({ registered: false, erc8004AgentId: agent.erc8004AgentId, walletAddress });
    }

    let erc8004AgentId = agent.erc8004AgentId;
    if (!erc8004AgentId) {
      erc8004AgentId = await findRegisteredAgentId(walletAddress);
      if (erc8004AgentId && confirmedWalletAddress) store.bindAgentErc8004Id(id, erc8004AgentId);
    }

    return NextResponse.json({
      registered: true,
      erc8004AgentId,
      walletAddress,
      identityRegistryAddress: identityRegistryAddress(),
      erc8004TxHash: agent.erc8004TxHash,
    });
  } catch (err) {
    if (err instanceof Erc8004NotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
