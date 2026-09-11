import { runCli } from "../../../proxy-servers/shared/cli.js";

/**
 * A direct, non-LLM front door onto the Agentic Prediction Market's 11 market-action tools
 * (`proxy-servers/shared/tools.ts`), bundled for OpenClaw so it can dispatch a deterministic action
 * — checking the order book, placing a trade, registering an ERC-8004 identity — without spending a
 * single model token deciding to call it. OpenClaw's own `command-dispatch: tool` skill frontmatter
 * field routes a recognized slash command straight to a tool instead of through the model — wire
 * that (or a messenger-gateway integration in front of OpenClaw — Telegram, WhatsApp, etc. — that
 * already recognizes a fixed set of phrasings) at this script directly instead of routing the
 * request through OpenClaw's full reasoning loop over the `dreamdex-event-contracts` MCP server;
 * fall back to that MCP path (see ../bettor-agent/SKILL.md / ../creator-agent/SKILL.md) for
 * anything more open-ended than these fixed commands cover.
 *
 * Same dispatch engine as `demo-agents/cli/index.ts` (see `proxy-servers/shared/cli.ts`) — same
 * commands, same `--agent <agentId>` convention, same activity-feed reporting — just invoked with
 * this file's own path so usage/error messages point back here.
 *
 * Usage:
 *   tsx agents/agent-skills/open-claw/cli/index.ts register --agent openclaw-bettor
 *   tsx agents/agent-skills/open-claw/cli/index.ts faucet --agent openclaw-bettor --amount 5000
 *   tsx agents/agent-skills/open-claw/cli/index.ts list_markets --agent openclaw-bettor --status TRADING
 *   tsx agents/agent-skills/open-claw/cli/index.ts place_order --agent openclaw-bettor \
 *     --marketId mkt-1 --side BUY_YES --price 0.62 --quantity 5
 *   tsx agents/agent-skills/open-claw/cli/index.ts list   # every tool + its natural-language equivalent
 *
 * See README.md (this folder) for the full CLI-command ↔ natural-language-prompt table, and
 * ../README.md for how this fits alongside the bettor-agent/creator-agent skills.
 */
runCli(process.argv, "tsx agents/agent-skills/open-claw/cli/index.ts");
