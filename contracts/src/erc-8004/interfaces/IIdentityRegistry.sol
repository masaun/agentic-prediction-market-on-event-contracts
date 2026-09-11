// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice One metadata (key, value) pair — used by `register`'s batch overload to seed metadata
/// atomically with minting. Mirrors the shape used by `IdentityRegistry.setMetadata`.
struct MetadataEntry {
    string key;
    string value;
}

/// @title IIdentityRegistry
/// @notice The ERC-8004 Identity Registry interface — an ERC-721 whose tokenId is the agent's
/// `agentId`. Shared by `ReputationRegistry` and `ValidationRegistry` (both only ever need the
/// ERC-721 ownership reads, never the ERC-8004-specific writes) and by anything off-chain (this
/// repo's app/agent-servers) that wants one canonical ABI to import against.
/// See contracts/doc/erc8004/ERC8004.md for the full design.
interface IIdentityRegistry {
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
    event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, string metadataValue);
    event AgentWalletUpdated(uint256 indexed agentId, address indexed newWallet);

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    // --- ERC-8004 ---

    function register() external returns (uint256 agentId);
    function register(string calldata agentURI) external returns (uint256 agentId);
    function register(string calldata agentURI, MetadataEntry[] calldata metadata) external returns (uint256 agentId);

    function setAgentURI(uint256 agentId, string calldata newURI) external;
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
    function getAgentWallet(uint256 agentId) external view returns (address);
    function agentWalletNonce(uint256 agentId) external view returns (uint256);

    function getMetadata(uint256 agentId, string calldata metadataKey) external view returns (string memory);
    function setMetadata(uint256 agentId, string calldata metadataKey, string calldata metadataValue) external;

    // --- ERC-721 (the subset the other registries + this app need) ---

    function balanceOf(address owner) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function approve(address to, uint256 tokenId) external;
    function setApprovalForAll(address operator, bool approved) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external;

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function tokenURI(uint256 agentId) external view returns (string memory);

    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// @notice Minimal receiver hook — checked by `safeTransferFrom`, same as stock ERC-721.
interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}
