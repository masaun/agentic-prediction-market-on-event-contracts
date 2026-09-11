#!/usr/bin/env bash
# Deploys IdentityRegistry, ReputationRegistry, and ValidationRegistry (ERC-8004) to Somnia
# testnet (or wherever SOMNIA_RPC_URL points). See README.md for the full walkthrough;
# doc/erc8004/ERC8004.md for why this repo deploys its own copy rather than pointing at the
# official erc-8004/erc-8004-contracts deployment. Run via `npm run deploy:erc8004` from the repo
# root, or directly as `bash contracts/scripts/erc8004/deploy-erc8004.sh`.
#
# After this, re-deploy X402FeeVault (npm run deploy:x402vault) with
# ERC8004_IDENTITY_REGISTRY_ADDRESS set to the IdentityRegistry address this script prints, so
# payFee() actually gates on registration.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if [ ! -f .env ]; then
  echo "contracts/.env not found — copy contracts/.env.example to contracts/.env" >&2
  echo "and fill in PRIVATE_KEY (a funded Somnia-testnet deployer wallet) first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

# Without --skip-simulation, forge estimates gas by running these constructors locally against
# the standard EVM gas schedule (via revm) — for these contracts that undershoots Somnia's real
# on-chain gas cost by ~20x, so deploys silently revert out-of-gas on-chain (burning the gas
# anyway) even though the local simulation reports "successful". --skip-simulation makes forge
# source each transaction's gas estimate from Somnia's own eth_estimateGas at broadcast time
# instead; --gas-estimate-multiplier adds headroom on top (unused gas is refunded, so this costs
# nothing extra if the estimate is already accurate).
forge script scripts/erc8004/DeployERC8004.s.sol:DeployERC8004 \
  --rpc-url "${SOMNIA_RPC_URL:?SOMNIA_RPC_URL not set in contracts/.env}" \
  --broadcast \
  --skip-simulation \
  --gas-estimate-multiplier 150
