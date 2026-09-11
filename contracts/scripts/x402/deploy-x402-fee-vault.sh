#!/usr/bin/env bash
# Deploys X402FeeVault to Somnia testnet (or wherever SOMNIA_RPC_URL points).
# See README.md for the full walkthrough; doc/x402/X402.md for why this
# contract exists. Run via `npm run deploy:x402vault` from the repo root, or
# directly as `bash contracts/scripts/x402/deploy-x402-fee-vault.sh`.
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

# Without --skip-simulation, forge estimates gas by running this constructor locally against the
# standard EVM gas schedule (via revm) — for this contract that undershoots Somnia's real
# on-chain gas cost by ~20x, so deploys silently revert out-of-gas on-chain (burning the gas
# anyway) even though the local simulation reports "successful". --skip-simulation makes forge
# source the transaction's gas estimate from Somnia's own eth_estimateGas at broadcast time
# instead; --gas-estimate-multiplier adds headroom on top (unused gas is refunded, so this costs
# nothing extra if the estimate is already accurate).
forge script scripts/x402/DeployX402FeeVault.s.sol:DeployX402FeeVault \
  --rpc-url "${SOMNIA_RPC_URL:?SOMNIA_RPC_URL not set in contracts/.env}" \
  --broadcast \
  --skip-simulation \
  --gas-estimate-multiplier 150
