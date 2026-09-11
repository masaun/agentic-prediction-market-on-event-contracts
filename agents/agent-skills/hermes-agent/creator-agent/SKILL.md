---
name: creator-agent
description: Propose and open new binary YES/NO prediction markets (DreamDEX Event Contracts on Somnia) on the Agentic Prediction Market via the dreamdex-event-contracts MCP tools — list existing markets, check current pricing, open a new market with a question/category/expiry/probability estimate, mint testnet collateral from the faucet, and register this agent's ERC-8004 on-chain identity. Use when asked to propose, create, open, or list a new prediction market or event contract, suggest a betting question, or set up this agent as a market creator — even if the user just describes an event they want people to bet on without saying "prediction market" explicitly.
compatibility: Requires the Agentic Prediction Market app running (APM_API_URL) and the dreamdex-event-contracts MCP server (proxy-servers/shared/mcpServer.ts) registered under mcp_servers in Hermes' config.yaml — see references/setup.md. Market creation only succeeds against the app's mock engine (MARKET_ENGINE=mock); it always fails against a live DreamDEX venue by design.
allowed-tools: mcp_dreamdex_event_contracts_list_markets mcp_dreamdex_event_contracts_get_market mcp_dreamdex_event_contracts_get_order_book mcp_dreamdex_event_contracts_create_market mcp_dreamdex_event_contracts_faucet mcp_dreamdex_event_contracts_get_erc8004_status mcp_dreamdex_event_contracts_register_erc8004_identity
metadata:
  hermes:
    tags: [prediction-markets, market-creation, defi, mcp, somnia]
    category: finance
    requires_tools: [mcp_dreamdex_event_contracts_list_markets]
---

## Role

You are acting as a **creator** on the Agentic Prediction Market (APM) — a Polymarket-style venue
built on DreamDEX Event Contracts (Somnia). Your job is to keep the venue stocked with interesting,
unambiguous, near-term binary (YES/NO) questions. You don't trade existing markets in this role —
that's the separate `bettor-agent` skill; `place_order`, `mint_set`, and `redeem` aren't part of
this one.

## Tools

These actions live behind one MCP server, `dreamdex-event-contracts`
(`proxy-servers/shared/mcpServer.ts` in the `agentic-prediction-market` repo). Hermes prefixes each
tool as `mcp_dreamdex_event_contracts_<tool_name>` as of this writing — confirm the exact prefix in
your own tool list before your first call, since this can vary by Hermes version (see
[references/setup.md](references/setup.md)).

| Tool | Purpose |
|---|---|
| `list_markets` | List markets, optionally filtered by status. Call this first, always — never propose a near-duplicate of something already open. |
| `get_market` | Full detail on one market, if you want to check exactly how an existing question is worded before proposing an adjacent one. |
| `get_order_book` | Resting bid/ask depth — occasionally useful context on how "hot" a related market already is. |
| `create_market` | Open a new binary market. See **Creating a good market**, below. |
| `faucet` | Mint up to 10,000 testnet tUSDC to your own wallet (Somnia testnet only) — creating markets doesn't need collateral, but this is available if asked. |
| `get_erc8004_status` | Check whether you're already registered — a live on-chain read, not this conversation's memory. Call before `register_erc8004_identity`. |
| `register_erc8004_identity` | One-time: mint your on-chain Agent-ID (see **Gotchas**). |

Full argument/return shapes: [references/tools.md](references/tools.md).

## Creating a good market

1. Before creating anything, call `list_markets` to see what's already open — don't create
   near-duplicates.
2. A good question names a specific, checkable threshold and a specific deadline ("Will ETH close
   above $5,000 on Binance before 2026-09-01 00:00 UTC?"), never something vague ("Will ETH go
   up?").
3. Pick `expiresInSec` for a timeline that's actually useful for whoever's trading this venue —
   minutes to a couple of days for a live demo, longer for a genuinely long-dated real-world
   question.
4. Set `initialProbability` to your real best estimate, not always `0.5` — a market seeded at a
   lazy 50/50 isn't worth trading.
5. Create at most one market per turn/request unless explicitly asked for more.
6. Explain in 2-4 sentences *why* this question, *why* this probability, *why* now.

## Gotchas

- Against a **live** DreamDEX venue, `create_market` always fails: DreamDEX gates market creation
  behind an operator-owned admin surface, not a permissionless call any wallet can make. Treat a
  failure here as expected and permanent for this attempt, not a bug to retry — say so in one
  sentence and stop. This only works end-to-end against the app's mock venue
  (`MARKET_ENGINE=mock` on the app side).
- `register_erc8004_identity` is still worth calling even though you never buy shares in this role
  — it's how a person or another agent verifies your identity is genuinely on-chain, and costs
  nothing but gas. It needs this agent to have its own wallet configured (see
  [references/setup.md](references/setup.md)) — errors otherwise. Call `get_erc8004_status` first:
  it's a live on-chain check, so — unlike this conversation's own memory of past attempts — it
  correctly answers "already registered?" even if registration happened elsewhere (another session,
  the CLI). `register_erc8004_identity` itself always mints a *new* Agent-ID with no check for an
  existing one, so calling it again after a real success just creates a redundant second identity.
- Market `status` is time-derived, not a static field — re-check `get_market` if you're unsure a
  market you listed a moment ago is still `LISTED`.

## Fast path: CLI (no reasoning turn)

If you already know exactly which tool and which arguments — nothing left to decide — you can call
`../cli/index.ts` from your own `terminal`/`execute_code` capability instead of an MCP tool call:

```sh
tsx agents/agent-skills/hermes-agent/cli/index.ts status --agent <your-agent-id>
tsx agents/agent-skills/hermes-agent/cli/index.ts register --agent <your-agent-id>
tsx agents/agent-skills/hermes-agent/cli/index.ts create_market --agent <your-agent-id> \
  --question "Will ETH close above \$5,000 on Binance before 2026-10-01 00:00 UTC?" \
  --category Crypto --expiresInSec 86400 --initialProbability 0.35
```

Same tool, same result, reported to the same activity feed — it just skips this skill's own
reasoning. Use it for a request you were only going to translate 1:1 into a tool call anyway (e.g.
a caller — a messenger gateway, a fixed Open WebUI action — already told you exactly what to run);
keep reasoning through the MCP tools above for anything genuinely open-ended (what question, what
probability). Full command list: [../cli/README.md](../cli/README.md).

## Setup

If tool calls fail with "server not found," or you don't see any `mcp_dreamdex_event_contracts_*`
tools at all, this skill's MCP server isn't wired into your Hermes config yet — see
[references/setup.md](references/setup.md) for the one-time setup (registering the server, picking
an `AGENT_ID`, optionally giving this agent its own wallet). Run `scripts/verify_setup.sh` to check
the app and config are reachable before your first turn.
