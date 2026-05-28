#!/usr/bin/env bash
# supabase/tests/z_chat_thread_races.sh
# Z race harness -- concurrent open / promote-vs-close / close-on-promoted.
# Runs against local Supabase only (DB URI hard-coded to the default).
# See docs/superpowers/specs/2026-05-27-5b-Z-chat-core-design.md S2.6 + S5.2 #8.

set -euo pipefail

DB_URI="${DB_URI:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
PSQL=(psql --quiet --tuples-only --no-align -v ON_ERROR_STOP=1 "$DB_URI")

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

# --------------------------------------------------------------------------
# Seed a fresh actor + instance + offer for each race scenario.
# Uses a unique label so concurrent runs do not collide.
# --------------------------------------------------------------------------
seed_offer() {
  local label="$1"
  "${PSQL[@]}" <<SQL
\i supabase/tests/_fixtures.sql
DO \$\$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; off1 uuid;
BEGIN
  cre  := mk_user('${label}' || '_cre');
  cand := mk_user('${label}' || '_cand');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
    values (inst, cand, cre, 'active', now() + interval '1 day') returning id into off1;
  RAISE NOTICE 'OFFER:%', off1;
END \$\$;
SQL
}

extract_offer_uuid() {
  grep -oE 'OFFER:[0-9a-f-]{36}' | head -1 | cut -d: -f2
}

# --------------------------------------------------------------------------
# RACE 1: two sessions call open_chat_thread(same_offer) concurrently.
# Expected: both return the same uuid (one INSERTS, the other hits
# ON CONFLICT DO UPDATE and returns the existing row's id).
# --------------------------------------------------------------------------
echo "--- Race 1: concurrent open_chat_thread ---"
OFFER=$(seed_offer "race1" 2>&1 | extract_offer_uuid)
[ -n "$OFFER" ] || fail "Race 1: seed_offer returned no OFFER uuid"

OUT_A=$(mktemp); OUT_B=$(mktemp)
trap 'rm -f "$OUT_A" "$OUT_B"' EXIT

echo "SELECT open_chat_thread(:'offer'::uuid);" \
  | "${PSQL[@]}" -v offer="$OFFER" > "$OUT_A" 2>&1 &
PID_A=$!
echo "SELECT open_chat_thread(:'offer'::uuid);" \
  | "${PSQL[@]}" -v offer="$OFFER" > "$OUT_B" 2>&1 &
PID_B=$!
wait "$PID_A" "$PID_B"

UUID_A=$(grep -oE '[0-9a-f-]{36}' "$OUT_A" | head -1 || true)
UUID_B=$(grep -oE '[0-9a-f-]{36}' "$OUT_B" | head -1 || true)
[ -n "$UUID_A" ] || fail "Race 1: session A produced no uuid ($(cat "$OUT_A"))"
[ -n "$UUID_B" ] || fail "Race 1: session B produced no uuid ($(cat "$OUT_B"))"
[ "$UUID_A" = "$UUID_B" ] || fail "Race 1: open_chat_thread not idempotent under concurrency ($UUID_A != $UUID_B)"
pass "Race 1: concurrent open returns same uuid ($UUID_A)"

# --------------------------------------------------------------------------
# RACE 2: one session promotes, the other closes.
# Final state is promoted or closed (never anything else).
# revoked_at IS NULL iff state=promoted.
# --------------------------------------------------------------------------
echo "--- Race 2: concurrent promote-vs-close ---"
OFFER=$(seed_offer "race2" 2>&1 | extract_offer_uuid)
[ -n "$OFFER" ] || fail "Race 2: seed_offer returned no OFFER uuid"

# Seed a lock for the promote to reference, AND open the thread first.
# Note: bash variable expansion in unquoted heredoc; OFFER is a UUID (safe).
LOCK_UUID=$(
  "${PSQL[@]}" -t -A <<SQL 2>&1
DO \$\$
DECLARE inst uuid; cre uuid; cand uuid; lk uuid;
BEGIN
  SELECT date_instance_id INTO inst FROM offers WHERE id = '${OFFER}'::uuid;
  SELECT creator_id       INTO cre  FROM offers WHERE id = '${OFFER}'::uuid;
  SELECT candidate_id     INTO cand FROM offers WHERE id = '${OFFER}'::uuid;
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, cand, 'active') returning id into lk;
  RAISE NOTICE 'LOCK:%', lk;
  PERFORM open_chat_thread('${OFFER}'::uuid);
