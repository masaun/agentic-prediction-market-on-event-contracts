# Setup: wiring the dreamdex-event-contracts MCP server into OpenClaw

This skill assumes you're running it against a checkout of the `agentic-prediction-market` repo
(the app + `agents/proxy-servers/` package this MCP server lives in). If you don't have one, clone it and
run `npm install` from the repo root first (Node ≥ 20 — this is an npm-workspaces monorepo, one
install wires up the app, `agents/proxy-servers`, and `packages/market-engine` together).

## 1. Install this skill

Copy or symlink this folder into one of OpenClaw's skill directories so it's discovered:

```sh
mkdir -p ~/.agents/skills
cp -r agents/agent-skills/open-claw/creator-agent ~/.agents/skills/creator-agent
# or, to keep it in sync with the source instead of a one-time copy:
ln -s "$(pwd)/agents/agent-skills/open-claw/creator-agent" ~/.agents/skills/creator-agent
```

A workspace-local `<agentic-prediction-market>/skills/creator-agent/` or
`<agentic-prediction-market>/.agents/skills/creator-agent/` also works and takes precedence over
the personal `~/.agents/skills` copy.

## 2. Start the app in mock mode

`create_market` only works against the app's mock engine — see the Gotchas section in
[../SKILL.md](../SKILL.md).

```sh
cd agentic-prediction-market
cp app/.env.example app/.env   # MARKET_ENGINE=mock by default — no edits needed
npm run dev:app                # http://localhost:3000 — must be running before OpenClaw starts
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
          "AGENT_ID": "openclaw-creator", // any distinct id — markets attribute to this
          // "AGENT_WALLET_PRIVATE_KEY": "${AGENT_WALLET_PRIVATE_KEY}" // optional, see step 4
        }
      }
    }
  },
  "tools": { "allow": ["dreamdex-event-contracts__*"] } // only if your policy scopes tool access
}
```

Pick an `AGENT_ID` distinct from any other agent (built-in or external) hitting the same app, so
its created markets don't get attributed to someone else's identity.

## 4. (Optional) give this agent its own wallet

Only relevant for `register_erc8004_identity` in this role — this agent's `place_order` calls
aren't part of this skill, so it never pays an x402 fee either way.

Put the key in one of OpenClaw's own env sources, never in `config.json` itself. OpenClaw resolves
`${VAR}` in any config string value from the parent process env, a `.env` in the current working
directory, and `~/.openclaw/.env` as a global fallback (checked in that order) — see
https://docs.openclaw.ai/gateway/configuration:

```sh
# ~/.openclaw/.env
AGENT_WALLET_PRIVATE_KEY=0x...
```

That wallet needs testnet SOMI/STT (gas) from https://testnet.somnia.network/ before
`register_erc8004_identity` can broadcast anything.

## 5. Register this agent's ERC-8004 identity (optional, recommended)

Ask it in plain English: "Register your agent identity with the DreamDEX ERC-8004 Identity
Registry." Requires `ERC8004_IDENTITY_REGISTRY_ADDRESS` set in this repo's `agents/proxy-servers/.env`
(already true if you followed this repo's own setup) and the wallet from step 4 funded with
testnet STT for gas.

## 6. Restart OpenClaw and verify

Restart OpenClaw so it picks up the config change, then check its logs for the
`dreamdex-event-contracts` tool registration. Or run this skill's preflight script from anywhere:

```sh
bash <path-to-this-skill>/scripts/verify_setup.sh
```

Created markets should now show up at `http://localhost:3000` (homepage feed) and
`http://localhost:3000/agents/openclaw-creator` (or whatever `AGENT_ID` you picked) as this agent
acts.

## Reference

Full design notes live in this repo:
[agents/proxy-servers/README.md](../../../../proxy-servers/README.md#external-agent-hosts-via-mcp-hermes-agent--openclaw),
[contracts/doc/erc8004/ERC8004.md](../../../../contracts/doc/erc8004/ERC8004.md).
