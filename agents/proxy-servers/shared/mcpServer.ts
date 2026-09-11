import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ALL_TOOLS, type ToolContext } from "./tools.js";

/**
 * Exposes every DreamDEX Event Contract action (list/get markets, place
 * orders, mint sets, redeem, ...) as MCP tools over stdio. This is the
 * integration point for a general-purpose agent host: point Hermes Agent's
 * or OpenClaw's MCP/tool config at this process instead of running
 * `shared/llmLoop.ts`, and either framework's own reasoning loop drives the
 * exact same market actions the built-in demo agents use.
 *
 * Example (illustrative — match the flag/field names to your installed
 * version's docs):
 *   openclaw: proxy-servers/openclaw.config.example.jsonc
 *   hermes-agent: proxy-servers/hermes.config.example.yaml
 *
 * Run: `AGENT_ID=my-agent APM_API_URL=http://localhost:3000 npm run mcp`
 */

const agentId = process.env.AGENT_ID;
if (!agentId) {
  console.error("Set AGENT_ID (the identity these tool calls report activity/positions under) before starting the MCP server.");
  process.exit(1);
}
const ctx: ToolContext = { agentId };

const server = new McpServer({ name: "dreamdex-event-contracts", version: "0.1.0" });

// Looping over a heterogeneous array of tool specs means each one's Args
// type can't be inferred individually; registerTool's generics are cast away
// here on purpose (each `tool.run` still validates/executes against its own
// concrete zod shape at runtime — see shared/tools.ts).
for (const tool of ALL_TOOLS) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.zodShape as Record<string, never> },
    (async (input: unknown) => {
      try {
        const output = await tool.run(input, ctx);
        return { content: [{ type: "text" as const, text: JSON.stringify(output) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }) as never,
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[mcp] dreamdex-event-contracts tool server ready for agent "${agentId}" (${ALL_TOOLS.length} tools)`);
