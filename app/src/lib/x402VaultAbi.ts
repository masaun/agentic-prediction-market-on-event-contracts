/**
 * Hand-authored ABI mirroring contracts/src/X402FeeVault.sol — kept in sync
 * manually since the interface is small and stable. Lives here (rather than
 * being imported across the package boundary from contracts/, a separate
 * Foundry project with its own build pipeline) so app/'s build never depends
 * on contracts/ having been compiled. Only the handful of members
 * app/src/lib/x402.ts actually reads are included.
 */
export const X402_FEE_VAULT_ABI = [
  {
    type: "event",
    name: "FeeLocked",
    inputs: [
      { name: "payer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "paymentRef", type: "bytes32", indexed: true },
      { name: "marketId", type: "string", indexed: false },
    ],
    anonymous: false,
  },
] as const;
