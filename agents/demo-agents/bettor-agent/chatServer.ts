import "dotenv/config";
import * as api from "../../proxy-servers/shared/apiClient.js";
import { startChatServer } from "../../proxy-servers/shared/chatServer.js";
import { TRADING_TOOLS } from "../../proxy-servers/shared/tools.js";
import { BETTOR_PERSONAS } from "./persona.js";

/**
 * OpenAI-compatible chat endpoint for the bettors — point Open WebUI's
 * "OpenAI API connection" at this server (default http://localhost:4002/v1)
 * to chat with Ada or Nomi directly instead of only watching them tick. Both
 * personas are registered as separate models on one server, so Open WebUI's
 * model picker shows "ada-bettor-agent" and "nomi-bettor-agent" side by side. See
 * README.md's "Chat UI (Open WebUI)" section.
 */

const PORT = Number(process.env.BETTOR_CHAT_PORT ?? 4002);

async function main() {
  for (const persona of Object.values(BETTOR_PERSONAS)) {
    await api.registerAgent({
      id: persona.id,
      name: persona.name,
      role: persona.role,
      persona: persona.systemPrompt,
      avatarEmoji: persona.avatarEmoji,
    });
  }

  startChatServer({
    port: PORT,
    apiKey: process.env.AGENT_CHAT_API_KEY,
    models: Object.entries(BETTOR_PERSONAS).map(([key, persona]) => ({
      id: `${key}-bettor-agent`,
      agentId: persona.id,
      systemPrompt: persona.systemPrompt,
      tools: TRADING_TOOLS,
    })),
  });
}

main().catch((err) => {
  console.error("bettor-agent chat server failed to start:", err);
  process.exit(1);
});
