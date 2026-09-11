import { NextResponse } from "next/server";
import type { Address, Hash } from "viem";
import { requireAgentKey } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { X402VaultNotConfiguredError, buildPaymentRequirements, verifyOnChainPayment } from "@/lib/x402";
import { isRegisteredAgent } from "@/lib/erc8004";

/**
 * The x402 resource server for buying YES/NO shares — see
 * contracts/doc/x402/X402.md for the full design. Unlike
 * POST /api/markets/:id/orders, this route never calls DreamDEX itself: it
 * only quotes and verifies the 0.01% platform fee. Placing the actual
 * DreamDEX order is the paying agent's own job, from the same wallet, once
 * this returns `cleared: true` — see agents/proxy-servers/shared/apiClient.ts.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAgentKey(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { side, price, quantity, agentId } = (body ?? {}) as {
    side?: "BUY_YES" | "BUY_NO";
    price?: number;
    quantity?: number;
    agentId?: string;
  };

  if (side !== "BUY_YES" && side !== "BUY_NO") {
    return NextResponse.json(
      { error: 'side must be "BUY_YES" or "BUY_NO" — use POST /api/markets/:id/orders for SELL_YES/SELL_NO' },
      { status: 400 },
    );
  }
  if (price === undefined || !quantity) {
    return NextResponse.json({ error: "price and quantity are required" }, { status: 400 });
  }

  const resource = `/api/markets/${id}/buy`;
  const costHuman = price * quantity;
  const paymentHeader = request.headers.get("x-payment");

  // Fast-fail UX only, once the agent's wallet is already known — see
  // contracts/doc/erc8004/ERC8004.md. The authoritative gate is X402FeeVault.payFee()'s own
  // on-chain revert, which fires regardless of whether the app has observed this wallet yet
  // (e.g. its very first buy attempt).
  const knownWallet = agentId ? getStore().getAgent(agentId)?.walletAddress : undefined;
  if (knownWallet) {
    try {
      if (!(await isRegisteredAgent(knownWallet as Address))) {
        return NextResponse.json(
          { error: `Agent "${agentId}" is not ERC-8004 registered — call register_erc8004_identity (or the Register tab) first.` },
          { status: 403 },
        );
      }
    } catch {
      // ERC8004 not configured, or an RPC hiccup — don't block the buy on this pre-check alone;
      // X402FeeVault.payFee()'s on-chain check is what actually matters.
    }
  }

  if (!paymentHeader) {
    try {
      const requirements = buildPaymentRequirements({ marketId: id, costHuman, resource });
      return NextResponse.json({ x402Version: 1, error: "Payment required", accepts: [requirements] }, { status: 402 });
    } catch (err) {
      if (err instanceof X402VaultNotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 501 });
      }
      throw err;
    }
  }

  let decoded: { txHash?: Hash; nonce?: string };
  try {
    decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString("utf-8"));
  } catch {
    return NextResponse.json({ error: "Malformed X-PAYMENT header — expected base64 JSON {txHash, nonce}" }, { status: 400 });
  }
  if (!decoded.txHash || !decoded.nonce) {
    return NextResponse.json({ error: "X-PAYMENT header must include txHash and nonce" }, { status: 400 });
  }

  try {
    const expectedPayer = agentId ? (getStore().getAgent(agentId)?.walletAddress as `0x${string}` | undefined) : undefined;
    const result = await verifyOnChainPayment({
      nonce: decoded.nonce,
      txHash: decoded.txHash,
      marketId: id,
      expectedPayer,
    });

    if (agentId) getStore().bindAgentWallet(agentId, result.payer);

    const payload = {
      cleared: true,
      payer: result.payer,
      feeAmount: result.feeAmountHuman,
      txHash: result.txHash,
      vaultAddress: process.env.X402_FEE_VAULT_ADDRESS,
    };
    const res = NextResponse.json(payload, { status: 200 });
    res.headers.set("X-PAYMENT-RESPONSE", Buffer.from(JSON.stringify(payload)).toString("base64"));
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 402 });
  }
}
