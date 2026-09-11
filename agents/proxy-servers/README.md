# proxy-servers

Proxy servers that sit in front of the app's REST API (`./app/api`): they route requests from both
**internal agents** (the built-in demo agents at [`../demo-agents/`](../demo-agents/)) and **external
agents** (Hermes Agent, OpenClaw, over MCP) into the platform. Each internal agent is a small
Node/TypeScript process that:

1. Registers itself with the app (`POST /api/agents/register`) so it shows up on `/agents`.
2. On an interval, takes a "turn": reasons about the market, calls tools, reports what it did.
3. Talks to the market over the app's REST API (`APM_API_URL` — APM being the
   [Agentic Prediction Market](../../README.md)) for everything **except buying shares**. Whether the app is
   backed by the mock venue or real DreamDEX Event Contracts on Somnia testnet/mainnet is decided entirely
   by the app's `MARKET_ENGINE` env var; these agents don't know or care.

   **Before it can buy anything**, an agent must also register an on-chain identity via **ERC-8004** — the
   `register_erc8004_identity` tool mints an Agent-ID NFT on `IdentityRegistry.sol` directly from that
   agent's own wallet (same wallet the x402 flow below pays fees from). `X402FeeVault.payFee` now reverts
   for any wallet that hasn't done this, so it's not optional once the vault is deployed with the registry
   wired in. See [contracts/doc/erc8004/ERC8004.md](../../contracts/doc/erc8004/ERC8004.md).

   **Buying shares (`BUY_YES`/`BUY_NO`) is the one exception**, and it's opt-in per agent: give an agent its
   own wallet private key (`ADA_AGENT_WALLET_PRIVATE_KEY` / `NOMI_AGENT_WALLET_PRIVATE_KEY` / `AGENT_WALLET_PRIVATE_KEY`
   — see `.env.example`) and it pays a 0.01% platform fee straight into `X402FeeVault.sol` via a real x402
   HTTP-402 challenge/response, then places its DreamDEX order directly from that same wallet — genuinely
   its own on-chain identity, key material this package now holds itself, not the app. No wallet configured
   (the default) means unchanged behavior: the app places the order, same as `SELL_*`, `mint_set`, `redeem`,
   and `faucet` still do either way. See [contracts/doc/x402/X402.md](../../contracts/doc/x402/X402.md) for the
   full design and why this is the one deliberate exception to "no chain code, no private keys" here.

```
agents/
├── proxy-servers/            # you are here
│   ├── shared/
│   │   ├── apiClient.ts   # typed fetch wrapper around the app's REST API (+ the x402 buy flow, see below)
│   │   ├── wallet.ts        # resolves an agent's own wallet (if configured) + pays x402 fees + places DreamDEX orders directly
│   │   ├── tools.ts        # the 11 market actions, defined once (JSON Schema + zod)
│   │   ├── receipt.ts       # formats place_order fills into one organized receipt — see Order execution
│   │   │                     # receipts below; shared by tools.ts, cli.ts, and llmLoop.ts
│   │   ├── llmLoop.ts       # reference reasoning engine: OpenRouter (default) or Anthropic tool-use loop
│   │   ├── chatServer.ts    # OpenAI-compatible /v1/chat/completions + /v1/models, for a chat UI (Open WebUI)
│   │   ├── mcpServer.ts     # the SAME tools, exposed over MCP for external agent hosts
│   │   └── cli.ts           # the non-LLM CLI dispatch engine — see CLI below; shared with the external-agent
│   │                         # CLIs bundled in ../agent-skills/hermes-agent/cli/ and ../agent-skills/open-claw/cli/
│   ├── run-demo.ts         # boots creator + both bettors ticking, prefixed logs
│   ├── run-chat.ts          # boots both chat servers, prefixed logs
│   └── docker-compose.chat.yml  # Open WebUI, wired to both chat servers
├── demo-agents/               # sibling — the built-in demo agents (internal, no external framework)
│   ├── creator-agent/  # "Sage" (Demo Agent as a new event creator) — proposes new markets
│   │   ├── index.ts      # autonomous ticking loop
│   │   └── chatServer.ts  # human-driven chat endpoint for Sage
│   ├── bettor-agent/  # "Ada" (Demo Agent as a bettor/trader, momentum) / "Nomi" (Demo Agent as a bettor/trader, contrarian) — trade existing markets
│   │   ├── index.ts      # autonomous ticking loop
│   │   └── chatServer.ts  # human-driven chat endpoint for Ada + Nomi
│   └── cli/
│       └── index.ts      # thin wrapper over proxy-servers/shared/cli.ts — see CLI below
└── agent-skills/              # sibling — Agent Skills bundles for Hermes Agent / OpenClaw
```

## Architecture

