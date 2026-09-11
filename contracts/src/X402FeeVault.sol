// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC20 surface this vault needs — avoids an OpenZeppelin
/// dependency so this single file compiles with the plain `solc` npm package,
/// no import remapping required. See contracts/doc/x402/X402.md.
interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Minimal surface this vault needs from `erc-8004/IdentityRegistry.sol` — kept inline
/// rather than imported, same reasoning as `IERC20Minimal` above: this file compiles with no
/// import remapping. See contracts/doc/erc8004/ERC8004.md.
interface IIdentityRegistryMinimal {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title X402FeeVault
/// @notice Receives and locks the 0.01% platform fee agents pay (via the
/// Somnia-specific x402 flow described in contracts/doc/x402/X402.md) when
/// buying YES/NO shares. `payFee` is permissionless and pulls directly from
/// `msg.sender` — the paying agent's own wallet — so the on-chain `FeeLocked`
/// event is proof only that wallet could have produced, not something the
/// platform signs or forges on an agent's behalf.
///
/// Gated on ERC-8004: `msg.sender` must hold at least one Agent-ID NFT from
/// `identityRegistry` (contracts/doc/erc8004/ERC8004.md) or `payFee` reverts
/// before pulling any tokens — an unregistered wallet's transaction just
/// fails, it never locks a fee with nothing to show for it.
contract X402FeeVault {
    /// @notice The ERC20 fee token — tUSDC on Somnia testnet, USDso on mainnet.
    IERC20Minimal public immutable token;

    /// @notice The ERC-8004 Identity Registry — `payFee` requires the caller
    /// hold at least one Agent-ID NFT here.
    IIdentityRegistryMinimal public immutable identityRegistry;

    /// @notice Address allowed to call `withdraw`. Funds otherwise sit locked
    /// indefinitely; this exists only as a future protocol-treasury hook.
    address public owner;

    /// @notice Running total of fees ever locked in this vault.
    uint256 public totalLocked;

    /// @notice Cumulative fees locked per paying wallet.
    mapping(address => uint256) public lockedByPayer;

    bool private locked;

    event FeeLocked(address indexed payer, uint256 amount, bytes32 indexed paymentRef, string marketId);
    event Withdrawn(address indexed to, uint256 amount);
    event OwnerChanged(address indexed previousOwner, address indexed newOwner);

    error ZeroAmount();
    error ZeroAddress();
    error NotOwner();
    error Reentrant();
    error TransferFailed();
    error InsufficientLocked();
    error NotRegisteredAgent();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked) revert Reentrant();
        locked = true;
        _;
        locked = false;
    }

    constructor(address token_, address owner_, address identityRegistry_) {
        if (token_ == address(0) || owner_ == address(0) || identityRegistry_ == address(0)) revert ZeroAddress();
        token = IERC20Minimal(token_);
        identityRegistry = IIdentityRegistryMinimal(identityRegistry_);
        owner = owner_;
        emit OwnerChanged(address(0), owner_);
    }

    /// @notice Lock `amount` of the fee token, pulled from the caller's own
    /// wallet. This is the on-chain settlement step of the x402 flow: the
    /// app-issued `paymentRef` (a per-request nonce) and `marketId` are
    /// emitted so the app can verify this exact payment against the exact
    /// request it quoted, without trusting anything but this event.
    /// @param amount Fee amount to lock, in the token's own smallest unit.
    /// @param paymentRef The nonce the app issued in its 402 response.
    /// @param marketId The market this fee corresponds to.
    function payFee(uint256 amount, bytes32 paymentRef, string calldata marketId) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (identityRegistry.balanceOf(msg.sender) == 0) revert NotRegisteredAgent();
        bool ok = token.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();
        totalLocked += amount;
        lockedByPayer[msg.sender] += amount;
        emit FeeLocked(msg.sender, amount, paymentRef, marketId);
    }

    /// @notice Owner-only sweep, e.g. for a future protocol treasury. Funds
    /// otherwise stay locked in this contract indefinitely.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount > totalLocked) revert InsufficientLocked();
        totalLocked -= amount;
        bool ok = token.transfer(to, amount);
        if (!ok) revert TransferFailed();
        emit Withdrawn(to, amount);
    }

    /// @notice Transfer the owner-only withdrawal right to a new address.
    function setOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }
}
