import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Convenience orchestrator: boots the creator and bettor chat servers
 * (OpenAI-compatible `/v1/chat/completions`, for Open WebUI — see README.md)
 * as separate processes against one running app (`npm run dev:app` in
 * another terminal). Equivalent to running `npm run agent:chat:creator` /
 * `agent:chat:bettor` in two terminals — this just does it in one, with
 * prefixed, colorized logs.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const tsxBin = path.resolve(here, "node_modules/.bin/tsx");

interface Spec {
  label: string;
  color: string;
  file: string;
}

const RESET = "\x1b[0m";
const specs: Spec[] = [
  { label: "sage-chat", color: "\x1b[36m", file: "../demo-agents/creator-agent/chatServer.ts" },
  { label: "bettor-chat", color: "\x1b[32m", file: "../demo-agents/bettor-agent/chatServer.ts" },
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
    env: process.env,
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

console.log(
  `Running ${specs.length} chat servers against ${process.env.APM_API_URL ?? "http://localhost:3000"}. ` +
    "Point Open WebUI's OpenAI API connections at them (see README.md). Ctrl+C to stop.",
);
