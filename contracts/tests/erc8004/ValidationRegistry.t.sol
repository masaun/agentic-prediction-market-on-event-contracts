// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../../src/erc-8004/IdentityRegistry.sol";
import {ValidationRegistry} from "../../src/erc-8004/ValidationRegistry.sol";

contract ValidationRegistryTest is Test {
    IdentityRegistry identity;
    ValidationRegistry validation;

    address ada = makeAddr("ada");
    address stranger = makeAddr("stranger");
    address validator = makeAddr("validator");
    uint256 agentId;

    event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash);
    event ValidationResponse(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        uint8 response,
        string responseURI,
        bytes32 responseHash,
        string tag
    );

    function setUp() public {
        identity = new IdentityRegistry();
        validation = new ValidationRegistry(address(identity));

        vm.prank(ada);
        agentId = identity.register();
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(ValidationRegistry.ZeroAddress.selector);
        new ValidationRegistry(address(0));
    }

    function test_validationRequest_onlyOwnerOrOperator() public {
        bytes32 requestHash = keccak256("req-1");

        vm.prank(stranger);
        vm.expectRevert(ValidationRegistry.NotOwnerOrApproved.selector);
        validation.validationRequest(validator, agentId, "ipfs://req-1", requestHash);

        vm.prank(ada);
        vm.expectEmit(true, true, false, true, address(validation));
        emit ValidationRequest(validator, agentId, "ipfs://req-1", requestHash);
        validation.validationRequest(validator, agentId, "ipfs://req-1", requestHash);

        (address storedValidator, uint256 storedAgentId, uint8 response,,) = validation.getValidationStatus(requestHash);
        assertEq(storedValidator, validator);
        assertEq(storedAgentId, agentId);
        assertEq(response, 0);
    }

    function test_validationRequest_approvedOperatorCanRequest() public {
        vm.prank(ada);
        identity.setApprovalForAll(stranger, true);

        bytes32 requestHash = keccak256("req-op");
        vm.prank(stranger);
        validation.validationRequest(validator, agentId, "ipfs://req-op", requestHash);

        (address storedValidator,,,,) = validation.getValidationStatus(requestHash);
        assertEq(storedValidator, validator);
    }

    function test_validationRequest_revertsOnDuplicateHash() public {
        bytes32 requestHash = keccak256("dup");
        vm.startPrank(ada);
        validation.validationRequest(validator, agentId, "ipfs://a", requestHash);
        vm.expectRevert(ValidationRegistry.DuplicateRequest.selector);
        validation.validationRequest(validator, agentId, "ipfs://b", requestHash);
        vm.stopPrank();
    }

    function test_validationResponse_onlyNamedValidator() public {
        bytes32 requestHash = keccak256("req-1");
        vm.prank(ada);
        validation.validationRequest(validator, agentId, "ipfs://req-1", requestHash);

        vm.prank(stranger);
        vm.expectRevert(ValidationRegistry.NotValidator.selector);
        validation.validationResponse(requestHash, 100, "ipfs://resp", keccak256("resp"), "passed");

        vm.prank(validator);
        vm.expectEmit(true, true, true, true, address(validation));
        emit ValidationResponse(validator, agentId, requestHash, 100, "ipfs://resp", keccak256("resp"), "passed");
        validation.validationResponse(requestHash, 100, "ipfs://resp", keccak256("resp"), "passed");

        (,, uint8 response, string memory tag,) = validation.getValidationStatus(requestHash);
        assertEq(response, 100);
        assertEq(tag, "passed");
    }

    function test_validationResponse_revertsAboveMax() public {
        bytes32 requestHash = keccak256("req-1");
        vm.prank(ada);
        validation.validationRequest(validator, agentId, "ipfs://req-1", requestHash);

        vm.prank(validator);
        vm.expectRevert(ValidationRegistry.InvalidResponse.selector);
        validation.validationResponse(requestHash, 101, "", bytes32(0), "");
    }

    function test_validationResponse_progressiveUpdates() public {
        bytes32 requestHash = keccak256("req-progressive");
        vm.prank(ada);
        validation.validationRequest(validator, agentId, "ipfs://req", requestHash);

        vm.startPrank(validator);
        validation.validationResponse(requestHash, 0, "", bytes32(0), "started");
        validation.validationResponse(requestHash, 50, "", bytes32(0), "halfway");
        validation.validationResponse(requestHash, 100, "", bytes32(0), "done");
        vm.stopPrank();

        (,, uint8 response, string memory tag,) = validation.getValidationStatus(requestHash);
        assertEq(response, 100);
        assertEq(tag, "done");
    }

    function test_getSummary_averagesMatchingValidatorAndTag() public {
        address validator2 = makeAddr("validator2");
        bytes32 hash1 = keccak256("h1");
        bytes32 hash2 = keccak256("h2");

        vm.startPrank(ada);
        validation.validationRequest(validator, agentId, "", hash1);
        validation.validationRequest(validator2, agentId, "", hash2);
        vm.stopPrank();

        vm.prank(validator);
        validation.validationResponse(hash1, 80, "", bytes32(0), "audit");
        vm.prank(validator2);
        validation.validationResponse(hash2, 100, "", bytes32(0), "audit");

        (uint64 count, uint8 avg) = validation.getSummary(agentId, new address[](0), "audit");
        assertEq(count, 2);
        assertEq(avg, 90);

        address[] memory onlyValidator1 = new address[](1);
        onlyValidator1[0] = validator;
        (uint64 count1, uint8 avg1) = validation.getSummary(agentId, onlyValidator1, "");
        assertEq(count1, 1);
        assertEq(avg1, 80);
    }

    function test_getAgentValidations_and_getValidatorRequests() public {
        bytes32 hash1 = keccak256("h1");
        bytes32 hash2 = keccak256("h2");
        vm.startPrank(ada);
        validation.validationRequest(validator, agentId, "", hash1);
        validation.validationRequest(validator, agentId, "", hash2);
        vm.stopPrank();

        bytes32[] memory agentReqs = validation.getAgentValidations(agentId);
        assertEq(agentReqs.length, 2);

        bytes32[] memory validatorReqs = validation.getValidatorRequests(validator);
        assertEq(validatorReqs.length, 2);
    }

    function test_getValidationStatus_revertsForUnknownHash() public {
        vm.expectRevert(ValidationRegistry.RequestDoesNotExist.selector);
        validation.getValidationStatus(keccak256("nope"));
    }
}
