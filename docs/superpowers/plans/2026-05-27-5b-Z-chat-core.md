# Sub-project Z — Chat-core amendments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Amend the existing chat-core primitives (already shipped via `20260525124500_p2_chat_core`) so `chat_lock_ready` returns `state='open'` at 5b launch, `promoted_at` is tracked, the `promote` UPDATE has a state filter to prevent partial-state races, and Z's test surface is complete (race harness + negative-authz + negative-RLS).

**Architecture:** Two thin migrations (each one `CREATE OR REPLACE FUNCTION` + targeted DDL). TDD ordering: update tests with NEW assertions first (test fails), then apply migration (test passes), then commit migration + test together. Race harness is a bash two-session driver against local supabase Postgres. Doc amendments at the end reconcile upstream artifacts with as-built reality.

**Tech Stack:** Postgres 15 (Supabase) PL/pgSQL `SECURITY DEFINER`, psql, bash, `mcp__supabase__apply_migration` (prod), `mcp__supabase__get_advisors`.

---

## Pre-flight (run once before Task 1)

**Verify local Supabase is running and the existing chat-core baseline is green.**

- [ ] **Pre-flight Step 1: Confirm local supabase is up.**

Run: `supabase status`
Expected: shows `API URL`, `DB URL`, `Studio URL` lines. If not running, `supabase start`.

- [ ] **Pre-flight Step 2: Confirm the existing test file passes against the un-amended baseline.**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/p2_chat_core.sql`
Expected: ends with multiple `NOTICE: chat-core ... OK` lines and `ROLLBACK`. Exit code 0.

If the test fails here, STOP and reconcile local state before continuing. The plan assumes local prod-parity from `20260525124500_p2_chat_core`.

- [ ] **Pre-flight Step 3: Confirm working tree clean except for known untracked items.**

Run: `git status --short`
Expected: only the known modified `supabase/config.toml` + untracked items (`.understand-anything/`, etc. — none of which are touched by this plan).

If anything ELSE is modified, stash or commit first.

---

## Task 1: Update p2_chat_core.sql with Z.1 expectations (failing tests)

**Files:**
- Modify: `supabase/tests/p2_chat_core.sql:1-92`

**Goal:** Replace the `both_ready` manipulation lines + flip the assertion "lock gate should be closed before rapport" → "lock gate stays open until promote/close." After this step the test FAILS against the un-amended `chat_lock_ready` body — that's the TDD red phase for Z.1.

- [ ] **Step 1: Read the current test file to understand structure.**

Run: `wc -l supabase/tests/p2_chat_core.sql`
Expected: 92 lines.

- [ ] **Step 2: Replace the chat_lock_ready assertion block.**

In `supabase/tests/p2_chat_core.sql`, find the block (currently lines 26-30):

```sql
  -- chat_lock_ready: false until both_ready; null-safe for a missing thread
  IF chat_lock_ready(t1) THEN RAISE EXCEPTION 'lock gate should be closed before rapport'; END IF;
  IF chat_lock_ready(gen_random_uuid()) THEN RAISE EXCEPTION 'lock gate should be false for missing thread'; END IF;
  update chat_threads set both_ready = true where id = t1;
  IF NOT chat_lock_ready(t1) THEN RAISE EXCEPTION 'lock gate should open once both_ready'; END IF;
```

Replace with the Z.1-semantics block:

```sql
  -- chat_lock_ready (Z.1): true while state='open', false otherwise; null-safe for missing thread
  IF NOT chat_lock_ready(t1) THEN RAISE EXCEPTION 'Z.1: lock gate should be open immediately after open_chat_thread (state=open)'; END IF;
  IF chat_lock_ready(gen_random_uuid()) THEN RAISE EXCEPTION 'Z.1: lock gate should be false for missing thread'; END IF;
```

(The third "open after both_ready" assertion is removed — `both_ready` is no longer the gate signal at 5b launch; Phase 7 will reintroduce its own coverage.)

- [ ] **Step 3: Add post-promote chat_lock_ready=false assertion + post-close chat_lock_ready=false assertion to the existing DO block.**

Immediately after the existing `promote_chat_thread_to_lock(off1, lk)` call and its `state='promoted'` assertion (currently lines 33-37), add:

```sql
  -- Z.1: after promote, state='promoted' → chat_lock_ready returns false
  IF chat_lock_ready(t1) THEN RAISE EXCEPTION 'Z.1: lock gate should close after promote (state=promoted)'; END IF;
```

And in the second DO block (the `close-open` block, currently lines 56-71), immediately after the `state='closed'` assertion, add:

```sql
  -- Z.1: after close, state='closed' → chat_lock_ready returns false
  IF chat_lock_ready(t1) THEN RAISE EXCEPTION 'Z.1: lock gate should be false after close (state=closed)'; END IF;
```

- [ ] **Step 4: Run the test to see it fail.**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/p2_chat_core.sql 2>&1 | tail -20`

Expected output contains: `ERROR:  Z.1: lock gate should be open immediately after open_chat_thread (state=open)`

This is the TDD red phase for Z.1. Do NOT proceed to commit yet.

---

## Task 2: Z.1 migration — `chat_lock_ready` body amendment

**Files:**
- Create: `supabase/migrations/20260527124551_z_chat_lock_ready_5b_launch.sql`

**Goal:** Replace `chat_lock_ready`'s body so it returns `state='open'`. Existing function privileges (REVOKE FROM public, authenticated) preserved.

- [ ] **Step 1: Create the migration file.**

Write to `supabase/migrations/20260527124551_z_chat_lock_ready_5b_launch.sql`:

```sql
-- 20260527124551_z_chat_lock_ready_5b_launch.sql
-- Z.1: amend chat_lock_ready body so the gate is meaningful at 5b launch.
-- At launch: returns true iff thread exists AND state='open'.
-- Phase 7 will redefine to ADD AND-conditions for rapport, without changing
-- the signature or A's call sites. See docs/superpowers/specs/2026-05-27-5b-Z-chat-core-design.md §2.3.

create or replace function chat_lock_ready(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select state = 'open' from chat_threads where id = p_thread), false);
$$;

-- Re-apply revokes (CREATE OR REPLACE preserves them on Postgres ≥10, but make explicit for clarity)
revoke execute on function chat_lock_ready(uuid) from public, authenticated;
```

- [ ] **Step 2: Apply the migration locally.**

Run: `supabase migration up`

Expected: output includes `Applying migration 20260527124551_z_chat_lock_ready_5b_launch.sql...` and exits 0.

Alternative if `supabase migration up` complains about history drift:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/20260527124551_z_chat_lock_ready_5b_launch.sql
```

- [ ] **Step 3: Run the test — Z.1 assertions now pass; Z.2 assertions still missing (no failures yet, since Task 1 only added Z.1 assertions).**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/p2_chat_core.sql 2>&1 | tail -10`

Expected: `NOTICE: chat-core open/ready/promote(+missing raise)/close-guard OK` + `NOTICE: chat-core close-open OK` + `NOTICE: chat-core legal-hold delete guard OK`. Exit code 0.

If a test fails, STOP. Compare the failing assertion against §2.3 of the spec.

- [ ] **Step 4: Commit Z.1 migration + test update together.**

```bash
git add supabase/migrations/20260527124551_z_chat_lock_ready_5b_launch.sql \
        supabase/tests/p2_chat_core.sql
git commit -m "feat(5b-Z.1): amend chat_lock_ready to state='open' predicate

At 5b launch the lock gate returns true iff thread exists AND state='open'
(per overview spec §2.4 and Z spec §2.3). Replaces the both_ready-coupled
body, which left every newly-opened thread gating false and would have
blocked A's match_accept_offer.

Phase 7 forward-compat: redefine the body to add AND-conditions for
rapport without changing the signature.

Tests updated in-place (drop both_ready manipulation; assert open=true,
promoted=false, closed=false, missing=false).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Update p2_chat_core.sql with Z.2 expectations (failing tests)

**Files:**
- Modify: `supabase/tests/p2_chat_core.sql`

**Goal:** Add assertions for the `promoted_at` column + state-filter hardening + negative-authz + negative-RLS. After this step those assertions FAIL — TDD red phase for Z.2.

- [ ] **Step 1: Add `promoted_at` assertion to the first DO block (immediately after the existing promote/state assertion).**

In the first DO block, immediately after the existing line:

```sql
  IF st <> 'promoted' THEN RAISE EXCEPTION 'promote did not set state=promoted, got %', st; END IF;
```

Add:

```sql
  -- Z.2: promote sets promoted_at (non-null, recent)
  PERFORM 1 FROM chat_threads WHERE id = t1 AND promoted_at IS NOT NULL AND promoted_at >= created_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'Z.2: promote should set promoted_at >= created_at'; END IF;
```

- [ ] **Step 2: Add a NEW DO block at the bottom of the file — state-filter hardening test.**

After the last `END $$;` line (line 91), append:

```sql

-- Z.2: promote_chat_thread_to_lock refuses non-open threads
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; off1 uuid; lk uuid; t1 uuid; ok boolean := false;
BEGIN
  cre := mk_user('sf_cre'); cand := mk_user('sf_cand');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
    values (inst, cand, cre, 'active', now() + interval '1 day') returning id into off1;
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, cand, 'active') returning id into lk;
  t1 := open_chat_thread(off1);
  -- Close first; then promote must raise
  PERFORM close_chat_thread(off1);
  BEGIN
    PERFORM promote_chat_thread_to_lock(off1, lk);
  EXCEPTION WHEN others THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'Z.2: promote on a CLOSED thread must raise (state filter)'; END IF;
  RAISE NOTICE 'Z.2: promote state-filter (closed→raise) OK';
  ROLLBACK;
END $$;

-- Z.2: promote_chat_thread_to_lock is idempotent within state='open' (re-promote no-ops cleanly via state filter)
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; off1 uuid; lk uuid; t1 uuid; ok boolean := false;
BEGIN
  cre := mk_user('rp_cre'); cand := mk_user('rp_cand');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
    values (inst, cand, cre, 'active', now() + interval '1 day') returning id into off1;
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, cand, 'active') returning id into lk;
  t1 := open_chat_thread(off1);
  PERFORM promote_chat_thread_to_lock(off1, lk);
  -- Second promote on already-promoted thread must raise (state filter, "not open")
  BEGIN
    PERFORM promote_chat_thread_to_lock(off1, lk);
  EXCEPTION WHEN others THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'Z.2: second promote on already-promoted thread must raise'; END IF;
  RAISE NOTICE 'Z.2: promote state-filter (already-promoted→raise) OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 3: Add a negative-authz DO block at the bottom — verifies REVOKE FROM authenticated works.**

Append after the previous additions:

```sql

-- Z: negative-authz — authenticated role cannot call chat_* RPCs directly (REVOKE confirmed)
DO $$
DECLARE ok boolean := false; off_uuid uuid := gen_random_uuid();
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM open_chat_thread(off_uuid);
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
    WHEN others THEN
      -- Any other error (FK violation, etc.) also indicates we passed the auth gate erroneously
      RAISE EXCEPTION 'Z: open_chat_thread reachable from authenticated — got %, expected insufficient_privilege', sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'Z: open_chat_thread MUST raise insufficient_privilege when called as authenticated'; END IF;
  RAISE NOTICE 'Z: negative-authz (open_chat_thread → insufficient_privilege) OK';
  -- RESET ROLE happens at transaction end (DO block rollback)
  ROLLBACK;
END $$;
```

