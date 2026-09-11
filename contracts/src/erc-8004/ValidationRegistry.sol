// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// @title ValidationRegistry
/// @notice ERC-8004's Validation Registry: an agent owner/operator requests third-party
/// validation of some off-chain work (`requestURI`/`requestHash`); the named validator posts a
/// 0-100 `response`, optionally multiple times as validation progresses. Not wired into this
/// app's buy flow — built for spec completeness alongside `IdentityRegistry`/`ReputationRegistry`.
/// See contracts/doc/erc8004/ERC8004.md.
contract ValidationRegistry {
    struct ValidationRecord {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        string tag;
        uint256 lastUpdate;
        bool exists;
    }

    IIdentityRegistry public immutable identityRegistry;

    mapping(bytes32 => ValidationRecord) private _validations;
    mapping(uint256 => bytes32[]) private _agentValidations;
    mapping(address => bytes32[]) private _validatorRequests;

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

    error ZeroAddress();
    error NotOwnerOrApproved();
    error DuplicateRequest();
    error RequestDoesNotExist();
    error NotValidator();
    error InvalidResponse();

    constructor(address identityRegistry_) {
        if (identityRegistry_ == address(0)) revert ZeroAddress();
        identityRegistry = IIdentityRegistry(identityRegistry_);
    }

    function getIdentityRegistry() external view returns (address) {
        return address(identityRegistry);
    }

    /// @notice Only `agentId`'s current owner (or an approved-for-all operator) may open a
    /// validation request against it. `requestHash` must be unique — it's the record's key.
    function validationRequest(address validatorAddress, uint256 agentId, string calldata requestURI, bytes32 requestHash) external {
        if (validatorAddress == address(0)) revert ZeroAddress();
        address owner = identityRegistry.ownerOf(agentId);
        if (msg.sender != owner && !identityRegistry.isApprovedForAll(owner, msg.sender)) revert NotOwnerOrApproved();
        if (_validations[requestHash].exists) revert DuplicateRequest();

        _validations[requestHash] = ValidationRecord({
            validatorAddress: validatorAddress,
            agentId: agentId,
            response: 0,
            tag: "",
            lastUpdate: block.timestamp,
            exists: true
        });
        _agentValidations[agentId].push(requestHash);
        _validatorRequests[validatorAddress].push(requestHash);

        emit ValidationRequest(validatorAddress, agentId, requestURI, requestHash);
    }

    /// @notice Only the validator named in the original request may respond, and may call this
    /// repeatedly (e.g. 0 -> 50 -> 100) as validation progresses — each call overwrites the prior
    /// response/tag and bumps `lastUpdate`.
    function validationResponse(bytes32 requestHash, uint8 response, string calldata responseURI, bytes32 responseHash, string calldata tag)
        external
    {
        ValidationRecord storage record = _validations[requestHash];
        if (!record.exists) revert RequestDoesNotExist();
        if (msg.sender != record.validatorAddress) revert NotValidator();
        if (response > 100) revert InvalidResponse();

        record.response = response;
        record.tag = tag;
        record.lastUpdate = block.timestamp;

        emit ValidationResponse(record.validatorAddress, record.agentId, requestHash, response, responseURI, responseHash, tag);
    }

    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (address validatorAddress, uint256 agentId, uint8 response, string memory tag, uint256 lastUpdate)
    {
        ValidationRecord storage record = _validations[requestHash];
        if (!record.exists) revert RequestDoesNotExist();
        return (record.validatorAddress, record.agentId, record.response, record.tag, record.lastUpdate);
    }

    function getSummary(uint256 agentId, address[] calldata validatorAddresses, string calldata tag)
        external
        view
        returns (uint64 count, uint8 averageResponse)
    {
        bytes32[] storage hashes = _agentValidations[agentId];
        uint256 sum = 0;
        for (uint256 i = 0; i < hashes.length; i++) {
            ValidationRecord storage record = _validations[hashes[i]];
            if (validatorAddresses.length > 0) {
                bool matched = false;
                for (uint256 j = 0; j < validatorAddresses.length; j++) {
                    if (validatorAddresses[j] == record.validatorAddress) {
                        matched = true;
                        break;
                    }
                }
                if (!matched) continue;
            }
            if (bytes(tag).length > 0 && keccak256(bytes(record.tag)) != keccak256(bytes(tag))) continue;
            sum += record.response;
            count++;
        }
        if (count > 0) averageResponse = uint8(sum / count);
    }

    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }
}
