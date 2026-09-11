// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {X402FeeVault} from "../../src/X402FeeVault.sol";

/// @notice Deploys X402FeeVault to whichever network `--rpc-url` points at.
/// See ../../README.md for usage and ../../doc/x402/X402.md for why this contract
/// exists.
contract DeployX402FeeVault is Script {
    function run() external returns (X402FeeVault vault) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address token = vm.envAddress("FEE_TOKEN_ADDRESS");
        address owner = vm.envOr("VAULT_OWNER_ADDRESS", vm.addr(deployerKey));
        address identityRegistry = vm.envAddress("ERC8004_IDENTITY_REGISTRY_ADDRESS");

        vm.startBroadcast(deployerKey);
        vault = new X402FeeVault(token, owner, identityRegistry);
        vm.stopBroadcast();

        console.log("X402FeeVault deployed at:", address(vault));
        console.log("  fee token:            ", token);
        console.log("  owner (withdraw-only):", owner);
        console.log("  identity registry:    ", identityRegistry);
        console.log("\nSet this in app/.env.local:");
        console.log("  X402_FEE_VAULT_ADDRESS=%s", address(vault));
    }
}
