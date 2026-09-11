import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import * as api from "./apiClient.js";
import type { ToolContext, ToolSpec } from "./tools.js";

/**
 * The reference reasoning engine: a plain tool-use loop behind a small
 * provider switch. This is what `npm run creator` / `npm run bettor:*` drive
 * by default, so the demo works with only one API key set — no external
 * agent runtime required. To drive the same market actions from Hermes
 * Agent or OpenClaw instead, point either at `shared/mcpServer.ts` (see
 * proxy-servers/README.md) and skip this file entirely.
 *
 * `LLM_PROVIDER` picks the engine:
 *  - "openrouter" (default) — OpenRouter's unified, OpenAI-compatible
 *    `/chat/completions` API (https://openrouter.ai/docs/quickstart). One
 *    key, any model in its catalog (`OPENROUTER_MODEL`), including Claude.
 *  - "anthropic" — calls the Anthropic Messages API directly via the SDK.
 */

const PROVIDER = (process.env.LLM_PROVIDER ?? "openrouter").toLowerCase();
const MAX_TOOL_TURNS = 6;

export interface AgentTurnResult {
  narration: string[];
  toolCalls: { name: string; input: unknown; output: unknown }[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface RunTurnOpts {
  agentId: string;
  systemPrompt: string;
  tools: ToolSpec<any>[];
  /** Autonomous-tick mode: a single synthetic "it's your turn" style prompt. */
  nudge?: string;
  /** Chat mode: the real conversation so far (oldest first), ending in the latest user message. */
  history?: ChatMessage[];
}

/** `history` then `nudge` appended as a trailing user turn, if both were given. */
function buildInitialTurns(opts: RunTurnOpts): ChatMessage[] {
  const turns = opts.history ? [...opts.history] : [];
  if (opts.nudge) turns.push({ role: "user", content: opts.nudge });
  return turns;
}

/**
 * Runs one "turn": the agent sees the system prompt + either a nudge
 * (autonomous ticking, via `demo-agents/creator-agent/index.ts` / `demo-agents/bettor-agent/index.ts`)
 * or a real chat `history` (human-driven, via each agent's chatServer.ts — see
 * `shared/chatServer.ts` and the Open WebUI integration in README.md), thinks,
 * calls zero or more tools (chained up to `MAX_TOOL_TURNS`), and stops once
 * it produces a final text reply with no further tool use.
 */
export async function runAgentTurn(opts: RunTurnOpts): Promise<AgentTurnResult> {
  const result = PROVIDER === "anthropic" ? await runAnthropicTurn(opts) : await runOpenRouterTurn(opts);

  // A `place_order` fill's receipt (see `shared/tools.ts`/`shared/receipt.ts`) is appended verbatim
  // after the model's own narration, rather than left to the model to recount from the raw tool
  // JSON — so the market title, fill price, and block-explorer tx link always reach Open WebUI (or
  // any other chat front door reading `narration`) in the same organized form, independent of
  // whatever the model chose to say about the trade.
  for (const call of result.toolCalls) {
    const receipt = (call.output as { receipt?: unknown } | undefined)?.receipt;
    if (call.name === "place_order" && typeof receipt === "string") result.narration.push(receipt);
  }

  for (const line of result.narration) {
    await api.reportActivity({ agentId: opts.agentId, timestamp: Date.now() / 1000, kind: "reasoning", message: line });
  }
  for (const call of result.toolCalls) {
    await api.reportActivity({
      agentId: opts.agentId,
      timestamp: Date.now() / 1000,
      kind: "action",
      message: `${call.name}(${JSON.stringify(call.input)})`,
      data: { tool: call.name, input: call.input, output: call.output },
    });
  }

  return result;
}

async function runToolCall(
  tool: ToolSpec<any> | undefined,
  name: string,
  input: unknown,
  ctx: ToolContext,
  toolCalls: AgentTurnResult["toolCalls"],
): Promise<{ output: unknown; isError: boolean; content: string }> {
  if (!tool) {
    return { output: undefined, isError: true, content: `Unknown tool ${name}` };
  }
  try {
    const output = await tool.run(input, ctx);
    toolCalls.push({ name, input, output });
    return { output, isError: false, content: JSON.stringify(output) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toolCalls.push({ name, input, output: { error: message } });
    return { output: { error: message }, isError: true, content: message };
  }
}

// ---------------------------------------------------------------------------
// Anthropic (direct)
// ---------------------------------------------------------------------------

const ANTHROPIC_MODEL = process.env.AGENT_MODEL ?? "claude-sonnet-5";

function toAnthropicTools(tools: ToolSpec<any>[]): Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.jsonSchema as Tool["input_schema"],
  }));
}

