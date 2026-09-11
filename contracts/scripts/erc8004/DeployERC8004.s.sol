// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IdentityRegistry} from "../../src/erc-8004/IdentityRegistry.sol";
import {ReputationRegistry} from "../../src/erc-8004/ReputationRegistry.sol";
import {ValidationRegistry} from "../../src/erc-8004/ValidationRegistry.sol";

/// @notice Deploys the three ERC-8004 registries to whichever network `--rpc-url` points at:
/// `IdentityRegistry` first, then `ReputationRegistry`/`ValidationRegistry` wired to its address.
/// See ../../README.md for usage and ../../doc/erc8004/ERC8004.md for why this repo deploys its own
/// (non-vanity-address) copy instead of pointing at the official erc-8004/erc-8004-contracts
/// deployment, which isn't reachable on Somnia.
contract DeployERC8004 is Script {
    function run()
        external
        returns (IdentityRegistry identityRegistry, ReputationRegistry reputationRegistry, ValidationRegistry validationRegistry)
    {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        identityRegistry = new IdentityRegistry();
        reputationRegistry = new ReputationRegistry(address(identityRegistry));
        validationRegistry = new ValidationRegistry(address(identityRegistry));
        vm.stopBroadcast();

        console.log("IdentityRegistry deployed at:  ", address(identityRegistry));
        console.log("ReputationRegistry deployed at:", address(reputationRegistry));
        console.log("ValidationRegistry deployed at:", address(validationRegistry));
        console.log("\nSet these in app/.env.local and agent-servers/.env:");
        console.log("  ERC8004_IDENTITY_REGISTRY_ADDRESS=%s", address(identityRegistry));
        console.log("\nAnd re-deploy X402FeeVault with this as ERC8004_IDENTITY_REGISTRY_ADDRESS so");
        console.log("payFee() gates on registration (see DeployX402FeeVault.s.sol):");
        console.log("  ERC8004_IDENTITY_REGISTRY_ADDRESS=%s", address(identityRegistry));
    }
}
