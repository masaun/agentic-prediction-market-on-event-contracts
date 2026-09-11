import "dotenv/config";
import * as api from "../../proxy-servers/shared/apiClient.js";
import { startChatServer } from "../../proxy-servers/shared/chatServer.js";
import { CREATOR_TOOLS } from "../../proxy-servers/shared/tools.js";
import { CREATOR_PERSONA } from "./persona.js";

/**
 * OpenAI-compatible chat endpoint for Sage — point Open WebUI's "OpenAI API
 * connection" at this server (default http://localhost:4001/v1) to chat with
 * her directly instead of only watching her tick. See README.md's
 * "Chat UI (Open WebUI)" section.
 */

const PORT = Number(process.env.CREATOR_CHAT_PORT ?? 4001);

async function main() {
  await api.registerAgent({
    id: CREATOR_PERSONA.id,
    name: CREATOR_PERSONA.name,
    role: CREATOR_PERSONA.role,
    persona: CREATOR_PERSONA.systemPrompt,
    avatarEmoji: CREATOR_PERSONA.avatarEmoji,
  });

  startChatServer({
    port: PORT,
    apiKey: process.env.AGENT_CHAT_API_KEY,
    models: [
      {
        id: "sage-creator-agent",
        agentId: CREATOR_PERSONA.id,
        systemPrompt: CREATOR_PERSONA.systemPrompt,
        tools: CREATOR_TOOLS,
      },
    ],
  });
}

main().catch((err) => {
  console.error("creator-agent chat server failed to start:", err);
  process.exit(1);
});