async function runAnthropicTurn(opts: RunTurnOpts): Promise<AgentTurnResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set. Set it in proxy-servers/.env, switch " +
        "LLM_PROVIDER=openrouter (needs OPENROUTER_API_KEY instead), or wire a different runtime " +
        "(Hermes Agent / OpenClaw) against shared/mcpServer.ts — see proxy-servers/README.md.",
    );
  }
  const client = new Anthropic({ apiKey });
  const ctx: ToolContext = { agentId: opts.agentId };
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const anthropicTools = toAnthropicTools(opts.tools);

  const messages: MessageParam[] = buildInitialTurns(opts).map((m) => ({ role: m.role, content: m.content }));
  const result: AgentTurnResult = { narration: [], toolCalls: [] };

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: opts.systemPrompt,
      tools: anthropicTools,
      messages,
    });

    const text = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) result.narration.push(text);

    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0 || response.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: response.content });

    const toolResults = await Promise.all(
      toolUses.map(async (call) => {
        const { isError, content } = await runToolCall(byName.get(call.name), call.name, call.input, ctx, result.toolCalls);
        return { type: "tool_result" as const, tool_use_id: call.id, is_error: isError, content };
      }),
    );
    messages.push({ role: "user", content: toolResults });
  }

  return result;
}

// ---------------------------------------------------------------------------
// OpenRouter (default) — https://openrouter.ai/docs/quickstart
// ---------------------------------------------------------------------------

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

function toOpenAiTools(tools: ToolSpec<any>[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.jsonSchema,
    },
  }));
}

async function runOpenRouterTurn(opts: RunTurnOpts): Promise<AgentTurnResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "LLM_PROVIDER=openrouter (the default) but OPENROUTER_API_KEY is not set. Get a key at " +
        "https://openrouter.ai/keys and set it in proxy-servers/.env, or set LLM_PROVIDER=anthropic to use " +
        "ANTHROPIC_API_KEY directly instead — see proxy-servers/README.md.",
    );
  }
  const ctx: ToolContext = { agentId: opts.agentId };
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const openAiTools = toOpenAiTools(opts.tools);

  const messages: OpenAiMessage[] = [
    { role: "system", content: opts.systemPrompt },
    ...buildInitialTurns(opts).map((m): OpenAiMessage => ({ role: m.role, content: m.content })),
  ];
  const result: AgentTurnResult = { narration: [], toolCalls: [] };

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Optional attribution headers for openrouter.ai/rankings — harmless to omit.
        ...(process.env.OPENROUTER_SITE_URL ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL } : {}),
        ...(process.env.OPENROUTER_SITE_NAME ? { "X-Title": process.env.OPENROUTER_SITE_NAME } : {}),
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        max_tokens: 1024,
        messages,
        tools: openAiTools,
      }),
    });
    const rawBody = await res.text();
    let data: {
      choices?: { message: OpenAiMessage; finish_reason: string }[];
      error?: { message: string; code?: number };
    };
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new Error(`OpenRouter chat completion failed (${res.status}): ${rawBody}`);
    }
    // OpenRouter sometimes returns an error payload with an HTTP 200 (e.g. a flaky
    // upstream provider for a free-tier model), so check `error`/missing `choices`
    // independently of `res.ok`.
    if (!res.ok || data.error) {
      const detail = data.error?.message ?? rawBody;
      throw new Error(`OpenRouter chat completion failed (${data.error?.code ?? res.status}): ${detail}`);
    }
    const choice = data.choices?.[0];
    if (!choice) break;
    const { message, finish_reason } = choice;

    const text = message.content?.trim();
    if (text) result.narration.push(text);

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0 || finish_reason !== "tool_calls") break;

    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });

    for (const call of toolCalls) {
      let input: unknown = {};
      try {
        input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        // fall through with empty input; the tool call below reports the failure
      }
      const { content } = await runToolCall(byName.get(call.function.name), call.function.name, input, ctx, result.toolCalls);
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }

  return result;
}
