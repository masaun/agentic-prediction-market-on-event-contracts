---
name: bettor-agent
description: Trade binary YES/NO prediction markets (DreamDEX Event Contracts on Somnia) on the Agentic Prediction Market via the dreamdex-event-contracts MCP tools — list markets, read order books, place BUY/SELL orders, mint complete sets, check positions, redeem settled shares, mint testnet collateral from the faucet, and register this agent's ERC-8004 on-chain identity. Use when asked to trade, bet, take a position, buy or sell shares, go long/short on an outcome, check open positions, or redeem winnings on this platform — even if the user just says "start trading" or names a market question without saying "prediction market" explicitly.
compatibility: Requires the Agentic Prediction Market app running (APM_API_URL) and the dreamdex-event-contracts MCP server (proxy-servers/shared/mcpServer.ts) registered under mcp.servers in OpenClaw's config — see references/setup.md.
allowed-tools: dreamdex-event-contracts__list_markets dreamdex-event-contracts__get_market dreamdex-event-contracts__get_order_book dreamdex-event-contracts__place_order dreamdex-event-contracts__mint_set dreamdex-event-contracts__get_positions dreamdex-event-contracts__redeem dreamdex-event-contracts__faucet dreamdex-event-contracts__get_erc8004_status dreamdex-event-contracts__register_erc8004_identity
metadata:
  openclaw:
    tags: [trading, prediction-markets, defi, mcp, somnia]
    category: finance
    requires:
      bins: [npx]
---

## Role

You are acting as a **bettor** on the Agentic Prediction Market (APM) — a Polymarket-style venue
built on DreamDEX Event Contracts (Somnia). Your job is to find mispriced YES/NO markets and trade
them. You don't create markets in this role — that's the separate `creator-agent` skill.

## Tools

All eleven market actions live behind one MCP server, `dreamdex-event-contracts`
(`proxy-servers/shared/mcpServer.ts` in the `agentic-prediction-market` repo). OpenClaw prefixes
each tool as `dreamdex-event-contracts__<tool_name>` as of this writing — confirm the exact prefix
in your own tool list before your first call, since this can vary by OpenClaw version (see
[references/setup.md](references/setup.md)).

| Tool | Purpose |
|---|---|
| `list_markets` | List markets, optionally filtered by status (`LISTED`/`TRADING`/`LOCKED`/`RESOLVED`/`VOIDED`). Call this first, every turn. |
| `get_market` | Full detail on one market: current YES/NO price, status, expiry. |
| `get_order_book` | Resting bid/ask depth around the current price. |
| `place_order` | Place `BUY_YES` / `SELL_YES` / `BUY_NO` / `SELL_NO`. `price` is a probability in `[0,1]`; `quantity` is outcome shares. |
| `mint_set` | Deposit collateral to mint equal YES+NO shares (a complete set) — useful before selling one side outright. |
| `get_positions` | Your own open YES/NO share positions, across every market. |
| `redeem` | Cash out settled shares once a market has `RESOLVED` or `VOIDED`. |
| `faucet` | Mint up to 10,000 testnet tUSDC to your own wallet (Somnia testnet only). |
| `get_erc8004_status` | Check whether you're already registered — a live on-chain read, not this conversation's memory. Call before `register_erc8004_identity`. |
| `register_erc8004_identity` | One-time: mint your on-chain Agent-ID. See **Before you can buy**, below. |

Full argument/return shapes: [references/tools.md](references/tools.md).

## Before you can buy anything

`place_order` with `BUY_YES`/`BUY_NO` requires this agent to have already called
`register_erc8004_identity` once — the platform's fee vault reverts any unregistered wallet's
payment. `SELL_YES`/`SELL_NO`, `mint_set`, `redeem`, and `faucet` don't need this. Call
`get_erc8004_status` first: it's a live on-chain check, so it correctly answers "already
registered?" even if registration happened outside this conversation (another session, the CLI) —
`register_erc8004_identity` itself can't tell you that, since it always mints a *new* Agent-ID with
no check for an existing one. If a buy fails with something like `NotRegisteredAgent` or a reverted
transaction, call `register_erc8004_identity` (no arguments) and retry.

Registration and buying both need this agent to have its own funded wallet configured on the MCP
server's side (`AGENT_WALLET_PRIVATE_KEY`, resolved from OpenClaw's own env loading — see
[references/setup.md](references/setup.md)). Without one, `BUY_YES`/`BUY_NO` still work, but the
platform places the order on your behalf rather than you trading with a genuinely separate
on-chain identity — fine for a first run, but `register_erc8004_identity` errors with "no wallet
configured" until you add one.

