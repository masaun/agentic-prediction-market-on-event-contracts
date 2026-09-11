// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../../src/erc-8004/IdentityRegistry.sol";
import {MetadataEntry} from "../../src/erc-8004/interfaces/IIdentityRegistry.sol";

contract IdentityRegistryTest is Test {
    IdentityRegistry registry;

    uint256 adaKey = 0xA11CE;
    address ada;
    address nomi = makeAddr("nomi");
    address stranger = makeAddr("stranger");

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
    event AgentWalletUpdated(uint256 indexed agentId, address indexed newWallet);
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    function setUp() public {
        registry = new IdentityRegistry();
        ada = vm.addr(adaKey);
    }

    // --- register overloads ---

    function test_register_noArgs_mintsIncrementally() public {
        vm.prank(ada);
        uint256 agentId1 = registry.register();
        assertEq(agentId1, 1);
        assertEq(registry.ownerOf(1), ada);
        assertEq(registry.balanceOf(ada), 1);
        assertEq(registry.tokenURI(1), "");

        vm.prank(nomi);
        uint256 agentId2 = registry.register();
        assertEq(agentId2, 2);
    }

    function test_register_withURI_emitsRegistered() public {
        vm.expectEmit(true, false, true, true, address(registry));
        emit Registered(1, "ipfs://agent-1", ada);
        vm.prank(ada);
        uint256 agentId = registry.register("ipfs://agent-1");
        assertEq(registry.tokenURI(agentId), "ipfs://agent-1");
    }

    function test_register_withMetadata_seedsMetadata() public {
        MetadataEntry[] memory entries = new MetadataEntry[](2);
        entries[0] = MetadataEntry({key: "role", value: "bettor"});
        entries[1] = MetadataEntry({key: "persona", value: "momentum"});

        vm.prank(ada);
        uint256 agentId = registry.register("ipfs://agent-1", entries);

        assertEq(registry.getMetadata(agentId, "role"), "bettor");
        assertEq(registry.getMetadata(agentId, "persona"), "momentum");
    }

    // --- setAgentURI ---

    function test_setAgentURI_ownerCanUpdate() public {
        vm.startPrank(ada);
        uint256 agentId = registry.register("ipfs://v1");
        vm.expectEmit(true, false, true, true, address(registry));
        emit URIUpdated(agentId, "ipfs://v2", ada);
        registry.setAgentURI(agentId, "ipfs://v2");
        vm.stopPrank();
        assertEq(registry.tokenURI(agentId), "ipfs://v2");
    }

    function test_setAgentURI_revertsForNonOwner() public {
        vm.prank(ada);
        uint256 agentId = registry.register("ipfs://v1");

        vm.prank(stranger);
        vm.expectRevert(IdentityRegistry.NotOwnerOrApproved.selector);
        registry.setAgentURI(agentId, "ipfs://hijacked");
    }

    function test_setAgentURI_approvedOperatorCanUpdate() public {
        vm.prank(ada);
        uint256 agentId = registry.register("ipfs://v1");

        vm.prank(ada);
        registry.approve(stranger, agentId);

        vm.prank(stranger);
        registry.setAgentURI(agentId, "ipfs://v2");
        assertEq(registry.tokenURI(agentId), "ipfs://v2");
    }

    // --- metadata ---

    function test_setMetadata_ownerOnly() public {
        vm.prank(ada);
        uint256 agentId = registry.register();

        vm.prank(stranger);
        vm.expectRevert(IdentityRegistry.NotOwnerOrApproved.selector);
        registry.setMetadata(agentId, "role", "bettor");

        vm.prank(ada);
        registry.setMetadata(agentId, "role", "bettor");
        assertEq(registry.getMetadata(agentId, "role"), "bettor");
    }

    // --- setAgentWallet (EIP-712) ---

    function test_setAgentWallet_validSignature() public {
        vm.prank(ada);
        uint256 agentId = registry.register();

        address tradingWallet = makeAddr("adaTradingWallet");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signSetAgentWallet(adaKey, agentId, tradingWallet, 0, deadline);

        vm.expectEmit(true, true, false, true, address(registry));
        emit AgentWalletUpdated(agentId, tradingWallet);
        registry.setAgentWallet(agentId, tradingWallet, deadline, sig);

        assertEq(registry.getAgentWallet(agentId), tradingWallet);
    }

    function test_setAgentWallet_revertsOnExpiredDeadline() public {
        vm.prank(ada);
        uint256 agentId = registry.register();

        address tradingWallet = makeAddr("adaTradingWallet");
        uint256 deadline = block.timestamp == 0 ? 0 : block.timestamp - 1;
        bytes memory sig = _signSetAgentWallet(adaKey, agentId, tradingWallet, 0, deadline);

        vm.expectRevert(IdentityRegistry.ExpiredSignature.selector);
        registry.setAgentWallet(agentId, tradingWallet, deadline, sig);
    }

    function test_setAgentWallet_revertsOnWrongSigner() public {
        vm.prank(ada);
        uint256 agentId = registry.register();

        address tradingWallet = makeAddr("adaTradingWallet");
        uint256 deadline = block.timestamp + 1 hours;
        uint256 wrongKey = 0xBAD;
        bytes memory sig = _signSetAgentWallet(wrongKey, agentId, tradingWallet, 0, deadline);

        vm.expectRevert(IdentityRegistry.InvalidSignature.selector);
        registry.setAgentWallet(agentId, tradingWallet, deadline, sig);
    }

    function test_setAgentWallet_revertsOnReplay() public {
        vm.prank(ada);
        uint256 agentId = registry.register();

        address tradingWallet = makeAddr("adaTradingWallet");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signSetAgentWallet(adaKey, agentId, tradingWallet, 0, deadline);

        registry.setAgentWallet(agentId, tradingWallet, deadline, sig);

        // Same signature again — nonce has already advanced, so the digest no longer matches.
        vm.expectRevert(IdentityRegistry.InvalidSignature.selector);
        registry.setAgentWallet(agentId, tradingWallet, deadline, sig);
    }

    // --- standard ERC-721 ---

    function test_transferFrom_movesOwnershipAndBalances() public {
        vm.prank(ada);
        uint256 agentId = registry.register();

        vm.prank(ada);
        vm.expectEmit(true, true, true, true, address(registry));
        emit Transfer(ada, stranger, agentId);
        registry.transferFrom(ada, stranger, agentId);

        assertEq(registry.ownerOf(agentId), stranger);
        assertEq(registry.balanceOf(ada), 0);
        assertEq(registry.balanceOf(stranger), 1);
    }

    function test_transferFrom_revertsForNonOwnerNonApproved() public {
        vm.prank(ada);
        uint256 agentId = registry.register();

        vm.prank(stranger);
        vm.expectRevert(IdentityRegistry.NotOwnerOrApproved.selector);
        registry.transferFrom(ada, stranger, agentId);
    }

    function test_ownerOf_revertsForUnknownToken() public {
        vm.expectRevert(IdentityRegistry.TokenDoesNotExist.selector);
        registry.ownerOf(999);
    }

    function test_supportsInterface() public view {
        assertTrue(registry.supportsInterface(0x01ffc9a7)); // ERC165
        assertTrue(registry.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(registry.supportsInterface(0x5b5e139f)); // ERC721Metadata
        assertFalse(registry.supportsInterface(0xffffffff));
    }

    function _signSetAgentWallet(uint256 signerKey, uint256 agentId, address newWallet, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 typehash = keccak256("SetAgentWallet(uint256 agentId,address newWallet,uint256 nonce,uint256 deadline)");
        bytes32 structHash = keccak256(abi.encode(typehash, agentId, newWallet, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