- [ ] **Step 4: Add a negative-RLS DO block at the bottom — verifies authenticated role gets zero rows from chat_threads.**

Append:

```sql

-- Z: negative-RLS — authenticated role SELECT on chat_threads returns 0 rows (RLS-enabled-no-policies → default-deny)
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; off1 uuid; t1 uuid; n int;
BEGIN
  cre := mk_user('rls_cre'); cand := mk_user('rls_cand');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
    values (inst, cand, cre, 'active', now() + interval '1 day') returning id into off1;
  t1 := open_chat_thread(off1);
  -- Confirm row exists from postgres role
  SELECT count(*) INTO n FROM chat_threads WHERE id = t1;
  IF n <> 1 THEN RAISE EXCEPTION 'Z: precondition — postgres role should see the row; saw %', n; END IF;
  -- Now switch to authenticated and confirm RLS hides it
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM chat_threads WHERE id = t1;
  IF n <> 0 THEN RAISE EXCEPTION 'Z: negative-RLS — authenticated role should see 0 rows; saw %', n; END IF;
  RAISE NOTICE 'Z: negative-RLS (authenticated → 0 rows) OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 5: Run the test to see Z.2 assertions fail.**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/p2_chat_core.sql 2>&1 | tail -20`

Expected: first failure is `ERROR:  Z.2: promote should set promoted_at >= created_at` (column doesn't exist yet, but `IF NOT FOUND` catches the empty result; actually since `promoted_at` column doesn't exist, the query itself errors with `column "promoted_at" does not exist`).

This is the TDD red phase for Z.2.

---

## Task 4: Z.2 migration — `promoted_at` column + state-filter hardening

**Files:**
- Create: `supabase/migrations/20260527124552_z_chat_threads_promoted_at.sql`

**Goal:** Add `promoted_at` column, backfill, harden `promote_chat_thread_to_lock` UPDATE with `AND state='open'` filter and split the row_count=0 raise into two distinguishable messages.

- [ ] **Step 1: Create the migration file.**

Write to `supabase/migrations/20260527124552_z_chat_threads_promoted_at.sql`:

```sql
-- 20260527124552_z_chat_threads_promoted_at.sql
-- Z.2: add promoted_at column + harden promote with state-filter to close
-- the partial-state race surfaced during Z spec self-review (R-Z4).
-- See docs/superpowers/specs/2026-05-27-5b-Z-chat-core-design.md §2.4.

alter table chat_threads add column if not exists promoted_at timestamptz;

-- Backfill: any thread already in state='promoted' from local test runs gets coalesce(updated_at).
-- On prod this is a no-op (zero rows expected).
update chat_threads
   set promoted_at = updated_at
 where state = 'promoted' and promoted_at is null;

create or replace function promote_chat_thread_to_lock(p_offer uuid, p_lock uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  update chat_threads
     set lock_id = p_lock,
         state = 'promoted',
         promoted_at = coalesce(promoted_at, now()),
         updated_at = now()
   where offer_id = p_offer
     and state = 'open';                 -- Z.2 guard: refuses promote on closed/already-promoted
  get diagnostics v_n = row_count;
  if v_n = 0 then
    -- Distinguish missing thread vs wrong-state for caller's translation
    if not exists (select 1 from chat_threads where offer_id = p_offer) then
      raise exception 'promote_chat_thread_to_lock: no chat thread for offer %', p_offer;
    else
      raise exception 'promote_chat_thread_to_lock: thread for offer % is not open', p_offer;
    end if;
  end if;
end $fn$;

revoke execute on function promote_chat_thread_to_lock(uuid, uuid) from public, authenticated;
```

- [ ] **Step 2: Apply the migration locally.**

Run: `supabase migration up`

Expected: includes `Applying migration 20260527124552_z_chat_threads_promoted_at.sql...` and exits 0.

Alternative:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/20260527124552_z_chat_threads_promoted_at.sql
```

- [ ] **Step 3: Run the test — all Z.2 assertions now pass.**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/p2_chat_core.sql 2>&1 | tail -20`

Expected output (last lines should be all NOTICE, no ERROR):

```
NOTICE:  chat-core open/ready/promote(+missing raise)/close-guard OK
NOTICE:  chat-core close-open OK
NOTICE:  chat-core legal-hold delete guard OK
NOTICE:  Z.2: promote state-filter (closed→raise) OK
NOTICE:  Z.2: promote state-filter (already-promoted→raise) OK
NOTICE:  Z: negative-authz (open_chat_thread → insufficient_privilege) OK
NOTICE:  Z: negative-RLS (authenticated → 0 rows) OK
```

Exit code 0.

- [ ] **Step 4: Commit Z.2 migration + remaining test additions.**

```bash
git add supabase/migrations/20260527124552_z_chat_threads_promoted_at.sql \
        supabase/tests/p2_chat_core.sql
git commit -m "feat(5b-Z.2): promoted_at column + promote state-filter hardening

Adds chat_threads.promoted_at (nullable timestamptz, set by promote_chat_thread_to_lock).
Hardens promote_chat_thread_to_lock UPDATE with WHERE state='open' filter to
close the partial-state race (close-then-promote) surfaced during Z spec
self-review (R-Z4). When the UPDATE matches zero rows, distinguishes
'no thread for offer' (programmer bug) from 'thread is not open'
(legitimate race losing) for caller translation.

Tests added in-place: promoted_at assertion + 2 state-filter DO blocks
(closed→raise, already-promoted→raise) + negative-authz (REVOKE check) +
negative-RLS (default-deny check).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Race harness — z_chat_thread_races.sh

**Files:**
- Create: `supabase/tests/z_chat_thread_races.sh`

**Goal:** Two-session bash race harness covering the three concurrent scenarios from spec §2.6. Sets `chmod +x` so it runs as a script.

- [ ] **Step 1: Create the harness file with header + seed helper.**

Write to `supabase/tests/z_chat_thread_races.sh`:

```bash
#!/usr/bin/env bash
# supabase/tests/z_chat_thread_races.sh
# Z race harness — concurrent open / promote-vs-close / close-on-promoted.
# Runs against local Supabase only (DB URI hard-coded to the default).
# See docs/superpowers/specs/2026-05-27-5b-Z-chat-core-design.md §2.6 + §5.2 #8.