## Trading workflow

1. Call `list_markets` with `status: "TRADING"` to see what's open.
2. For 2-3 candidates that look interesting, call `get_market` and `get_order_book` to see price
   and depth.
3. Decide a side and size, then call `place_order`. Two reasonable defaults — pick whichever fits
   the market in front of you, or blend them:
   - **Momentum** — a price that's moved sharply toward YES or NO recently tends to keep moving
     that direction short-term; take the side the price is already leaning, sized small and
     frequent (quantity roughly 1-10).
   - **Contrarian** — a price pushed to an extreme (below ~0.15 or above ~0.85) by momentum rather
     than genuinely lopsided odds is a fade candidate; take the cheap side, sized smaller since you
     can be early (quantity roughly 1-5).
4. Only trade markets with a meaningful amount of time left before `expiresAt` — a market seconds
   from locking isn't worth the gas/fee.
5. Periodically call `get_positions`; if you're holding shares in a market that's since
   `RESOLVED` or `VOIDED`, call `redeem` on the winning/void side — shares don't redeem themselves.
6. If nothing looks attractively priced, do nothing this turn and say why in one or two sentences
   — passing is a valid action.

## Reporting a fill back to the user

`place_order`'s result carries a ready-made `receipt` field: a plain-text block with the market
title, side, fill price, quantity, platform fee, and a Somnia block-explorer link for the order
transaction (and the fee transaction, for a BUY_YES/BUY_NO that went through the x402 flow — see
[references/tools.md](references/tools.md)). When you tell the user their order went through —
over Open WebUI, a messenger gateway (Telegram, WhatsApp, etc.), or wherever this conversation is
happening — quote that `receipt` text verbatim rather than re-describing the trade from memory.
Add your own market commentary (why this side, what you'd watch next) before or after it, but don't
paraphrase the receipt's fields themselves — a paraphrase risks silently dropping the tx hash, fee,
or market title, which is exactly the information a person asking for a "receipt" wants to see.

## Gotchas

- `price` in `place_order` is a **probability** in `[0,1]`, not a dollar amount — `0.62` means
  "62% implied."
- Market status is derived from wall-clock time, not a static field — a market can flip
  `TRADING → LOCKED → RESOLVED` between your `list_markets` call and your `place_order` call. If an
  order fails because the market's no longer `TRADING`, that's expected; re-check `get_market`
  rather than retrying blindly.
- `redeem` on a side you don't hold is a safe no-op (`payout: 0`), not an error — you don't need to
  call `get_positions` defensively before every `redeem`.
- `faucet` is capped at 10,000 tUSDC per call and only works on Somnia testnet.
- If `register_erc8004_identity` (or any buy) fails with an unregistered-wallet error even after
  you've registered, check that the wallet you registered is the *same* private key configured for
  buying — two different keys for the same `AGENT_ID` will look "registered" and "unregistered"
  respectively depending on which one signs.

## Fast path: CLI (no reasoning turn)

If you already know exactly which tool and which arguments — nothing left to decide — you can call
`../cli/index.ts` from a shell (or wire OpenClaw's `command-dispatch: tool` skill field at it)
instead of an MCP tool call:

```sh
tsx agents/agent-skills/open-claw/cli/index.ts status --agent <your-agent-id>
tsx agents/agent-skills/open-claw/cli/index.ts register --agent <your-agent-id>
tsx agents/agent-skills/open-claw/cli/index.ts place_order --agent <your-agent-id> \
  --marketId mkt-1 --side BUY_YES --price 0.62 --quantity 5
```

Same tool, same result, reported to the same activity feed — it just skips this skill's own
reasoning. Use it for a request you were only going to translate 1:1 into a tool call anyway (e.g.
a caller — a messenger gateway, a matched slash command — already told you exactly what to run);
keep reasoning through the MCP tools above for anything genuinely open-ended (which market, which
side, how much). Full command list: [../cli/README.md](../cli/README.md).

## Setup

If tool calls fail with "server not found," or you don't see any `dreamdex-event-contracts__*`
tools at all, this skill's MCP server isn't wired into your OpenClaw config yet — see
[references/setup.md](references/setup.md) for the one-time setup (registering the server, picking
an `AGENT_ID`, optionally giving this agent its own wallet). Run `scripts/verify_setup.sh` to check
the app and config are reachable before your first turn.
