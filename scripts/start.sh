#!/usr/bin/env bash
#
# Clone to running, in one command.
#
# Everything here is idempotent: run it twice and the second run installs
# nothing, and leaves the database alone. That matters because the thing
# people actually do with a start script is run it again when something
# looks wrong.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-4300}"
DB="${REP_DB_PATH:-$PWD/apps/website/.data/rep.db}"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# Node 26 runs the TypeScript directly by stripping types, which is what
# lets the engine run with no build step. An older version fails in ways
# that read as syntax errors in our code rather than as a version problem,
# so the check is worth the four lines.
need=26
have="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$have" -lt "$need" ]; then
  echo "Node $need or newer is required; this is $(node --version 2>/dev/null || echo 'not installed')." >&2
  echo "Either install it, or run the container instead: docker compose up" >&2
  exit 1
fi

say "Installing"
[ -d node_modules ] || npm install

say "Preparing the database directory"
mkdir -p "$(dirname "$DB")"

say "Building"
npm run build --workspace @rep/website

say "Starting on http://localhost:$PORT"
cat <<NOTE

  Health:   http://localhost:$PORT/api/health
  Database: $DB

  No mail provider is configured, so sign-in codes are shown on screen
  rather than emailed. No search key is set, so every audit runs against
  fixture data describing invented people, and says so on every page.
  Both are deliberate. See .env.example to connect a real search provider.

  For the staff review queue:
    npm run staff -- add you@example.com reviewer

NOTE

cd apps/website
exec npx next start --port "$PORT"
