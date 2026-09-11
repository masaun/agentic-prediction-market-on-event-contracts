import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { runAgentTurn, type ChatMessage } from "./llmLoop.js";
import type { ToolSpec } from "./tools.js";

/**
 * A minimal OpenAI-compatible `/v1/chat/completions` + `/v1/models` server,
 * so a human can talk to an agent directly instead of only watching it tick.
 * This is the integration point for Open WebUI (https://github.com/open-webui/open-webui):
 * add this server's URL as an "OpenAI API connection" in Open WebUI's admin
 * settings and each entry in `models` shows up as a selectable model in its
 * chat UI. See `demo-agents/creator-agent/chatServer.ts`, `demo-agents/bettor-agent/chatServer.ts`,
 * and the "Chat UI (Open WebUI)" section of README.md.
 *
 * Each request runs the exact same `shared/tools.ts` + `shared/llmLoop.ts`
 * tool-use loop the autonomous ticking agents use — a chat turn is just one
 * more way to drive `runAgentTurn`, seeded with the conversation instead of
 * a synthetic nudge. Tool calls made this way still report to the app's
 * activity feed under the model's `agentId`, so a human chatting with Ada
 * shows up on her `/agents/:id` page exactly like her autonomous turns do.
 */

export interface ChatModel {
  /** The id Open WebUI shows in its model picker and sends back as `model`. */
  id: string;
  /** Which on-chain-or-mock identity tool calls from this model report under. */
  agentId: string;
  systemPrompt: string;
  tools: ToolSpec<any>[];
}

export interface StartChatServerOpts {
  port: number;
  models: ChatModel[];
  /** If set, requests must send `Authorization: Bearer <apiKey>` — set as the connection's API key in Open WebUI. */
  apiKey?: string;
}

interface OpenAiChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
}

interface ChatCompletionRequest {
  model?: string;
  messages?: OpenAiChatMessage[];
  stream?: boolean;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function toHistory(messages: OpenAiChatMessage[]): ChatMessage[] {
  // The model's persona is the system prompt we own (see ChatModel.systemPrompt) — any
  // system message Open WebUI sends is dropped so persona/tool behavior can't be overridden
  // from the chat UI side.
  return messages
    .filter((m): m is OpenAiChatMessage & { role: "user" | "assistant" } => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content ?? "" }));
}

export function startChatServer(opts: StartChatServerOpts) {
  const byId = new Map(opts.models.map((m) => [m.id, m]));
  if (opts.models.length === 0) throw new Error("startChatServer: models must be non-empty");

  const server = createServer(async (req, res) => {
    try {
      if (opts.apiKey) {
        const auth = req.headers.authorization;
        if (auth !== `Bearer ${opts.apiKey}`) {
          return sendJson(res, 401, { error: { message: "Invalid API key", type: "invalid_request_error" } });
        }
      }

      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true, models: opts.models.map((m) => m.id) });
      }

      if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
        return sendJson(res, 200, {
          object: "list",
          data: opts.models.map((m) => ({ id: m.id, object: "model", created: 0, owned_by: "agentic-prediction-market" })),
        });
      }

      if (req.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")) {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as ChatCompletionRequest;
        const model = (body.model ? byId.get(body.model) : undefined) ?? opts.models[0];
        const history = toHistory(body.messages ?? []);
        if (history.length === 0 || history[history.length - 1].role !== "user") {
          return sendJson(res, 400, { error: { message: "messages must end with a user message" } });
        }

        const result = await runAgentTurn({
          agentId: model.agentId,
          systemPrompt: model.systemPrompt,
          tools: model.tools,
          history,
        });
        const content = result.narration.join("\n\n") || "(No response — nothing worth acting on or saying this turn.)";
        const id = `chatcmpl-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);

        if (body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
          res.write(
            `data: ${JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model: model.id,
              choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
            })}\n\n`,
          );
          res.write(
            `data: ${JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model: model.id,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })}\n\n`,
          );
          res.write("data: [DONE]\n\n");
          return res.end();
        }

        return sendJson(res, 200, {
          id,
          object: "chat.completion",
          created,
          model: model.id,
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }

      sendJson(res, 404, { error: { message: `Not found: ${req.method} ${url.pathname}` } });
    } catch (err) {
      sendJson(res, 500, { error: { message: err instanceof Error ? err.message : String(err) } });
    }
  });

  server.listen(opts.port, () => {
    console.log(`[chat] OpenAI-compatible endpoint ready on http://localhost:${opts.port} (models: ${opts.models.map((m) => m.id).join(", ")})`);
  });

  return server;
}
