#!/usr/bin/env bash
# Opens the four processes `npm run dev:all` needs — the app, both agent
# chat servers, and Open WebUI's Docker Compose — each in its own macOS
# Terminal.app window, instead of interleaving their output in one terminal.
#
# Each command is written to a throwaway .command file and launched via
# `open -a Terminal`, rather than driving Terminal.app over Apple Events
# (osascript's `tell application "Terminal" to do script ...`) — the latter
# requires the calling app (e.g. VS Code's integrated terminal) to hold
# Automation/TCC permission, which macOS frequently denies silently instead
# of prompting for it. `open -a Terminal <file>` is a plain app launch and
# needs no such permission.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NAMES=(
  "dev-app"
  "agent-chat-creator"
  "agent-chat-bettor"
  "chat-docker"
)

COMMANDS=(
  "npm run dev:app"
  "npm run wait:app && npm run agent:chat:creator"
  "npm run wait:app && npm run agent:chat:bettor"
  "docker compose -f agents/proxy-servers/docker-compose.chat.yml up"
)

if [[ "$(uname)" != "Darwin" ]]; then
  echo "dev:all's separate-terminal mode only knows how to drive macOS Terminal.app." >&2
  echo "Run 'npm run dev:all:log' instead (all four in one terminal, labeled), or run these four yourself:" >&2
  printf '  %s\n' "${COMMANDS[@]}" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/apm-dev-all.XXXXXX")"

for i in "${!COMMANDS[@]}"; do
  script_file="$TMP_DIR/${NAMES[$i]}.command"
  cat > "$script_file" <<EOF
#!/usr/bin/env bash
cd "$ROOT_DIR"
${COMMANDS[$i]}
status=\$?
echo
echo "[dev-all] '${COMMANDS[$i]}' exited (\$status). Press enter to close this window."
read -r
EOF
  chmod +x "$script_file"
  open -a Terminal "$script_file"
done
