// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Test} from "forge-std/Test.sol";
import {X402FeeVault} from "../../src/X402FeeVault.sol";
import {IdentityRegistry} from "../../src/erc-8004/IdentityRegistry.sol";

/// @notice Minimal mock ERC20 — just enough surface for X402FeeVault's tests,
/// deliberately not importing OpenZeppelin (matches the vault's own
/// dependency-free style). Mirrors the real Somnia testnet tUSDC
/// (contracts/README.md): a plain transfer/transferFrom/approve token with a
/// public mint, no permit/EIP-3009.
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "insufficient allowance");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract X402FeeVaultTest is Test {
    X402FeeVault vault;
    MockERC20 token;
    IdentityRegistry identityRegistry;

    address owner = makeAddr("owner");
    address ada = makeAddr("ada");
    address nomi = makeAddr("nomi");
    address treasury = makeAddr("treasury");
    address unregistered = makeAddr("unregistered");

    event FeeLocked(address indexed payer, uint256 amount, bytes32 indexed paymentRef, string marketId);
    event Withdrawn(address indexed to, uint256 amount);
    event OwnerChanged(address indexed previousOwner, address indexed newOwner);

    function setUp() public {
        token = new MockERC20();
        identityRegistry = new IdentityRegistry();
        vault = new X402FeeVault(address(token), owner, address(identityRegistry));
        token.mint(ada, 1_000_000);
        token.mint(nomi, 1_000_000);
        token.mint(unregistered, 1_000_000);

        vm.prank(ada);
        identityRegistry.register();
        vm.prank(nomi);
        identityRegistry.register();
        // `unregistered` deliberately never calls register() — see
        // test_payFee_revertsForUnregisteredAgent below.
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(X402FeeVault.ZeroAddress.selector);
        new X402FeeVault(address(0), owner, address(identityRegistry));

        vm.expectRevert(X402FeeVault.ZeroAddress.selector);
        new X402FeeVault(address(token), address(0), address(identityRegistry));

        vm.expectRevert(X402FeeVault.ZeroAddress.selector);
        new X402FeeVault(address(token), owner, address(0));
    }

    function test_payFee_revertsForUnregisteredAgent() public {
        vm.startPrank(unregistered);
        token.approve(address(vault), type(uint256).max);
        vm.expectRevert(X402FeeVault.NotRegisteredAgent.selector);
        vault.payFee(10, bytes32(uint256(1)), "mkt-1");
        vm.stopPrank();

        assertEq(vault.totalLocked(), 0);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function test_payFee_locksAndEmits() public {
        vm.startPrank(ada);
        token.approve(address(vault), type(uint256).max);

        vm.expectEmit(true, true, false, true, address(vault));
        emit FeeLocked(ada, 42, bytes32(uint256(1)), "mkt-1");
        vault.payFee(42, bytes32(uint256(1)), "mkt-1");
        vm.stopPrank();

        assertEq(vault.totalLocked(), 42);
        assertEq(vault.lockedByPayer(ada), 42);
        assertEq(token.balanceOf(address(vault)), 42);
        assertEq(token.balanceOf(ada), 1_000_000 - 42);
    }

    function test_payFee_accumulatesAcrossPayers() public {
        vm.prank(ada);
        token.approve(address(vault), type(uint256).max);
        vm.prank(ada);
        vault.payFee(10, bytes32(uint256(1)), "mkt-1");

        vm.prank(nomi);
        token.approve(address(vault), type(uint256).max);
        vm.prank(nomi);
        vault.payFee(20, bytes32(uint256(2)), "mkt-1");

        assertEq(vault.totalLocked(), 30);
        assertEq(vault.lockedByPayer(ada), 10);
        assertEq(vault.lockedByPayer(nomi), 20);
    }

    function test_payFee_revertsOnZeroAmount() public {
        vm.prank(ada);
        vm.expectRevert(X402FeeVault.ZeroAmount.selector);
        vault.payFee(0, bytes32(uint256(1)), "mkt-1");
    }

    function test_payFee_revertsWithoutAllowance() public {
        vm.prank(ada);
        vm.expectRevert();
        vault.payFee(10, bytes32(uint256(1)), "mkt-1");
    }

    function test_withdraw_onlyOwner() public {
        _lockFee(ada, 100);

        vm.prank(ada);
        vm.expectRevert(X402FeeVault.NotOwner.selector);
        vault.withdraw(treasury, 100);

        vm.prank(owner);
        vault.withdraw(treasury, 100);
        assertEq(token.balanceOf(treasury), 100);
        assertEq(vault.totalLocked(), 0);
    }

    function test_withdraw_revertsAboveTotalLocked() public {
        _lockFee(ada, 100);
        vm.prank(owner);
        vm.expectRevert(X402FeeVault.InsufficientLocked.selector);
        vault.withdraw(treasury, 101);
    }

    function test_withdraw_emitsEvent() public {
        _lockFee(ada, 100);
        vm.expectEmit(true, false, false, true, address(vault));
        emit Withdrawn(treasury, 60);
        vm.prank(owner);
        vault.withdraw(treasury, 60);
    }

    function test_setOwner_onlyCurrentOwner() public {
        vm.prank(ada);
        vm.expectRevert(X402FeeVault.NotOwner.selector);
        vault.setOwner(ada);

        vm.expectEmit(true, true, false, true, address(vault));
        emit OwnerChanged(owner, ada);
        vm.prank(owner);
        vault.setOwner(ada);
        assertEq(vault.owner(), ada);

        // old owner can no longer withdraw
        _lockFee(nomi, 10);
        vm.prank(owner);
        vm.expectRevert(X402FeeVault.NotOwner.selector);
        vault.withdraw(treasury, 10);
    }

    function test_setOwner_revertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(X402FeeVault.ZeroAddress.selector);
        vault.setOwner(address(0));
    }

    function _lockFee(address payer, uint256 amount) internal {
        vm.prank(payer);
        token.approve(address(vault), type(uint256).max);
        vm.prank(payer);
        vault.payFee(amount, bytes32(uint256(uint160(payer))), "mkt-1");
    }
}
