#!/usr/bin/env bash
#
# Build the container and prove it does the thing it exists to do.
#
# This lives in a script rather than inside the CI workflow for two
# reasons. Anybody with Docker can run the same verification locally, which
# matters because the machine this was written on has no container runtime
# at all and the image went unbuilt for days waiting on CI. And checks
# buried in YAML are checks nobody reads.
#
#   bash scripts/verify-image.sh
#
# Takes a few minutes, mostly npm install inside the build.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="${IMAGE:-goodname:verify}"
NAME="${NAME:-goodname-verify}"
PORT="${PORT:-4310}"
VOLUME="${VOLUME:-goodname-verify-data}"

pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

command -v docker >/dev/null || {
  echo "Docker is not installed. That is the whole reason this script exists:" >&2
  echo "without it the Dockerfile can be written but never proven." >&2
  exit 127
}

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  [ "${KEEP_VOLUME:-}" = "1" ] || docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup

step "Building"
docker build -t "$IMAGE" .

step "Starting"
docker run -d --name "$NAME" -p "$PORT:4300" -v "$VOLUME:/data" "$IMAGE" >/dev/null

step "Waiting for the image's own health check"
# Not a port check. A container whose background worker is dead answers on
# the port, serves every page, and finishes no audits: the failure this is
# here to catch looks exactly like success from outside.
for _ in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo starting)
  [ "$state" = "healthy" ] && break
  [ "$state" = "unhealthy" ] && { docker logs "$NAME"; fail "the container reported unhealthy"; }
  sleep 5
done
[ "${state:-}" = "healthy" ] || { docker logs "$NAME"; fail "never became healthy"; }
pass "healthy"

step "What it says about itself"
health=$(curl -fsS "http://localhost:$PORT/api/health")
echo "  $health"
grep -q '"ok":true' <<<"$health" || fail "health reports not ok"
# Asserted rather than assumed: the dangerous version of this product is
# one that looks live and is not, or looks like a demo and is not.
grep -q 'no live provider configured' <<<"$health" || fail "an image built with no key claims a live provider"
pass "fixture data, schema present, worker started"

step "The site serves"
for path in / /audit /signin /account /review; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT$path")
  [ "$code" = "200" ] || fail "$path returned $code"
done
pass "every page answers"

step "A real audit, end to end, inside the container"
# The point of the whole script. Everything above proves it starts; this
# proves the thing it exists to do works in it. If the worker never starts,
# the poll below exhausts its attempts rather than passing.
jar=$(mktemp)
curl -fsS -c "$jar" -b "$jar" -X POST "http://localhost:$PORT/api/auth/request" \
  -H 'content-type: application/json' -d '{"email":"verify@example.test"}' >/dev/null

# The endpoint that reveals a sign-in code is closed in a production build,
# by design, so the code is read from the database the way an operator
# would read it.
code=$(docker exec "$NAME" node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.env.REP_DB_PATH);
  const r = db.prepare('SELECT body FROM email_outbox ORDER BY created_at DESC LIMIT 1').get();
  process.stdout.write((r.body.match(/code is (\d{6})/) || [])[1] ?? '');
")
[ -n "$code" ] && pass "sign-in code issued" || fail "no sign-in code was written"

curl -fsS -c "$jar" -b "$jar" -X POST "http://localhost:$PORT/api/auth/verify" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"verify@example.test\",\"code\":\"$code\"}" >/dev/null

scan=$(curl -fsS -b "$jar" -X POST "http://localhost:$PORT/api/audit" \
  -H 'content-type: application/json' \
  -d '{"fullName":"Jensen Adoni","profession":"attorney","employer":"Adoni Law","city":"Chicago","region":"Illinois","credentials":"JD","websiteUrl":"https://adoni-law.example","attested":true,"scenario":"official_finding"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["scanId"])')

for _ in $(seq 1 40); do
  status=$(curl -fsS -b "$jar" "http://localhost:$PORT/api/scan/$scan/status" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status",""))')
  [ "$status" != "pending" ] && break
  sleep 3
done
[ "$status" = "complete" ] || { docker logs "$NAME"; fail "the audit never completed (status: $status)"; }

curl -fsS -b "$jar" "http://localhost:$PORT/api/scan/$scan" | python3 -c '
import sys, json
d = json.load(sys.stdin)
assert d["scan"]["isFixture"] is True, "a container with no key produced a non-fixture report"
assert d["presence"]["status"] == "scored", d["presence"]["status"]
assert len(d["evidence"]) > 0, "a complete report with no evidence"
print("       score", d["presence"]["score"], "| evidence", len(d["evidence"]),
      "| awaiting review", d["risk"]["awaitingReview"])
'
pass "a report came out of it"

step "The database survives a restart"
# It is a file in a volume, and that is the whole reason: a deploy must not
# take the customers with it. The failure here is silent.
before=$(docker exec "$NAME" node -e "
  const { DatabaseSync } = require('node:sqlite');
  process.stdout.write(String(new DatabaseSync(process.env.REP_DB_PATH).prepare('SELECT COUNT(*) n FROM scans').get().n));
")
docker restart "$NAME" >/dev/null
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = "healthy" ] && break
  sleep 5
done
after=$(docker exec "$NAME" node -e "
  const { DatabaseSync } = require('node:sqlite');
  process.stdout.write(String(new DatabaseSync(process.env.REP_DB_PATH).prepare('SELECT COUNT(*) n FROM scans').get().n));
")
[ "$before" = "$after" ] && [ "$before" != "0" ] || fail "scans before restart $before, after $after"
pass "$after scan(s) survived"

step "It is not running as root"
who=$(docker exec "$NAME" id -un)
[ "$who" != "root" ] || fail "running as root"
pass "running as $who"

printf '\n\033[32mThe image does what the Dockerfile claims.\033[0m\n\n'
