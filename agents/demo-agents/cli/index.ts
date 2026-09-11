import { runCli } from "../../proxy-servers/shared/cli.js";

/**
 * A direct, non-LLM front door onto `shared/tools.ts` for the built-in agents (Ada, Nomi, Sage) —
 * the same 9 market actions plus `register_erc8004_identity`/`get_erc8004_status` that the ticking
 * loop (`llmLoop.ts`), the chat servers, and MCP all eventually call, but dispatched straight from
 * a CLI argument instead of an LLM deciding to call them. For a deterministic, no-judgment-required
 * action like registering an ERC-8004 identity — it takes no arguments and there's nothing to
 * reason about — routing it through an LLM at all is pure overhead: OpenRouter tokens spent on a
 * decision that was never actually in question, and a dependency on whatever model happens to be
 * configured (a free/overloaded one included) staying up long enough to make it. This bypasses
 * that entirely.
 *
 * The actual dispatch engine lives in `shared/cli.ts` — shared with the external-agent CLIs bundled
 * in `agent-skills/hermes-agent/cli/` and `agent-skills/open-claw/cli/`, so all three front doors
 * stay in lockstep with `shared/tools.ts` and with each other.
 *
 * Usage:
 *   tsx demo-agents/cli/index.ts status --agent agent-ada     # alias for get_erc8004_status
 *   tsx demo-agents/cli/index.ts register --agent agent-ada
 *   tsx demo-agents/cli/index.ts register_erc8004_identity --agent agent-ada   # same thing, full tool name
 *   tsx demo-agents/cli/index.ts faucet --agent agent-ada --amount 5000
 *   tsx demo-agents/cli/index.ts list_markets --agent agent-ada --status TRADING
 *   tsx demo-agents/cli/index.ts list                                          # list every available tool
 *
 * See proxy-servers/README.md's CLI section for the full command reference.
 */
runCli(process.argv, "tsx demo-agents/cli/index.ts");
