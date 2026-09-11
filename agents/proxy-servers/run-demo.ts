import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Convenience orchestrator: boots the creator agent and both bettor
 * personas as separate processes against one running app (`npm run dev:app`
 * in another terminal, `MARKET_ENGINE=mock` by default). Equivalent to
 * running `npm run agent:creator` / `agent:bettor:ada` / `agent:bettor:nomi`
 * in three terminals — this just does it in one, with prefixed, colorized
 * logs.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const tsxBin = path.resolve(here, "node_modules/.bin/tsx");

interface Spec {
  label: string;
  color: string;
  file: string;
  env?: Record<string, string>;
}

const RESET = "\x1b[0m";
const specs: Spec[] = [
  { label: "sage", color: "\x1b[36m", file: "../demo-agents/creator-agent/index.ts" },
  { label: "ada", color: "\x1b[32m", file: "../demo-agents/bettor-agent/index.ts", env: { AGENT_PERSONA: "ada" } },
  { label: "nomi", color: "\x1b[35m", file: "../demo-agents/bettor-agent/index.ts", env: { AGENT_PERSONA: "nomi" } },
];

const children: ChildProcess[] = [];

function prefixed(label: string, color: string, chunk: Buffer) {
  const text = chunk.toString();
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    process.stdout.write(`${color}[${label}]${RESET} ${line}\n`);
  }
}

for (const spec of specs) {
  const child = spawn(tsxBin, [spec.file], {
    cwd: here,
    env: { ...process.env, ...spec.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => prefixed(spec.label, spec.color, chunk));
  child.stderr?.on("data", (chunk) => prefixed(spec.label, spec.color, chunk));
  child.on("exit", (code) => prefixed(spec.label, spec.color, Buffer.from(`exited (${code})`)));
  children.push(child);
}

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`Running ${specs.length} demo agents against ${process.env.APM_API_URL ?? "http://localhost:3000"}. Ctrl+C to stop.`);
