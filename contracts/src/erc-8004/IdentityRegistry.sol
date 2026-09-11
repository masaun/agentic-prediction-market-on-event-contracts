// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityRegistry, IERC721Receiver, MetadataEntry} from "./interfaces/IIdentityRegistry.sol";

/// @title IdentityRegistry
/// @notice ERC-8004's Identity Registry: an ERC-721 whose tokenId is the agent's `agentId`,
/// minted incrementally to whichever wallet calls `register`. Any agent this platform trades
/// with — built-in (Ada, Nomi) or external (Hermes Agent, OpenClaw) — must hold one before
/// `X402FeeVault.payFee` (and therefore buying YES/NO shares) will let it through. See
/// contracts/doc/erc8004/ERC8004.md.
///
/// Hand-rolled ERC-721 + ERC-165 rather than an OpenZeppelin import, matching this repo's
/// existing single-file, dependency-free contracts (see contracts/README.md and
/// X402FeeVault.sol) — `forge build` needs nothing beyond forge-std.
///
/// Not the official erc-8004/erc-8004-contracts deployment: that repo's canonical `0x8004...`
/// addresses are reached via a pre-mined CREATE2 salt against a factory that isn't deployed on
/// Somnia — see contracts/doc/erc8004/ERC8004.md for why this is an independent, spec-faithful
/// deployment instead.
contract IdentityRegistry is IIdentityRegistry {
    string public constant NAME = "ERC-8004 Agent Identity";
    string public constant SYMBOL = "AGENT-ID";

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant SET_AGENT_WALLET_TYPEHASH =
        keccak256("SetAgentWallet(uint256 agentId,address newWallet,uint256 nonce,uint256 deadline)");

    bytes4 private constant ERC165_INTERFACE_ID = 0x01ffc9a7;
    bytes4 private constant ERC721_INTERFACE_ID = 0x80ac58cd;
    bytes4 private constant ERC721_METADATA_INTERFACE_ID = 0x5b5e139f;
    bytes4 private constant ERC721_RECEIVED = IERC721Receiver.onERC721Received.selector;

    bytes32 public immutable domainSeparator;

    uint256 private _nextAgentId = 1;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    mapping(uint256 => string) private _agentURIs;
    mapping(uint256 => address) private _agentWallets;
    mapping(uint256 => uint256) private _agentWalletNonces;
    mapping(uint256 => mapping(string => string)) private _metadata;

    error ZeroAddress();
    error TokenDoesNotExist();
    error NotOwnerOrApproved();
    error NotOwner();
    error ExpiredSignature();
    error InvalidSignature();
    error TransferToNonReceiver();
    error InvalidSignatureLength();

    constructor() {
        domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, keccak256(bytes("ERC8004IdentityRegistry")), keccak256(bytes("1")), block.chainid, address(this)
            )
        );
    }

    // ---------------------------------------------------------------------
    // ERC-8004
    // ---------------------------------------------------------------------

    function register() external returns (uint256 agentId) {
        agentId = _register(msg.sender, "");
    }

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = _register(msg.sender, agentURI);
    }

    function register(string calldata agentURI, MetadataEntry[] calldata metadata) external returns (uint256 agentId) {
        agentId = _register(msg.sender, agentURI);
        for (uint256 i = 0; i < metadata.length; i++) {
            _metadata[agentId][metadata[i].key] = metadata[i].value;
            emit MetadataSet(agentId, metadata[i].key, metadata[i].key, metadata[i].value);
        }
    }

    function _register(address owner, string memory agentURI) internal returns (uint256 agentId) {
        agentId = _nextAgentId++;
        _mint(owner, agentId);
        _agentURIs[agentId] = agentURI;
        emit Registered(agentId, agentURI, owner);
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        if (!_isApprovedOrOwner(msg.sender, agentId)) revert NotOwnerOrApproved();
        _agentURIs[agentId] = newURI;
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    /// @notice Binds `newWallet` as `agentId`'s operating wallet, authorized by the current
    /// owner's EIP-712 signature rather than a direct `msg.sender == owner` check — so the
    /// operating wallet itself (e.g. an agent process holding its own trading key, never the
    /// owner's) can submit this transaction on the owner's behalf without ever seeing the
    /// owner's private key. Used when a human registers (minting to their own/App-custodied
    /// wallet) and then wants a separate agent-held wallet recognized as the same identity.
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert ExpiredSignature();
        if (newWallet == address(0)) revert ZeroAddress();
        address owner = ownerOf(agentId);

        uint256 nonce = _agentWalletNonces[agentId]++;
        bytes32 structHash = keccak256(abi.encode(SET_AGENT_WALLET_TYPEHASH, agentId, newWallet, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        address signer = _recover(digest, signature);
        if (signer != owner) revert InvalidSignature();

        _agentWallets[agentId] = newWallet;
        emit AgentWalletUpdated(agentId, newWallet);
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return _agentWallets[agentId];
    }

    function agentWalletNonce(uint256 agentId) external view returns (uint256) {
        return _agentWalletNonces[agentId];
    }

    function getMetadata(uint256 agentId, string calldata metadataKey) external view returns (string memory) {
        return _metadata[agentId][metadataKey];
    }

    function setMetadata(uint256 agentId, string calldata metadataKey, string calldata metadataValue) external {
        if (!_isApprovedOrOwner(msg.sender, agentId)) revert NotOwnerOrApproved();
        _metadata[agentId][metadataKey] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    // ---------------------------------------------------------------------
    // ERC-721
    // ---------------------------------------------------------------------

    function balanceOf(address owner) public view returns (uint256) {
        if (owner == address(0)) revert ZeroAddress();
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _owners[tokenId];
        if (owner == address(0)) revert TokenDoesNotExist();
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        _requireExists(tokenId);
        return _tokenApprovals[tokenId];
    }

    function isApprovedForAll(address owner, address operator) public view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !isApprovedForAll(owner, msg.sender)) revert NotOwnerOrApproved();
        _tokenApprovals[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (!_isApprovedOrOwner(msg.sender, tokenId)) revert NotOwnerOrApproved();
        if (ownerOf(tokenId) != from) revert NotOwner();
        if (to == address(0)) revert ZeroAddress();
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length > 0) {
            try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 retval) {
                if (retval != ERC721_RECEIVED) revert TransferToNonReceiver();
            } catch {
                revert TransferToNonReceiver();
            }
        }
    }

    function name() external pure returns (string memory) {
        return NAME;
    }

    function symbol() external pure returns (string memory) {
        return SYMBOL;
    }

    function tokenURI(uint256 agentId) external view returns (string memory) {
        _requireExists(agentId);
        return _agentURIs[agentId];
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == ERC165_INTERFACE_ID || interfaceId == ERC721_INTERFACE_ID || interfaceId == ERC721_METADATA_INTERFACE_ID;
    }

    // ---------------------------------------------------------------------
    // internals
    // ---------------------------------------------------------------------

    function _mint(address to, uint256 tokenId) internal {
        if (to == address(0)) revert ZeroAddress();
        _balances[to] += 1;
        _owners[tokenId] = to;
        emit Transfer(address(0), to, tokenId);
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        delete _tokenApprovals[tokenId];
        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address owner = ownerOf(tokenId);
        return spender == owner || getApproved(tokenId) == spender || isApprovedForAll(owner, spender);
    }

    function _requireExists(uint256 tokenId) internal view {
        if (_owners[tokenId] == address(0)) revert TokenDoesNotExist();
    }

    /// @dev Plain `ecrecover` split — no OZ ECDSA import, matching this file's dependency-free
    /// style. Accepts only the standard 65-byte (r,s,v) layout.
    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignatureLength();
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }
}
