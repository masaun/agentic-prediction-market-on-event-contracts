# Setup: wiring the dreamdex-event-contracts MCP server into Hermes Agent

This skill assumes you're running it against a checkout of the `agentic-prediction-market` repo
(the app + `agents/proxy-servers/` package this MCP server lives in). If you don't have one, clone it and
run `npm install` from the repo root first (Node ≥ 20 — this is an npm-workspaces monorepo, one
install wires up the app, `agents/proxy-servers`, and `packages/market-engine` together).

## 1. Install this skill

Copy or symlink this folder into one of Hermes' skill directories so it's discovered:

```sh
mkdir -p ~/.hermes/skills
cp -r agents/agent-skills/hermes-agent/bettor-agent ~/.hermes/skills/bettor-agent
# or, to keep it in sync with the source instead of a one-time copy:
ln -s "$(pwd)/agents/agent-skills/hermes-agent/bettor-agent" ~/.hermes/skills/bettor-agent
```

A project-local `<agentic-prediction-market>/.hermes/skills/bettor-agent/` also works and takes
precedence, but requires running `hermes skills trust` for that project first.

## 2. Start the app

```sh
cd agentic-prediction-market
npm run dev:app   # http://localhost:3000 — must be running before Hermes starts
```

## 3. Register the MCP server with Hermes

Edit `~/.hermes/config.yaml`, adding a `dreamdex_event_contracts` entry under `mcp_servers` —
start from
[agents/proxy-servers/hermes.config.example.yaml](../../../../proxy-servers/hermes.config.example.yaml)
in this repo:

```yaml
mcp_servers:
  dreamdex_event_contracts:
    command: "npx"
    args: ["tsx", "shared/mcpServer.ts"]
    # Run from agents/proxy-servers/ in your agentic-prediction-market checkout — set an
    # absolute path in args[1] instead if Hermes' own working directory differs.
    env:
      APM_API_URL: "http://localhost:3000"
      AGENT_ID: "hermes-bettor"   # any distinct id — trades/positions attribute to this
      # AGENT_WALLET_PRIVATE_KEY: "${AGENT_WALLET_PRIVATE_KEY}"   # optional, see step 4
```

Pick an `AGENT_ID` distinct from any other agent (built-in or external) hitting the same app, so
its trades and positions don't get attributed to someone else's identity.

## 4. (Optional) give this agent its own wallet

Without this, buying still works — the platform places the order on your behalf. With it, you
trade with a genuinely separate on-chain identity: `place_order BUY_YES`/`BUY_NO` pays a 0.01%
platform fee from your own wallet via a real x402 HTTP-402 challenge/response, then places the
DreamDEX order directly from that same wallet.

Put the key in Hermes' own secrets file, never in `config.yaml` itself:

```sh
# ~/.hermes/.env
AGENT_WALLET_PRIVATE_KEY=0x...
```

(Hermes' secrets guide: https://hermes-agent.nousresearch.com/docs/user-guide/secrets/ — if your
installed version doesn't resolve `${VAR}` inside the `env:` mapping specifically, check its
current docs, since this is a fast-moving project.)

That wallet needs testnet SOMI/STT (gas) from https://testnet.somnia.network/ and testnet tUSDC
(call the `faucet` tool once you're running, or fund it from the app's Faucet tab) before it can
do anything.

## 5. Register this agent's ERC-8004 identity

Before this agent's first `BUY_YES`/`BUY_NO`, have it call `register_erc8004_identity` once (no
arguments) — just ask it in plain English: "Register your agent identity with the DreamDEX
ERC-8004 Identity Registry." Requires `ERC8004_IDENTITY_REGISTRY_ADDRESS` set in this repo's
`agents/proxy-servers/.env` (already true if you followed this repo's own setup) and the wallet from step
4 funded with testnet STT for gas.

## 6. Restart Hermes and verify

Restart Hermes so it picks up the config change, then check its logs for the
`dreamdex-event-contracts` tool registration. Or run this skill's preflight script from anywhere:

```sh
bash <path-to-this-skill>/scripts/verify_setup.sh
```

Trades and positions should now show up at `http://localhost:3000/agents/hermes-bettor` (or
whatever `AGENT_ID` you picked) as this agent acts.

## Reference

Full design notes live in this repo:
[agents/proxy-servers/README.md](../../../../proxy-servers/README.md#external-agent-hosts-via-mcp-hermes-agent--openclaw),
[contracts/doc/erc8004/ERC8004.md](../../../../contracts/doc/erc8004/ERC8004.md),
[contracts/doc/x402/X402.md](../../../../contracts/doc/x402/X402.md).
