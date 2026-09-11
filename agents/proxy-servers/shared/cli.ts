import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ALL_TOOLS, type ToolSpec } from "./tools.js";
import { reportActivity } from "./apiClient.js";
import { explorerTxUrl } from "./receipt.js";

/**
 * The direct, non-LLM CLI engine shared by every front door that dispatches straight onto
 * `shared/tools.ts` instead of going through an LLM tool-use loop: the internal `demo-agents/cli/`
 * (Ada/Nomi/Sage) and the external-agent CLIs bundled with the Hermes Agent / OpenClaw skills
 * (`agent-skills/hermes-agent/cli/`, `agent-skills/open-claw/cli/`). One `runCli()` call, one
 * `--agent <agentId>` convention, one `NATURAL_LANGUAGE_EXAMPLES` mapping — so the three entrypoints
 * can never drift out of sync with each other or with `shared/tools.ts` itself.
 *
 * Loads `proxy-servers/.env` by absolute path (relative to this file), not the process's current
 * working directory — so it resolves the same whether the caller runs from `proxy-servers/`, the
 * repo root, or gets spawned by an external framework (Hermes, OpenClaw) from wherever *its* own
 * cwd happens to be.
 */
loadDotenv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

export const ALIASES: Record<string, string> = {
  register: "register_erc8004_identity",
  status: "get_erc8004_status",
};

const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));

/**
 * Every CLI command's natural-language equivalent — the exact same tool, reached instead through an
 * LLM chat turn (Open WebUI's `ada-bettor-agent`/`nomi-bettor-agent`/`sage-creator-agent`, or an external agent host —
 * Hermes Agent, OpenClaw — via MCP) picking it from a plain-English ask, per `shared/tools.ts`'s
 * tool descriptions. The two paths are interchangeable: whichever one an agent takes, the same
 * `tool.run()` call happens and the same activity entry gets reported. Kept here (not just in
 * READMEs) so every `list` command can print both side by side — this *is* the reference for what
 * these prompts should resolve to.
 */
export const NATURAL_LANGUAGE_EXAMPLES: Record<string, string> = {
  list_markets: "What markets are currently open for trading?",
  get_market: "Give me the full details on market mkt-1, including its current price.",
  get_order_book: "What does the order book look like for market mkt-1?",
  create_market: "Propose a new market asking whether ETH closes above $5,000 by the end of the month.",
  place_order: "Buy 5 YES shares on market mkt-1 at 62 cents.",
  mint_set: "Mint 10 complete YES/NO share sets on market mkt-1.",
  get_positions: "What positions do I currently hold?",
  redeem: "Redeem my YES shares on market mkt-1.",
  faucet: "Send me 5,000 tUSDC from the testnet faucet.",
  get_erc8004_status: "Have you already registered your agent identity with the DreamDEX ERC-8004 Identity Registry?",
  register_erc8004_identity: "Register your agent identity with the DreamDEX ERC-8004 Identity Registry on Somnia testnet.",
};

function printUsageAndExit(programName: string, code: number): never {
  console.log(
    [
      `Usage: ${programName} <command> --agent <agentId> [--<key> <value> ...]`,
      "",
      "Commands:",
      "  register --agent <agentId>            Alias for register_erc8004_identity — no other args needed.",
      "  <tool-name> --agent <agentId> [flags]  Run any tool from shared/tools.ts directly, no LLM involved.",
      "  list                                    List every available tool, its description, and the",
      "                                          natural-language prompt that reaches the same tool via",
      "                                          Open WebUI or an external MCP host, with no CLI needed.",
      "",
      "Examples:",
      `  ${programName} status --agent agent-ada     # alias for get_erc8004_status — check before registering`,
      `  ${programName} register --agent agent-ada`,
      `  ${programName} faucet --agent agent-ada --amount 5000`,
      `  ${programName} list_markets --agent agent-ada --status TRADING`,
      "",
      "Flag values are JSON-parsed when possible (so --amount 5000 becomes a number, --status TRADING",
      "stays a string) — see proxy-servers/README.md's CLI section for the full reference.",
    ].join("\n"),
  );
  process.exit(code);
}

function coerce(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // Plain strings (market ids, agent ids, enum values) aren't valid JSON literals.
  }
}

