// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// @title ReputationRegistry
/// @notice ERC-8004's Reputation Registry: on-chain feedback signals (value + tags + revocation)
/// against an `agentId` from `IdentityRegistry`, with the bulk of context (endpoint, skill,
/// proof-of-payment, etc.) left off-chain in `feedbackURI`. Not wired into this app's buy flow —
/// built for spec completeness alongside `IdentityRegistry`/`ValidationRegistry`. See
/// contracts/doc/erc8004/ERC8004.md.
///
/// A plain constructor rather than the official repo's upgradeable `initialize()` — this repo
/// doesn't deploy behind proxies, so there's no initializer pattern to replicate.
contract ReputationRegistry {
    struct Feedback {
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        bool isRevoked;
    }

    struct Response {
        address responder;
        string responseURI;
        bytes32 responseHash;
    }

    IIdentityRegistry public immutable identityRegistry;

    mapping(uint256 => mapping(address => mapping(uint64 => Feedback))) private _feedback;
    mapping(uint256 => mapping(address => uint64)) private _lastIndex;
    mapping(uint256 => address[]) private _clients;
    mapping(uint256 => mapping(address => bool)) private _isClient;
    mapping(uint256 => mapping(address => mapping(uint64 => Response[]))) private _responses;

    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        int128 value,
        uint8 valueDecimals,
        string indexed indexedTag1,
        string tag1,
        string tag2,
        string endpoint,
        string feedbackURI,
        bytes32 feedbackHash
    );
    event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex);
    event ResponseAppended(
        uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, address indexed responder, string responseURI
    );

    error ZeroAddress();
    error InvalidDecimals();
    error SelfFeedbackNotAllowed();
    error FeedbackDoesNotExist();
    error AlreadyRevoked();

    constructor(address identityRegistry_) {
        if (identityRegistry_ == address(0)) revert ZeroAddress();
        identityRegistry = IIdentityRegistry(identityRegistry_);
    }

    function getIdentityRegistry() external view returns (address) {
        return address(identityRegistry);
    }

    /// @notice Submits one feedback entry against `agentId` from the caller's own address (the
    /// "client"). Reverts if `agentId` doesn't exist (via `ownerOf`) or if the caller is that
    /// agent's own owner/operator — feedback about an agent can't come from the agent itself.
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external returns (uint64 feedbackIndex) {
        if (valueDecimals > 18) revert InvalidDecimals();
        address owner = identityRegistry.ownerOf(agentId);
        if (msg.sender == owner || identityRegistry.isApprovedForAll(owner, msg.sender)) revert SelfFeedbackNotAllowed();

        feedbackIndex = _lastIndex[agentId][msg.sender] + 1;
        _lastIndex[agentId][msg.sender] = feedbackIndex;
        _feedback[agentId][msg.sender][feedbackIndex] =
            Feedback({value: value, valueDecimals: valueDecimals, tag1: tag1, tag2: tag2, isRevoked: false});

        if (!_isClient[agentId][msg.sender]) {
            _isClient[agentId][msg.sender] = true;
            _clients[agentId].push(msg.sender);
        }

        emit NewFeedback(agentId, msg.sender, feedbackIndex, value, valueDecimals, tag1, tag1, tag2, endpoint, feedbackURI, feedbackHash);
    }

    /// @notice Only the original submitter (`msg.sender` must be the feedback's `clientAddress`)
    /// can revoke their own feedback.
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        if (feedbackIndex == 0 || feedbackIndex > _lastIndex[agentId][msg.sender]) revert FeedbackDoesNotExist();
        Feedback storage fb = _feedback[agentId][msg.sender][feedbackIndex];
        if (fb.isRevoked) revert AlreadyRevoked();
        fb.isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    /// @notice Anyone (typically the agent responding to feedback about itself) may append a
    /// response to an existing feedback entry — callable multiple times per entry.
    function appendResponse(uint256 agentId, address clientAddress, uint64 feedbackIndex, string calldata responseURI, bytes32 responseHash)
        external
    {
        if (feedbackIndex == 0 || feedbackIndex > _lastIndex[agentId][clientAddress]) revert FeedbackDoesNotExist();
        _responses[agentId][clientAddress][feedbackIndex].push(
            Response({responder: msg.sender, responseURI: responseURI, responseHash: responseHash})
        );
        emit ResponseAppended(agentId, clientAddress, feedbackIndex, msg.sender, responseURI);
    }

    /// @notice Aggregates non-revoked feedback matching the given filters. `clientAddresses`
    /// empty means "every known client"; `tag1`/`tag2` empty means "no filter on that tag".
    /// `averageValue`/`valueDecimals` simplification: this averages raw `value` regardless of
    /// each entry's own `valueDecimals` and reports the last matching entry's decimals — exact
    /// cross-decimals normalization is left to callers who pass a consistent `valueDecimals`
    /// convention for a given `tag1`/`tag2` pair.
    function getSummary(uint256 agentId, address[] calldata clientAddresses, string calldata tag1, string calldata tag2)
        external
        view
        returns (uint64 count, int128 averageValue, uint8 valueDecimals)
    {
        address[] memory clients = _resolveClients(agentId, clientAddresses);
        int256 sum = 0;
        for (uint256 i = 0; i < clients.length; i++) {
            address client = clients[i];
            uint64 last = _lastIndex[agentId][client];
            for (uint64 idx = 1; idx <= last; idx++) {
                Feedback storage fb = _feedback[agentId][client][idx];
                if (fb.isRevoked) continue;
                if (bytes(tag1).length > 0 && keccak256(bytes(fb.tag1)) != keccak256(bytes(tag1))) continue;
                if (bytes(tag2).length > 0 && keccak256(bytes(fb.tag2)) != keccak256(bytes(tag2))) continue;
                sum += int256(fb.value);
                count += 1;
                valueDecimals = fb.valueDecimals;
            }
        }
        if (count > 0) averageValue = int128(sum / int256(uint256(count)));
    }

    function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
        external
        view
        returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked)
    {
        Feedback storage fb = _feedback[agentId][clientAddress][feedbackIndex];
        return (fb.value, fb.valueDecimals, fb.tag1, fb.tag2, fb.isRevoked);
    }

    function readAllFeedback(uint256 agentId, address[] calldata clientAddresses, string calldata tag1, string calldata tag2, bool includeRevoked)
        external
        view
        returns (
            address[] memory clientsOut,
            uint64[] memory indexesOut,
            int128[] memory valuesOut,
            uint8[] memory decimalsOut,
            string[] memory tag1Out,
            string[] memory tag2Out,
            bool[] memory revokedOut
        )
    {
        address[] memory clients = _resolveClients(agentId, clientAddresses);

        uint256 total = 0;
        for (uint256 i = 0; i < clients.length; i++) {
            uint64 last = _lastIndex[agentId][clients[i]];
            for (uint64 idx = 1; idx <= last; idx++) {
                if (_matches(agentId, clients[i], idx, tag1, tag2, includeRevoked)) total++;
            }
        }

        clientsOut = new address[](total);
        indexesOut = new uint64[](total);
        valuesOut = new int128[](total);
        decimalsOut = new uint8[](total);
        tag1Out = new string[](total);
        tag2Out = new string[](total);
        revokedOut = new bool[](total);

        uint256 cursor = 0;
        for (uint256 i = 0; i < clients.length; i++) {
            uint64 last = _lastIndex[agentId][clients[i]];
            for (uint64 idx = 1; idx <= last; idx++) {
                if (!_matches(agentId, clients[i], idx, tag1, tag2, includeRevoked)) continue;
                Feedback storage fb = _feedback[agentId][clients[i]][idx];
                clientsOut[cursor] = clients[i];
                indexesOut[cursor] = idx;
                valuesOut[cursor] = fb.value;
                decimalsOut[cursor] = fb.valueDecimals;
                tag1Out[cursor] = fb.tag1;
                tag2Out[cursor] = fb.tag2;
                revokedOut[cursor] = fb.isRevoked;
                cursor++;
            }
        }
    }

    /// @dev A calldata array and a storage array don't unify in a ternary's two branches, so this
    /// picks one explicitly instead.
    function _resolveClients(uint256 agentId, address[] calldata clientAddresses) private view returns (address[] memory clients) {
        if (clientAddresses.length > 0) {
            clients = clientAddresses;
        } else {
            clients = _clients[agentId];
        }
    }

    function _matches(uint256 agentId, address client, uint64 idx, string calldata tag1, string calldata tag2, bool includeRevoked)
        private
        view
        returns (bool)
    {
        Feedback storage fb = _feedback[agentId][client][idx];
        if (!includeRevoked && fb.isRevoked) return false;
        if (bytes(tag1).length > 0 && keccak256(bytes(fb.tag1)) != keccak256(bytes(tag1))) return false;
        if (bytes(tag2).length > 0 && keccak256(bytes(fb.tag2)) != keccak256(bytes(tag2))) return false;
        return true;
    }

    function getResponseCount(uint256 agentId, address clientAddress, uint64 feedbackIndex, address[] calldata responders)
        external
        view
        returns (uint64)
    {
        Response[] storage responses = _responses[agentId][clientAddress][feedbackIndex];
        if (responders.length == 0) return uint64(responses.length);
        uint64 count = 0;
        for (uint256 i = 0; i < responses.length; i++) {
            for (uint256 j = 0; j < responders.length; j++) {
                if (responses[i].responder == responders[j]) {
                    count++;
                    break;
                }
            }
        }
        return count;
    }

    function getClients(uint256 agentId) external view returns (address[] memory) {
        return _clients[agentId];
    }

    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64) {
        return _lastIndex[agentId][clientAddress];
    }
}
