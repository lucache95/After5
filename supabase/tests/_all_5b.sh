#!/usr/bin/env bash
# _all_5b.sh — 5b master run-all. Z → A → B → C (SQL+Deno) → D/E/F/G (Vitest) → H (E2E).
# Non-zero exit on any failure. See docs/superpowers/specs/2026-05-29-5b-H-e2e-ci-design.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
API_URL="http://127.0.0.1:54321"
FUNCTIONS_PID=""

cleanup() {
  if [[ -n "$FUNCTIONS_PID" ]] && kill -0 "$FUNCTIONS_PID" 2>/dev/null; then
    echo "==> tearing down functions-serve (pid $FUNCTIONS_PID)"
    kill "$FUNCTIONS_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "==> 0. preflight: stack reachable"
pg_isready -d "$DB_URL" >/dev/null 2>&1 || { echo "FAIL: local DB not up. Run \`supabase start\`." >&2; exit 1; }

echo "==> 1. db reset (applies Z/A/B/C migrations + seed)"
supabase db reset

echo "==> 2. SQL suite (Z → A → B → C; ON_ERROR_STOP — filename sort gives the order)"
for f in supabase/tests/*.sql; do
  echo "   -- $f"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> 3. SQL race harnesses (p5_concurrency_lib.sh is a sourced library — skip it)"
for h in supabase/tests/*races*.sh; do
  [[ -f "$h" ]] || continue
  echo "   -- $h"
  bash "$h"
done

echo "==> 4. Deno edge tests (stubbed — no functions-serve needed)"
# Scope to the 5b dirs (match-* + _shared). A bare `supabase/functions/` glob
# type-checks the WHOLE tree, and unrelated non-5b functions (process-jobs,
# start-verification) carry pre-existing TS errors that would fail the run.
deno test --allow-env --allow-net \
  --import-map=supabase/functions/_shared/_test_import_map.json \
  supabase/functions/match-*/ supabase/functions/_shared/

echo "==> 5. Web Vitest (D + E + F + G)"
pnpm --filter @after5/web test

echo "==> 6. start functions-serve for the E2E (reality #1: start does NOT serve functions)"
# Pull local keys from the running stack so the handler's env is satisfied.
# `supabase status -o env` emits ANON_KEY / SERVICE_ROLE_KEY (verified on CLI v2.101).
eval "$(supabase status -o env | sed 's/^/export /')"
export SUPABASE_URL="$API_URL"
export SUPABASE_ANON_KEY="${ANON_KEY:-${SUPABASE_ANON_KEY:-}}"
export SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"
supabase functions serve >/tmp/5b-functions-serve.log 2>&1 &
FUNCTIONS_PID=$!

echo "   -- waiting for functions-serve to answer (not 503)"
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/functions/v1/match-shortlist" \
    -H "apikey: ${SUPABASE_ANON_KEY}" -H 'content-type: application/json' -d '{}' || echo 000)
  if [[ "$code" != "503" && "$code" != "000" ]]; then echo "   functions-serve up (HTTP $code)"; break; fi
  if [[ "$i" == "60" ]]; then echo "FAIL: functions-serve never came up; see /tmp/5b-functions-serve.log" >&2; exit 1; fi
  sleep 1
done

echo "==> 7. Playwright E2E (happy path + negatives)"
export LOCAL_SUPABASE_PUBLISHABLE_KEY="${PUBLISHABLE_KEY:-${SUPABASE_ANON_KEY}}"
pnpm --filter @after5/web exec playwright test

echo "==> ALL 5b TESTS GREEN"