set -euo pipefail

DB_URI="${DB_URI:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
PSQL=(psql --quiet --tuples-only --no-align -v ON_ERROR_STOP=1 "$DB_URI")

# Helper: print pass/fail with prefix
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

# --------------------------------------------------------------------------
# Seed a fresh actor + instance + offer for each race scenario. Returns the
# offer uuid on stdout. Uses a unique label so concurrent runs don't collide.
# --------------------------------------------------------------------------
seed_offer() {
  local label="$1"
  "${PSQL[@]}" <<EOF
\i supabase/tests/_fixtures.sql
DO \$\$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; off1 uuid;
BEGIN
  cre := mk_user('$label' || '_cre');
  cand := mk_user('$label' || '_cand');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
    values (inst, cand, cre, 'active', now() + interval '1 day') returning id into off1;
  RAISE NOTICE 'OFFER:%', off1;
END \$\$;
EOF
}

# Extract OFFER:<uuid> from psql NOTICE output
extract_offer_uuid() {
  grep -oE 'OFFER:[0-9a-f-]{36}' | head -1 | cut -d: -f2
}
```

- [ ] **Step 2: Append Race 1 (concurrent open returns same uuid).**

Append to `supabase/tests/z_chat_thread_races.sh`:

```bash

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

"${PSQL[@]}" -c "SELECT open_chat_thread('$OFFER'::uuid)" > "$OUT_A" 2>&1 &
PID_A=$!
"${PSQL[@]}" -c "SELECT open_chat_thread('$OFFER'::uuid)" > "$OUT_B" 2>&1 &
PID_B=$!
wait "$PID_A" "$PID_B"

UUID_A=$(grep -oE '[0-9a-f-]{36}' "$OUT_A" | head -1 || true)
UUID_B=$(grep -oE '[0-9a-f-]{36}' "$OUT_B" | head -1 || true)
[ -n "$UUID_A" ] || fail "Race 1: session A produced no uuid (out: $(cat $OUT_A))"
[ -n "$UUID_B" ] || fail "Race 1: session B produced no uuid (out: $(cat $OUT_B))"
[ "$UUID_A" = "$UUID_B" ] || fail "Race 1: open_chat_thread not idempotent under concurrency ($UUID_A != $UUID_B)"
pass "Race 1: concurrent open returns same uuid ($UUID_A)"
```

- [ ] **Step 3: Append Race 2 (promote-vs-close → deterministic, no partial state).**

Append:

```bash

# --------------------------------------------------------------------------
# RACE 2: one session promotes, the other closes. With Z.2's state-filter
# hardening, the outcome is deterministic: whichever statement acquires
# the row lock first wins. Final state ∈ {'promoted','closed'} (never
# anything else); revoked_at IS NULL iff state='promoted'.
# --------------------------------------------------------------------------
echo "--- Race 2: concurrent promote-vs-close ---"
OFFER=$(seed_offer "race2" 2>&1 | extract_offer_uuid)
[ -n "$OFFER" ] || fail "Race 2: seed_offer returned no OFFER uuid"

# Seed a lock for the promote to reference, AND open the thread first.
LOCK_UUID=$(
  "${PSQL[@]}" -t -A <<EOF
DO \$\$
DECLARE inst uuid; cre uuid; cand uuid; lk uuid;
BEGIN
  SELECT date_instance_id INTO inst FROM offers WHERE id = '$OFFER';
  SELECT creator_id INTO cre FROM offers WHERE id = '$OFFER';
  SELECT candidate_id INTO cand FROM offers WHERE id = '$OFFER';
  -- date_instances.creator_id is the offer's creator
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, cand, 'active') returning id into lk;
  RAISE NOTICE 'LOCK:%', lk;
  PERFORM open_chat_thread('$OFFER');
END \$\$;
EOF
)
LOCK=$(echo "$LOCK_UUID" | grep -oE 'LOCK:[0-9a-f-]{36}' | head -1 | cut -d: -f2)
[ -n "$LOCK" ] || fail "Race 2: lock seed produced no uuid"

OUT_P=$(mktemp); OUT_C=$(mktemp)
trap 'rm -f "$OUT_A" "$OUT_B" "$OUT_P" "$OUT_C"' EXIT

"${PSQL[@]}" -c "SELECT promote_chat_thread_to_lock('$OFFER'::uuid, '$LOCK'::uuid)" > "$OUT_P" 2>&1 &
PID_P=$!
"${PSQL[@]}" -c "SELECT close_chat_thread('$OFFER'::uuid)" > "$OUT_C" 2>&1 &
PID_C=$!
wait "$PID_P" || true  # promote may raise if close went first
wait "$PID_C" || true  # close may no-op (state-filter); never raises

# Inspect final state
FINAL_STATE=$("${PSQL[@]}" -t -A -c "SELECT state FROM chat_threads WHERE offer_id = '$OFFER'")
FINAL_REVOKED=$("${PSQL[@]}" -t -A -c "SELECT revoked_at IS NOT NULL FROM chat_threads WHERE offer_id = '$OFFER'")

