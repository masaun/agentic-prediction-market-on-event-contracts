// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../../src/erc-8004/IdentityRegistry.sol";
import {ReputationRegistry} from "../../src/erc-8004/ReputationRegistry.sol";

contract ReputationRegistryTest is Test {
    IdentityRegistry identity;
    ReputationRegistry reputation;

    address ada = makeAddr("ada");
    address client1 = makeAddr("client1");
    address client2 = makeAddr("client2");
    uint256 agentId;

    event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex);

    function setUp() public {
        identity = new IdentityRegistry();
        reputation = new ReputationRegistry(address(identity));

        vm.prank(ada);
        agentId = identity.register();
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(ReputationRegistry.ZeroAddress.selector);
        new ReputationRegistry(address(0));
    }

    function test_giveFeedback_revertsForAgentOwner() public {
        vm.prank(ada);
        vm.expectRevert(ReputationRegistry.SelfFeedbackNotAllowed.selector);
        reputation.giveFeedback(agentId, 90, 0, "quality", "", "", "", bytes32(0));
    }

    function test_giveFeedback_revertsOnInvalidDecimals() public {
        vm.prank(client1);
        vm.expectRevert(ReputationRegistry.InvalidDecimals.selector);
        reputation.giveFeedback(agentId, 90, 19, "quality", "", "", "", bytes32(0));
    }

    function test_giveFeedback_revertsForUnknownAgent() public {
        vm.prank(client1);
        vm.expectRevert(); // IdentityRegistry.ownerOf reverts TokenDoesNotExist
        reputation.giveFeedback(999, 90, 0, "quality", "", "", "", bytes32(0));
    }

    function test_giveFeedback_storesAndTracksClient() public {
        vm.prank(client1);
        uint64 idx = reputation.giveFeedback(agentId, 90, 0, "quality", "speed", "https://a2a", "ipfs://fb1", keccak256("fb1"));
        assertEq(idx, 1);

        (int128 value, uint8 decimals, string memory tag1, string memory tag2, bool revoked) =
            reputation.readFeedback(agentId, client1, idx);
        assertEq(value, 90);
        assertEq(decimals, 0);
        assertEq(tag1, "quality");
        assertEq(tag2, "speed");
        assertFalse(revoked);

        address[] memory clients = reputation.getClients(agentId);
        assertEq(clients.length, 1);
        assertEq(clients[0], client1);
        assertEq(reputation.getLastIndex(agentId, client1), 1);
    }

    function test_revokeFeedback_onlySubmitter() public {
        vm.prank(client1);
        uint64 idx = reputation.giveFeedback(agentId, 90, 0, "quality", "", "", "", bytes32(0));

        vm.prank(client2);
        vm.expectRevert(ReputationRegistry.FeedbackDoesNotExist.selector);
        reputation.revokeFeedback(agentId, idx);

        vm.prank(client1);
        vm.expectEmit(true, true, true, false, address(reputation));
        emit FeedbackRevoked(agentId, client1, idx);
        reputation.revokeFeedback(agentId, idx);

        (,,,, bool revoked) = reputation.readFeedback(agentId, client1, idx);
        assertTrue(revoked);
    }

    function test_revokeFeedback_revertsIfAlreadyRevoked() public {
        vm.startPrank(client1);
        uint64 idx = reputation.giveFeedback(agentId, 90, 0, "quality", "", "", "", bytes32(0));
        reputation.revokeFeedback(agentId, idx);
        vm.expectRevert(ReputationRegistry.AlreadyRevoked.selector);
        reputation.revokeFeedback(agentId, idx);
        vm.stopPrank();
    }

    function test_appendResponse_anyoneCanRespond() public {
        vm.prank(client1);
        uint64 idx = reputation.giveFeedback(agentId, 90, 0, "quality", "", "", "", bytes32(0));

        vm.prank(ada);
        reputation.appendResponse(agentId, client1, idx, "ipfs://response", keccak256("resp"));

        assertEq(reputation.getResponseCount(agentId, client1, idx, new address[](0)), 1);
    }

    function test_getSummary_averagesNonRevokedMatchingTag() public {
        vm.prank(client1);
        reputation.giveFeedback(agentId, 80, 0, "quality", "", "", "", bytes32(0));
        vm.prank(client2);
        reputation.giveFeedback(agentId, 100, 0, "quality", "", "", "", bytes32(0));
        vm.prank(client1);
        uint64 idx2 = reputation.giveFeedback(agentId, 0, 0, "speed", "", "", "", bytes32(0));
        vm.prank(client1);
        reputation.revokeFeedback(agentId, idx2);

        (uint64 count, int128 avg,) = reputation.getSummary(agentId, new address[](0), "quality", "");
        assertEq(count, 2);
        assertEq(avg, 90);
    }

    function test_readAllFeedback_excludesRevokedByDefault() public {
        vm.startPrank(client1);
        reputation.giveFeedback(agentId, 80, 0, "quality", "", "", "", bytes32(0));
        uint64 idx2 = reputation.giveFeedback(agentId, 20, 0, "quality", "", "", "", bytes32(0));
        reputation.revokeFeedback(agentId, idx2);
        vm.stopPrank();

        (address[] memory clients,,,,,, bool[] memory revoked) =
            reputation.readAllFeedback(agentId, new address[](0), "", "", false);
        assertEq(clients.length, 1);
        assertEq(revoked.length, 1);
        assertFalse(revoked[0]);

        (address[] memory clientsAll,,,,,,) = reputation.readAllFeedback(agentId, new address[](0), "", "", true);
        assertEq(clientsAll.length, 2);
    }
}
