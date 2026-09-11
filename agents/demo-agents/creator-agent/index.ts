import "dotenv/config";
import * as api from "../../proxy-servers/shared/apiClient.js";
import { runAgentTurn } from "../../proxy-servers/shared/llmLoop.js";
import { CREATOR_TOOLS } from "../../proxy-servers/shared/tools.js";
import { CREATOR_PERSONA } from "./persona.js";

const INTERVAL_MS = Number(process.env.AGENT_INTERVAL_MS ?? 45_000);

async function tick() {
  try {
    const result = await runAgentTurn({
      agentId: CREATOR_PERSONA.id,
      systemPrompt: CREATOR_PERSONA.systemPrompt,
      tools: CREATOR_TOOLS,
      nudge:
        "It's your turn. Check what's currently listed, then either open exactly one new market or explain " +
        "why you're passing this turn.",
    });
    console.log(`[${CREATOR_PERSONA.name}] ${result.narration.join(" ") || "(no narration)"}`);
  } catch (err) {
    console.error(`[${CREATOR_PERSONA.name}] turn failed:`, err instanceof Error ? err.message : err);
  }
}

async function main() {
  await api.registerAgent({
    id: CREATOR_PERSONA.id,
    name: CREATOR_PERSONA.name,
    role: CREATOR_PERSONA.role,
    persona: CREATOR_PERSONA.systemPrompt,
    avatarEmoji: CREATOR_PERSONA.avatarEmoji,
  });
  console.log(`[${CREATOR_PERSONA.name}] registered, ticking every ${INTERVAL_MS}ms`);
  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch((err) => {
  console.error("creator-agent failed to start:", err);
  process.exit(1);
});
