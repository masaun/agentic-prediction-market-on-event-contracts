# Setup: wiring the dreamdex-event-contracts MCP server into OpenClaw

This skill assumes you're running it against a checkout of the `agentic-prediction-market` repo
(the app + `agents/proxy-servers/` package this MCP server lives in). If you don't have one, clone it and
run `npm install` from the repo root first (Node ≥ 20 — this is an npm-workspaces monorepo, one
install wires up the app, `agents/proxy-servers`, and `packages/market-engine` together).

## 1. Install this skill

Copy or symlink this folder into one of OpenClaw's skill directories so it's discovered:

```sh
mkdir -p ~/.agents/skills
cp -r agents/agent-skills/open-claw/bettor-agent ~/.agents/skills/bettor-agent
# or, to keep it in sync with the source instead of a one-time copy:
ln -s "$(pwd)/agents/agent-skills/open-claw/bettor-agent" ~/.agents/skills/bettor-agent
```

A workspace-local `<agentic-prediction-market>/skills/bettor-agent/` or
`<agentic-prediction-market>/.agents/skills/bettor-agent/` also works and takes precedence over the
personal `~/.agents/skills` copy.

## 2. Start the app

```sh
cd agentic-prediction-market
npm run dev:app   # http://localhost:3000 — must be running before OpenClaw starts
```

## 3. Register the MCP server with OpenClaw

Edit `~/.openclaw/config.json` (or your config dir), adding a `dreamdex-event-contracts` entry
under `mcp.servers` — start from
[agents/proxy-servers/openclaw.config.example.jsonc](../../../../proxy-servers/openclaw.config.example.jsonc)
in this repo:

```jsonc
{
  "mcp": {
    "servers": {
      "dreamdex-event-contracts": {
        "command": "npx",
        "args": ["tsx", "shared/mcpServer.ts"],
        // Run from agents/proxy-servers/ in your agentic-prediction-market checkout — set an
        // absolute path for args[1] instead if OpenClaw's own cwd differs.
        "env": {
          "APM_API_URL": "http://localhost:3000",
          "AGENT_ID": "openclaw-bettor", // any distinct id — trades/positions attribute to this
          // "AGENT_WALLET_PRIVATE_KEY": "${AGENT_WALLET_PRIVATE_KEY}" // optional, see step 4
        }
      }
    }
  },
  "tools": { "allow": ["dreamdex-event-contracts__*"] } // only if your policy scopes tool access
}
```

Pick an `AGENT_ID` distinct from any other agent (built-in or external) hitting the same app, so
its trades and positions don't get attributed to someone else's identity.

## 4. (Optional) give this agent its own wallet

Without this, buying still works — the platform places the order on your behalf. With it, you
trade with a genuinely separate on-chain identity: `place_order BUY_YES`/`BUY_NO` pays a 0.01%
platform fee from your own wallet via a real x402 HTTP-402 challenge/response, then places the
DreamDEX order directly from that same wallet.

Put the key in one of OpenClaw's own env sources, never in `config.json` itself. OpenClaw resolves
`${VAR}` in any config string value from the parent process env, a `.env` in the current working
directory, and `~/.openclaw/.env` as a global fallback (checked in that order) — see
https://docs.openclaw.ai/gateway/configuration:

```sh
# ~/.openclaw/.env
AGENT_WALLET_PRIVATE_KEY=0x...
```

That wallet needs testnet SOMI/STT (gas) from https://testnet.somnia.network/ and testnet tUSDC
(call the `faucet` tool once you're running, or fund it from the app's Faucet tab) before it can
do anything.

## 5. Register this agent's ERC-8004 identity

Before this agent's first `BUY_YES`/`BUY_NO`, have it call `register_erc8004_identity` once (no
arguments) — just ask it in plain English: "Register your agent identity with the DreamDEX
ERC-8004 Identity Registry." Requires `ERC8004_IDENTITY_REGISTRY_ADDRESS` set in this repo's
`agents/proxy-servers/.env` (already true if you followed this repo's own setup) and the wallet from step
4 funded with testnet STT for gas.

## 6. Restart OpenClaw and verify

Restart OpenClaw so it picks up the config change, then check its logs for the
`dreamdex-event-contracts` tool registration. Or run this skill's preflight script from anywhere:

```sh
bash <path-to-this-skill>/scripts/verify_setup.sh
```

Trades and positions should now show up at `http://localhost:3000/agents/openclaw-bettor` (or
whatever `AGENT_ID` you picked) as this agent acts.

## Reference

Full design notes live in this repo:
[agents/proxy-servers/README.md](../../../../proxy-servers/README.md#external-agent-hosts-via-mcp-hermes-agent--openclaw),
[contracts/doc/erc8004/ERC8004.md](../../../../contracts/doc/erc8004/ERC8004.md),
[contracts/doc/x402/X402.md](../../../../contracts/doc/x402/X402.md).