Four front doors onto the same `shared/tools.ts` actions — the autonomous ticking loop (`index.ts`), the
human-driven chat endpoint (`chatServer.ts`), the **CLI** (`../demo-agents/cli/index.ts`, see [below](#cli)), and
**external MCP hosts** (`shared/mcpServer.ts`, see [below](#external-agent-hosts-via-mcp-hermes-agent--openclaw))
— all funnel through the exact same 11 tools against the app, but only the first two go through
`shared/llmLoop.ts`'s built-in reasoning loop. The CLI and `mcpServer.ts` are the odd ones out on purpose:
the CLI dispatches straight to a tool with no LLM in the loop at all (see [CLI](#cli) for why that matters
for something like `register_erc8004_identity`), and `mcpServer.ts` hands the exact same tools to an
*external* framework's own reasoning loop (Hermes Agent, OpenClaw) instead of `llmLoop.ts` — so the built-in
Sage/Ada/Nomi processes below never spawn or call `mcpServer.ts`, and an MCP-driven agent never runs
`llmLoop.ts`. The two paths only share `shared/tools.ts`.

```mermaid
flowchart LR
    subgraph creator["demo-agents/creator-agent/"]
        SageIdx["index.ts\nticking loop"]
        SageChat["chatServer.ts\n:4001"]
    end
    subgraph bettor["demo-agents/bettor-agent/"]
        BettorIdx["index.ts\nticking loop\nAGENT_PERSONA=ada|nomi"]
        BettorChat["chatServer.ts\n:4002\nada-bettor-agent · nomi-bettor-agent"]
    end
    CLI["demo-agents/cli/index.ts\ntsx ../demo-agents/cli/index.ts <tool> --agent <id>\nno LLM involved"]
    ExternalHost["Hermes Agent / OpenClaw\nexternal framework's own\nreasoning loop (not llmLoop.ts)"]
    Mcp["shared/mcpServer.ts\nMCP stdio server"]

    Nudge["synthetic \"it's your turn\" nudge"]
    Chat["your chat message"]
    SageIdx -.-> Nudge
    BettorIdx -.-> Nudge

    Loop["shared/llmLoop.ts\nrunAgentTurn()\nLLM_PROVIDER switch"]
    Tools["shared/tools.ts\n11 market actions"]
    Client["shared/apiClient.ts"]

    Nudge --> Loop
    Chat --> Loop
    SageChat -.-> Chat
    BettorChat -.-> Chat
    SageIdx --> Loop
    BettorIdx --> Loop
    SageChat --> Loop
    BettorChat --> Loop
    Loop --> Tools
    CLI -- "tool.run() directly\n(bypasses Loop entirely)" --> Tools
    ExternalHost --> Mcp
    Mcp -- "tool.run() via MCP\n(bypasses Loop entirely, like CLI —\nSage/Ada/Nomi never touch this path)" --> Tools
    Tools --> Client

    OpenWebUI["Open WebUI\n:3010\n(docker-compose.chat.yml)"]
    OpenWebUI -- "OpenAI API connection" --> SageChat
    OpenWebUI -- "OpenAI API connection" --> BettorChat

    Client -- "HTTP REST (APM_API_URL)" --> App["app\n:3000"]
```

A chat turn and a ticking turn are the same `runAgentTurn()` call with a different first message — a tool
call made from Open WebUI hits the real `apiClient.ts` and reports to the app's activity feed under the same
`agentId` as an autonomous trade, so it shows up on `/agents/:id` the same way.

`runAgentTurn()` (in `shared/llmLoop.ts`) reports every activity entry it sees, unfiltered — reasoning text
as-is, every tool call as `tool_name({...json args...})` with the parsed args/output alongside on `data`
(see `ActivityEntry` in `shared/types.ts`). Open WebUI's own title/tags/follow-up generation also rides the
same `/v1/chat/completions` endpoint (see [Chat UI (Open WebUI)](#chat-ui-open-webui) below) as an ordinary
chat turn, so it can surface here too, as a "reasoning" entry whose message is a raw JSON blob rather than
prose. The app is where this gets curated for display, not just formatted: `app/src/lib/formatActivity.ts`
only ever shows state-changing tool calls (`create_market`, `place_order`, `mint_set`, `redeem`, `faucet`) as a plain
sentence, and drops everything else — read-only lookups and all "reasoning" entries, including an agent's
own narration — before it reaches the "Live agent activity" feed or an agent's "Activity log". That's
deliberate: an agent's rationale and what it's been checking are exactly what would leak its strategy to a
competing agent watching the same feed.

## Installation

| Requirement | Version |
|---|---|
| Node | ≥ 20 |
| npm | workspaces-aware (ships with Node ≥ 20) |

| # | Step | Command | Run from |
|---|---|---|---|
| 1 | Install dependencies | `npm install` | repo root (installs `app`, `agents/proxy-servers`, `packages/market-engine` together — npm workspaces) |
| 2 | Configure env | `cp .env.example .env` then set `OPENROUTER_API_KEY` | `agents/proxy-servers/` |
| 3 | Start the app | `npm run dev:app` | repo root, separate terminal — every agent process below needs this running first |
| 4a | Start agents — autonomous | `npm run demo:agents` | repo root — Sage + Ada + Nomi tick on a timer |
| 4b | Start agents — chat | `npm run demo:chat` + `docker compose -f docker-compose.chat.yml up` | repo root — see [Chat UI (Open WebUI)](#chat-ui-open-webui) |
| 4c | Start app + chat agents + Open WebUI, one shot | `npm run dev:all` | repo root — opens steps 3 + 4b's commands each in its own Terminal.app tab (macOS); `npm run dev:all:log` runs them together in one terminal instead (any OS, via `concurrently`) |

Or run one autonomous agent at a time: `npm run agent:creator`, `npm run agent:bettor:ada`,
`npm run agent:bettor:nomi`.

## Two ways to reason

**Built-in (default)** — `shared/llmLoop.ts` is a plain tool-use loop behind an `LLM_PROVIDER` switch. It's
what every `npm run agent:*` script drives.

- `LLM_PROVIDER=openrouter` (default) — calls [OpenRouter](https://openrouter.ai/docs/quickstart)'s
  unified, OpenAI-compatible `/chat/completions` API. One `OPENROUTER_API_KEY` gets you any model in its
  catalog via `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`) — including Claude, by setting
  `OPENROUTER_MODEL=anthropic/claude-sonnet-4.5`, without touching `ANTHROPIC_API_KEY` at all.
- `LLM_PROVIDER=anthropic` — calls the Anthropic Messages API directly via `@anthropic-ai/sdk`. Needs
  `ANTHROPIC_API_KEY`, model id from `AGENT_MODEL`.

Both branches drive the exact same `shared/tools.ts` and tool-use loop shape (system prompt → think → call
tools → repeat up to 6 turns → final narration) — swapping the env var is the only thing that changes.

**Hermes Agent / OpenClaw** — both are full external agent runtimes with their own reasoning loop, memory,
and tool dispatch. Rather than re-implement their internals, `shared/mcpServer.ts` exposes the exact same
11 tools over MCP for either framework to attach to as an external tool provider — see
[External agent hosts via MCP](#external-agent-hosts-via-mcp-hermes-agent--openclaw) below for the full
procedure.

## External agent hosts via MCP (Hermes Agent / OpenClaw)

`shared/mcpServer.ts` exposes the exact same 11 market actions from `shared/tools.ts` — `list_markets`,
`get_market`, `get_order_book`, `create_market`, `place_order`, `mint_set`, `get_positions`, `redeem`,
`faucet`, `register_erc8004_identity`, `get_erc8004_status` — as an MCP stdio server. Point Hermes Agent's or OpenClaw's own reasoning loop at it instead of
running `shared/llmLoop.ts`, and either framework drives the exact same market actions the built-in demo
agents use.

| # | Step | Command / Action | Run from | Notes |
|---|---|---|---|---|
| 1 | Install dependencies | `npm install` | repo root | Installs `app`, `agents/proxy-servers`, `packages/market-engine` together (npm workspaces) |
| 2 | Start the app | `npm run dev:app` | repo root, separate terminal | Must be running first — MCP tool calls hit `APM_API_URL` under the hood |
| 3 | (Optional) start the MCP server standalone, to confirm it boots | `AGENT_ID=my-agent npm run mcp` | `agents/proxy-servers/` (or `AGENT_ID=my-agent npm run agent:mcp` from repo root) | Only for testing the server alone — the host framework spawns its own copy per its config in step 5 |
| 4 | Pick an `AGENT_ID` | e.g. `hermes-trader` or `openclaw-trader` | — | Attributes trades/positions to a distinct identity, same as the built-in demo agents |
| 5 | Register the server with the host framework | Hermes: edit `~/.hermes/config.yaml` under `mcp_servers`; OpenClaw: edit `~/.openclaw/config.json` (or your config dir) under `mcp.servers` | your framework's config location | Templates: [hermes.config.example.yaml](hermes.config.example.yaml), [openclaw.config.example.jsonc](openclaw.config.example.jsonc) |
| 6 | Point the config at the process | `command: "npx"`, `args: ["tsx", "shared/mcpServer.ts"]`, `env.APM_API_URL: "http://localhost:3000"`, `env.AGENT_ID: "<same id as step 4>"` | inside that config block | Set cwd to `agents/proxy-servers/`, or use an absolute path if the host's working directory differs |
| 7 | (Optional) allowlist tools | e.g. OpenClaw: `tools.allow: ["dreamdex-event-contracts__*"]` | same config file | Only if your framework's policy scopes tool access |
| 8 | Start/restart the host framework | Hermes Agent / OpenClaw normal startup | wherever that framework runs | It spawns the MCP server itself per its config — step 3's standalone run is no longer needed once this is wired in |
| 9 | Verify | Check the host framework's logs for `dreamdex-event-contracts` tool registration; tool calls should show up on `/agents/:id` in the app | app UI (`http://localhost:3000`) | Confirms trades/positions attribute to the `AGENT_ID` from step 4 |

Both example config files' field names (`mcp_servers` for Hermes, `mcp.servers` for OpenClaw) are sourced
from each project's docs at the time of writing — double-check against your installed version, both
frameworks are fast-moving.

**Giving this agent its own wallet (optional):** the private key is a secret, so it doesn't belong
hardcoded in `config.yaml`/`openclaw.json` — both example config files put it in `${AGENT_WALLET_PRIVATE_KEY}`
form and expect the actual value to live in each framework's own secrets file instead:

| Framework | Secret file | Reference syntax in `mcp_servers`/`mcp.servers` config |
|---|---|---|
| Hermes Agent | `~/.hermes/.env` — see [Hermes' secrets guide](https://hermes-agent.nousresearch.com/docs/user-guide/secrets/) | `${VAR_NAME}` |
| OpenClaw | `~/.openclaw/.env` (global fallback — also checks the parent process env and a `.env` in the cwd first) — see [OpenClaw's configuration guide](https://docs.openclaw.ai/gateway/configuration) | `${VAR_NAME}` in any config string value |

```sh
# ~/.hermes/.env  — or  ~/.openclaw/.env
AGENT_WALLET_PRIVATE_KEY=0x...
```

```yaml
# ~/.hermes/config.yaml (OpenClaw's mcp.servers.*.env block takes the same
# ${AGENT_WALLET_PRIVATE_KEY} reference — see openclaw.config.example.jsonc)
mcp_servers:
  dreamdex_event_contracts:
    command: "npx"
    args: ["tsx", "shared/mcpServer.ts"]
    env:
      APM_API_URL: "http://localhost:3000"
      AGENT_ID: "hermes-trader"
      AGENT_WALLET_PRIVATE_KEY: "${AGENT_WALLET_PRIVATE_KEY}"   # ← resolved from ~/.hermes/.env at connect time
```

Hermes' docs confirm `${VAR}` resolution (from everything in `~/.hermes/.env`) for a server entry's
`command`/`args`/`transport.url`/`headers`; they don't show an explicit example of it inside the `env:`
mapping specifically, so if your installed version doesn't resolve it there, check Hermes' current docs —
both frameworks are fast-moving. Either way, the raw key stays out of `config.yaml`/`openclaw.json` and out
of this repo.

`mcpServer.ts` runs as the child process Hermes/OpenClaw spawn, so it's the one that resolves the actual
key value — neither framework's own reasoning core ever sees it, same as it never sees
`APM_AGENT_API_KEY`. The resolution itself, in `shared/wallet.ts`, is what makes this work for *any*
external `AGENT_ID` with no per-agent code change — Ada and Nomi get their own dedicated env var each and
never fall back to a shared one, but anything else (every external MCP agent) shares this one:

```ts
// shared/wallet.ts
const AGENT_WALLET_ENV: Record<string, string> = {
  "agent-ada": "ADA_AGENT_WALLET_PRIVATE_KEY",
  "agent-nomi": "NOMI_AGENT_WALLET_PRIVATE_KEY",
};

function resolvePrivateKey(agentId: string): `0x${string}` | undefined {
  const dedicatedEnvVar = AGENT_WALLET_ENV[agentId];
  const dedicated = dedicatedEnvVar ? process.env[dedicatedEnvVar] : undefined;
  const fallback = dedicatedEnvVar ? undefined : process.env.AGENT_WALLET_PRIVATE_KEY;
  return (dedicated || fallback) as `0x${string}` | undefined; // undefined ⇒ hasOwnWallet() is false
}
```

With this set, `place_order` for `BUY_YES`/`BUY_NO` runs the full x402 flow — see [x402 payments for
buying shares](#x402-payments-for-buying-shares) below — with no change to the tool itself; without it,
buying works exactly as it does today, App-custodied.

**Example: registering an agent's identity by just asking.** Once the MCP server is wired in (step 8 above),
this is a plain-English message to Hermes Agent's or OpenClaw's own chat/reasoning interface — not Open
WebUI, which only fronts the two built-in chat servers above, not external MCP hosts:

| Framework | Front door | Example prompt | Tool invoked |
|---|---|---|---|
| Hermes Agent / OpenClaw | Its own chat/reasoning interface (not Open WebUI) | "Register your agent identity with the DreamDEX ERC-8004 Identity Registry on Somnia testnet." | `register_erc8004_identity` (off the `dreamdex-event-contracts` tool list, no arguments) |

The framework's LLM picks the tool on its own and reports back the minted Agent-ID and tx hash — same tool,
same `IdentityRegistry.sol`, as the built-in agents use. Requires `ERC8004_IDENTITY_REGISTRY_ADDRESS` set in
`agents/proxy-servers/.env` and this agent's wallet (`AGENT_WALLET_PRIVATE_KEY`, or its own dedicated var) funded
with testnet STT for gas — see [Registering agent identity via
ERC-8004](../../README.md#registering-agent-identity-via-erc-8004) in the root README.

### Why `npm run dev:app` doesn't (and shouldn't) start this for you

`shared/mcpServer.ts` uses MCP's **stdio transport** (`StdioServerTransport` in `shared/mcpServer.ts`) —
there's no address to connect to and nothing "listening." A stdio MCP server only does something useful
when the *host* (Hermes Agent, OpenClaw) is the one that spawns it, per the `command`/`args` in its own
config (step 6 above), because the host wires its own stdin/stdout directly to that child process. If
`dev:app` pre-launched a copy of `mcpServer.ts` in the background instead, it would just sit idle with its
stdin/stdout connected to nothing — Hermes wouldn't attach to that instance; it spawns its own regardless.
So starting an extra copy ahead of time doesn't get you anything, and running the app is decoupled from
running the MCP server on purpose.

The one real dependency runs the other way: once Hermes spawns `mcpServer.ts`, that process's tool calls go
out over HTTP to `APM_API_URL` — so **the app (step 2) must already be running** before Hermes starts, not
the other way around. The actual sequence is:

1. `npm run dev:app` — app up at `http://localhost:3000`.
2. Hermes/OpenClaw's own config points at `agents/proxy-servers/shared/mcpServer.ts` with `APM_API_URL` and
   `AGENT_ID` set (steps 5–6 above).
3. Starting Hermes/OpenClaw itself spawns `mcpServer.ts` as its MCP tool provider — that spawn is automatic
   from the host framework's side, not from `dev:app`'s side.

If you instead want one persistent, always-on MCP server that any host can attach to without spawning it
itself, that needs MCP's Streamable HTTP transport in place of stdio — a different setup than what's
implemented here today.

## x402 payments for buying shares

Full design, research, and diagrams: [contracts/doc/x402/X402.md](../../contracts/doc/x402/X402.md). Summary
from this package's side:

`apiClient.placeOrder` checks `shared/wallet.ts`'s `hasOwnWallet(agentId)` before every `BUY_YES`/`BUY_NO`
call. If that agent has no configured wallet — the default, and the only option in mock mode — nothing
changes: one `POST /api/markets/:id/orders` call, exactly as before, exactly like `SELL_YES`/`SELL_NO`
always work. If it does, `placeOrder` instead:

1. `POST /api/markets/:id/buy` with no payment → the app responds `402` with the quoted 0.01% fee, a nonce,
   and `X402FeeVault`'s address.
2. `wallet.ts`'s `payPlatformFee` pays that fee **on-chain, from the agent's own wallet** — approving the
   vault first if needed, then calling `payFee(...)` — genuinely agent-broadcast, agent-paid transactions.
3. Retries `POST /api/markets/:id/buy` with the resulting tx hash in an `X-PAYMENT` header. The app verifies
   the transaction itself (reads the receipt, checks the `FeeLocked` event) and returns `200 cleared`.
4. `wallet.ts`'s `resolveTradingEngine(agentId)` — a `LiveEngine` from `@apm/market-engine`, built with that
   same wallet's key — places the actual DreamDEX order **directly**, bypassing the app for the trade
   itself. Its result (fill, tx hash) plus the fee payment's own receipt come back from `placeOrder` like
   normal, so the `place_order` tool's output — and the activity log narration `runAgentTurn` already
   generates from it — includes both without any change to `shared/tools.ts`.

Set up a wallet for Ada, Nomi, or an external MCP agent's `AGENT_ID` via `ADA_AGENT_WALLET_PRIVATE_KEY` /
`NOMI_AGENT_WALLET_PRIVATE_KEY` / `AGENT_WALLET_PRIVATE_KEY` in `.env.example` — each needs testnet SOMI/STT (gas)
and tUSDC before it can do anything, same funding story as any other live wallet in this project (see the
root README's ["Point it at real Somnia testnet
markets"](../../README.md#5-optional-point-it-at-real-somnia-testnet-markets)). This is genuinely separate key
material from the app's own `ADA_AGENT_WALLET_PRIVATE_KEY`/`_NOMI` — the app never sees it.

## Chat UI (Open WebUI)

`shared/chatServer.ts` puts a minimal OpenAI-compatible `/v1/chat/completions` + `/v1/models` endpoint in
front of the exact same `runAgentTurn` tool-use loop `llmLoop.ts` already drives — a chat message is just
another way to seed a turn, in place of the ticking loop's synthetic "it's your turn" nudge. Point
[Open WebUI](https://github.com/open-webui/open-webui) at it as a custom "OpenAI API connection" and you get
a normal chat UI for talking to Sage, Ada, or Nomi directly — ask what they see in the order book, why they
passed last turn, or tell them to go place a trade — instead of only watching them tick. Tool calls made
this way still hit the real `shared/tools.ts` actions and report to the app's activity feed under the same
`agentId`, so a chat-triggered trade shows up on `/agents/:id` exactly like an autonomous one.

Two chat servers, one per agent process (matching `../demo-agents/creator-agent/` / `../demo-agents/bettor-agent/`); the bettor server
registers **both** personas as separate selectable models — see [URLs](#urls) below for exact ports and
routes.

```sh
npm run demo:chat -w proxy-servers   # both chat servers, one terminal — or from repo root: npm run demo:chat
# or one at a time:
npm run chat:creator -w proxy-servers
npm run chat:bettor -w proxy-servers
```

Each chat server calls `registerAgent` against the app on startup (same as `index.ts`), so **the app must
already be running at `APM_API_URL`** (`npm run dev:app`) — starting a chat server first fails fast with
`ECONNREFUSED`. `npm run dev:all` (from repo root) starts the app, both chat servers, and Open WebUI's
Docker Compose each in its own Terminal.app tab (macOS only — `scripts/dev-all.sh`), waiting on the app's
`/api/health` before starting each chat server so this ordering is never an issue. On other platforms, or to
keep everything in one terminal, use `npm run dev:all:log` (same sequencing, via `concurrently`).

Each chat server only answers three routes; anything else, including `GET /`, is a `404` on purpose:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/models` (or `/models`) | List that server's models — what Open WebUI's picker reads |
| `POST` | `/v1/chat/completions` (or `/chat/completions`) | Run one chat turn (what Open WebUI calls per message) |
| `GET` | `/health` | Liveness check — `{ ok: true, models: [...] }`, no LLM call made |

Verify a server is actually up before wiring Open WebUI at it:

```sh
curl http://localhost:4001/health   # -> {"ok":true,"models":["sage-creator-agent"]}
curl http://localhost:4002/health   # -> {"ok":true,"models":["ada-bettor-agent","nomi-bettor-agent"]}
```

Then run Open WebUI itself (a separate app — this repo doesn't vendor it) via the provided compose file,
which wires up both chat servers as connections in one go:

```sh
docker compose -f docker-compose.chat.yml up   # from agents/proxy-servers/ — or from repo root: -f agents/proxy-servers/docker-compose.chat.yml
```

Open [http://localhost:3010](http://localhost:3010) — on first load Open WebUI merges the models from both
connections, so `sage-creator-agent`, `ada-bettor-agent`, and `nomi-bettor-agent` all show up in its model picker. No sign-up
required for this local demo (`WEBUI_AUTH=False` in the compose file — see the comment there before exposing
it beyond localhost).

Prefer running Open WebUI without Docker, or pointing an existing Open WebUI instance at these agents?
Add each server as an OpenAI API connection under **Settings → Connections**, base URL
`http://localhost:4001/v1` and `http://localhost:4002/v1` (or `http://host.docker.internal:<port>/v1` from
inside a container), any non-empty string as the API key (or the value of `AGENT_CHAT_API_KEY` if you set
one — see `.env.example`).

Every request still needs a working `LLM_PROVIDER` (`OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY`, see above)
and the app running at `APM_API_URL` — the chat servers are a new front door onto the same agents, not a new
reasoning engine.

### Chat UI (Open WebUI) - How to Prompt in Natural Language

No special syntax needed — pick a model in Open WebUI's picker and send a plain-English message; the LLM
behind it picks the right tool from `shared/tools.ts` on its own, with no arguments needed.

| Model in the picker | Example prompt | Tool invoked |
|---|---|---|
| `ada-bettor-agent` / `nomi-bettor-agent` / `sage-creator-agent` | "Register yourself in the ERC-8004 Identity Registry." | `register_erc8004_identity` |

The agent replies with the tx hash and minted Agent-ID once it lands (requires
`ERC8004_IDENTITY_REGISTRY_ADDRESS` set in `agents/proxy-servers/.env` and that agent's wallet
(`ADA_AGENT_WALLET_PRIVATE_KEY` / `NOMI_AGENT_WALLET_PRIVATE_KEY`) funded with testnet STT for gas — see [Registering
agent identity via ERC-8004](../../README.md#registering-agent-identity-via-erc-8004) in the root README).

The same pattern — a plain-English ask, no tool name required — works for any of the other ten tools in
`shared/tools.ts` (checking the order book, placing a trade, minting a set, redeeming, hitting the faucet,
and so on), not just registration.

### Order execution receipts

`place_order`'s `tool.run()` (`shared/tools.ts`) builds a structured receipt for every buy/sell — via
`shared/receipt.ts` — instead of leaving the market title, fill price, and tx hash to whatever the LLM
happens to remember and phrase on its own. It fetches the market (for its `question`), formats a plain-text
block with the fill details and a Somnia block-explorer link for the order transaction (and the fee
transaction, for a `BUY_YES`/`BUY_NO` that went through the [x402 flow](#x402-payments-for-buying-shares)),
and returns it as the tool output's `receipt` field alongside the raw fill data.

`runAgentTurn` (`shared/llmLoop.ts`) appends that `receipt` verbatim after the model's own narration, so it
reaches Open WebUI the same way regardless of what the model chose to say about the trade — the model still
adds its own market commentary, but the hard facts (price, fee, tx link) are never left to its memory or
paraphrasing. The same `receipt` string is what the CLI's `place_order` summarizer prints (see
[CLI](#cli) below), and it's included as-is in the JSON an MCP-connected external agent host (Hermes Agent,
OpenClaw) sees — see [external agent hosts via MCP](#external-agent-hosts-via-mcp-hermes-agent-openclaw) and
each skill's `SKILL.md` for how those agents are instructed to relay it.

Example — asking `ada-bettor-agent` in Open WebUI "Buy 5 YES shares on the market of 'BTC closes at or above its
opening price'":

```
Taking the momentum side here — YES has been grinding up and the price still looks a touch underconfident
given the move.

✅ Order Filled — BUY YES
Market:        BTC closes at or above its opening price
Market ID:     0x0000000000000000000000000000000000000000000000000000000000012baf
Quantity:      5 YES shares
Fill Price:    0.372
Total Cost:    1.8600 tUSDC
Platform Fee:  0.000186 tUSDC
Order ID:      ord-9182
Order Tx:      https://shannon-explorer.somnia.network/tx/0x7a1c9e2f4b8d3a6c1e5f0a2b9d4c7e8f1a3b5c7d9e0f2a4b6c8d0e2f4a6c8e0f
Fee Tx:        https://shannon-explorer.somnia.network/tx/0x1122334455667788990011223344556677889900112233445566778899aabb
Executed:      2026-09-04T01:55:12.000Z
```

The status line varies with how much of the order actually filled: `✅ Order Filled` (full),
`⚠️ Order Partially Filled` (a `SELL_YES`/`SELL_NO`, or a resting `LIMIT` order, only partly crossed), or
`🕓 Order Placed — Resting on Book` (nothing crossed yet — `filledQuantity: 0`). `Fee Tx` only appears for the
x402-metered `BUY_YES`/`BUY_NO` path; a `SELL_YES`/`SELL_NO` or an app-custodied buy omits it.

## CLI

For a deterministic action with nothing to reason about — `register_erc8004_identity` takes no arguments
at all — going through an LLM chat turn is pure overhead: it burns OpenRouter tokens on a decision that was
never actually in question, and makes the action only as reliable as whatever model happens to be
configured (a free/overloaded one included — this is exactly what was behind the intermittent
`OpenRouter chat completion failed (502)` errors some registration attempts hit via Open WebUI). `../demo-agents/cli/index.ts`
is a direct front door onto `shared/tools.ts` that skips the LLM entirely: it parses the command line, calls
`tool.run(input, { agentId })` straight away, and reports the result to the app's activity feed in the exact
shape `shared/llmLoop.ts`'s `runAgentTurn` uses — so a CLI-triggered action shows up on `/agents/:id`
identically to an autonomous or chat-triggered one.

```sh
cd agents/proxy-servers

# The flagship case — register an identity, no LLM, no tokens spent:
tsx ../demo-agents/cli/index.ts register --agent agent-ada     # or: npm run register:ada
tsx ../demo-agents/cli/index.ts register --agent agent-nomi    # or: npm run register:nomi
tsx ../demo-agents/cli/index.ts register --agent agent-sage    # or: npm run register:sage

# Any other tool from shared/tools.ts works the same way — flags become the tool's input object,
# JSON-parsed when possible (so --amount 5000 becomes a number, --status TRADING stays a string):
tsx ../demo-agents/cli/index.ts faucet --agent agent-ada --amount 5000
tsx ../demo-agents/cli/index.ts list_markets --agent agent-ada --status TRADING
tsx ../demo-agents/cli/index.ts place_order --agent agent-ada --marketId mkt-1 --side BUY_YES --price 0.62 --quantity 5
# -> prints the same formatted receipt block described in "Order execution receipts" above,
#    not the raw { orderId, filledQuantity, ... } JSON — see shared/cli.ts's SUMMARIZERS

# List every available tool and its description:
tsx ../demo-agents/cli/index.ts list
```

Or from the repo root: `npm run agent:register:ada` / `agent:register:nomi` / `agent:register:sage`, and
`npm run agent:cli -- <tool> --agent <id> [flags]` for anything else.

### CLI commands ↔ natural-language prompts

Every CLI command and its natural-language equivalent — the same underlying tool either way, whichever
front door an agent (or you, driving it through Open WebUI) happens to use. `tsx ../demo-agents/cli/index.ts list` prints
this same mapping at the terminal, straight from the source of truth
(`NATURAL_LANGUAGE_EXAMPLES` in `shared/cli.ts`), so it can't drift from what's actually implemented.
Hermes Agent and OpenClaw get their own copy of this same CLI, bundled with their skills — see
[agent-skills/hermes-agent/cli/README.md](../agent-skills/hermes-agent/cli/README.md) and
[agent-skills/open-claw/cli/README.md](../agent-skills/open-claw/cli/README.md):

| CLI command | Example prompt (Open WebUI / MCP) | Tool |
|---|---|---|
| `tsx ../demo-agents/cli/index.ts status --agent <id>` | "Have you already registered your agent identity with the DreamDEX ERC-8004 Identity Registry?" | `get_erc8004_status` |
| `tsx ../demo-agents/cli/index.ts register --agent <id>` | "Register your agent identity with the DreamDEX ERC-8004 Identity Registry on Somnia testnet." | `register_erc8004_identity` |
| `tsx ../demo-agents/cli/index.ts list_markets --agent <id> [--status TRADING]` | "What markets are currently open for trading?" | `list_markets` |
| `tsx ../demo-agents/cli/index.ts get_market --agent <id> --marketId <id>` | "Give me the full details on market mkt-1, including its current price." | `get_market` |
| `tsx ../demo-agents/cli/index.ts get_order_book --agent <id> --marketId <id>` | "What does the order book look like for market mkt-1?" | `get_order_book` |
| `tsx ../demo-agents/cli/index.ts create_market --agent <id> --question <q> --category <c> --expiresInSec <n>` | "Propose a new market asking whether ETH closes above $5,000 by the end of the month." | `create_market` |
| `tsx ../demo-agents/cli/index.ts place_order --agent <id> --marketId <id> --side BUY_YES --price 0.62 --quantity 5` | "Buy 5 YES shares on market mkt-1 at 62 cents." | `place_order` |
| `tsx ../demo-agents/cli/index.ts mint_set --agent <id> --marketId <id> --amount 10` | "Mint 10 complete YES/NO share sets on market mkt-1." | `mint_set` |
| `tsx ../demo-agents/cli/index.ts get_positions --agent <id>` | "What positions do I currently hold?" | `get_positions` |
| `tsx ../demo-agents/cli/index.ts redeem --agent <id> --marketId <id> --outcome YES` | "Redeem my YES shares on market mkt-1." | `redeem` |
| `tsx ../demo-agents/cli/index.ts faucet --agent <id> --amount 5000` | "Send me 5,000 tUSDC from the testnet faucet." | `faucet` |

**Why `get_erc8004_status` exists, separately from `register_erc8004_identity`:** an Open WebUI chat is one
continuous thread — if an agent's *own* memory of "am I registered" only ever comes from what happened
inside that thread's own tool calls, then a genuinely-failed attempt earlier in the conversation (e.g. the
chat server was down, or the wallet var wasn't set yet) gets "remembered" as failure forever, even after the
underlying problem is fixed and the agent is actually registered — including by a completely different
channel, like the CLI or another session, that the chat thread has no visibility into at all.
`register_erc8004_identity` itself can't answer "am I already registered" either — `IdentityRegistry.register()`
has no duplicate-prevention, so calling it again just mints a second, redundant Agent-ID rather than failing
or no-opping. `get_erc8004_status` is the fix: a live on-chain read (the same `GET /api/agents/:id/erc8004`
the app's own `/agents` page uses), so "are you registered" always reflects current reality, not stale
conversation history.

`create_market` and `place_order`/`mint_set`/`redeem` are only meaningful for the roles those tools are
actually reachable from — `CREATOR_TOOLS` (Sage) excludes `place_order`/`mint_set`/`redeem`, and
`TRADING_TOOLS` (Ada/Nomi) excludes `create_market` — same as in ordinary chat/MCP use; the CLI itself
doesn't enforce that split, since it isn't routed through a persona's tool list at all.

Same preconditions as the natural-language paths above: `ERC8004_IDENTITY_REGISTRY_ADDRESS` set in
`agents/proxy-servers/.env`, and that agent's own wallet (`ADA_AGENT_WALLET_PRIVATE_KEY` /
`NOMI_AGENT_WALLET_PRIVATE_KEY` / `SAGE_AGENT_WALLET_PRIVATE_KEY`) funded with testnet STT for gas — the CLI
signs and broadcasts the exact same on-chain transaction `register_erc8004_identity` always did, just without
an LLM deciding to call it.

## Troubleshooting

**Wallet/identity env vars (`ADA_AGENT_WALLET_PRIVATE_KEY`, `NOMI_AGENT_WALLET_PRIVATE_KEY`,
`SAGE_AGENT_WALLET_PRIVATE_KEY`, `AGENT_WALLET_PRIVATE_KEY`, `ERC8004_IDENTITY_REGISTRY_ADDRESS`,
`SOMNIA_NETWORK`, `SOMNIA_RPC_URL`) no longer need a restart after editing `.env`.** This repo hit
the "process loaded `.env` once at startup, edit doesn't reach it" bug three separate times before
`shared/wallet.ts` got a real fix instead of another one-off restart: every function in that file
that reads one of these vars now calls a small `refreshEnv()` first, which re-reads
`agents/proxy-servers/.env` fresh (`dotenv`'s `override: true`) on every single call — a chat server, the
ticking loop, or anything else built on `wallet.ts` picks up an edit on its *very next* tool call,
no restart required. Everything **else** this package reads from `.env` (`OPENROUTER_API_KEY`,
`LLM_PROVIDER`, `APM_API_URL`, chat server ports, etc.) still only loads once at startup via the
ambient `import "dotenv/config"` in each entrypoint — those still need the restart described below.
The CLI was never affected either way: each invocation is a fresh process that reads `.env` from
scratch regardless.

| Symptom | Cause | Fix |
|---|---|---|
| Open WebUI chat reply is `OpenRouter chat completion failed (401): User not found.` (any model, any prompt) | The chat server (`chat:creator` / `chat:bettor`) loads `OPENROUTER_API_KEY` from `.env` once, at process startup, via `dotenv` — editing or rotating the key afterward doesn't reach an already-running process | Restart the chat server(s) so they re-read the current `.env`: stop and rerun `npm run demo:chat -w proxy-servers` (or `npm run chat:creator` / `npm run chat:bettor` individually) |
| `register_erc8004_identity`/`get_erc8004_status` fail with `<VAR> is not set` even though that var is clearly present in `agents/proxy-servers/.env`, **and you haven't restarted since editing it** | The file defines the same variable name **twice**. `dotenv` parses top-to-bottom and the *last* occurrence silently wins, with no warning — a real value set earlier in the file can be clobbered by a later blank line (e.g. from re-pasting a block out of `.env.example` without removing the original). This is the one thing `refreshEnv()` (below) *can't* fix, since it's a bug in the file's content, not staleness in when it was read | `grep -c '^<VAR>=' agents/proxy-servers/.env` — if it prints more than `1`, delete the duplicate (keep one) |
| Open WebUI reply to a registration prompt is `OpenRouter chat completion failed (502): ...` (message text varies — "Provider returned error", "Service temporarily overloaded", etc.), and the agent's activity log shows no `register_erc8004_identity` action at all | The configured `OPENROUTER_MODEL` (especially a free-tier one) is rate-limited, overloaded, or otherwise down upstream — the failure happens at the raw API call, before the agent's turn ever reaches a tool call, so nothing on-chain was attempted | Either switch `OPENROUTER_MODEL` to a more reliable model (a paid one, or `LLM_PROVIDER=anthropic` with a real `ANTHROPIC_API_KEY`) and restart the chat servers, or skip the LLM for this action entirely — use the [CLI](#cli) instead: `tsx ../demo-agents/cli/index.ts register --agent <agentId>` |

## URLs

Every address that comes up running this package, in the order you'd bring them up:

| URL | Method | Process | What |
|---|---|---|---|
| `http://localhost:3000` | — | app (`APM_API_URL`) | The platform every agent talks to — must be running before any agent process starts |
| `http://localhost:4001/v1/models` | `GET` | `../demo-agents/creator-agent/chatServer.ts` | Model list: `sage-creator-agent` |
| `http://localhost:4001/v1/chat/completions` | `POST` | `../demo-agents/creator-agent/chatServer.ts` | Run one chat turn with Sage |
| `http://localhost:4001/health` | `GET` | `../demo-agents/creator-agent/chatServer.ts` | Liveness check, no LLM call |
| `http://localhost:4002/v1/models` | `GET` | `../demo-agents/bettor-agent/chatServer.ts` | Model list: `ada-bettor-agent`, `nomi-bettor-agent` |
| `http://localhost:4002/v1/chat/completions` | `POST` | `../demo-agents/bettor-agent/chatServer.ts` | Run one chat turn with Ada or Nomi |
| `http://localhost:4002/health` | `GET` | `../demo-agents/bettor-agent/chatServer.ts` | Liveness check, no LLM call |
| `http://localhost:3010` | — | Open WebUI (`docker-compose.chat.yml`) | The actual chat UI you open in a browser — not started by any `npm run` script, only the compose file |

Ports are all env-configurable — `CREATOR_CHAT_PORT`, `BETTOR_CHAT_PORT` — and Open WebUI's is set via
`ports:` in `docker-compose.chat.yml` if `3010` collides with something else on your machine.

## Personas

| Agent | Role | Strategy |
|---|---|---|
| Sage 🧭 (Demo Agent as a new event creator) | creator | Scans open markets, proposes new unambiguous YES/NO questions with a genuine probability estimate |
| Ada 📈 (Demo Agent as a bettor/trader) | bettor | Momentum — bets with recent price direction, sized small and frequent |
| Nomi 🦉 (Demo Agent as a bettor/trader) | bettor | Contrarian — fades markets priced near 0/1 extremes, sized small |

Edit `../demo-agents/creator-agent/persona.ts` / `../demo-agents/bettor-agent/persona.ts` to change behavior, or add a new persona object
and a new npm script to run a fourth agent.

## Env vars

See the root README's environment variable table — the ones this package reads are prefixed `APM_*` /
`AGENT_*`, plus `LLM_PROVIDER`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `ANTHROPIC_API_KEY`,
`CREATOR_CHAT_PORT`, `BETTOR_CHAT_PORT`, `AGENT_CHAT_API_KEY`, and (see [x402 payments](#x402-payments-for-buying-shares)
above) `ADA_AGENT_WALLET_PRIVATE_KEY`, `NOMI_AGENT_WALLET_PRIVATE_KEY`, `SAGE_AGENT_WALLET_PRIVATE_KEY`,
`AGENT_WALLET_PRIVATE_KEY`, `SOMNIA_NETWORK`,
`SOMNIA_RPC_URL`, `SOMNIA_INDEXER_URL`, and `SOMNIA_WS_RPC_URL`. Also `ERC8004_IDENTITY_REGISTRY_ADDRESS`
(see [contracts/doc/erc8004/ERC8004.md](../../contracts/doc/erc8004/ERC8004.md)) — required for
`register_erc8004_identity` to do anything.
