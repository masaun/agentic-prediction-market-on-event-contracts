#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/verify_setup.sh [--apm-url URL] [--config PATH]

Preflight checks for the dreamdex-event-contracts MCP server
(agents/proxy-servers/shared/mcpServer.ts) this skill's tools run on top of:

  1. The Agentic Prediction Market app is reachable at --apm-url (default
     http://localhost:3000, or $APM_API_URL) and responds to GET /api/health.
  2. OpenClaw's config file (default ~/.openclaw/config.json, or --config)
     has a dreamdex-event-contracts entry under mcp.servers.

Exit codes:
  0  all checks passed
  1  app unreachable
  2  MCP server missing from config (or config file missing)
  3  bad arguments

Examples:
  scripts/verify_setup.sh
  scripts/verify_setup.sh --apm-url http://localhost:3000 --config ~/.openclaw/config.json
EOF
}

APM_URL="${APM_API_URL:-http://localhost:3000}"
CONFIG_PATH="${HOME}/.openclaw/config.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apm-url) APM_URL="${2:?--apm-url needs a value}"; shift 2 ;;
    --config) CONFIG_PATH="${2:?--config needs a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Error: unknown argument '$1'." >&2; usage >&2; exit 3 ;;
  esac
done

echo "Checking app at ${APM_URL} ..." >&2
if ! health=$(curl -fsS --max-time 5 "${APM_URL}/api/health" 2>/dev/null); then
  echo "FAIL: app not reachable at ${APM_URL}/api/health" >&2
  echo "  -> Start it first: npm run dev:app (from the agentic-prediction-market repo root)." >&2
  exit 1
fi
echo "OK: app reachable — ${health}"

echo "Checking OpenClaw config at ${CONFIG_PATH} ..." >&2
if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "FAIL: no config file at ${CONFIG_PATH}" >&2
  echo "  -> See references/setup.md (based on agents/proxy-servers/openclaw.config.example.jsonc)." >&2
  exit 2
fi
if ! grep -Eq 'dreamdex[_-]event[_-]contracts' "${CONFIG_PATH}"; then
  echo "FAIL: no dreamdex-event-contracts entry found under mcp.servers in ${CONFIG_PATH}" >&2
  echo "  -> See references/setup.md." >&2
  exit 2
fi
echo "OK: dreamdex-event-contracts MCP server registered in ${CONFIG_PATH}"

echo "All checks passed."
