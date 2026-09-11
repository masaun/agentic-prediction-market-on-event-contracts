# Agentic Prediction Market on top of Event Contracts (powered by DreamDEX) 

A Polymarket-style prediction market platform where **both sides of the market are AI agents**: one agent proposes
new binary (YES/NO) questions, other agents research and trade them — end to end, on top of
[DreamDEX Event Contracts](https://docs.dreamdex.io/developers/event-contracts) on [Somnia (Shannon) Testnet](https://docs.dreamdex.io/developers/http-api#base-urls).

On this agentic prediction market, only agent, who has registered in the ERC8004 IdentityRegistry contract and hold a Agent NFT, are allowed to buy the YES/NO shares. 

Also, when an agent buy a YES/NO shares on Event Contracts via this platform, the agent pays the
platform's 0.01% fee via [x402](#x402-agents-paying-for-their-own-buys).


NOTE: 
- Since the [DreamDEX Event Contracts](https://docs.dreamdex.io/developers/event-contracts) currently does not allow users (incl. Agent) to create a new event with a new topic on an event creator side, we currently only implement an event better/buyer side at this point.

- Since the ERC8004 contract has not been officially deployed by either Somnia team or DreamDEX team, we deployed the own ERC8004 IdentityRegistry contract by ourself. In the future, it should be replaced with the official ERC8004 contract to be deployed by either Somnia team or DreamDEX team.

- Currently, we experiment and show a demo using a Demo Agents. At the same time, we are on the way to implement the Agent Skills for external agents (e.g., Hermes Agent, OpenClaw). In the future, those external agents should be able to interact with this agentic prediction market.

- You can see [Installation](#installation) below for
the full walkthrough, including how to point it at real Somnia testnet markets instead.

## READMEs in this repo

This repo has 11 READMEs. Start here to find the right one; [Other READMEs](#other-readmes) and
[Agent Skills READMEs](#agent-skills-readmes) below have more detail per file (sub-sections, CLI
tables, etc.).

| README | Covers |
|---|---|
| [app/README.md](app/README.md) | The Next.js platform — frontend + backend, API routes, env vars specific to `app/` |
| [agents/proxy-servers/README.md](agents/proxy-servers/README.md) | The AI agents — LLM loop, MCP server, chat servers, wallets, CLI |
| [contracts/README.md](contracts/README.md) | `X402FeeVault.sol` and the `erc-8004/` registries — addresses, deployment, testnet collateral |
| [agents/agent-skills/hermes-agent/README.md](agents/agent-skills/hermes-agent/README.md) | Hermes Agent — Agent Skills overview, quick start, CLI summary |
| [agents/agent-skills/hermes-agent/bettor-agent/README.md](agents/agent-skills/hermes-agent/bettor-agent/README.md) | Hermes Agent — trading skill (bettor) |
| [agents/agent-skills/hermes-agent/creator-agent/README.md](agents/agent-skills/hermes-agent/creator-agent/README.md) | Hermes Agent — market-creation skill (creator) |
| [agents/agent-skills/hermes-agent/cli/README.md](agents/agent-skills/hermes-agent/cli/README.md) | Hermes Agent — non-LLM CLI, command ↔ prompt table |
| [agents/agent-skills/open-claw/README.md](agents/agent-skills/open-claw/README.md) | OpenClaw — Agent Skills overview, quick start, CLI summary |
| [agents/agent-skills/open-claw/bettor-agent/README.md](agents/agent-skills/open-claw/bettor-agent/README.md) | OpenClaw — trading skill (bettor) |
| [agents/agent-skills/open-claw/creator-agent/README.md](agents/agent-skills/open-claw/creator-agent/README.md) | OpenClaw — market-creation skill (creator) |
| [agents/agent-skills/open-claw/cli/README.md](agents/agent-skills/open-claw/cli/README.md) | OpenClaw — non-LLM CLI, command ↔ prompt table |

## Summary

| | |
|---|---|
| **What it is** | A prediction-market venue in the shape of Polymarket, populated entirely by autonomous agents |
| **Who creates markets** | Sage 🧭 (Demo Agent as a new event creator), an LLM agent that scans open markets and proposes new, unambiguous YES/NO questions with a genuine probability estimate |
| **Who trades** | Ada 📈 (Demo Agent as a bettor/trader, momentum) and Nomi 🦉 (Demo Agent as a bettor/trader, contrarian), LLM agents that read prices and place orders |
| **The market itself** | [DreamDEX Event Contracts](https://docs.dreamdex.io/developers/event-contracts) — Somnia's on-chain binary order-book markets (`@somnia-chain/markets-sdk`) — or a faithful in-memory mock of the same interface, so the whole thing runs with zero blockchain setup |
| **Agent runtime** | A built-in tool-use loop, reasoning via **OpenRouter** by default (any model, one key) or **Anthropic** directly; the same market actions are also exposed over MCP so you can drive them from **Hermes Agent** or **OpenClaw** instead |
| **The UI** | A live-updating (SSE) dashboard: browse markets, watch order books and trades, read every agent's reasoning trace |
| **Chat with the agents** | Each agent also exposes an OpenAI-compatible chat endpoint (`agents/proxy-servers/shared/chatServer.ts`), so you can talk to Sage, Ada, or Nomi directly from **[Open WebUI](https://github.com/open-webui/open-webui)** instead of only watching them tick |
| **Paying to buy shares** | Optional, per-agent: give an agent (built-in or external) its own wallet and every `BUY_YES`/`BUY_NO` pays a 0.01% platform fee via a real **x402** HTTP-402 challenge/response, locked in [`X402FeeVault.sol`](contracts/src/X402FeeVault.sol) — see [x402: agents paying for their own buys](#x402-agents-paying-for-their-own-buys) |
| **Agent identity** | Every agent — built-in or external — must mint an **ERC-8004** Agent-ID NFT ([`IdentityRegistry.sol`](contracts/src/erc-8004/IdentityRegistry.sol)) before it can buy shares at all: `X402FeeVault.payFee` reverts for any unregistered wallet. Register via the **Register** tab (human) or the `register_erc8004_identity` tool (autonomous agents) — see [Registering agent identity via ERC-8004](#registering-agent-identity-via-erc-8004) |

## URLs

| URL | What | Required? |
|---|---|---|
| `http://localhost:3000` | The app — markets, agents, live activity feed | Always — `npm run dev:app` |
| `http://localhost:3010` | Open WebUI — chat with Sage, Ada, or Nomi | Optional — `docker compose -f agents/proxy-servers/docker-compose.chat.yml up` |
| `http://localhost:4001` | Creator agent chat server (`sage-creator-agent`) | Optional — the backend Open WebUI talks to; `npm run demo:chat` |
| `http://localhost:4002` | Bettor agent chat server (`ada-bettor-agent`, `nomi-bettor-agent`) | Optional — the backend Open WebUI talks to; `npm run demo:chat` |

See [agents/proxy-servers/README.md#urls](agents/proxy-servers/README.md#urls) for the full per-route breakdown of the two
chat servers.

## Deployed Contract Addresses on Somnia Testnet

From [contracts/README.md#contracts-addresses-and-getting-testnet-collateral](contracts/README.md#contracts-addresses-and-getting-testnet-collateral)
— see that section for the full breakdown (collateral decimals, faucet instructions, x402-enabled-wallet
gotchas).

This repo's own deploys — ERC-8004 registries and `X402FeeVault` — not fixed across environments, so these
are only what this repo's own `npm run deploy:erc8004` / `npm run deploy:x402vault` runs have produced:

| Contract | Address (Somnia Testnet, chain 50312) |
|---|---|
| `IdentityRegistry` | [`0x37D4EF7C9F69769be1cb4E254d19692278a7cc17`](https://shannon-explorer.somnia.network/address/0x37D4EF7C9F69769be1cb4E254d19692278a7cc17) |
| `ReputationRegistry` | [`0x97Bf2828690A74ADe4e46C21205E5612e505acCb`](https://shannon-explorer.somnia.network/address/0x97Bf2828690A74ADe4e46C21205E5612e505acCb) |
| `ValidationRegistry` | [`0x1db9A66DFB0B553Fcb8348B2fccB717395e1eCD9`](https://shannon-explorer.somnia.network/address/0x1db9A66DFB0B553Fcb8348B2fccB717395e1eCD9) |
| `X402FeeVault` (re-deployed, ERC-8004-gated) | [`0x91aa603135011E65D35C74CE514779Ecb3F941A6`](https://shannon-explorer.somnia.network/address/0x91aa603135011E65D35C74CE514779Ecb3F941A6) |

DreamDEX Event Contracts — same address on testnet (50312) and mainnet (5031), deployed via CREATE3:

| Contract | Address |
|---|---|
| `BinaryMarketsModule` | `0x3ecC694Cef705358864a646142ac17A90E29e388` |
| `MarketsCore` | `0x2802504314685D89bF6C992CA5a8e7cC78bc0294` |
| `BinarySettlement` | `0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23` |
| `OutcomeToken6909` | `0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9` |
| `OracleHub` | `0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b` |
| `CollateralRouter` | `0xbC0C9834B15ACE38bB50dDaa7d7f7C7CC4DC183C` |

Collateral token (decimals differ from mainnet's — read them programmatically, don't hardcode):

| Network | Token | Address | Decimals |
|---|---|---|---|
| Testnet | tUSDC | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` | 6 |

## Architecture

```mermaid
flowchart LR
    subgraph agents["agents/proxy-servers — no chain code, no private keys, except the opt-in x402 buy path"]
        subgraph DemoAgents["Demo Agents"]
            Sage["Sage 🧭\n(Demo Agent as a\nnew event creator)"]
            Ada["Ada 📈\n(Demo Agent as a\nbettor/trader)"]
            Nomi["Nomi 🦉\n(Demo Agent as a\nbettor/trader)"]
        end
        Tools["shared/tools.ts\n11 market actions"]
        LLM["shared/llmLoop.ts\nLLM_PROVIDER switch\n+ runAgentTurn"]
        OpenRouter["OpenRouter API\n(default, any model)"]
        AnthropicAPI["Anthropic API\n(direct)"]
        MCPSrv["shared/mcpServer.ts\nMCP stdio server"]
        ChatSrv["shared/chatServer.ts\nOpenAI-compatible chat API\n:4001 sage · :4002 ada/nomi"]
        Wallet["shared/wallet.ts\nopt-in own wallet per agent\n(ADA_AGENT_WALLET_PRIVATE_KEY etc.)\n+ registerAgentIdentity()"]
        Sage --> Tools
        Ada --> Tools
        Nomi --> Tools
        Tools --> LLM
        LLM -- "LLM_PROVIDER=openrouter (default)" --> OpenRouter
        LLM -- "LLM_PROVIDER=anthropic" --> AnthropicAPI
        Tools -.exposed as.-> MCPSrv
        Sage -.exposed as.-> ChatSrv
        Ada -.exposed as.-> ChatSrv
        Nomi -.exposed as.-> ChatSrv
        ChatSrv -- "seeds a turn with the chat" --> LLM
        Tools -- "place_order BUY_YES/BUY_NO,\nif a wallet is configured" --> Wallet
        Tools -- "register_erc8004_identity" --> Wallet
    end

    subgraph external["bring your own agent runtime / chat UI"]
        Hermes["Hermes Agent"]
        OpenClaw["OpenClaw"]
        OpenWebUI["Open WebUI\n:3010"]
    end
    Hermes -. MCP .-> MCPSrv
    OpenClaw -. MCP .-> MCPSrv
    OpenWebUI -. "OpenAI API" .-> ChatSrv

    LLM -- "HTTP REST" --> API
    MCPSrv -- "HTTP REST" --> API

    subgraph app["app — Next.js platform"]
        API["/api/** route handlers"]
        Engine["getEngine(agentId)\n(src/lib/engine.ts)"]
        BuyAPI["/api/markets/:id/buy\nx402 verifier + ERC-8004 pre-check\n(src/lib/x402.ts, src/lib/erc8004.ts)"]
        RegisterAPI["/api/register-agent\n/api/agents/:id/erc8004\n(src/lib/erc8004.ts)"]
        Store["JSON store\nagent registry + activity log\n+ erc8004AgentId"]
        UI["React UI\nMarkets · Agents · Register · Faucet · live feed"]
        API -- "agentId picks the wallet\n(live mode only)" --> Engine
        API --> Store
        RegisterAPI --> Store
        UI -- "fetch + SSE" --> API
        UI -- "fetch" --> RegisterAPI
    end

    Wallet -- "0: register(), own wallet" --> Identity["IdentityRegistry.sol\nsee contracts/doc/erc8004/ERC8004.md"]
    Wallet -- "1: 402 challenge,\n3: verify txHash" --> BuyAPI
    Wallet -- "2: pay fee, own wallet,\nown tx" --> Vault["X402FeeVault.sol\ngated on IdentityRegistry,\nsee contracts/doc/x402/X402.md"]
    Vault -.-> Identity
    Wallet -- "4: placeOrder, same wallet,\ndirect via LiveEngine" --> Somnia
    RegisterAPI -- "register(), App-custodied wallet" --> Identity

    Engine -- "MARKET_ENGINE=mock" --> Mock["MockEngine\nin-memory venue\n(one shared instance)"]
    Engine -- "MARKET_ENGINE=live" --> Live["LiveEngine(s)\n@somnia-chain/markets-sdk\n1 instance per configured wallet —\nSOMNIA_PRIVATE_KEY (shared/default),\nSOMNIA_PRIVATE_KEY_ADA, _NOMI\n(SELL_*/mint_set/redeem/faucet only)"]
    Live -- "reads/writes" --> Somnia["DreamDEX Event Contracts\non Somnia testnet/mainnet"]
    Somnia -. "watchMarkets + subscribeLive\n(onEvent — trades, resolutions)" .-> Live
    Live -- "orders settle in\nERC20 collateral" --> Collateral["tUSDC (testnet) / USDso (mainnet)\nsee contracts/README.md"]
    Live -- "faucet (testnet only,\n10,000 tUSDC cap/call)" --> Collateral
    Vault -. "locks 0.01% of\nevery x402 buy" .-> Collateral

    style DemoAgents stroke-dasharray: 5 5
```

**Why agents never touch the chain directly — with one deliberate exception:** every agent — built-in or
external — calls the app's REST API for everything except *buying* shares. The app is the one process
holding wallet keys for those actions (`SOMNIA_PRIVATE_KEY` and, optionally, a dedicated key per agent —
see [Giving Ada and Nomi their own wallets](#giving-ada-and-nomi-their-own-wallets)) and the DreamDEX SDK.
That keeps agents/proxy-servers dependency-light for `SELL_*`/`mint_set`/`redeem`/`faucet`/`create_market`, and
means swapping `MARKET_ENGINE` between mock and live changes nothing about how agents behave for those.

`BUY_YES`/`BUY_NO` is the exception, and it's opt-in per agent: give one its own wallet private key (see
[x402: agents paying for their own buys](#x402-agents-paying-for-their-own-buys) below) and it pays the
platform's 0.01% fee and places its DreamDEX order **directly**, from a key `agents/proxy-servers` holds itself —
genuinely its own on-chain identity, not the app's. No wallet configured means unchanged behavior.

## Repository layout

```
agentic-prediction-market/
├── app/                    # Platform: Next.js frontend + backend (see app/README.md)
├── agents/
│   ├── proxy-servers/      # Routes internal + external agents' requests into the platform (app/api) — LLM loop + MCP server (see agents/proxy-servers/README.md)
│   ├── demo-agents/        # Built-in demo agents: creator (Sage) + bettors (Ada, Nomi), run against proxy-servers/shared
│   └── agent-skills/       # Agent Skills for external hosts (Hermes Agent, OpenClaw) — see agents/agent-skills/hermes-agent/README.md, agents/agent-skills/open-claw/README.md
├── contracts/              # X402FeeVault.sol + erc-8004/ registries — see contracts/README.md
└── packages/
    └── market-engine/      # Shared MarketEngine: MockEngine + LiveEngine (DreamDEX SDK wrapper)
```

### Other READMEs

| README | Covers |
|---|---|
| [app/README.md](app/README.md) | The Next.js platform — frontend + backend, API routes, env vars specific to `app/` |
| [agents/proxy-servers/README.md](agents/proxy-servers/README.md) | The AI agents — LLM loop, MCP server, chat servers, wallets |
| ↳ [§ CLI](agents/proxy-servers/README.md#cli) | Direct, non-LLM dispatch onto `shared/tools.ts` — `tsx agents/demo-agents/cli/index.ts <tool> --agent <id>`, no OpenRouter tokens spent |
| ↳ [§ CLI commands ↔ natural-language prompts](agents/proxy-servers/README.md#cli-commands--natural-language-prompts) | Every CLI command next to the example prompt that reaches the same tool via Open WebUI or MCP instead |
| [contracts/README.md](contracts/README.md) | `X402FeeVault.sol` and the `erc-8004/` registries — addresses, deployment, testnet collateral |

### Agent Skills READMEs

[Agent Skills](https://agentskills.io) (the open `SKILL.md` format) let external agent hosts —
[Hermes Agent](https://hermes-agent.nousresearch.com/) and [OpenClaw](https://openclaw.ai/) — drive
the same `dreamdex-event-contracts` MCP tool server the built-in Sage/Ada/Nomi agents use, as either
a **bettor** (trades existing markets) or a **creator** (proposes new ones). See [Drive the agents
from Hermes Agent or OpenClaw instead](#5-optional-drive-the-agents-from-hermes-agent-or-openclaw-instead)
above for the underlying MCP wiring these skills sit on top of. Each framework also gets a bundled,
**non-LLM CLI** (`agents/agent-skills/<framework>/cli/`) — the same token-free dispatch pattern as
[agents/proxy-servers' own CLI](agents/proxy-servers/README.md#cli), for wiring a messenger gateway (Telegram,
WhatsApp, etc.) or a fixed Open WebUI action straight to a tool call without spending a reasoning
turn on it.

| README | Framework | Role | Covers |
|---|---|---|---|
| [agents/agent-skills/hermes-agent/README.md](agents/agent-skills/hermes-agent/README.md) | Hermes Agent | — (overview) | Both skills, Hermes-specific config paths/tool-name prefix, quick start, CLI summary table |
| [agents/agent-skills/hermes-agent/bettor-agent/README.md](agents/agent-skills/hermes-agent/bettor-agent/README.md) | Hermes Agent | Bettor | Trading workflow, ERC-8004/x402 buy-gate diagram, tool reference + example prompts, setup |
| [agents/agent-skills/hermes-agent/creator-agent/README.md](agents/agent-skills/hermes-agent/creator-agent/README.md) | Hermes Agent | Creator | Market-creation workflow, what makes a good market, tool reference + example prompts, setup |
| [agents/agent-skills/hermes-agent/cli/README.md](agents/agent-skills/hermes-agent/cli/README.md) | Hermes Agent | CLI (both) | Full CLI-command ↔ natural-language-prompt table, wiring recipes, token-savings rationale |
| [agents/agent-skills/open-claw/README.md](agents/agent-skills/open-claw/README.md) | OpenClaw | — (overview) | Both skills, OpenClaw-specific config paths/tool-name prefix, quick start, CLI summary table |
| [agents/agent-skills/open-claw/bettor-agent/README.md](agents/agent-skills/open-claw/bettor-agent/README.md) | OpenClaw | Bettor | Trading workflow, ERC-8004/x402 buy-gate diagram, tool reference + example prompts, setup |
| [agents/agent-skills/open-claw/creator-agent/README.md](agents/agent-skills/open-claw/creator-agent/README.md) | OpenClaw | Creator | Market-creation workflow, what makes a good market, tool reference + example prompts, setup |
| [agents/agent-skills/open-claw/cli/README.md](agents/agent-skills/open-claw/cli/README.md) | OpenClaw | CLI (both) | Full CLI-command ↔ natural-language-prompt table, wiring recipes, token-savings rationale |


## Demo Video

- https://youtu.be/TSgZ8X3qqBY?si=JHVeJufaQj_oVgD1

## Installation

Requires Node ≥ 20.

### 1. Install

```sh
npm install
```

This is an npm-workspaces monorepo (`app`, `agents/proxy-servers`, `packages/market-engine`) — one install at the
root wires up all three.

### 2. Run the platform

```sh
cp app/.env.example app/.env   # MARKET_ENGINE=mock by default — no edits needed
npm run dev:app
```

Open [http://localhost:3000](http://localhost:3000). You'll see four seeded demo markets and an empty
agents page — the venue works standalone, it just has no traders yet.

### 3. Run the demo agents (with Open WebUI)

```sh
cp agents/proxy-servers/.env.example agents/proxy-servers/.env
# edit agents/proxy-servers/.env and set OPENROUTER_API_KEY (default provider — see below to use Claude directly instead)
```

Instead of only watching Sage/Ada/Nomi tick on their own schedule, you can talk to them directly. With
`npm run dev:app` already running from step 2, boot the rest across separate terminals:

```sh
npm run agent:chat:creator  # terminal 2 — Sage's chat server (:4001)
npm run agent:chat:bettor   # terminal 3 — Ada/Nomi's chat server (:4002)

# terminal 4, still from repo root — if you cd'd into agents/proxy-servers/ instead, drop the prefix:
# docker compose -f docker-compose.chat.yml up
docker compose -f agents/proxy-servers/docker-compose.chat.yml up
```

(`npm run demo:chat` also boots both chat servers together in one terminal, if you don't need the app or
Open WebUI running alongside them.)

Open [http://localhost:3010](http://localhost:3010) and pick `sage-creator-agent`, `ada-bettor-agent`, or `nomi-bettor-agent`
from Open WebUI's model dropdown. Each chat turn runs the exact same tool-use loop as the autonomous ticking
agents — same tools, same activity feed — just triggered by your message instead of a timer. See
[agents/proxy-servers/README.md](agents/proxy-servers/README.md#chat-ui-open-webui) for running the pieces individually or
pointing an existing Open WebUI instance at these agents without Docker.

#### Switching LLM providers

`agents/proxy-servers/shared/llmLoop.ts` picks its reasoning engine from `LLM_PROVIDER` in `agents/proxy-servers/.env`:

```sh
# agents/proxy-servers/.env

# Default — one OPENROUTER_API_KEY, any model in OpenRouter's catalog via OPENROUTER_MODEL
# (openrouter.ai/models), including Claude if you set OPENROUTER_MODEL=anthropic/claude-sonnet-4.5.
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-4o-mini

# Or call the Anthropic Messages API directly instead:
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=...
# AGENT_MODEL=claude-sonnet-5
```

Nothing else changes — both branches drive the exact same `shared/tools.ts` tool-use loop. See
[agents/proxy-servers/README.md](agents/proxy-servers/README.md#two-ways-to-reason) for details.

### 4. (Optional) Point it at real Somnia testnet markets

```sh
# app/.env
MARKET_ENGINE=live
SOMNIA_NETWORK=testnet
SOMNIA_PRIVATE_KEY=0x...   # a funded Shannon-testnet wallet; reads work without it

# Optional — only needed to point at something other than the standard testnet/mainnet
# endpoints (e.g. a local devnet). Leave both lines out entirely to use the defaults;
# see "SOMNIA_INDEXER_URL / SOMNIA_WS_RPC_URL" in app/README.md for the default URLs
# and why a *blank* line here is not the same as an absent one.
# SOMNIA_INDEXER_URL=
# SOMNIA_WS_RPC_URL=
```

"Funded" means holding some testnet tUSDC (Somnia testnet's collateral token) *and* some native testnet
SOMI/STT to pay gas — tUSDC alone isn't enough, since even the tUSDC faucet call is itself a signed
transaction. Get STT from the [official Somnia faucet](https://testnet.somnia.network/) (or one of the
alternates in [docs.somnia.network](https://docs.somnia.network) if that one's rate-limited) — this app has
no faucet for the gas token, only for tUSDC. For tUSDC: DreamDEX itself has no web faucet for it either —
it's an on-chain `faucet()` call capped at 10,000 tUSDC per call — but this app puts two front ends on it: a
person can open the **Faucet** tab (next to Markets/Agents in the nav) and pick which wallet to fund, and an
agent — built-in (Ada, Nomi) or external (Hermes Agent, OpenClaw) — can call the `faucet` tool/
`POST /api/faucet` directly, same as `place_order` or `mint_set`, and it funds *that agent's own* wallet
automatically. See
[Contracts, addresses, and getting testnet collateral](contracts/README.md#contracts-addresses-and-getting-testnet-collateral)
in `contracts/README.md` for the underlying call and the full contract-address table. Without a signer
configured, reads (`listMarkets`, `getOrderBook`, `getTrades`) still work — only `placeOrder`/`mintSet`/
`redeem`/`faucet` need one.

Everything else — the agents, the UI, the API — is unchanged. Two things differ from mock mode, both
inherent to how DreamDEX Event Contracts work, not limitations of this app:

- **Market creation is operator-gated on-chain.** DreamDEX markets are deployed through the
  `MarketCreatorAdmin` surface (`createMarketCreator` → `registerSeries` → `triggerRoll`), not a
  permissionless call any wallet can make. Sage's `create_market` tool throws a clear
  `NotSupportedInLiveModeError` in live mode — trade real existing markets, or stay in mock mode to see
  the full create → trade → resolve → redeem loop end to end.
- **DreamDEX attributes every fill to the address that signed it** — there's no permissionless per-agent
  wallet at the contract level, so "which agent traded" is only ever as granular as how many distinct keys
  this app is configured with. By default that's one (`SOMNIA_PRIVATE_KEY`, shared by everyone); see
  the next section for giving Ada and Nomi their own.

#### Giving Ada and Nomi their own wallets

By default every agent — Sage, Ada, Nomi, or an external MCP agent — signs with the one shared
`SOMNIA_PRIVATE_KEY` wallet, same as before this existed: fine for a demo, but it means Ada's and Nomi's
fills land on the same on-chain account and are only told apart by the app's own activity log
(`createdBy`/`agentId` tags), not by the chain itself.

To give Ada and Nomi genuinely separate on-chain wallets, set two more keys in `app/.env`:

```sh
# app/.env — optional, on top of the block above
ADA_AGENT_WALLET_PRIVATE_KEY=0x...    # Ada's own funded Shannon-testnet wallet
NOMI_AGENT_WALLET_PRIVATE_KEY=0x...   # Nomi's own funded Shannon-testnet wallet
```

`app/src/lib/engine.ts`'s `getEngine(agentId)` looks the agent's id (`agent-ada` / `agent-nomi`) up in an
`AGENT_WALLET_ENV` map, builds (and caches) a separate `LiveEngine` — separate `@somnia-chain/markets-sdk`
signer, separate on-chain account — for whichever key it finds, and falls back to the shared
`SOMNIA_PRIVATE_KEY` for any agentId not in the map (Sage, an external MCP agent, or either var left unset).
Every write route that takes an `agentId` (`place_order`, `mint_set`, `redeem`, `faucet`) and the positions
read (`GET /api/agents/:id/positions`) already resolve their engine this way — Ada's trades fill from her
own wallet and her own positions come back from her own on-chain balance, genuinely distinct from Nomi's.

The mechanism generalizes past exactly these two: add another `<AGENT_ID>: "SOMNIA_PRIVATE_KEY_<NAME>"`
entry to `AGENT_WALLET_ENV` for any other agent (built-in or external) you want its own wallet for.

Each dedicated wallet needs both testnet SOMI/STT (gas) and tUSDC before it can do anything, same as the
shared wallet — fund it either from the **Faucet** tab's "Fund wallet for" selector (tUSDC only; get STT
from [testnet.somnia.network](https://testnet.somnia.network/) first) or by having the agent call its own
`faucet` tool once it already has enough STT to pay for that call.

#### Registering agent identity via ERC-8004

Before an agent can buy shares at all, it needs an **ERC-8004** Agent-ID NFT — minted by
[`IdentityRegistry.sol`](contracts/src/erc-8004/IdentityRegistry.sol). `X402FeeVault.payFee`
(below) reverts for any wallet that doesn't hold one, so this is a hard precondition, not an
optional nicety. Full design: **[contracts/doc/erc8004/ERC8004.md](contracts/doc/erc8004/ERC8004.md)**.

Three ways to register:

- **A person**, via the **Register** tab (`app/src/app/register-agent/page.tsx`) →
  `POST /api/register-agent`, picking which agent to register. Signs from that agent's
  App-custodied wallet (`app/.env`'s `ADA_AGENT_WALLET_PRIVATE_KEY`/`_NOMI`/shared), same
  key-resolution as the Faucet tab.
- **An agent** — built-in (Ada, Nomi) or external via MCP (Hermes Agent, OpenClaw) — via the
  `register_erc8004_identity` tool (`agents/proxy-servers/shared/tools.ts` →
  `agents/proxy-servers/shared/wallet.ts`'s `registerAgentIdentity`), signed from that agent's own wallet
  (`agents/proxy-servers/.env`'s `ADA_AGENT_WALLET_PRIVATE_KEY` etc. — same variable name as the App-custodied
  one above, but a separate file and independent value) — the same wallet it'll pay x402 fees from
  below. Reached either via natural language (see [Example prompts](#example-prompts-natural-language)
  below) or directly, with no LLM involved at all, via the **[CLI](agents/proxy-servers/README.md#cli)**:
  `tsx agents/demo-agents/cli/index.ts register --agent agent-ada` (from `agents/proxy-servers/`) — the same on-chain
  transaction either way, just without spending LLM tokens or depending on whatever model is
  configured staying up.

**API endpoints** (full detail in [contracts/doc/erc8004/ERC8004.md](contracts/doc/erc8004/ERC8004.md#api-endpoints)):

| Layer | Method | Path / tool | Purpose |
|---|---|---|---|
| agents/proxy-servers | tool / MCP | `register_erc8004_identity` | Autonomous agent signs `register()` itself, then reports the result to the app |
| agents/proxy-servers | CLI | `tsx agents/demo-agents/cli/index.ts register --agent <id>` | Same tool as above, dispatched directly — no LLM, no OpenRouter tokens spent. See [CLI](agents/proxy-servers/README.md#cli) |
| app | `POST` | `/api/register-agent` | Human-UI path — app signs `register()` from the picked agent's App-custodied wallet |
| app | `POST` | `/api/agents/:id/erc8004` | Records a completed registration (`erc8004AgentId`, `txHash`) onto the agent's record |
| app | `GET` | `/api/agents/:id/erc8004` | Live on-chain registration status, self-healing the store if a registration happened outside these paths — used by the Register tab and the Agents page's registration-status table |
| app | `POST` | `/api/markets/:id/buy` | Existing x402 buy route — now pre-checks ERC-8004 registration before quoting a fee |

For the agent path above, registering is just telling the agent to do it in plain English — see
[Example prompts (natural language)](#example-prompts-natural-language) right below.

**Whichever wallet you register must be the same one that pays x402 fees**, or the buy-gate still
fails even though *some* wallet for that agentId is registered. The simplest way to guarantee that
is the same trick `contracts/README.md`'s x402 "gotcha" already recommends for a different reason:
set `app/.env`'s App-custodied `ADA_AGENT_WALLET_PRIVATE_KEY` and `agents/proxy-servers/.env`'s
identically-named x402 wallet var to the same value, so one wallet is registered, fee-paying, and
trading all at once.

Requires `ERC8004_IDENTITY_REGISTRY_ADDRESS` set in both `app/.env` and
`agents/proxy-servers/.env` (deploy via `npm run deploy:erc8004`, see `contracts/README.md`) — unset makes
registration attempts respond `501` rather than silently no-opping.

Why all three ERC-8004 registries got built even though only Identity Registry does anything here,
why the buy-gate lives on-chain in `X402FeeVault` rather than only in the app, and why the Agent ID
above is additive rather than replacing every existing `agentId`/URL/store key: see
[contracts/doc/erc8004/ERC8004.md's trade-off comparison](contracts/doc/erc8004/ERC8004.md#trade-off-comparison).

#### Example prompts (natural language)

No tool name or special syntax required for any of this — an agent's own LLM picks
`register_erc8004_identity` on its own from a plain-English ask (it takes no arguments), the same
way it picks any of the other ten tools in `shared/tools.ts`:

| Front door | Example prompt | Tool invoked |
|---|---|---|
| Open WebUI — `ada-bettor-agent` / `nomi-bettor-agent` / `sage-creator-agent` (built-in agents' chat servers) | "Register yourself in the ERC-8004 Identity Registry." | `register_erc8004_identity` |
| Hermes Agent / OpenClaw's own chat/reasoning interface (external agents, via MCP — not Open WebUI, which only fronts the built-in agents' chat servers) | "Register your agent identity with the DreamDEX ERC-8004 Identity Registry on Somnia testnet." | `register_erc8004_identity` |

The agent replies with the minted Agent-ID and tx hash once the transaction lands — requires
`ERC8004_IDENTITY_REGISTRY_ADDRESS` set in `agents/proxy-servers/.env` and that agent's wallet
(`ADA_AGENT_WALLET_PRIVATE_KEY`/`NOMI_AGENT_WALLET_PRIVATE_KEY`/`AGENT_WALLET_PRIVATE_KEY`) funded with testnet
STT for gas. Full walkthroughs: [Chat UI (Open WebUI) - How to Prompt in Natural
Language](agents/proxy-servers/README.md#chat-ui-open-webui---how-to-prompt-in-natural-language) and
[External agent hosts via MCP](agents/proxy-servers/README.md#external-agent-hosts-via-mcp-hermes-agent--openclaw)
in `agents/proxy-servers/README.md`.

Every other tool has the same two front doors too — natural language (LLM picks the tool) or the
[CLI](agents/proxy-servers/README.md#cli) (no LLM, no tokens spent) — see
[CLI commands ↔ natural-language prompts](agents/proxy-servers/README.md#cli-commands--natural-language-prompts)
in `agents/proxy-servers/README.md` for the full command-by-command table.

#### x402: agents paying for their own buys

This is a **different, separate wallet mechanism** from the one above — easy to conflate since both are
about "giving Ada/Nomi their own key," and both now use the *same variable names*
(`ADA_AGENT_WALLET_PRIVATE_KEY`/`NOMI_AGENT_WALLET_PRIVATE_KEY`/`SAGE_AGENT_WALLET_PRIVATE_KEY`) after a
naming unification pass — but they're still two entirely independent env vars, each read only from its own
package's `.env`, each holding whatever value *you* put there. Setting one does nothing to the other; they
happen to agree only if you deliberately set both to the same key (recommended — see the "gotcha" linked
below):

| | Giving Ada/Nomi their own wallet (above) | x402 buying (this section) |
|---|---|---|
| Covers | `mint_set`, `SELL_*`, `redeem`, `faucet` | `BUY_YES`, `BUY_NO` only |
| Variable name | `ADA_AGENT_WALLET_PRIVATE_KEY` / `NOMI_AGENT_WALLET_PRIVATE_KEY` / `SAGE_AGENT_WALLET_PRIVATE_KEY` | Same three names — but read from a different file entirely |
| Key lives in | `app/.env` | `agents/proxy-servers/.env` |
| Who signs | The app, on the agent's behalf | The agent's own process, itself |
| Default if unset | Falls back to the shared `SOMNIA_PRIVATE_KEY` | Falls back to the app placing the order instead (same as before this existed) |

Buying YES/NO shares goes through a real **x402** HTTP-402 challenge/response, and skims a **0.01%
platform fee** into [`X402FeeVault.sol`](contracts/src/X402FeeVault.sol), locked on Somnia testnet. Full
design, the research behind it (including whether DreamDEX itself could accept x402 payments — it can't,
and can't be made to), and diagrams: **[contracts/doc/x402/X402.md](contracts/doc/x402/X402.md)**.

Quick version: give an agent its own wallet (`ADA_AGENT_WALLET_PRIVATE_KEY`/`NOMI_AGENT_WALLET_PRIVATE_KEY`/
`AGENT_WALLET_PRIVATE_KEY` in `agents/proxy-servers/.env`, funded with testnet STT + tUSDC — see the "gotcha" in
[contracts/README.md](contracts/README.md#contracts-addresses-and-getting-testnet-collateral), since this
is a different address from the one above unless you deliberately reuse the same key) and, from then on,
every `BUY_YES`/`BUY_NO` that agent places: gets a `402` quoting the fee, pays it on-chain from that wallet,
gets the app to verify the payment, then places the DreamDEX order **directly from that same wallet** —
bypassing the app for the trade itself. Deploy the vault first (`npm run deploy:x402vault`, see
`contracts/README.md`) and set `X402_FEE_VAULT_ADDRESS` in `app/.env`, or a configured buy attempt
fails with a clear "vault not configured" error rather than silently skipping the fee.

**New precondition:** that same wallet must also be [registered via ERC-8004](#registering-agent-identity-via-erc-8004)
first — `payFee` now reverts with `NotRegisteredAgent` for any wallet that isn't, so an agent that
skips registration gets a failed transaction on its very first buy attempt instead of a normal fill.

#### What each mode actually gets you

`MARKET_ENGINE` is one app-wide switch (`app/src/lib/engine.ts:35-41`) — every agent talks to the same
running app over HTTP, so there's no way to have, say, Sage create on mock while Ada/Nomi trade live in
the same run. Splitting them (two app instances, or a hybrid engine) wouldn't actually connect the two
halves either: a mock-created market was never deployed on-chain, so a live `place_order` can never fill
against it — Ada/Nomi would just keep trading whatever's already really listed on DreamDEX, never anything
Sage proposed. In short:

| | Sage creates | Ada/Nomi trade |
|---|---|---|
| `MARKET_ENGINE=mock` | ✅ full create → trade → resolve → redeem loop, all synthetic | mock only |
| `MARKET_ENGINE=live` (Somnia testnet/mainnet, real DreamDEX Event Contracts) | ❌ always throws `NotSupportedInLiveModeError` (by design — operator-gated on-chain); Sage just reports "nothing to create" each turn | ✅ real trades against DreamDEX's already-listed Somnia markets |
| Sage on mock + Ada/Nomi on live (two instances or a hybrid engine — not built) | ✅ mock market exists | ✅ real trades — but never on Sage's mock market, only on markets DreamDEX already lists |

The only way Ada/Nomi genuinely trade something Sage proposed is full mock mode. The only way to get real
on-chain trades is accepting that Sage can't create anything for that run.

The homepage's live feed (SSE, `/api/events`) works the same way in both modes: `LiveEngine.onEvent`
diffs `listMarkets`/`getTrades` snapshots against a locally-tracked baseline, re-run every time
`client.subscribeLive` reports the on-chain live store changed — so market creations, trades (with real
tx hashes), and resolutions you see there in live mode are genuinely from Somnia, not synthesized. Every
`txHash` that comes back from a fill, mint, or redeem renders in the UI as a short link to the Somnia
block explorer (Shannon testnet or mainnet, whichever `SOMNIA_NETWORK` is set to) — see
[Tx hash → block explorer links](app/README.md#tx-hash--block-explorer-links) in `app/README.md`.

### Where does data actually live, in live mode?

| | Live mode | Mock mode |
|---|---|---|
| Orders, fills/trades, positions, redemptions | **On-chain** — real Somnia testnet/mainnet transactions, real tx hashes, linked to the block explorer in the UI | In-memory, `packages/market-engine/src/mockEngine.ts` — no tx hash, no explorer link |
| Market creation (Sage's proposals) | **Not possible live** (operator-gated, see above) — Sage can only propose against the mock venue | In-memory |
| Agent registration + reasoning/activity narration | **Always local** — `app/data/store.json` (see `app/src/lib/store.ts`), regardless of `MARKET_ENGINE` | Same |

Trades are the one thing worth putting on-chain here: they're what DreamDEX itself settles, so they're
already real transactions the moment `MARKET_ENGINE=live` is set. Agent identity and the free-text
reasoning trace stay in the local JSON store either way — see [contracts/README.md](contracts/README.md)
for why we didn't build a separate contract to move that on-chain too.

### 5. (Optional) Drive the agents from Hermes Agent or OpenClaw instead

`agents/proxy-servers/shared/mcpServer.ts` exposes the same 11 tools (`list_markets`, `get_market`,
`get_order_book`, `create_market`, `place_order`, `mint_set`, `get_positions`, `redeem`, `faucet`,
`register_erc8004_identity`, `get_erc8004_status`) as an MCP stdio server. Point either framework's MCP
config at it instead of running `shared/llmLoop.ts`:

```sh
AGENT_ID=my-agent npm run agent:mcp   # from repo root — optional, just to confirm it boots
```

This doesn't run automatically alongside `npm run dev:app`, and it shouldn't: it's an MCP **stdio** server,
which only does something useful when Hermes/OpenClaw itself spawns it (per their own config, pointing at
`agents/proxy-servers/shared/mcpServer.ts`) — not something this app pre-launches for them. The one real
dependency is that `dev:app` needs to already be running before Hermes/OpenClaw starts, since the spawned
process's tool calls go out over HTTP to `APM_API_URL`.

See [External agent hosts via MCP](agents/proxy-servers/README.md#external-agent-hosts-via-mcp-hermes-agent--openclaw)
in `agents/proxy-servers/README.md` for the full step-by-step procedure, and
`agents/proxy-servers/openclaw.config.example.jsonc` / `agents/proxy-servers/hermes.config.example.yaml` for the config
block each framework uses to register it.

| # | Step | Command / Action | Notes |
|---|---|---|---|
| 1 | Start the app | `npm run dev:app` | Must be running first — MCP tool calls hit `APM_API_URL` |
| 2 | Start the MCP server (optional standalone check) | `AGENT_ID=my-agent npm run agent:mcp` | Only to confirm it boots — the host framework spawns its own copy in step 4 |
| 3 | Register it with the host framework | Hermes: `~/.hermes/config.yaml` under `mcp_servers`; OpenClaw: `~/.openclaw/config.json` under `mcp.servers` | Point `command`/`args` at `agents/proxy-servers/shared/mcpServer.ts`, set `env.AGENT_ID` to a distinct identity |
| 4 | Start/restart the host framework | normal startup for that framework | It drives the same 11 tools its own reasoning loop dispatches, in place of `shared/llmLoop.ts` |
| 5 | Verify | tool calls show up on `/agents/:id` in the app | Confirms trades/positions attribute to the `AGENT_ID` you set |

## Environment variables

| Variable | Where | Default | Description |
|---|---|---|---|
| `MARKET_ENGINE` | app | `mock` | `mock` — self-contained in-memory venue. `live` — real DreamDEX Event Contracts on Somnia via `@somnia-chain/markets-sdk`. |
| `SOMNIA_NETWORK` | app | `testnet` | `testnet` (Shannon, chain 50312) or `mainnet` (chain 5031). Only read when `MARKET_ENGINE=live`. |
| `SOMNIA_INDEXER_URL` | app | SDK default for `SOMNIA_NETWORK` | Override the DreamDEX/Somnia Markets indexer GraphQL endpoint. Only read when `MARKET_ENGINE=live`. |
| `SOMNIA_WS_RPC_URL` | app | SDK default for `SOMNIA_NETWORK` | Override the chain WebSocket RPC endpoint. Only read when `MARKET_ENGINE=live`. |
| `SOMNIA_PRIVATE_KEY` | app | *(unset)* | Shared/default wallet — used by Sage, external MCP agents, and any bettor without a dedicated key below. Reads work without it; `place_order`/`mint_set`/`redeem`/`faucet` throw without it. Only read when `MARKET_ENGINE=live`. **Keep this out of version control.** |
| `ADA_AGENT_WALLET_PRIVATE_KEY` | app | *(unset)* | Ada's own wallet — see [Giving Ada and Nomi their own wallets](#giving-ada-and-nomi-their-own-wallets). Falls back to `SOMNIA_PRIVATE_KEY` if unset. Only read when `MARKET_ENGINE=live`. Same variable name as the agents/proxy-servers row further down, but a separate file and independent value — see [x402: agents paying for their own buys](#x402-agents-paying-for-their-own-buys). **Keep this out of version control.** |
| `NOMI_AGENT_WALLET_PRIVATE_KEY` | app | *(unset)* | Nomi's own wallet — same fallback and rules as `ADA_AGENT_WALLET_PRIVATE_KEY` (app) above. |
| `SAGE_AGENT_WALLET_PRIVATE_KEY` | app | *(unset)* | Sage's own wallet, for `POST /api/register-agent` to sign her ERC-8004 registration from a wallet genuinely her own rather than the shared fallback. Has no effect on trading — Sage never buys shares. |
| `APM_AGENT_API_KEY` | app **and** agents/proxy-servers | *(unset)* | Optional shared secret. If set on the app, every agent-facing write route requires it in the `x-apm-agent-key` header — set the same value in agents/proxy-servers' `.env`. Leave unset for a zero-config local demo. |
| `APM_API_URL` | agents/proxy-servers | `http://localhost:3000` | Base URL of the running app. The only address agents/proxy-servers talks to for everything except the x402 buy flow's direct DreamDEX call (see below). |
| `X402_FEE_VAULT_ADDRESS` | app | *(unset)* | Deployed `X402FeeVault.sol` address (`npm run deploy:x402vault`). Only needed if some agent has its own wallet (below); unset makes `POST /api/markets/:id/buy` respond `501` instead of silently skipping the fee. See [contracts/doc/x402/X402.md](contracts/doc/x402/X402.md). |
| `ERC8004_IDENTITY_REGISTRY_ADDRESS` | app **and** agents/proxy-servers | *(unset)* | Deployed `IdentityRegistry.sol` address (`npm run deploy:erc8004`). Required for the **Register** tab, `POST /api/register-agent`, `GET /api/agents/:id/erc8004`, the buy route's pre-flight check, and agents/proxy-servers' `register_erc8004_identity` tool. Unset makes those `501` rather than silently skipping the check — `X402FeeVault.payFee` (once re-deployed with this registry wired in) still gates on it regardless. See [contracts/doc/erc8004/ERC8004.md](contracts/doc/erc8004/ERC8004.md). |
| `SOMNIA_RPC_URL` | app **and** agents/proxy-servers | public Somnia RPC for `SOMNIA_NETWORK` | Override the plain JSON-RPC HTTP endpoint used to verify (app) and pay (agents/proxy-servers) x402 fee transactions. Distinct from `SOMNIA_WS_RPC_URL` below, which is WebSocket-only and used for a different purpose (`LiveEngine`'s live subscriptions). |
| `ADA_AGENT_WALLET_PRIVATE_KEY` | agents/proxy-servers | *(unset)* | Ada's own wallet for buying shares — **not** the same mechanism as the app's copy of this same variable name, further up this table, see [x402: agents paying for their own buys](#x402-agents-paying-for-their-own-buys). Unset means `place_order` falls back to the app placing the order, unchanged. |
| `NOMI_AGENT_WALLET_PRIVATE_KEY` | agents/proxy-servers | *(unset)* | Nomi's own wallet — same as above. |
| `SAGE_AGENT_WALLET_PRIVATE_KEY` | agents/proxy-servers | *(unset)* | Sage's own wallet — only relevant to `register_erc8004_identity` (her `place_order` calls are excluded from `CREATOR_TOOLS`, so this has no effect on trading). |
| `AGENT_WALLET_PRIVATE_KEY` | agents/proxy-servers | *(unset)* | Fallback wallet for any agent not covered by a dedicated var above — used by external MCP agents (Hermes Agent, OpenClaw). Ada/Nomi never fall back to this. |
| `LLM_PROVIDER` | agents/proxy-servers | `openrouter` | Which LLM engine `shared/llmLoop.ts` reasons with: `openrouter` (default) or `anthropic`. Not read at all if you're driving the tools from Hermes Agent / OpenClaw via `shared/mcpServer.ts` instead. |
| `OPENROUTER_API_KEY` | agents/proxy-servers | *(unset)* | Required when `LLM_PROVIDER=openrouter`. Get one at [openrouter.ai/keys](https://openrouter.ai/keys). |
| `OPENROUTER_MODEL` | agents/proxy-servers | `openai/gpt-4o-mini` | Model slug OpenRouter routes to — any id from [openrouter.ai/models](https://openrouter.ai/models), including Anthropic's (`anthropic/claude-sonnet-4.5`). Only read when `LLM_PROVIDER=openrouter`. |
| `ANTHROPIC_API_KEY` | agents/proxy-servers | *(unset)* | Required when `LLM_PROVIDER=anthropic`. |
| `AGENT_MODEL` | agents/proxy-servers | `claude-sonnet-5` | Anthropic model id used for agent reasoning. Only read when `LLM_PROVIDER=anthropic`. |
| `AGENT_INTERVAL_MS` | agents/proxy-servers | `30000` (`45000` for the creator) | How often each agent wakes up and takes a turn, in milliseconds. |
| `AGENT_PERSONA` | agents/proxy-servers (agents/demo-agents/bettor-agent only) | `ada` | Which bettor persona to run: `ada` (momentum) or `nomi` (contrarian). |
| `AGENT_ID` | agents/proxy-servers (`shared/mcpServer.ts` only) | *(required)* | The agent identity MCP tool calls report activity/positions under, when driving these tools from an external agent host. |
| `CREATOR_CHAT_PORT` | agents/proxy-servers (`agents/demo-agents/creator-agent/chatServer.ts`) | `4001` | Port for Sage's OpenAI-compatible chat endpoint, for a chat UI like Open WebUI. |
| `BETTOR_CHAT_PORT` | agents/proxy-servers (`agents/demo-agents/bettor-agent/chatServer.ts`) | `4002` | Port for the bettors' OpenAI-compatible chat endpoint (serves both `ada-bettor-agent` and `nomi-bettor-agent` as models). |
| `AGENT_CHAT_API_KEY` | agents/proxy-servers (`shared/chatServer.ts`) | *(unset)* | Optional bearer token the chat servers require in `Authorization: Bearer <key>` — set the same value as the connection's API key in Open WebUI. |

Each package also ships its own `.env.example` (`app/.env.example`, `agents/proxy-servers/.env.example`) with the
same variables and inline comments.

## Notes on the demo venue (mock mode)

`packages/market-engine/src/mockEngine.ts` is a small, honest simulation, not a matching engine:

- Prices move on a simple price-impact model (a fill nudges the mid-price proportionally to size vs.
  liquidity) — there's no real resting order book, so `get_order_book` synthesizes plausible depth around
  the current price for display.
- Status is **derived from wall-clock time** on every read (`TRADING` → `LOCKED` after expiry → settles
  ~45s later), the same way DreamDEX's on-chain markets work — see the SDK's own gotcha: "status
  transitions are time-derived on-chain, read the market's live status before every write."
- A market with zero trading volume at settlement **voids** (both sides redeem at half); otherwise it
  resolves YES/NO with a probability weighted by its final price — mirroring DreamDEX's real Resolved/Voided
  outcomes without needing an actual oracle.

Swapping to `MARKET_ENGINE=live` replaces this with real reads/writes against Somnia via
`@somnia-chain/markets-sdk`'s unified (ccxt-style) exchange API — see `packages/market-engine/src/liveEngine.ts`.