case "$FINAL_STATE" in
  promoted)
    [ "$FINAL_REVOKED" = "f" ] || fail "Race 2: state=promoted but revoked_at set — partial state"
    pass "Race 2: promote won (state=promoted, revoked_at NULL)"
    ;;
  closed)
    [ "$FINAL_REVOKED" = "t" ] || fail "Race 2: state=closed but revoked_at NULL — partial state"
    # promote should have raised
    grep -q "is not open" "$OUT_P" || fail "Race 2: close won but promote did not raise 'not open' (out: $(cat $OUT_P))"
    pass "Race 2: close won (state=closed, promote raised 'not open')"
    ;;
  *)
    fail "Race 2: unexpected final state '$FINAL_STATE' (expected 'promoted' or 'closed')"
    ;;
esac
```

- [ ] **Step 4: Append Race 3 (close-on-promoted is idempotent no-op).**

Append:

```bash

# --------------------------------------------------------------------------
# RACE 3: thread is already 'promoted'; two concurrent close calls.
# Expected: both no-op via state filter (close updates WHERE state='open').
# Final state remains 'promoted'.
# --------------------------------------------------------------------------
echo "--- Race 3: concurrent close-on-promoted ---"
OFFER=$(seed_offer "race3" 2>&1 | extract_offer_uuid)
[ -n "$OFFER" ] || fail "Race 3: seed_offer returned no OFFER uuid"

# Seed: open + promote
"${PSQL[@]}" <<EOF
DO \$\$
DECLARE inst uuid; cre uuid; cand uuid; lk uuid;
BEGIN
  SELECT date_instance_id INTO inst FROM offers WHERE id = '$OFFER';
  SELECT creator_id INTO cre FROM offers WHERE id = '$OFFER';
  SELECT candidate_id INTO cand FROM offers WHERE id = '$OFFER';
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, cand, 'active') returning id into lk;
  PERFORM open_chat_thread('$OFFER');
  PERFORM promote_chat_thread_to_lock('$OFFER', lk);
END \$\$;
EOF

OUT_C1=$(mktemp); OUT_C2=$(mktemp)
trap 'rm -f "$OUT_A" "$OUT_B" "$OUT_P" "$OUT_C" "$OUT_C1" "$OUT_C2"' EXIT

"${PSQL[@]}" -c "SELECT close_chat_thread('$OFFER'::uuid)" > "$OUT_C1" 2>&1 &
PID_1=$!
"${PSQL[@]}" -c "SELECT close_chat_thread('$OFFER'::uuid)" > "$OUT_C2" 2>&1 &
PID_2=$!
wait "$PID_1" "$PID_2"

FINAL_STATE=$("${PSQL[@]}" -t -A -c "SELECT state FROM chat_threads WHERE offer_id = '$OFFER'")
[ "$FINAL_STATE" = "promoted" ] || fail "Race 3: state changed from 'promoted' to '$FINAL_STATE' under concurrent close"
pass "Race 3: concurrent close-on-promoted both no-op (state=promoted preserved)"

echo
echo "All race tests passed."
```

- [ ] **Step 5: Make the harness executable.**

Run: `chmod +x supabase/tests/z_chat_thread_races.sh`

- [ ] **Step 6: Run the harness.**

Run: `bash supabase/tests/z_chat_thread_races.sh`

Expected output:

```
--- Race 1: concurrent open_chat_thread ---
PASS: Race 1: concurrent open returns same uuid (<some-uuid>)
--- Race 2: concurrent promote-vs-close ---
PASS: Race 2: promote won (state=promoted, revoked_at NULL)
  (or)
PASS: Race 2: close won (state=closed, promote raised 'not open')
--- Race 3: concurrent close-on-promoted ---
PASS: Race 3: concurrent close-on-promoted both no-op (state=promoted preserved)

All race tests passed.
```

Exit code 0.

If Race 2 flakes (i.e., reports different outcomes across runs), that's EXPECTED — it's a real race. The test is still correct as long as one of the two pass paths fires. Re-run if curious.

If any test FAILS (e.g., "partial state" message), STOP and debug — there's a real bug in Z.2's state filter.

- [ ] **Step 7: Commit the race harness.**

```bash
git add supabase/tests/z_chat_thread_races.sh
git commit -m "test(5b-Z): race harness for chat-core concurrency

Three two-session bash race scenarios:
- Race 1: concurrent open_chat_thread returns same uuid (idempotency)
- Race 2: promote-vs-close deterministic, no partial state (Z.2 state filter)
- Race 3: concurrent close-on-promoted both no-op (state guard)

Pattern lifted from S5's harnesses; will be reused by A's
p5_concurrency_lib.sh shape.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Apply Z.1 to prod (per runbook discipline)

**Files:**
- Modify: `docs/superpowers/plans/5b-prod-migration-rollout.md` (Applied to prod log)

**Goal:** Apply `20260527124551_z_chat_lock_ready_5b_launch.sql` to prod ref `ufufmcpnysvwtutpbian` via `mcp__supabase__apply_migration`. Per-migration verify cycle.

- [ ] **Step 1: Pre-apply verification — confirm prod is at the expected baseline.**

Use `mcp__supabase__execute_sql`:

```sql
-- Current chat_lock_ready body should still be the both_ready version
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='chat_lock_ready';
```

Expected: body contains `coalesce((select both_ready from chat_threads ...))`. If it already contains `state = 'open'`, this migration has already been applied — STOP and reconcile the log.

- [ ] **Step 2: Apply Z.1 via Supabase MCP.**

Use `mcp__supabase__apply_migration` with:
- `name`: `20260527124551_z_chat_lock_ready_5b_launch`
- `query`: the full contents of `supabase/migrations/20260527124551_z_chat_lock_ready_5b_launch.sql`

Expected: returns success object.

- [ ] **Step 3: Post-apply verification.**

Use `mcp__supabase__execute_sql`:

```sql
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='chat_lock_ready';
```

Expected: body now contains `state = 'open'`.

Then:

```sql
-- Confirm the function still revoked from authenticated
SELECT has_function_privilege('authenticated', 'public.chat_lock_ready(uuid)', 'execute');
```

Expected: `false`.

- [ ] **Step 4: Security advisor check.**

Use `mcp__supabase__get_advisors` with `type=security`.

Expected: no NEW findings on `chat_lock_ready` or `chat_threads`. Existing advisories from earlier migrations are unchanged.

If a new finding appears, STOP — triage before continuing.

- [ ] **Step 5: Update the runbook's Applied to prod log.**

In `docs/superpowers/plans/5b-prod-migration-rollout.md`, find the table (currently shows only `_(none yet — runbook drafted 2026-05-27; no apply yet)_`) and append a row:

```markdown
| `20260527124551_z_chat_lock_ready_5b_launch` | <YYYY-MM-DDThh:mm:ssZ UTC> | GREEN | Z.1 chat_lock_ready body → state='open' predicate. Body verified post-apply. has_function_privilege('authenticated', ...) returned false. Advisor clean. |
```

(Fill in the actual UTC timestamp when applying.)

- [ ] **Step 6: Commit the runbook update.**

```bash
git add docs/superpowers/plans/5b-prod-migration-rollout.md
git commit -m "ops(5b-Z.1): apply chat_lock_ready amendment to prod

Applied 20260527124551_z_chat_lock_ready_5b_launch via Supabase MCP.
Post-apply: function body verified contains state='open'; REVOKE from
authenticated confirmed; security advisor GREEN.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Apply Z.2 to prod (per runbook discipline)

**Files:**
- Modify: `docs/superpowers/plans/5b-prod-migration-rollout.md` (Applied to prod log)

**Goal:** Apply `20260527124552_z_chat_threads_promoted_at.sql` to prod. Per-migration verify cycle.

- [ ] **Step 1: Pre-apply verification.**

```sql
SELECT to_regclass('public.chat_threads') IS NOT NULL AS table_present;
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='chat_threads' AND column_name='promoted_at';
```

Expected: `table_present = true`; second query returns zero rows (column NOT yet present).

If `promoted_at` already exists, this migration has been applied — STOP.

- [ ] **Step 2: Apply Z.2 via Supabase MCP.**

Use `mcp__supabase__apply_migration` with:
- `name`: `20260527124552_z_chat_threads_promoted_at`
- `query`: the full contents of `supabase/migrations/20260527124552_z_chat_threads_promoted_at.sql`

Expected: returns success object.

- [ ] **Step 3: Post-apply verification.**

```sql
-- Column added
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='chat_threads' AND column_name='promoted_at';
-- Expected: 1 row, timestamp with time zone

-- Function body now contains the state filter
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='promote_chat_thread_to_lock';
-- Expected: body contains "and state = 'open'" and the distinguishing IF NOT EXISTS branch

-- REVOKE preserved
SELECT has_function_privilege('authenticated', 'public.promote_chat_thread_to_lock(uuid,uuid)', 'execute');
-- Expected: false
```

- [ ] **Step 4: Security advisor check.**

Use `mcp__supabase__get_advisors` with `type=security`.

Expected: no NEW findings.

- [ ] **Step 5: Update the runbook log.**

Append a row to the table:

```markdown
| `20260527124552_z_chat_threads_promoted_at` | <YYYY-MM-DDThh:mm:ssZ UTC> | GREEN | Z.2 column add + promote state-filter hardening. Column verified; function body verified contains state filter; advisor clean. |
```

- [ ] **Step 6: Commit the runbook update.**

```bash
git add docs/superpowers/plans/5b-prod-migration-rollout.md
git commit -m "ops(5b-Z.2): apply promoted_at + promote state-filter to prod

Applied 20260527124552_z_chat_threads_promoted_at via Supabase MCP.
Post-apply: column added; function body verified contains AND state='open'
filter; REVOKE preserved; security advisor GREEN.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Amend overview spec § Z deliverables

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md:46-58`

**Goal:** Strike outdated bullets and add the as-built bullets so the spec doesn't lie about the prod shape. Replace the existing § Z block with the reconciled version.

- [ ] **Step 1: Read the current § Z block to confirm line range.**

Run: `sed -n '46,58p' docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md`

Confirms the lines shown in the Read tool earlier.

- [ ] **Step 2: Replace the § Z block.**

Open `docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md`. Find the heading `### Z — Chat-core primitives` (line 46) through the blank line before `### A — Backend happy path` (line 58). Replace the deliverables block with:

```markdown
### Z — Chat-core primitives
**Goal:** Provide the four thread-state functions A consumes (`open_chat_thread`, `chat_lock_ready`, `promote_chat_thread_to_lock`, `close_chat_thread`) and the `chat_threads` table they read/write. Chat-core already shipped in S2 band 124500 (`20260525124500_p2_chat_core`); Z's 5b deliverables are amendments only.

**Deliverables (Z is amendment-only — see `docs/superpowers/specs/2026-05-27-5b-Z-chat-core-design.md`):**
- `chat_threads` table — exact as-built shape on prod: `id uuid PK, offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE UNIQUE, lock_id uuid NULL REFERENCES locks(id) ON DELETE SET NULL, state text NOT NULL CHECK in ('open','promoted','closed') DEFAULT 'open', both_ready bool DEFAULT false, legal_hold bool DEFAULT false, revoked_at timestamptz, promoted_at timestamptz (Z.2), created_at, updated_at`. Structural 1:1 with offers via `offer_id UNIQUE`. `state` uses text+CHECK rather than an enum — functionally equivalent; an enum upgrade is **deferred to Phase 7** if needed.
- `chat_lock_ready(thread uuid) returns bool` (Z.1 5b amendment) — returns `state='open'` (true while thread is open, false after promote/close, false for missing thread). Phase 7 redefines internally by adding AND-conditions for rapport, without changing the signature.
- `promote_chat_thread_to_lock(offer, lock)` (Z.2 hardening) — UPDATE filtered by `AND state='open'` so concurrent close-then-promote can never produce partial state; distinguishes "no thread for offer" vs "thread is not open" in its RAISE for caller translation.
- `promoted_at` timestamptz column (Z.2 add) — set by `promote_chat_thread_to_lock`; supports 5b analytics + Phase 7 rapport-to-promotion latency metrics.
- Migrations in **S2 band 124500** (NOT P5 band — chat-core is canonically S2).
- RLS on `chat_threads`: enabled with **zero policies** (default-deny). Only SECURITY DEFINER paths (Z's RPCs called by A's match_* RPCs) can read/write. Participant-read policy is **Phase 7's responsibility** (referenced inline in the original migration's source comments).
- Auth model: Z's functions are NOT public RPCs (`REVOKE EXECUTE FROM public, authenticated`); invariant §2.5 #7 (`auth.uid()=p_actor`) is enforced one layer up at A's match_* RPCs. Negative-authz test verifies the REVOKE.
- Tests: in-place updates to `supabase/tests/p2_chat_core.sql` (4-combo lock_ready + promoted_at + state-filter + negative-authz + negative-RLS) + new `supabase/tests/z_chat_thread_races.sh` (two-session bash race harness).

**Phase 7 expansions (NOT 5b):** participants column (if join-overhead becomes a hot path), enum upgrade for state, separate `closed_at`/`promoted_at` (if `revoked_at` semantics get muddier), `'ready'` substate between open and promoted (gated by rapport — chat_lock_ready redefined to AND-include the rapport check), participant-read RLS policy.

**Depends on:** S1 schema spine + S2 chat-core baseline (`20260525124500_p2_chat_core`) already on prod.
```

- [ ] **Step 3: Commit the spec amendment.**