/** Pretty-printers for a few tools whose raw JSON output is worth summarizing — everything else
 * just gets indented JSON, which is already reasonably readable. */
const SUMMARIZERS: Partial<Record<string, (output: any) => string>> = {
  register_erc8004_identity: (output) =>
    [
      `Registered — Agent-ID #${output.erc8004AgentId}`,
      `Tx: ${explorerTxUrl(output.txHash)}`,
      `Agent URI: ${output.agentURI}`,
    ].join("\n"),
  get_erc8004_status: (output) =>
    output.registered
      ? `Registered — Agent-ID #${output.erc8004AgentId} (wallet ${output.walletAddress})`
      : `Not registered${output.walletAddress ? ` — wallet ${output.walletAddress} would sign it` : ""}`,
  faucet: (output) => `Minted ${output.amount} tUSDC${output.txHash ? `\nTx: ${explorerTxUrl(output.txHash)}` : ""}`,
  place_order: (output) => output.receipt ?? JSON.stringify(output, null, 2),
};

/**
 * Parses argv, dispatches straight to `shared/tools.ts`, and reports the result to the app's
 * activity feed in the exact shape `shared/llmLoop.ts`'s `runAgentTurn` uses — so a CLI-triggered
 * action shows up on `/agents/:id` identically to an autonomous, chat-, or MCP-triggered one.
 *
 * @param argv the full `process.argv` (including the node/tsx and script-path entries — only
 *   `argv.slice(2)` is read).
 * @param programName what usage/error messages print as the command to run — each entrypoint
 *   passes its own invocation string (e.g. `"tsx demo-agents/cli/index.ts"`).
 */
export async function runCli(argv: string[], programName: string): Promise<void> {
  const [, , commandArg, ...rest] = argv;

  if (!commandArg || commandArg === "--help" || commandArg === "-h") printUsageAndExit(programName, commandArg ? 0 : 1);

  if (commandArg === "list") {
    const aliasFor: Record<string, string> = {};
    for (const [alias, toolName] of Object.entries(ALIASES)) aliasFor[toolName] = alias;
    for (const tool of ALL_TOOLS) {
      const alias = aliasFor[tool.name] ? ` (alias: ${aliasFor[tool.name]})` : "";
      console.log(`${tool.name}${alias}\n  ${tool.description}`);
      const example = NATURAL_LANGUAGE_EXAMPLES[tool.name];
      if (example) console.log(`  Natural language (Open WebUI / MCP): "${example}"`);
      console.log("");
    }
    return;
  }

  const toolName = ALIASES[commandArg] ?? commandArg;
  const tool: ToolSpec<any> | undefined = TOOLS_BY_NAME.get(toolName);
  if (!tool) {
    console.error(`Unknown command "${commandArg}". Run "${programName} list" to see available tools.`);
    process.exit(1);
  }

  const { values } = parseArgs({
    args: rest,
    options: { agent: { type: "string" } },
    strict: false, // tool-specific flags vary per tool — collected manually below instead.
  });

  const agentId = values.agent as string | undefined;
  if (!agentId) {
    console.error(`Missing --agent <agentId>. Run "${programName} --help" for usage.`);
    process.exit(1);
  }

  // Re-scan raw args for every `--flag value` pair except --agent, since `parseArgs` above only
  // declared that one option and ran with `strict: false` to tolerate the rest.
  const input: Record<string, unknown> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--") || arg === "--agent") {
      if (arg === "--agent") i++; // skip its value too
      continue;
    }
    const key = arg.slice(2);
    const value = rest[i + 1];
    input[key] = value !== undefined ? coerce(value) : true;
    i++;
  }

  const timestamp = Date.now() / 1000;
  try {
    const output = await tool.run(input, { agentId });
    await reportActivity({ agentId, timestamp, kind: "action", message: `${toolName}(${JSON.stringify(input)})`, data: { tool: toolName, input, output } });

    const summarize = SUMMARIZERS[toolName];
    console.log(summarize ? summarize(output as any) : JSON.stringify(output, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await reportActivity({
      agentId,
      timestamp,
      kind: "action",
      message: `${toolName}(${JSON.stringify(input)})`,
      data: { tool: toolName, input, output: { error: message } },
    });
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
