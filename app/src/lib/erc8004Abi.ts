/**
 * Hand-authored ABI mirroring contracts/src/erc-8004/IdentityRegistry.sol — kept in sync manually
 * like x402VaultAbi.ts, and for the same reason: app/'s build never depends on contracts/ having
 * been compiled. Only the members app/src/lib/erc8004.ts actually reads/writes are included.
 */
/** Referenced directly (not by array index) by `erc8004.ts`'s `findRegisteredAgentId` — a
 * `getLogs` filter needs one event ABI item, not the whole array. */
export const REGISTERED_EVENT = {
  type: "event",
  name: "Registered",
  inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "agentURI", type: "string", indexed: false },
    { name: "owner", type: "address", indexed: true },
  ],
  anonymous: false,
} as const;

export const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  REGISTERED_EVENT,
] as const;