```bash
git add docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md
git commit -m "docs(5b): amend overview spec § Z to match as-built prod shape

Task 0 surfaced that chat-core primitives already shipped via
20260525124500_p2_chat_core. The original § Z deliverables list described
participants uuid[2] + chat_thread_state enum + separate closed_at +
participant-read RLS — none of which prod has. § Z is now the truthful
amendment surface: as-built shape + Z.1/Z.2 amendments + Phase 7
expansion list.

Sourcing: docs/superpowers/specs/2026-05-27-5b-Z-chat-core-design.md
(Z's brainstorm output, committed earlier this session).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Amend master roadmap Task 1 acceptance criteria

**Files:**
- Modify: `docs/superpowers/plans/2026-05-27-5b-master-roadmap.md:105-115` (Task 1 acceptance criteria)

**Goal:** Replace Task 1's acceptance criteria with a pointer to Z's spec (which has the authoritative list now). Avoids two-places-to-update drift.

- [ ] **Step 1: Find the current Task 1 acceptance criteria block.**

Run: `sed -n '105,116p' docs/superpowers/plans/2026-05-27-5b-master-roadmap.md`

Should show the bullet list starting with `- chat_threads table exists on local + prod with the exact shape: ...`.

- [ ] **Step 2: Replace the acceptance-criteria block with a pointer.**

Open `docs/superpowers/plans/2026-05-27-5b-master-roadmap.md`. Find the `**Acceptance criteria:**` block at the end of Task 1 (after Step 6 "Merge Z to main"). Replace the bullet list with:

```markdown
**Acceptance criteria:**
- See `docs/superpowers/specs/2026-05-27-5b-Z-chat-core-design.md` §5.2 — authoritative since Z brainstormed against the actual prod state (which the original roadmap acceptance criteria did not reflect; chat-core was already shipped via `20260525124500_p2_chat_core`).
- Summary: 10 criteria covering table shape + chat_lock_ready 4-combo semantics + idempotency + promote atomicity & fail-loud + close state guard + auth boundary (REVOKE confirmed via negative test) + RLS default-deny + race correctness + prod-applied via runbook + overview spec amended.
- The "auth.uid()=p_actor" line in the prior version of this acceptance list was **incorrect for Z** (invariant §2.5 #7 applies to public RPCs; Z's functions are not public — they are SECURITY DEFINER + REVOKE FROM public,authenticated). Auth enforcement happens one layer up at A's match_* RPCs.
```

- [ ] **Step 3: Commit the roadmap amendment.**

```bash
git add docs/superpowers/plans/2026-05-27-5b-master-roadmap.md
git commit -m "docs(5b): point Task 1 acceptance criteria at Z spec

Z's brainstorm produced a more accurate acceptance criteria list than
the roadmap had (which assumed a fresh build; chat-core was already
on prod via 20260525124500_p2_chat_core). Roadmap now sources from
the spec to avoid drift.

Also flags that the prior 'all four functions check auth.uid()=p_actor'
criterion was incorrect — Z's functions are SECURITY DEFINER +
REVOKE FROM public,authenticated; auth is enforced at A's match_* layer.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Mark Z complete in roadmap + final sanity sweep

**Files:**
- Modify: `docs/superpowers/plans/2026-05-27-5b-master-roadmap.md` (Task 1 step checkboxes)

**Goal:** Tick the Task 1 step checkboxes in the master roadmap, run a final sanity sweep, then push.

- [ ] **Step 1: Mark Task 1 step checkboxes in the master roadmap.**

In `docs/superpowers/plans/2026-05-27-5b-master-roadmap.md`, find the Task 1 step list. Change each `- [ ]` to `- [x]` and append a brief result note (mirror the Task 0 format).

The 6 steps:

```markdown
- [x] **Step 1: Brainstorm Z.** ✓ Brainstormed; spec at `docs/superpowers/specs/2026-05-27-5b-Z-chat-core-design.md`. Reconciled with prod reality (chat-core already shipped via `20260525124500_p2_chat_core`).

- [x] **Step 2: Write Z's plan.** ✓ Plan at `docs/superpowers/plans/2026-05-27-5b-Z-chat-core.md`.

- [x] **Step 3: Execute Z's plan.** ✓ Z.1 + Z.2 migrations + tests + race harness all committed.

- [x] **Step 4: Run Z's run-all on local stack.** ✓ `psql -f supabase/tests/p2_chat_core.sql` GREEN (7 NOTICE lines, exit 0). `bash supabase/tests/z_chat_thread_races.sh` GREEN (3 PASS lines, exit 0).

- [x] **Step 5: Apply Z's migrations to prod per the runbook.** ✓ Z.1 applied (`20260527124551`), Z.2 applied (`20260527124552`); advisors GREEN; runbook log updated.

- [x] **Step 6: Merge Z to `main`.** ✓ Z's commits landed directly on `main` (no feature branch — Z is a small amendment surface; 5a precedent of `--no-ff` doesn't apply to single-author single-session work).
```

- [ ] **Step 2: Final sanity sweep — re-run both tests, confirm clean tree.**

Run all three:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/p2_chat_core.sql 2>&1 | tail -10
bash supabase/tests/z_chat_thread_races.sh
git status --short
```

Expected:
- First: 7 NOTICE lines (chat-core open/ready/promote/close-guard OK, chat-core close-open OK, chat-core legal-hold delete guard OK, Z.2: promote state-filter (closed→raise) OK, Z.2: promote state-filter (already-promoted→raise) OK, Z: negative-authz OK, Z: negative-RLS OK), exit 0.
- Second: 3 PASS lines + "All race tests passed", exit 0.
- Third: only the roadmap modification staged (about to be committed), plus the pre-existing untracked items and `supabase/config.toml` modification (unchanged from session start).

- [ ] **Step 3: Commit the roadmap checkbox updates.**

```bash
git add docs/superpowers/plans/2026-05-27-5b-master-roadmap.md
git commit -m "docs(5b-Z): mark Task 1 checkboxes complete in master roadmap

Z (chat-core amendments) shipped: 2 migrations + tests + race harness +
runbook log + overview spec amendment + acceptance-criteria amendment.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push to origin (only when all of the above are green).**

Run: `git push origin main`

Expected: `<prior-head>..<new-head>  main -> main`

---

## Self-review

### Spec coverage

| Spec § | Task |
|---|---|
| §1 Scope reduction (Z's amendment scope) | Tasks 1-7 |
| §2.1 Table shape (final, post-Z) | Task 4 (adds `promoted_at`); Task 8 (documents) |
| §2.2 State machine | Task 1, 3 (test assertions); Task 4 (state-filter enforces) |
| §2.3 chat_lock_ready Option C semantics | Tasks 1, 2 |
| §2.4 promoted_at + state-filter | Tasks 3, 4 |
| §2.5 Auth model (no p_actor, REVOKE + negative test) | Task 3 (negative-authz DO block) |
| §2.6 Test surface (existing in-place + race harness) | Tasks 1, 3 (in-place), 5 (race) |
| §2.7 Overview spec amendment | Task 8 |
| §3 Data flow (Z's seam to A) | Implicit — no code change beyond Z.1+Z.2 affects the seam |
| §4 Error handling (RAISE conditions) | Task 4 (split RAISE) + Task 3 (state-filter test) |
| §5.2 Acceptance criteria (10 items) | All covered; Task 9 amends roadmap to point at this list |
| §5.3 Run-all integration (foreshadow H) | Tasks 5 (creates the harness H will consume); H is its own sub-project |
| §6 Deliverables (7 items) | Tasks 2, 4, 1+3, 5, 6+7 (runbook log), 8, 9 = 1:1 mapping |
| §7.1 R-Z4 (partial-state race) | Task 4 (state filter) + Task 5 (race test confirms) |

No gaps.

### Placeholder scan

Grepped own plan for "TBD" / "TODO" / "implement later" / "fill in" / "add appropriate" / "handle edge cases" / "similar to Task" / "etc." — none present in step bodies. The only "etc." appears in a quoted spec-amendment paragraph (legitimate, references Phase 7 expansion list).

### Type consistency

- Migration filenames: `20260527124551_z_chat_lock_ready_5b_launch` and `20260527124552_z_chat_threads_promoted_at` — consistent across Tasks 2, 4, 6, 7, 8.
- Test file paths: `supabase/tests/p2_chat_core.sql` (modified, never renamed) and `supabase/tests/z_chat_thread_races.sh` (new, never renamed) — consistent across Tasks 1, 3, 5, 10.
- Function signatures: `chat_lock_ready(uuid) → boolean`, `promote_chat_thread_to_lock(uuid, uuid) → void`, `open_chat_thread(uuid) → uuid`, `close_chat_thread(uuid) → void` — consistent everywhere.
- Errcode strings: `'promote_chat_thread_to_lock: no chat thread for offer %'` and `'promote_chat_thread_to_lock: thread for offer % is not open'` — consistent between Task 4 (creates) and Task 5 race test (greps for "is not open").
- Acceptance-criteria numbers: §5.2 #1-#10 in the spec is the canonical list; Task 9 references "10 criteria" — consistent.

No type drift.

---

## Execution handoff

User said "run autonomously through the plans i trust your defaults" — proceeding directly to `superpowers:subagent-driven-development` execution without a separate approval prompt. Subagent-driven is the recommended path (fresh subagent per task + two-stage review).
