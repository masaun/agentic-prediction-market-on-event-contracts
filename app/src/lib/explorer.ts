export type SomniaNetwork = "testnet" | "mainnet";

/**
 * Base URLs from `@somnia-chain/markets-sdk`'s chain definitions
 * (`somniaShannon`/`somniaMainnet` `blockExplorers.default.url`) — kept as a
 * literal here so this stays a client-safe, dependency-free import.
 */
const EXPLORER_BASE_URL: Record<SomniaNetwork, string> = {
  testnet: "https://shannon-explorer.somnia.network",
  mainnet: "https://explorer.somnia.network",
};

/** Block explorer URL for a DreamDEX Event Contract transaction on Somnia. */
export function explorerTxUrl(txHash: string, network: SomniaNetwork = "testnet"): string {
  return `${EXPLORER_BASE_URL[network]}/tx/${txHash}`;
}

/** Block explorer URL for a wallet address on Somnia. */
export function explorerAddressUrl(address: string, network: SomniaNetwork = "testnet"): string {
  return `${EXPLORER_BASE_URL[network]}/address/${address}`;
}

/** Block explorer URL for the ERC-8004 IdentityRegistry NFT instance (agentId) minted to an agent. */
export function explorerTokenUrl(contractAddress: string, tokenId: string, network: SomniaNetwork = "testnet"): string {
  return `${EXPLORER_BASE_URL[network]}/token/${contractAddress}/instance/${tokenId}?tab=token_transfers`;
}