END \$\$;
SQL
)
LOCK=$(echo "$LOCK_UUID" | grep -oE 'LOCK:[0-9a-f-]{36}' | head -1 | cut -d: -f2)
[ -n "$LOCK" ] || fail "Race 2: lock seed produced no uuid"

OUT_P=$(mktemp); OUT_C=$(mktemp)
trap 'rm -f "$OUT_A" "$OUT_B" "$OUT_P" "$OUT_C"' EXIT

echo "SELECT promote_chat_thread_to_lock(:'offer'::uuid, :'lock'::uuid);" \
  | "${PSQL[@]}" -v offer="$OFFER" -v lock="$LOCK" > "$OUT_P" 2>&1 &
PID_P=$!
echo "SELECT close_chat_thread(:'offer'::uuid);" \
  | "${PSQL[@]}" -v offer="$OFFER" > "$OUT_C" 2>&1 &
PID_C=$!
wait "$PID_P" || true   # promote may raise if close went first
wait "$PID_C" || true   # close may no-op (state filter); never raises

FINAL_STATE=$(echo "SELECT state FROM chat_threads WHERE offer_id = :'offer'::uuid;" \
  | "${PSQL[@]}" -t -A -v offer="$OFFER")
FINAL_REVOKED=$(echo "SELECT revoked_at IS NOT NULL FROM chat_threads WHERE offer_id = :'offer'::uuid;" \
  | "${PSQL[@]}" -t -A -v offer="$OFFER")

case "$FINAL_STATE" in
  promoted)
    [ "$FINAL_REVOKED" = "f" ] || fail "Race 2: state=promoted but revoked_at set (partial state)"
    pass "Race 2: promote won (state=promoted, revoked_at NULL)"
    ;;
  closed)
    [ "$FINAL_REVOKED" = "t" ] || fail "Race 2: state=closed but revoked_at NULL (partial state)"
    grep -q "is not open" "$OUT_P" \
      || fail "Race 2: close won but promote did not raise [not open] ($(cat "$OUT_P"))"
    pass "Race 2: close won (state=closed, promote raised is-not-open)"
    ;;
  *)
    fail "Race 2: unexpected final state [$FINAL_STATE] (expected promoted or closed)"
    ;;
esac

# --------------------------------------------------------------------------
# RACE 3: thread is already promoted; two concurrent close calls.
# Expected: both no-op via state filter (close updates WHERE state=open).
# Final state remains promoted.
# --------------------------------------------------------------------------
echo "--- Race 3: concurrent close-on-promoted ---"
OFFER=$(seed_offer "race3" 2>&1 | extract_offer_uuid)
[ -n "$OFFER" ] || fail "Race 3: seed_offer returned no OFFER uuid"

# Seed: open + promote. Bash expands OFFER in unquoted heredoc.
"${PSQL[@]}" <<SQL
DO \$\$
DECLARE inst uuid; cre uuid; cand uuid; lk uuid;
BEGIN
  SELECT date_instance_id INTO inst FROM offers WHERE id = '${OFFER}'::uuid;
  SELECT creator_id       INTO cre  FROM offers WHERE id = '${OFFER}'::uuid;
  SELECT candidate_id     INTO cand FROM offers WHERE id = '${OFFER}'::uuid;
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, cand, 'active') returning id into lk;
  PERFORM open_chat_thread('${OFFER}'::uuid);
  PERFORM promote_chat_thread_to_lock('${OFFER}'::uuid, lk);
END \$\$;
SQL

OUT_C1=$(mktemp); OUT_C2=$(mktemp)
trap 'rm -f "$OUT_A" "$OUT_B" "$OUT_P" "$OUT_C" "$OUT_C1" "$OUT_C2"' EXIT

echo "SELECT close_chat_thread(:'offer'::uuid);" \
  | "${PSQL[@]}" -v offer="$OFFER" > "$OUT_C1" 2>&1 &
PID_1=$!
echo "SELECT close_chat_thread(:'offer'::uuid);" \
  | "${PSQL[@]}" -v offer="$OFFER" > "$OUT_C2" 2>&1 &
PID_2=$!
wait "$PID_1" "$PID_2"

FINAL_STATE=$(echo "SELECT state FROM chat_threads WHERE offer_id = :'offer'::uuid;" \
  | "${PSQL[@]}" -t -A -v offer="$OFFER")
[ "$FINAL_STATE" = "promoted" ] \
  || fail "Race 3: state changed from promoted to [$FINAL_STATE] under concurrent close"
pass "Race 3: concurrent close-on-promoted both no-op (state=promoted preserved)"

echo
echo "All race tests passed."
