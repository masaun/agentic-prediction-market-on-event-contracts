import { createPublicClient, decodeEventLog, http, isAddressEqual, type Address, type Hash } from "viem";
import { randomBytes } from "node:crypto";
import { X402_FEE_VAULT_ABI } from "./x402VaultAbi";

/**
 * The Somnia-specific x402 payment scheme this app implements for buying
 * YES/NO shares — see contracts/doc/x402/X402.md for the full design and why
 * it diverges from x402's stock "exact" EVM scheme (tUSDC has neither
 * EIP-3009 nor Permit2 available on Somnia testnet). Each agent holds its
 * own wallet and submits the fee payment itself; this module is the App's
 * side of the deal — it only ever *verifies* an already-mined transaction,
 * never signs or broadcasts anything on an agent's behalf.
 */

/** 0.01% platform fee, in basis points (1 bp = 0.01%). */
export const PLATFORM_FEE_BPS = 1;

/** tUSDC's on-chain decimals — see contracts/README.md. Mirrors the same
 * literal already used in packages/market-engine/src/liveEngine.ts. */
const TUSDC_DECIMALS = 6;

/** How long an issued 402 charge stays payable before it expires. */
const CHARGE_TTL_SEC = 300;

type SomniaNetwork = "testnet" | "mainnet";

const NETWORK_DEFAULTS: Record<SomniaNetwork, { chainId: number; rpcUrl: string }> = {
  testnet: { chainId: 50312, rpcUrl: "https://dream-rpc.somnia.network" },
  mainnet: { chainId: 5031, rpcUrl: "" },
};

export class X402VaultNotConfiguredError extends Error {
  constructor() {
    super(
      "X402_FEE_VAULT_ADDRESS is not set — deploy contracts/src/X402FeeVault.sol " +
        "(see contracts/README.md / npm run deploy:x402vault) and set its address in app/.env " +
        "before buying shares against a live Somnia venue.",
    );
    this.name = "X402VaultNotConfiguredError";
  }
}

export class X402PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402PaymentError";
  }
}

function network(): SomniaNetwork {
  return (process.env.SOMNIA_NETWORK ?? "testnet").toLowerCase() === "mainnet" ? "mainnet" : "testnet";
}

function vaultAddress(): Address {
  const addr = process.env.X402_FEE_VAULT_ADDRESS;
  if (!addr) throw new X402VaultNotConfiguredError();
  return addr as Address;
}

function rpcUrl(): string {
  const net = network();
  const url = process.env.SOMNIA_RPC_URL || NETWORK_DEFAULTS[net].rpcUrl;
  if (!url) {
    throw new Error(`No default RPC URL for Somnia ${net} — set SOMNIA_RPC_URL in app/.env.`);
  }
  return url;
}

function publicClient() {
  return createPublicClient({ transport: http(rpcUrl()) });
}

/** In human tUSDC units. */
export function computeFee(cost: number): number {
  return (cost * PLATFORM_FEE_BPS) / 10_000;
}

function toAtomicUnits(amountHuman: number): bigint {
  return BigInt(Math.round(amountHuman * 10 ** TUSDC_DECIMALS));
}

export interface PaymentRequirements {
  x402Version: 1;
  /** Flags this as the Somnia-specific extension scheme documented in
   * contracts/doc/x402/X402.md — not x402's stock EIP-3009 "exact" scheme,
   * which tUSDC on Somnia testnet doesn't support. */
  scheme: "exact-agent-paid";
  network: string;
  resource: string;
  description: string;
  asset: Address;
  payTo: Address;
  maxAmountRequired: string;
  extra: {
    marketId: string;
    /** Per-request nonce the agent must pass as `paymentRef` to
     * `X402FeeVault.payFee` — ties the on-chain payment to this exact quote. */
    nonce: Hash;
    validBefore: number;
  };
}

interface PendingCharge {
  marketId: string;
  feeAmountAtomic: bigint;
  validBefore: number;
}

/** Charges issued by `buildPaymentRequirements` awaiting on-chain proof.
 * In-memory and process-local — fine for a demo venue; a production
 * deployment would persist this (see contracts/doc/x402/X402.md's honest
 * caveats). Cleared once verified so a nonce can never be redeemed twice. */
const pendingCharges = new Map<string, PendingCharge>();

