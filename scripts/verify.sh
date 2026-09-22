#!/usr/bin/env bash
#
# End-to-end verification against a running server.
#
# Two scripts run here and they check different kinds of claim. `section8.py` walks the demo
# script in the build spec — seed, edit a reading, watch the verdict roll up, generate the
# report, find it again — and asserts the workflow behaves as described. `chartcheck.py` parses
# the error curve back out of the generated report and checks it as geometry: that the envelope
# steps where the standard says it steps, that each dot sits where its own error puts it, that a
# grossly failing reading does not drag the axis around it. Substring checks (`'<polyline' in
# html`) prove an element was emitted and nothing more; a chart can contain every expected tag
# and still tell a reader something false.
#
# The database, the uploads and the generated reports all live outside the checkout, and the
# server is started and stopped here. Uploads and reports go to a temporary directory; the
# database goes to a scratch PostgreSQL selected below — never the live one by default.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for tool in python3 curl; do
  command -v "$tool" >/dev/null || { echo "$tool is required to run the verification scripts." >&2; exit 1; }
done

# A high port, varied per run, so a stale process from a previous run cannot be mistaken for
# this one — the checks would otherwise pass against the wrong server.
# NOTE (2026-09-04): legacy sqlite isolation via DB_PATH is retired.
# The server now uses PostgreSQL via DATABASE_URL (see server/src/db/index.ts), so there is
# no throwaway file DB. Two flows, in order of preference:
#
#   1. Scratch database (safe, default): set VERIFY_DATABASE_URL to an empty/disposable
#      Postgres database (local `createdb verify_r76`, a Supabase branch, ...). The seed and
#      the server inherit it as DATABASE_URL, the seed --reset wipes only the scratch DB,
#      and --clean drops its tables afterwards. Live data is untouched by construction.
#
#   2. Live database (destructive opt-in): VERIFY_ALLOW_LIVE=1 runs seed --reset against
#      DATABASE_URL, destroying whatever examination data it holds. For emergencies only.
#
# A separate database cannot be faked with schemas on the Supabase pooler (transaction mode
# breaks session-scoped `SET search_path`), which is why this script requires a whole
# database rather than a temp schema.
PORT="${VERIFY_PORT:-$((14000 + RANDOM % 1000))}"
WORK="$(mktemp -d)"
export UPLOADS_DIR="$WORK/uploads"
export REPORTS_DIR="$WORK/reports"
export PORT
export BASE_URL="http://127.0.0.1:$PORT"

if [ -n "${DB_PATH:-}" ]; then
  echo "WARNING: DB_PATH is legacy and ignored — server uses DATABASE_URL (PostgreSQL)." >&2
fi
if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi
SCRATCH=0
if [ -n "${VERIFY_DATABASE_URL:-}" ]; then
  # Cosmetic differences (a trailing slash) must not slip past the guard. This still only
  # catches the copy-paste case — the same database reachable via a different hostname
  # (pooler vs direct) is a different string, so treat this as a tripwire, not proof.
  if [ "${VERIFY_DATABASE_URL%/}" = "${DATABASE_URL:-}" ] || [ "${VERIFY_DATABASE_URL}" = "${DATABASE_URL%/}" ]; then
    echo "Refusing: VERIFY_DATABASE_URL points at the live DATABASE_URL." >&2
    echo "Use a disposable database, or set VERIFY_ALLOW_LIVE=1 to run against live explicitly." >&2
    exit 1
  fi
  export DATABASE_URL="$VERIFY_DATABASE_URL"
  SCRATCH=1
elif [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required (server/src/db/index.ts). Refusing to verify without it." >&2
  echo "Set VERIFY_DATABASE_URL to a disposable database (safe), or DATABASE_URL + VERIFY_ALLOW_LIVE=1 (destructive)." >&2
  exit 1
elif [ "${VERIFY_ALLOW_LIVE:-0}" != "1" ]; then
  echo "Refusing: verify seeds (--reset) and mutates data. Set VERIFY_DATABASE_URL to a disposable" >&2
  echo "database (safe), or VERIFY_ALLOW_LIVE=1 to run against DATABASE_URL (destructive)." >&2
  exit 1
fi

SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "Seeding a throwaway database"
npm run --silent seed -- --reset > "$WORK/seed.log" 2>&1 || { cat "$WORK/seed.log" >&2; exit 1; }

node --disable-warning=ExperimentalWarning server/src/index.ts > "$WORK/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  curl -sf "$BASE_URL/api/health" >/dev/null 2>&1 && break
  # If the server died on startup its log is the only useful thing to show.
  kill -0 "$SERVER_PID" 2>/dev/null || { cat "$WORK/server.log" >&2; exit 1; }
  sleep 0.25
done
curl -sf "$BASE_URL/api/health" >/dev/null || { echo "Server did not come up on $BASE_URL" >&2; cat "$WORK/server.log" >&2; exit 1; }

STATUS=0
python3 scripts/verify/section8.py || STATUS=1
echo
python3 scripts/verify/chartcheck.py || STATUS=1

# Leave a scratch database empty behind us. Skipped for the live flow, where dropping
# tables would be destruction disguised as tidiness.
if [ "$SCRATCH" = "1" ]; then
  echo
  echo "Dropping scratch database tables"
  npm run --silent seed -- --clean > "$WORK/clean.log" 2>&1 || { cat "$WORK/clean.log" >&2; STATUS=1; }
fi

exit "$STATUS"
