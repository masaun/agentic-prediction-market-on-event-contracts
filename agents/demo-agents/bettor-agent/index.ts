import "dotenv/config";
import * as api from "../../proxy-servers/shared/apiClient.js";
import { runAgentTurn } from "../../proxy-servers/shared/llmLoop.js";
import { TRADING_TOOLS } from "../../proxy-servers/shared/tools.js";
import { BETTOR_PERSONAS } from "./persona.js";

const key = process.env.AGENT_PERSONA ?? "ada";
const persona = BETTOR_PERSONAS[key];
if (!persona) {
  console.error(`Unknown AGENT_PERSONA "${key}". Options: ${Object.keys(BETTOR_PERSONAS).join(", ")}`);
  process.exit(1);
}

const INTERVAL_MS = Number(process.env.AGENT_INTERVAL_MS ?? 30_000);

async function tick() {
  try {
    const result = await runAgentTurn({
      agentId: persona.id,
      systemPrompt: persona.systemPrompt,
      tools: TRADING_TOOLS,
      nudge: "It's your turn. Scan the open markets and either place a trade (or redeem settled shares) or pass.",
    });
    console.log(`[${persona.name}] ${result.narration.join(" ") || "(no narration)"}`);
  } catch (err) {
    console.error(`[${persona.name}] turn failed:`, err instanceof Error ? err.message : err);
  }
}

async function main() {
  await api.registerAgent({
    id: persona.id,
    name: persona.name,
    role: persona.role,
    persona: persona.systemPrompt,
    avatarEmoji: persona.avatarEmoji,
  });
  console.log(`[${persona.name}] registered, ticking every ${INTERVAL_MS}ms`);
  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch((err) => {
  console.error("bettor-agent failed to start:", err);
  process.exit(1);
});