function tUSDCAddress(): Address {
  const testnet = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E" as const;
  const mainnet = "0x00000022dA000002656c64D9eA6011ea952D008A" as const;
  return network() === "mainnet" ? mainnet : testnet;
}

/** Issues a 402 payment challenge for buying `costHuman` tUSDC worth of
 * shares on `marketId`. Throws `X402VaultNotConfiguredError` if the vault
 * isn't deployed/configured yet. */
export function buildPaymentRequirements(input: {
  marketId: string;
  costHuman: number;
  resource: string;
}): PaymentRequirements {
  const vault = vaultAddress(); // throws if unconfigured — check first
  const feeHuman = computeFee(input.costHuman);
  const feeAmountAtomic = toAtomicUnits(feeHuman);
  const nonce = `0x${randomBytes(32).toString("hex")}` as Hash;
  const validBefore = Math.floor(Date.now() / 1000) + CHARGE_TTL_SEC;

  pendingCharges.set(nonce, { marketId: input.marketId, feeAmountAtomic, validBefore });

  return {
    x402Version: 1,
    scheme: "exact-agent-paid",
    network: `eip155:${NETWORK_DEFAULTS[network()].chainId}`,
    resource: input.resource,
    description: `0.01% platform fee for buying shares on market ${input.marketId}`,
    asset: tUSDCAddress(),
    payTo: vault,
    maxAmountRequired: feeAmountAtomic.toString(),
    extra: { marketId: input.marketId, nonce, validBefore },
  };
}

export interface VerifiedPayment {
  payer: Address;
  feeAmountHuman: number;
  txHash: Hash;
}

/**
 * Verifies an agent-submitted `X402FeeVault.payFee` transaction against the
 * charge previously issued for `nonce`. Never signs or broadcasts anything —
 * only reads the transaction receipt this agent already paid for and mined
 * itself. See contracts/doc/x402/X402.md §3 for why a mined transaction,
 * rather than a signature, is the proof here.
 */
export async function verifyOnChainPayment(input: {
  nonce: string;
  txHash: Hash;
  marketId: string;
  expectedPayer?: Address;
}): Promise<VerifiedPayment> {
  const charge = pendingCharges.get(input.nonce);
  if (!charge) {
    throw new X402PaymentError("Unknown or already-redeemed payment nonce — request a new 402 challenge.");
  }
  if (Math.floor(Date.now() / 1000) > charge.validBefore) {
    pendingCharges.delete(input.nonce);
    throw new X402PaymentError("Payment charge expired — request a new 402 challenge.");
  }
  if (charge.marketId !== input.marketId) {
    throw new X402PaymentError("Payment nonce was issued for a different market.");
  }

  const client = publicClient();
  const receipt = await client.getTransactionReceipt({ hash: input.txHash });
  if (receipt.status !== "success") {
    throw new X402PaymentError(`Payment transaction ${input.txHash} did not succeed on-chain.`);
  }

  const vault = vaultAddress();
  let payer: Address | undefined;
  let amount: bigint | undefined;
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address as Address, vault)) continue;
    try {
      const decoded = decodeEventLog({ abi: X402_FEE_VAULT_ABI, data: log.data, topics: log.topics, eventName: "FeeLocked" });
      if (decoded.args.paymentRef !== input.nonce) continue;
      payer = decoded.args.payer;
      amount = decoded.args.amount;
      break;
    } catch {
      // Not a FeeLocked log (or a different event) — keep scanning.
    }
  }
  if (!payer || amount === undefined) {
    throw new X402PaymentError(
      `No FeeLocked event for this payment nonce found in transaction ${input.txHash} — did payFee() actually run?`,
    );
  }
  if (amount < charge.feeAmountAtomic) {
    throw new X402PaymentError(
      `Payment amount ${amount} is below the required fee ${charge.feeAmountAtomic}.`,
    );
  }
  if (input.expectedPayer && !isAddressEqual(payer, input.expectedPayer)) {
    throw new X402PaymentError(
      `Payment came from ${payer}, but this agent is registered with wallet ${input.expectedPayer}.`,
    );
  }

  pendingCharges.delete(input.nonce); // one-time use — blocks replay

  return {
    payer,
    feeAmountHuman: Number(amount) / 10 ** TUSDC_DECIMALS,
    txHash: input.txHash,
  };
}
