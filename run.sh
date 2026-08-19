#!/usr/bin/env bash
#
# One-click launcher for the Bus Sun-Side Advisor.
#
#   ./run.sh              build (if needed) and serve the production app
#   ./run.sh --dev        run the dev server instead (hot reload)
#   ./run.sh --rebuild    force a fresh production build first
#
# It finds Node, installs dependencies, sets up .env.local, builds, starts the
# server and opens a browser. Safe to re-run: every step is skipped if it is
# already done.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

MODE="prod"
FORCE_REBUILD=0
for arg in "$@"; do
  case "$arg" in
    --dev) MODE="dev" ;;
    --rebuild) FORCE_REBUILD=1 ;;
    -h|--help) sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 1 ;;
  esac
done

say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m !\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31m✗\033[0m %s\n\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Node
# ---------------------------------------------------------------------------
# This machine has no system-wide Node (no sudo), so a local tarball install
# under ~/.local is the primary source. Any Node on PATH is used if it is new
# enough — Next.js 16 requires 20.9+.
if ! command -v node >/dev/null 2>&1; then
  LOCAL_NODE="$(ls -d "$HOME"/.local/node-v*-linux-x64/bin 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$LOCAL_NODE" ] && export PATH="$LOCAL_NODE:$PATH"
fi

command -v node >/dev/null 2>&1 || die "Node.js not found.
Install it (no root needed) with:
  curl -fsSL https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-x64.tar.xz \\
    | tar -xJ -C \"\$HOME/.local\"
then run this script again."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20.9+ required, found $(node -v)."
say "Node $(node -v) — $(command -v node)"

# ---------------------------------------------------------------------------
# 2. Dependencies
# ---------------------------------------------------------------------------
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  say "Installing dependencies (first run takes a minute)…"
  npm install --no-fund --no-audit
else
  say "Dependencies already installed."
fi

# ---------------------------------------------------------------------------
# 3. Configuration
# ---------------------------------------------------------------------------
# Nothing is required here: the app runs on OpenStreetMap's public services with
# no key and no account. .env.local exists only so the endpoints can be pointed
# somewhere else (a self-hosted OSRM, say) — see .env.example for the list.
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  say "Created .env.local from .env.example (all values optional)"
else
  say "Using the existing .env.local"
fi

if [ -z "${OSM_USER_AGENT:-}" ] && ! grep -qE '^OSM_USER_AGENT=.+' .env.local 2>/dev/null; then
  warn "Using the default OSM_USER_AGENT. Fine for local use; set your own in
   .env.local before deploying — Nominatim rejects unidentified callers."
fi

# ---------------------------------------------------------------------------
# 4. Port
# ---------------------------------------------------------------------------
PORT="${PORT:-3000}"
port_busy() { node -e '
  const net = require("net");
  const s = net.createServer();
  s.once("error", () => process.exit(0));   // in use
  s.once("listening", () => s.close(() => process.exit(1)));
  s.listen(Number(process.argv[1]), "127.0.0.1");
' "$1"; }

while port_busy "$PORT" && [ "$PORT" -lt 3020 ]; do
  warn "Port $PORT is in use, trying $((PORT + 1))…"
  PORT=$((PORT + 1))
done
export PORT

# ---------------------------------------------------------------------------
# 5. Build (production mode only)
# ---------------------------------------------------------------------------
if [ "$MODE" = "prod" ]; then
  if [ "$FORCE_REBUILD" = "1" ] || [ ! -f .next/BUILD_ID ]; then
    say "Building the production app…"
    npm run build
  else
    say "Using the existing build (pass --rebuild to rebuild)."
  fi
fi

# ---------------------------------------------------------------------------
# 6. Serve, and open a browser once the server answers
# ---------------------------------------------------------------------------
URL="http://localhost:$PORT"

open_when_ready() {
  for _ in $(seq 1 60); do
    sleep 1
    if node -e '
      require("http").get(process.argv[1], r => process.exit(r.statusCode < 500 ? 0 : 1))
        .on("error", () => process.exit(1));
    ' "$URL" 2>/dev/null; then
      # WSL, then desktop Linux, then macOS.
      for opener in wslview xdg-open open; do
        command -v "$opener" >/dev/null 2>&1 && { "$opener" "$URL" >/dev/null 2>&1 || true; return; }
      done
      # WSL without wslview: hand the URL to the Windows shell.
      command -v explorer.exe >/dev/null 2>&1 && { explorer.exe "$URL" >/dev/null 2>&1 || true; return; }
      return
    fi
  done
}
open_when_ready &

say "Starting the server on $URL   (press Ctrl+C to stop)"
echo
if [ "$MODE" = "dev" ]; then
  exec npm run dev -- --port "$PORT"
else
  exec npm run start -- --port "$PORT"
fi
