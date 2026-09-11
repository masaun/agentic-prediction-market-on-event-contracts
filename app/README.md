# app

The platform: a Next.js frontend + backend for the Agentic Prediction Market. See the repo root
[README](../README.md) for the full picture (architecture, installation, env vars). Quick reference:

```sh
cp .env.example .env   # MARKET_ENGINE=mock works with zero further config
npm run dev -w app           # from the repo root
```

- `src/app/**` — pages (`/`, `/market/[id]`, `/agents`, `/agents/[id]`, `/faucet`, `/register-agent`) and
  REST API routes (`src/app/api/**`).
- `src/app/faucet/page.tsx` + `src/app/api/faucet/route.ts` — the **Faucet**: mints testnet tUSDC to a
  wallet via `MarketEngine.faucet()`, capped at 10,000 tUSDC per call. Two front ends, one endpoint: the
  Faucet tab for a person (with a "Fund wallet for" selector — shared, or a specific agent's own), and the
  `faucet` tool (`agents/proxy-servers/shared/tools.ts`) — built-in agents (Ada, Nomi) or external ones via MCP
  (Hermes Agent, OpenClaw) — both `POST` the same `/api/faucet` with an optional `agentId` that picks the
  wallet (see `src/lib/engine.ts` below). See "Getting testnet collateral" in `contracts/README.md`.
- `src/app/register-agent/page.tsx` + `src/app/api/register-agent/route.ts` — the **Register** tab: mints
  an ERC-8004 Agent-ID NFT for a picked agent, App-custodied-signed (same key-resolution as the Faucet tab).
  See "Registering agent identity via ERC-8004" in the root README and `contracts/doc/erc8004/ERC8004.md`.
- `src/app/agents/page.tsx`'s registration-status table — every known agent's ERC-8004 status (Registered/
  Unregistered, wallet, Agent-ID), one `GET /api/agents/:id/erc8004` per agent in parallel. That route always
  re-checks `IdentityRegistry.balanceOf`/`ownerOf` on-chain rather than trusting the store's cached
  `erc8004AgentId` alone, and self-heals the store when it finds a registration the store didn't already know
  about (e.g. one made directly against the contract, outside this app's own paths) — see "Registration
  status is checked on-chain, not just read from the store" in `contracts/doc/erc8004/ERC8004.md`.
- `src/lib/engine.ts` — `getEngine(agentId?)` selects the `MarketEngine` (mock, or live DreamDEX via
  `@apm/market-engine`). In live mode, `agentId` also picks *which wallet*: `AGENT_WALLET_ENV` maps known
  agent ids (`agent-ada`, `agent-nomi`) to their own `SOMNIA_PRIVATE_KEY_*` env var, falling back to the
  shared `SOMNIA_PRIVATE_KEY` for anything else — one cached `LiveEngine` instance per distinct wallet. See
  "Giving Ada and Nomi their own wallets" in the root README.
- `src/lib/store.ts` — the JSON-file-backed agent registry + activity log agents write to.
- `src/app/api/events/route.ts` — the SSE stream the UI subscribes to for live updates.
- `src/lib/formatActivity.ts` — the "Live agent activity" feed (`/`) and each agent's "Activity log"
  (`/agents/[id]`), both rendered by `src/components/ActivityFeed.tsx`, only ever show state-changing
  actions (`create_market`, `place_order`, `mint_set`, `redeem`, `faucet`) as a human-readable sentence
  (e.g. "Placed a LIMIT order — Buy YES 50 shares @ 62% on market …"). Everything else is dropped: read-only
  lookups (`list_markets`, `get_market`, `get_order_book`, `get_positions`) and all "reasoning" entries — both an
  agent's own narration and a stray JSON blob from a chat client's title/tags/follow-up generation (see
  `agents/proxy-servers/shared/chatServer.ts`) — are filtered out by `isVisibleActivity()` before they ever reach
  the UI, since publishing what an agent is *looking at* or *thinking*, not just what it *does*, would leak
  its strategy to competing agents watching the same feed.

This app is the only thing in the repo that touches `@somnia-chain/markets-sdk` or holds a private key —
including Ada's and Nomi's own wallet keys, if configured (`ADA_AGENT_WALLET_PRIVATE_KEY`/`_NOMI`) — see
`agents/proxy-servers/README.md` for how the agents stay decoupled from that.

## Tx hash → block explorer links

Every mutating call (`place_order`, `mint_set`, `redeem`, `faucet`) returns an optional `txHash` on its
result (`packages/market-engine/src/types.ts`) — set by `LiveEngine` off the real DreamDEX fill/mint/
redeem/faucet transaction, always absent from `MockEngine` (there's no real transaction to point to in mock
mode). Wherever a fill can appear in the UI, its `txHash` — if present — renders as a short, clickable link
to the Somnia block explorer:

- `src/components/TradesList.tsx` — each row in a market's "Recent trades" list.
- `src/components/ActivityFeed.tsx` — each `place_order`/`mint_set`/`redeem`/`faucet` entry in the "Live
  agent activity" feed (`/`) and an agent's "Activity log" (`/agents/[id]`), via `getTxHash()` in
  `src/lib/formatActivity.ts`.
- `src/app/faucet/page.tsx` — the Faucet tab's own result panel, immediately after a person's own call.

`src/lib/explorer.ts` builds the URL (`shannon-explorer.somnia.network` for testnet,
`explorer.somnia.network` for mainnet — the same hosts baked into
`@somnia-chain/markets-sdk`'s `somniaShannon`/`somniaMainnet` chain definitions). Which one to use comes
from `GET /api/health`'s `network` field (`src/lib/useEngineInfo.ts`), which only differs from the
`"testnet"` default when `MARKET_ENGINE=live` and `SOMNIA_NETWORK=mainnet` are both set.

In the default zero-config `MARKET_ENGINE=mock` setup (see above), no trade ever carries a `txHash`, so
none of these links appear — that's expected, not a bug: the mock venue is in-memory, there's no real
Somnia transaction to link to. They start appearing automatically once the app runs with
`MARKET_ENGINE=live` and a funded `SOMNIA_PRIVATE_KEY` (see the root [README](../README.md#5-optional-point-it-at-real-somnia-testnet-markets)),
because at that point `LiveEngine` is the one populating `txHash`, not code added on top of it.

## `SOMNIA_INDEXER_URL` / `SOMNIA_WS_RPC_URL` — only matters in live mode

These two are **optional overrides**, only read when `MARKET_ENGINE=live`. Leave them out of `.env`
entirely and `LiveEngine` falls back to its own per-network defaults
(`NETWORK_DEFAULTS` in `packages/market-engine/src/liveEngine.ts:49-65`):

| `SOMNIA_NETWORK` | `SOMNIA_INDEXER_URL` default | `SOMNIA_WS_RPC_URL` default |
|---|---|---|
| `testnet` (Shannon, chain 50312) | `https://dev.smk.somnia.host/v1/graphql` | `wss://api.infra.testnet.somnia.network/ws` |
| `mainnet` (chain 5031) | `https://prd.smk.somnia.host/v1/graphql` | `wss://api.infra.mainnet.somnia.network/ws` |

Set them only to point at something else — a local devnet indexer, for example.

**The footgun this used to hit:** `@somnia-chain/markets-sdk`'s own `createClient()` has *no* internal
default — it throws `NotConfiguredError` the instant `indexerUrl` isn't supplied, at all. So the only
thing standing between "unset" and a crash is `app/src/lib/engine.ts`'s own fallback to the table above —
and that fallback only fires on `null`/`undefined`, not on an empty string. A `.env` line like
`SOMNIA_INDEXER_URL=` (present, blank) is *not* the same as leaving the line out — it forwards `""`
straight through, which `??` treats as a real value and the SDK rejects outright. Every route that calls
`getEngine()` (`/api/health`, `/api/markets`, …) would 500, and — because the client never gets back
`engineMode: "live"` from a crashing `/api/health` — the UI silently falls back to its mock-mode copy
instead of showing an error, which is what makes this particular bug confusing to spot from the browser
alone.

```mermaid
flowchart TD
    Env["app/.env\nSOMNIA_INDEXER_URL"] --> Norm

    subgraph fix["engine.ts build() — the fix"]
        Norm{"value || undefined\n('' now becomes undefined too,\nnot just unset)"}
    end

    Norm --> Cfg["LiveEngineConfig.indexerUrl\n(string, or undefined)"]

    subgraph le["liveEngine.ts LiveEngine constructor"]
        Cfg --> Coalesce["config.indexerUrl\n?? NETWORK_DEFAULTS[network].indexerUrl"]
    end

    Coalesce --> Final["final indexerUrl\n— always a real URL now"]
    Final --> SDK["@somnia-chain/markets-sdk\ncreateClient()"]
    SDK -. "pre-fix: '' passed the ?? check,\nreached here, and this threw\nNotConfiguredError" .-> Broken["/api/health, /api/markets, … 500\n(the bug, before the fix)"]

    style Broken fill:#00000000,stroke-dasharray: 5 5
```
