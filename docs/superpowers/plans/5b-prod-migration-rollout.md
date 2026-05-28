# Phase 5b — Prod Migration Rollout Runbook

> **Status:** Drafted 2026-05-27. **No migrations applied yet** — this is the apply plan, not the apply log.
> **Owner:** Master-roadmap level. Sourced by every sub-project's "Step 5: apply to prod" gate.
> **Authority:** Pairs with `docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md` (architecture) and `docs/superpowers/plans/2026-05-27-5b-master-roadmap.md` (sequencing).

---

## Apply discipline (per `feedback_schema-data-integrity-rigor.md` + `feedback_secure-by-default-db.md`)

Read this before touching prod:

1. **Per-migration only.** Never apply two migrations in one session without verifying the first. Each migration has its own apply → verify → advisor → commit-to-advance cycle.
2. **Never `supabase db push` or `supabase db reset` against prod.** Migration history is divergent (see memory `schema-drift-prod-triggers.md`). Use `mcp__supabase__apply_migration` (one file at a time, in band order) OR the per-migration `psql` path documented per-migration below.
3. **Run `mcp__supabase__get_advisors type=security` after every DDL.** Any new ERROR or WARN must be triaged before the next migration.
4. **Verification SQL must run GREEN** before committing to advance. If verification fails, run the documented rollback and STOP.
5. **Local-first.** Every migration runs on local Supabase (`supabase db reset` from clean baseline) BEFORE prod apply. If it fails locally, it doesn't go anywhere near prod.
6. **No secrets, no test OTP, no `[auth.sms.test_otp]`** in any file that lands in this repo via `supabase config push`. The local `123456` OTP must never reach prod (see memory `schema-drift-prod-triggers.md`).
7. **Update the "Applied to prod" log at the bottom of this file** after each successful apply. Include: timestamp, version recorded by prod, advisor verdict (`GREEN`/`YELLOW`/`RED`), notes.

---

## Verification log — Task 0 (2026-05-27)

Prod ref: `ufufmcpnysvwtutpbian`. All queries via `mcp__supabase__execute_sql` (read-only).

### Step 1 — Profiles schema (S0/S1 cutover landed) — **GREEN**

| Column | Type | Nullable | Default |
|---|---|---|---|
| `account_state` | `account_lifecycle` enum | NO | `'active'` |
| `standing` | `standing_state` enum | NO | `'good'` |
| `dating_enabled` | `boolean` | NO | `false` |

All three present. `can_enter_lock_flow()` (Step 4) will read these.

### Step 2 — S2 chat-core band `124500-124999` — **YELLOW (Z scope reduction)**

Found existing migration on prod: **`20260525124500_p2_chat_core`** (also in local repo). This is the IC v2 C11.7 chat-core slice that was applied as part of the S2 cutover on 2026-05-26/27. **Z's primitives are partially already on prod.**

**Existing shape (prod):**
- Table `chat_threads` exists with columns: `id (uuid PK), offer_id (uuid NOT NULL UNIQUE FK→offers), lock_id (uuid nullable FK→locks), state (text CHECK in 'open'|'promoted'|'closed' default 'open'), both_ready (bool default false), legal_hold (bool default false), revoked_at (timestamptz), created_at, updated_at`.
- RLS enabled, **zero policies** (SECURITY DEFINER RPCs are the only access path).
- Functions present: `open_chat_thread(uuid)→uuid`, `chat_lock_ready(uuid)→bool`, `promote_chat_thread_to_lock(uuid, uuid)→void`, `close_chat_thread(uuid)→void`, plus trigger `chat_threads_block_held_delete()` (legal-hold guard).
- All four RPCs are `SECURITY DEFINER`, `REVOKE`d from `public,authenticated`.

**Divergences from Z spec (§1 Z of overview):**

| Z spec said | Prod state | Verdict |
|---|---|---|
| `state` is an enum `chat_thread_state` | `state` is `text + CHECK` | Functionally equivalent. No upgrade required. |
| Column `participants uuid[2]` on table | No `participants` column; derived via `offer_id → offers.host_id + offers.candidate_id` join | Acceptable. Saves duplication. Z brainstorm should verify all reads can join through offer cheaply. |
| Columns `promoted_at`, `closed_at` separately | Single `revoked_at` (used on close); `updated_at` tracks state changes generically | Acceptable. `close_chat_thread` sets `revoked_at=coalesce(revoked_at, now())`. Z brainstorm should decide whether dedicated `promoted_at` is needed for analytics; if so, add a non-breaking column-add migration. |
| `chat_lock_ready` returns `true` at 5b launch | Returns `coalesce(both_ready, false)`; `both_ready` defaults to `false` | **BLOCKING gap.** Z MUST amend so `match_accept_offer` doesn't immediately raise `P5005 chat_not_ready` at 5b launch. Two options: (a) change `chat_lock_ready` body to `select true` for 5b, restore real predicate in Phase 7; (b) make `open_chat_thread` set `both_ready=true`; let Phase 7 flip the default + add real gate. Z brainstorm decides. |
| `open_chat_thread` idempotent | ✓ Uses `ON CONFLICT (offer_id) DO UPDATE SET updated_at=now()` | Match. |
| `promote_chat_thread_to_lock` atomic | ✓ Single UPDATE + fail-loud on `row_count=0` | Match. |
| `close_chat_thread` idempotent on already-closed | ✓ `WHERE state='open' AND NOT legal_hold` (no-op silently otherwise) | Match. |
| Negative RLS test: non-participant SELECT denied | RLS enabled, no policies → all client SELECTs denied by default | Match for 5b (RPC-only path). Participant-read policy is Phase 7's job per the source comment. |

**Z's sub-project scope SHRINKS to:**
1. The `chat_lock_ready` true-at-launch amendment (one migration, see § Z below).
2. Optional: add `promoted_at` column if Z's brainstorm decides analytics needs it (column-add only — non-breaking).
3. Z's tests still ship (race harness + state transitions + idempotency + RLS denial via fake-jwt) since none exist in repo today.

No reconciliation of existing migration version needed — local file matches prod version. Z's amendment migration adopts a fresh slot in the same band: `20260527124551`.

### Step 3 — P5 band `126000-126999` — **GREEN**

Scanned the full `list_migrations` output. Highest version applied: `20260527022030`. No entry in `126xxx`. Band is empty and ready for A → B → C migrations.

### Step 4 — S2 prerequisites — **GREEN**

All six tables exist on prod (verified via `to_regclass`):

`feature_config, analytics_events, admin_alerts, notifications, notification_preferences, jobs` → all `true`.

All five functions exist (verified via `information_schema.routines`):

| Function | Return type |
|---|---|
| `offer_expires_at` | `timestamp with time zone` |
| `can_enter_lock_flow` | `boolean` |
| `dispatch_notification` | `json` |
| `enqueue_job` | `uuid` |
| `cancel_jobs` | `integer` |

Both enums exist. `job_type` values include all 5b jobs: `offer_expiry, standby_roll, bulk_withdraw, rating_window` (plus 9 unrelated). No `job_type` extension needed.

### Step 5 — C1 `notification_type` enum gap inventory — **RED (5 gaps)**

**Prod enum values:** `new_match, offer_received, offer_expiring, standby_promoted, date_reconfirm, safety_checkin, safety_alert, new_message, rating_request, moderation_action, account, verification_passed, verification_failed, appeal_resolved, offer_withdrawn` (15 values).

**5b emits 9 types** (per overview spec §3). Cross-reference:

| 5b emits | Prod has | Gap? | Emitting sub-project |
|---|---|---|---|
| `offer_received` | ✓ | — | A (`match_make_offer`) |
| `new_match` | ✓ | — | A (`match_accept_offer`) |
| `reciprocal_detected` | ✗ | **MISSING** | A (`match_make_offer` reciprocal branch) |
| `offer_passed` | ✗ | **MISSING** | B (`match_pass_offer`) |
| `offer_expired` | ✗ | **MISSING** (note: `offer_expiring` is the pre-warning; `offer_expired` is the post-expiry; semantically distinct) | B (`match_expire_offer`) |
| `standby_promoted` | ✓ | — | B (`match_auto_roll`) |
| `offer_withdrawn` | ✓ | — | B (`match_withdraw`) |
| `lock_cancelled_frozen` | ✗ | **MISSING** | B (`match_cancel_lock` safety branch) |
| `lock_cancelled_rolled` | ✗ | **MISSING** | B (`match_cancel_lock` rolled branch) |

**5 missing values.** These MUST be added before the emitting sub-project applies. Enums are additive — safe to add all 5 in one migration as the very first prereq amendment (see § Prereq amendment below).

This is a **C1 contract amendment** owed by S2 to 5b. Tracked as a single migration here rather than spawning a separate plan, because it's a one-line addition per value (no logic change).

---

## Migration ordering (apply in this exact sequence)

```
┌─ PREREQ (must land before any sub-project applies) ───────────────┐
│  1. 20260527124550_s2_notification_type_5b_extend.sql             │
└───────────────────────────────────────────────────────────────────┘
┌─ Z (chat-core amendments) — Task 1 ───────────────────────────────┐
│  2. 20260527124551_z_chat_lock_ready_5b_launch.sql                │
│  3. 20260527124552_z_chat_threads_promoted_at.sql  (OPTIONAL)     │
└───────────────────────────────────────────────────────────────────┘
┌─ A (backend happy path) — Task 2 ─────────────────────────────────┐
│  4. 20260527126000_p5_lock_keys.sql                               │
│  5. 20260527126100_p5_idempotency.sql                             │
│  6. 20260527126200_p5_shortlist.sql                               │
│  7. 20260527126300_p5_make_offer.sql                              │
│  8. 20260527126400_p5_accept_lock.sql                             │
│  9. 20260527126500_p5_reveal_predicate.sql                        │
│ 10. 20260527126600_p5_profiles_revealed_policy.sql                │
│ 11. 20260527126700_p5_s5_swipe_hook.sql                           │
└───────────────────────────────────────────────────────────────────┘
┌─ B (backend resolution) — Task 3 ─────────────────────────────────┐
│ 12. 20260527126800_p5_pass_expire_roll.sql                        │
│ 13. 20260527126900_p5_reciprocal.sql                              │
│ 14. 20260527127000_p5_cancel_safe_roll.sql                        │
│ 15. 20260527127100_p5_rating_window_enqueue.sql                   │
└───────────────────────────────────────────────────────────────────┘
┌─ C (extras + edge) — Task 4 ──────────────────────────────────────┐
│ 16. 20260527127200_p5_feature_flag.sql                            │
│ 17. 20260527127300_p5_demand_hint.sql                             │
│ 18. 20260527127400_p5_admin_tooling.sql                           │
│ 19. 20260527127500_p5_idempotency_prune_cron.sql                  │
│ 20. 20260527127600_p5_grants.sql                                  │
└───────────────────────────────────────────────────────────────────┘
```

**20 migrations total.** Filename slugs above are working targets — each sub-project's own spec/plan may refine the exact internal split (e.g., A's `match_make_offer` might fan out into 2 files). Update this runbook if the filename count changes.

**Note on numbering vs master-roadmap "126NN" placeholders:** the master roadmap used `202605271260NN` through `202605271276NN`. This runbook expands `NN` to round hundreds (`126000`, `126100`, …) for unambiguous ordering. Sub-projects can slot intermediate versions if needed (e.g., `126050`); the band is sparse enough.

---

## PREREQ: Notification type enum extension

Owed by S2 to unblock A + B.

**Migration:** `supabase/migrations/20260527124550_s2_notification_type_5b_extend.sql`

**Pre-conditions:**
- Step 5 gap inventory unchanged (re-run the cross-reference query immediately before apply to confirm).
- No 126xxx migration applied yet.

**Proposed SQL (final form lives in the migration file, drafted by Task 0.5 or A's brainstorm prerequisite step):**

```sql
-- 20260527124550_s2_notification_type_5b_extend.sql
-- C1 contract amendment: add the 5 notification_type values 5b emits.
-- Additive only; safe to run alone. Apply BEFORE A's first migration (126000).
alter type notification_type add value if not exists 'reciprocal_detected';
alter type notification_type add value if not exists 'offer_passed';
alter type notification_type add value if not exists 'offer_expired';
alter type notification_type add value if not exists 'lock_cancelled_frozen';
alter type notification_type add value if not exists 'lock_cancelled_rolled';
```

**Verification SQL (run post-apply):**

```sql
select array_agg(e.enumlabel order by e.enumsortorder) as values
from pg_type t join pg_enum e on e.enumtypid=t.oid
where t.typname='notification_type'
  and e.enumlabel in ('reciprocal_detected','offer_passed','offer_expired','lock_cancelled_frozen','lock_cancelled_rolled');
-- Expected: {reciprocal_detected,offer_passed,offer_expired,lock_cancelled_frozen,lock_cancelled_rolled}
```

**Rollback SQL:** Postgres does **not** support removing enum values in a stable, supported way. If this migration is wrong, the rollback is to leave the unused values in place (no functional impact — dispatchers simply never emit them). This is one-way; double-check the spelling against the overview spec §3 before applying.

**Security-advisor checks:** Run `mcp__supabase__get_advisors type=security` and `type=performance`. Expected: no new advisories (enum extensions don't introduce RLS or definer surface).

**Expected duration:** <1 s.

**Apply protocol:**

```
mcp__supabase__apply_migration name=20260527124550_s2_notification_type_5b_extend body=<above SQL>
# Then verification SQL
# Then advisors
# Then update the "Applied to prod" log below
```

---

## § Z — chat-core amendments (Task 1)

Z's scope is **reduced** because the table + 4 RPCs already exist on prod (see Step 2 above). What Z still owes:

### Z.1 — `chat_lock_ready` 5b-launch amendment

**Migration:** `supabase/migrations/20260527124551_z_chat_lock_ready_5b_launch.sql`

**Pre-conditions:**
- PREREQ enum extension applied.
- `20260525124500_p2_chat_core` present on prod (verified Step 2).

**Decision pending (Z brainstorm):** which of these two implementations Z ships. Both achieve "`chat_lock_ready=true` at 5b launch; Phase 7 flips it to real predicate."

- **Option A — predicate replacement:** `CREATE OR REPLACE FUNCTION chat_lock_ready(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT TRUE $$;` Phase 7 redefines body to the rapport predicate when ready.
- **Option B — data flip:** Keep predicate body unchanged. Modify `open_chat_thread` so newly-created threads have `both_ready=true`. Existing threads (zero on prod today) backfilled to `true`. Phase 7 flips both default + open_chat_thread back, redefines the meaning, backfills.

**Recommended:** Option A. Cleaner forward-compat — Phase 7 redefines one function, no data backfill. Z brainstorm finalizes.

**Verification SQL (run post-apply, Option A draft):**

```sql
-- Predicate returns true regardless of both_ready
do $$ declare v_thread uuid; v_ready bool;
begin
  insert into chat_threads (offer_id) values ('00000000-0000-0000-0000-000000000000') returning id into v_thread;
  -- Above insert will fail FK on real prod; for local test use a fresh seeded offer.
  -- For prod verification, prefer SELECT-only:
end $$;
-- Simpler check (no insert):
select chat_lock_ready('00000000-0000-0000-0000-000000000000'::uuid);
-- Expected with Option A: true (function ignores arg)
-- Expected with Option B: false (no row → coalesce(false))
```

Pin: verification SQL must NOT mutate data on prod. Use a non-existent UUID + assert the function returns `true` regardless. If Z picks Option B, the verification adapts.

**Rollback SQL:**

```sql
-- Restore original predicate body from 20260525124500_p2_chat_core
create or replace function chat_lock_ready(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select both_ready from chat_threads where id = p_thread), false);
$$;
```

**Security-advisor checks:** Expected GREEN — re-issuing an existing SECURITY DEFINER function doesn't change attack surface; permissions on the function persist. Verify the new function still has `REVOKE EXECUTE ... FROM public, authenticated`.

**Expected duration:** <1 s.

### Z.2 — `chat_threads.promoted_at` column (OPTIONAL — Z brainstorm decides)

**Migration:** `supabase/migrations/20260527124552_z_chat_threads_promoted_at.sql`

**Skip if:** Z brainstorm decides `updated_at + state='promoted'` is enough for downstream consumers (likely; analytics can derive from `analytics_events`).

**Pre-conditions:**
- Z.1 applied.

**Proposed SQL (if shipping):**

```sql
alter table chat_threads add column if not exists promoted_at timestamptz;
-- Backfill: any thread currently in 'promoted' state gets updated_at as best-effort proxy
update chat_threads set promoted_at = updated_at where state='promoted' and promoted_at is null;
-- Update promote_chat_thread_to_lock to set promoted_at = now()
create or replace function promote_chat_thread_to_lock(p_offer uuid, p_lock uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  update chat_threads
     set lock_id = p_lock, state = 'promoted',
         promoted_at = coalesce(promoted_at, now()), updated_at = now()
   where offer_id = p_offer;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'promote_chat_thread_to_lock: no chat thread for offer %', p_offer; end if;
end $fn$;
revoke execute on function promote_chat_thread_to_lock(uuid, uuid) from public, authenticated;
```

**Verification SQL:**

```sql
select column_name, data_type, is_nullable from information_schema.columns
where table_schema='public' and table_name='chat_threads' and column_name='promoted_at';
-- Expected: one row {promoted_at, timestamp with time zone, YES}
```

**Rollback SQL:**

```sql
-- Restore promote_chat_thread_to_lock to pre-Z.2 body (from 20260525124500_p2_chat_core)
create or replace function promote_chat_thread_to_lock(p_offer uuid, p_lock uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  update chat_threads set lock_id = p_lock, state = 'promoted', updated_at = now()
   where offer_id = p_offer;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'promote_chat_thread_to_lock: no chat thread for offer %', p_offer; end if;
end $fn$;
revoke execute on function promote_chat_thread_to_lock(uuid, uuid) from public, authenticated;
alter table chat_threads drop column if exists promoted_at;
```

**Expected duration:** <1 s (table is empty on prod).

---

## § A — backend happy path (Task 2)

8 migrations. Apply in the listed order. Each is its own session: apply → verify → advisor → log → next.

### A.1 — `20260527126000_p5_lock_keys.sql`

**Goal:** Advisory-lock key helpers (`match_instance_lock_key(uuid)`, `match_pair_lock_key(uuid,uuid)`). Both `IMMUTABLE` functions returning `bigint`. Used by `pg_advisory_xact_lock` inside A's RPCs.

**Pre-conditions:** PREREQ + Z.1 applied. No `match_*_lock_key` function exists on prod.

**Verification SQL:**

```sql
select routine_name, data_type from information_schema.routines
where routine_schema='public'
  and routine_name in ('match_instance_lock_key','match_pair_lock_key');
-- Expected: 2 rows, both bigint
select match_instance_lock_key('00000000-0000-0000-0000-000000000000'::uuid) is not null;
-- Expected: true
```

**Rollback SQL:** `drop function if exists public.match_instance_lock_key(uuid); drop function if exists public.match_pair_lock_key(uuid,uuid);`

**Advisor checks:** GREEN expected (pure IMMUTABLE helpers, no DDL on tables).

**Expected duration:** <1 s.

### A.2 — `20260527126100_p5_idempotency.sql`

**Goal:** `transition_idempotency(idem_key uuid PK, rpc_name text, result_uuid uuid, created_at timestamptz)` ledger. Helper function `idem_replay_or_record(p_key, p_rpc, p_compute_fn)` (or inline pattern in each RPC; A's brainstorm decides shape).

**Pre-conditions:** A.1 applied. No `transition_idempotency` table.

**Verification SQL:**

```sql
select to_regclass('public.transition_idempotency') is not null as table_exists;
select count(*) from transition_idempotency;  -- expected 0
-- RLS check: table should NOT be client-readable
select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='transition_idempotency';
-- Expected: true (RLS on)
```

**Rollback SQL:** `drop table if exists public.transition_idempotency cascade;`

**Advisor checks:** GREEN expected. Confirm advisor flags no missing RLS policy (table is RPC-only; `REVOKE` on the table from `public,authenticated` is the right posture).

**Expected duration:** <1 s.

### A.3 — `20260527126200_p5_shortlist.sql`

**Goal:** `match_shortlist(p_actor uuid, p_instance uuid, p_candidate uuid, p_rank int, p_idem_key uuid) → uuid` RPC + `match_ingest_interest(p_swiper uuid, p_instance uuid, p_swipe boolean) → void` RPC + `queue_entries.offer_frozen_rank integer` column add (frozen at offer-made time, drives standby order).

**Pre-conditions:** A.1, A.2 applied. `queue_entries` table exists (verified Step 4). `match_shortlist` function does NOT exist on prod yet.

**Verification SQL:**

```sql
-- Functions present
select routine_name from information_schema.routines
where routine_schema='public' and routine_name in ('match_shortlist','match_ingest_interest');
-- Expected: 2 rows

-- Column added
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='queue_entries' and column_name='offer_frozen_rank';
-- Expected: one row {offer_frozen_rank, integer}

-- Feature-flag enforcement (assuming match_v2_enabled=false at this point — C ships flag)
-- Skip this until C.1 applies; for now match_v2_enabled key may not exist yet
```

**Rollback SQL:** `drop function if exists public.match_shortlist(uuid,uuid,uuid,int,uuid); drop function if exists public.match_ingest_interest(uuid,uuid,boolean); alter table queue_entries drop column if exists offer_frozen_rank;`

**Advisor checks:** GREEN expected. The new SECURITY DEFINER functions must be `REVOKE EXECUTE ... FROM public, authenticated` — advisor will flag if not.

**Expected duration:** <2 s.

### A.4 — `20260527126300_p5_make_offer.sql`

**Goal:** `match_make_offer(p_actor uuid, p_instance uuid, p_candidate uuid, p_idem_key uuid) → uuid`. Performs: feature_flag gate (P5000) + actor-JWT match (P5001) + `can_enter_lock_flow(candidate)` (P5002) + `dating_enabled` + `blocks` checks + `pg_advisory_xact_lock(match_instance_lock_key)` + insert into `offers` + `open_chat_thread(offer_id)` (Z exists) + `enqueue_job('offer_expiry', ..., run_after=offer_expires_at())` + reciprocal detection (raise P5008 if pending) + emit `offer_received` + `reciprocal_detected` notifications via `dispatch_notification`.

**Pre-conditions:** A.3 applied. PREREQ enum extension applied (uses `reciprocal_detected`).

**Verification SQL:**

```sql
select routine_name from information_schema.routines
where routine_schema='public' and routine_name='match_make_offer';
-- Expected: 1 row

-- Negative test: anon caller should be revoked from execute
select has_function_privilege('anon', 'public.match_make_offer(uuid,uuid,uuid,uuid)', 'execute');
-- Expected: false

-- Smoke: call with a fake actor that doesn't match JWT.sub → should raise P5001
-- Skip on prod; covered in A's local test suite
```

**Rollback SQL:** `drop function if exists public.match_make_offer(uuid,uuid,uuid,uuid);`

**Advisor checks:** GREEN. Confirm function permissions are revoked from `public,authenticated`.

**Expected duration:** <2 s.

### A.5 — `20260527126400_p5_accept_lock.sql`

**Goal:** `match_accept_offer(p_actor uuid, p_offer uuid, p_idem_key uuid) → uuid`. Performs: feature_flag (P5000) + actor-JWT (P5001) + `chat_lock_ready(thread)` (P5005) + `can_enter_lock_flow(actor)` (P5002) + `pg_advisory_xact_lock(match_pair_lock_key)` + insert into `locks` (GiST exclusion on `(user_id, time_range)` enforces time conflict → P5004) + `promote_chat_thread_to_lock` + cancel `offer_expiry` job + emit `new_match` + enqueue `standby_roll` jobs for off-market counterparties (B implements consumer).

**Pre-conditions:** A.4 applied. `locks` table has GiST exclusion constraint (verify via `pg_constraint`).

**Verification SQL:**

```sql
select routine_name from information_schema.routines
where routine_schema='public' and routine_name='match_accept_offer';
-- Expected: 1 row

-- GiST exclusion on locks must be in place
select conname from pg_constraint
where conrelid='public.locks'::regclass and contype='x';
-- Expected: at least one row (e.g., locks_one_active_per_user_excl)
```

**Rollback SQL:** `drop function if exists public.match_accept_offer(uuid,uuid,uuid);`

**Advisor checks:** GREEN.

**Expected duration:** <2 s.

### A.6 — `20260527126500_p5_reveal_predicate.sql`

**Goal:** `match_reveal_allowed(p_viewer uuid, p_instance uuid) → boolean`. Returns `true` iff viewer is locked with a counterparty on this instance (per overview spec §2.6). Used by A.7's RLS policy and by F's UI.

**Pre-conditions:** A.5 applied.

**Verification SQL:**

```sql
select routine_name, data_type from information_schema.routines
where routine_schema='public' and routine_name='match_reveal_allowed';
-- Expected: 1 row, boolean
-- Negative test: viewer not in any lock → returns false
select match_reveal_allowed(gen_random_uuid(), gen_random_uuid());
-- Expected: false
```

**Rollback SQL:** `drop function if exists public.match_reveal_allowed(uuid,uuid);`

**Advisor checks:** GREEN.

**Expected duration:** <1 s.

### A.7 — `20260527126600_p5_profiles_revealed_policy.sql`

**Goal:** RLS policy `profiles_select_revealed` on `public.profiles` allowing SELECT iff `match_reveal_allowed(auth.uid(), <instance derived from request>)` returns true. **High-risk migration** — touches the profiles RLS surface, which is the PII gate.

**Pre-conditions:** A.6 applied. Existing profiles RLS policies catalogued first (run query in pre-apply step).

**Pre-apply inventory (mandatory):**

```sql
select policyname, cmd, qual, with_check from pg_policies
where schemaname='public' and tablename='profiles'
order by policyname;
-- Document each existing policy in the apply log BEFORE applying. Confirm A.7 doesn't conflict.
```

**Verification SQL:**

```sql
select policyname from pg_policies
where schemaname='public' and tablename='profiles' and policyname='profiles_select_revealed';
-- Expected: 1 row

-- Negative test (local only — DO NOT run on prod without a seeded test pair):
-- A locked-pair viewer can SELECT counterparty PII; an un-locked viewer cannot.
-- Covered in A's local test suite (a_reveal_negative_rls.sql).
```

**Rollback SQL:** `drop policy if exists profiles_select_revealed on public.profiles;`

**Advisor checks:** **REQUIRED — security advisor MUST be run and verified GREEN after this migration.** Per memory `feedback_secure-by-default-db.md`, any RLS change is a "review live migration before apply" gate. If advisor flags any new finding on `profiles`, STOP and triage.

**Expected duration:** <1 s.

### A.8 — `20260527126700_p5_s5_swipe_hook.sql`

**Goal:** Modify S5's `record_swipe` RPC (currently in `20260527120100_s5_record_swipe.sql`) to invoke `match_ingest_interest(swiper, instance, swipe_is_right)` on every right-swipe so the host's queue updates in realtime. Pure additive — preserves existing S5 behavior.

**Pre-conditions:** A.3 applied (`match_ingest_interest` exists). S5's `record_swipe` exists on prod (`20260527120100`).

**Verification SQL:**

```sql
-- Compare function body before/after — capture the diff in the apply log
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='record_swipe';
```

**Rollback SQL:** Restore the original `record_swipe` body from `20260527120100_s5_record_swipe.sql`. Capture the original CREATE OR REPLACE FUNCTION statement in this runbook's apply log BEFORE applying A.8 so rollback is one paste away.

**Advisor checks:** GREEN expected.

**Expected duration:** <1 s.

---

## § B — backend resolution (Task 3)

4 migrations. Apply after all A migrations are GREEN. Same per-migration discipline.

### B.1 — `20260527126800_p5_pass_expire_roll.sql`

**Goal:** `match_pass_offer`, `match_expire_offer`, `match_auto_roll`, `match_next_standby`, `match_withdraw` RPCs.

**Pre-conditions:** All A migrations applied. PREREQ enum extension applied (uses `offer_passed, offer_expired, standby_promoted, offer_withdrawn`).

**Verification SQL:** All 5 functions present; `match_auto_roll` consumes `standby_roll` job (verify by inspecting source for `job_type='standby_roll'`).

**Rollback SQL:** `drop function if exists ...` for all 5.

**Advisor checks:** GREEN.

**Expected duration:** <2 s.

### B.2 — `20260527126900_p5_reciprocal.sql`

**Goal:** `match_resolve_reciprocal(p_actor uuid, p_pair_id uuid, p_choice uuid)` resolves a reciprocal-pair detected earlier (P5008). Tracks the pair table (or column on offers — B's brainstorm decides).

**Pre-conditions:** B.1 applied.

**Verification SQL:** Function present; reciprocal-pair tracking table/column exists.

**Rollback SQL:** Drop function + drop table/column if separate.

**Advisor checks:** GREEN.

**Expected duration:** <2 s.

### B.3 — `20260527127000_p5_cancel_safe_roll.sql`

**Goal:** `match_cancel_lock(p_actor uuid, p_lock uuid, p_reason text, p_idem_key uuid)`. Reason taxonomy: `'creator_pre_lock'`, `'mutual'`, `'no_show'`, `'safety'`. Safety branch atomically updates `profiles.standing`, inserts to `admin_alerts`, enqueues `bulk_withdraw`. Per MD10 (creator-cancel-pre-lock) handled here.

**Pre-conditions:** B.2 applied. PREREQ enum extension applied (uses `lock_cancelled_frozen, lock_cancelled_rolled`).

**Verification SQL:** Function present; atomic test (in local suite) verifies safety branch all-or-nothing.

**Rollback SQL:** `drop function if exists public.match_cancel_lock(uuid,uuid,text,uuid);`

**Advisor checks:** GREEN. **Important:** the safety branch updates `profiles.standing` — confirm function is SECURITY DEFINER and that the actor check (must be a lock counterparty OR service_role) is bullet-proof.

**Expected duration:** <2 s.

### B.4 — `20260527127100_p5_rating_window_enqueue.sql`

**Goal:** Modify `match_accept_offer` (A.5) to additionally enqueue a `rating_window` job at lock creation with `run_after = lock.time_range_end + grace`. F's rating UI is gated on `rating_visible_at` derived from this.

**Pre-conditions:** B.3 applied. A.5 present on prod.

**Verification SQL:** Function body diff includes `enqueue_job('rating_window', ...)` for the new lock.

**Rollback SQL:** Restore `match_accept_offer` body from A.5 (capture pre-B.4 body in the apply log first).

**Advisor checks:** GREEN.

**Expected duration:** <1 s.

---

## § C — extras + edge transport (Task 4)

5 migrations + 8 edge-function deploys. Apply after all B migrations are GREEN. Edge functions deploy via `supabase functions deploy match-*` per memory's per-function discipline; deploy log goes into the apply log below.

### C.1 — `20260527127200_p5_feature_flag.sql`

**Goal:** Insert `feature_config (key, value)` row: `('match_v2_enabled', 'false')`. Set the flag OFF by default. Task 10 flips it per-cohort later.

**Pre-conditions:** All B migrations applied. `feature_config` table exists (verified Step 4).

**Verification SQL:**

```sql
select key, value from feature_config where key='match_v2_enabled';
-- Expected: 1 row, value='false'
```

**Rollback SQL:** `delete from feature_config where key='match_v2_enabled';`

**Advisor checks:** GREEN. Confirm RLS on `feature_config` still gates writes to service_role.

**Expected duration:** <1 s.

### C.2 — `20260527127300_p5_demand_hint.sql`

**Goal:** `match_demand_hint(p_instance uuid) → text` stubbed to swipe-count heuristic. Returns one of `'quiet'|'warming_up'|'filling_up'|'almost_full'` based on `count(*) from swipes where date_instance_id=p_instance and direction=true` bucketed by thresholds.

**Pre-conditions:** C.1 applied.

**Verification SQL:** Function present + smoke call against a seeded instance returns valid bucket.

**Rollback SQL:** `drop function if exists public.match_demand_hint(uuid);`

**Advisor checks:** GREEN.

**Expected duration:** <1 s.

### C.3 — `20260527127400_p5_admin_tooling.sql`

**Goal:** `admin_force_expire_offer(p_offer uuid)` + `admin_force_cancel_lock(p_lock uuid, p_reason text)`. **Service-role only.** Used for support escalations.

**Pre-conditions:** C.2 applied.

**Verification SQL:**

```sql
select routine_name from information_schema.routines
where routine_schema='public'
  and routine_name in ('admin_force_expire_offer','admin_force_cancel_lock');
-- Expected: 2 rows
-- Confirm anon + authenticated CANNOT execute
select has_function_privilege('anon', 'public.admin_force_expire_offer(uuid)', 'execute');
-- Expected: false
select has_function_privilege('authenticated', 'public.admin_force_expire_offer(uuid)', 'execute');
-- Expected: false
```

**Rollback SQL:** `drop function if exists public.admin_force_expire_offer(uuid); drop function if exists public.admin_force_cancel_lock(uuid,text);`

**Advisor checks:** GREEN. **High-risk migration** — admin tooling. Confirm `REVOKE` from non-service-role is correct.

**Expected duration:** <1 s.

### C.4 — `20260527127500_p5_idempotency_prune_cron.sql`

**Goal:** pg_cron schedule that prunes `transition_idempotency` rows older than 30 days. Monthly cadence. Settled rows only (no in-flight checks needed — by definition older than 30 days has already returned).

**Pre-conditions:** C.3 applied. `pg_cron` extension enabled on prod (verify before apply).

**Pre-apply verify:**

```sql
select extname from pg_extension where extname='pg_cron';
-- If empty, enable via mcp__supabase__execute_sql: create extension if not exists pg_cron;
```

**Verification SQL:**

```sql
select jobname, schedule, command from cron.job where jobname like 'p5_idempotency_prune%';
-- Expected: 1 row, monthly schedule
```

**Rollback SQL:** `select cron.unschedule('p5_idempotency_prune');`

**Advisor checks:** GREEN.

**Expected duration:** <1 s.

### C.5 — `20260527127600_p5_grants.sql`

**Goal:** Centralized `REVOKE EXECUTE ... FROM public, authenticated` for every match_* RPC + `GRANT EXECUTE ... TO service_role` for admin RPCs. Defense-in-depth — even if a previous migration forgot a revoke, this one cleans up.

**Pre-conditions:** All other C migrations applied.

**Verification SQL:**

```sql
-- No authenticated/anon privileges on any match_* function except those explicitly granted
select p.proname, r.rolname
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
left join lateral (
  select 'anon' as rolname where has_function_privilege('anon', p.oid, 'execute')
  union all
  select 'authenticated' where has_function_privilege('authenticated', p.oid, 'execute')
) r on true
where n.nspname='public' and p.proname like 'match\_%' escape '\';
-- Expected: zero rows
```

**Rollback SQL:** No rollback — this is hardening. If something breaks, the fix is to GRANT to the specific principal that needs access, not to re-grant broadly.

**Advisor checks:** **REQUIRED** — security advisor must run after this and report GREEN on every match_* RPC.

**Expected duration:** <1 s.

### C.6 — Edge function deploys (8 functions)

After C.5, deploy each edge function via `mcp__supabase__deploy_edge_function` (or `supabase functions deploy match-<name> --project-ref ufufmcpnysvwtutpbian`):

1. `match-shortlist`
2. `match-make-offer`
3. `match-accept-offer`
4. `match-pass-offer`
5. `match-withdraw`
6. `match-cancel-lock`
7. `match-resolve-reciprocal`
8. `match-demand-hint`

**Per-function deploy protocol:**
- Deploy one
- Smoke-test with `mcp__supabase__get_logs service=edge-function` for any startup error
- Confirm cold-start latency <2 s (R12 mitigation)
- Log version + timestamp below

**Skip on prod until:** `match_v2_enabled=true` cohort flip happens (Task 10). Functions can be deployed in advance with the flag still false; they'll all return 503 until flag flips.

---

## TS types regen (Task 4, post-C)

After C migrations land, regenerate types:

```bash
supabase gen types typescript --project-id ufufmcpnysvwtutpbian > packages/types/src/database.ts
```

Commit the regen as part of C's merge.

---

## Applied to prod log

> Append one row per successful apply. Format: `version | applied_at (UTC) | advisor verdict | notes`. Include the exact `mcp__supabase__list_migrations` version recorded by prod (may differ from the local filename slug per the `20260526185247 → 20260527022030` precedent — record what prod reports).

| Version | Applied at | Advisor | Notes |
|---|---|---|---|
| `20260527124551_z_chat_lock_ready_5b_launch` | 2026-05-28T05:35Z | GREEN | Z.1 chat_lock_ready body → state='open' predicate. Body verified post-apply (`pg_get_functiondef` contains `state = 'open'`). `has_function_privilege('authenticated', ...)` = false; same for `anon`. Advisor: 0 new findings; all reported advisories are pre-existing (notably the `chat_threads rls_enabled_no_policy` was already there from `20260525124500_p2_chat_core` and is Phase 7's responsibility per Z spec §7.2). |
| `20260527124552_z_chat_threads_promoted_at` | 2026-05-28T05:42Z | GREEN | Z.2 column add + promote state-filter hardening. Column verified (`promoted_at timestamp with time zone YES`). Function body verified contains `and state = 'open'` filter AND the distinguishing `IF NOT EXISTS` branch with two raise messages ("no chat thread for offer" vs "thread for offer % is not open"). `has_function_privilege('authenticated', ...)` = false; same for `anon`. Advisor: 0 new findings; same pre-existing list as Z.1's check. |
| `20260527124550_s2_notification_type_5b_extend` | 2026-05-28T06:15Z | GREEN | PREREQ for A: adds 5 notification_type enum values (`reciprocal_detected, offer_passed, offer_expired, lock_cancelled_frozen, lock_cancelled_rolled`). Verified post-apply: all 5 values present via pg_enum query. Additive only; no advisor impact. |
| `20260527126000_p5_lock_keys` | 2026-05-28T06:22Z | GREEN | A.1: `match_pair_lock_key(uuid,uuid)` + `match_instance_lock_key(uuid)` (both IMMUTABLE bigint hashes for pg_advisory_xact_lock) + `temp_race` scaffolding table (RLS-enabled-no-policies; race-harness id passthrough — by P5 design, scaffolding lives in prod for parity with local). Verified: 2 functions present, temp_race present, pair_lock_key order-independent. |
| `20260527126100_p5_idempotency` | 2026-05-28T06:29Z | GREEN | A.2: `transition_idempotency(actor, action, idem_key, result, created_at)` ledger PK on first 3 cols + `match_idem_lookup` + `match_idem_store` helpers. `idem_key uuid NOT NULL` (overrides P5 source's `text`). REVOKEs verified (authenticated/anon cannot execute). RLS-enabled-no-policies (service/definer only). |
| `20260527126200_p5_shortlist` | 2026-05-28T06:36Z | GREEN | A.3: `match_shortlist` (public C2 RPC; auth via auth.uid()=p_actor + P5000 flag gate + P5001 mismatch + frozen-slot rule for active offer holder) + `match_ingest_interest` (internal; REVOKE'd) + `match_next_standby` (internal; REVOKE'd) + `queue_entries.swiper_disclosed_at` + `queue_entries.offer_frozen_rank` columns. Divergence from spec §2.4: actual rank policy is "set candidate's rank; frozen-slot for active offer holder" rather than bump-and-cascade (queue_entries has no per-rank UNIQUE so collision is non-issue; UI manages visual order). Reciprocal-detection call removed from shortlist (moves to A.4 per spec §2.8). Spec amendment pending at end of A. Verified: 3 functions, 2 new columns, shortlist callable by authenticated, ingest+standby NOT callable. |
| `20260527126300_p5_make_offer` | 2026-05-28T06:51Z | GREEN | A.4: `match_make_offer(actor, instance, candidate, idem_key uuid)` returning offer uuid. 18-step pipeline: P5001 auth, P5000 flag, idempotency replay, advisory-lock instance, P5002 dating_enabled both, P5002 blocks both directions, creator+seeking checks, P5003 already-active, shortlisted check, P5002 can_enter_lock_flow, P5008 reciprocal-detection (dispatches notifications to both creators BEFORE raise; uses existing offer id as pair marker), insert offer with offer_expires_at(), promote queue to offer_active with offer_frozen_rank=1, open chat thread via Z, enqueue offer_expiry job (dedup_key=offer.id), dispatch offer_received notif, analytics event, idempotency store, return. Public C2 RPC (callable by authenticated). |
| `20260527126400_p5_accept_lock` | 2026-05-28T07:08Z | GREEN | A.5: `match_accept_offer(actor, offer, idem_key uuid)` returning lock uuid. 18-step pipeline: P5001 auth, P5000 flag, idempotency replay, load offer + verify p_actor is candidate, P5007 expired check (early + re-check under lock), P5002 can_enter_lock_flow(actor), P5005 chat_lock_ready (Z returns true at 5b launch), advisory-lock instance, insert lock (P5004 on GiST exclusion / unique violation), resolve offer to 'accepted', queue → locked, date_instance → matched, Z.promote_chat_thread_to_lock, cancel offer_expiry job, enqueue 2 cascade jobs (autoclose_creator + autowithdraw_user — B's consumers), enqueue rating_window job (run_after = upper(time_range) + 2h grace), dispatch new_match to both parties, analytics events, idempotency store, return. Public C2 RPC. |
| `20260527126500_p5_reveal_predicate` | 2026-05-28T07:20Z | GREEN | A.6: `match_reveal_allowed(viewer, instance)` returning bool. 3 OR branches per spec §2.6: (1) creator-of-instance, (2) candidate of offer with status IN ('active','accepted') (persists post-lock so historical reveal access is preserved unless B rolls offer back), (3) lock_participants of lock with status IN ('active','completed'). SECURITY DEFINER stable; remains callable by authenticated (returns bool only, no PII leak). Verified with 4-case enumeration test. |
| `20260527126600_p5_profiles_revealed_policy` | 2026-05-28T07:40Z | GREEN (high-risk PII gate, advisor reviewed) | A.7: `profiles_select_revealed` RLS policy + `match_reveal_allowed_pair(viewer, target)` SECURITY DEFINER helper. Policy gates row access symmetrically (auth.uid()=id OR pair predicate). Helper is DEFINER to bypass dependent-table RLS (date_instances/offers/locks own RLS would hide the rows needed to evaluate the predicate). Discovery during impl: column-level REVOKE on email/etc doesn't compose with Supabase's table-level grants — backed off; column projection enforcement moved to F's reveal modal + C's Edge Functions. RESIDUAL RISK documented in migration header. Verified with 4-case RLS test (stranger pre-offer 0 rows, candidate sees creator via active offer, stranger excluded, symmetric reveal). |
| `20260527126650_p5_revoke_internals_from_anon` | 2026-05-28T07:48Z | GREEN | A.7 hardening: lock down match_* SECURITY DEFINER functions from `anon` (Supabase auto-grants new functions to anon; plain `revoke from public,authenticated` doesn't catch it — use `revoke all from public, anon`). Internal helpers (match_ingest_interest, match_next_standby, match_idem_*, match_reveal_allowed_pair) also revoked from authenticated. **EXCEPTION:** match_reveal_allowed_pair is grant-execute back to authenticated because it's invoked from the profiles_select_revealed RLS policy and PG checks EXECUTE privilege in the calling role's context (despite SECURITY DEFINER inside) — missing grant crashes the server (known quirk in this Supabase build). Public C2 RPCs (shortlist/make_offer/accept_offer) remain authenticated-callable per design. |
| `20260527126700_p5_s5_swipe_hook` | 2026-05-28T07:55Z | GREEN | A.8: amends S5's `record_swipe` to invoke `match_ingest_interest(p_instance)` on right-swipes when feature flag `match_v2_enabled=true`. Legacy mode preserved when flag off (swipes still recorded, queue_entries not populated). Pre-A.8 body captured in migration header for rollback. Verified 3 cases: right-swipe seeds queue, left-swipe no-op, flag-off right-swipe no-op. |
| `20260527126800_p5_pass_expire_withdraw` | 2026-05-28T08:10Z | GREEN | **B-lite** (scope-reduced; see migration header): match_pass_offer + match_expire_offer + match_withdraw + match_resolve_offer_negative internal helper. match_auto_roll STUBBED to null-return (real implementation deferred to follow-on B migration). DEFERRED: match_cancel_lock (safety atomicity), match_resolve_reciprocal + reciprocal_pairs table, match_autoclose_creator_conflicts, match_autowithdraw_user_conflicts, bulk_withdraw consumer. 4 test cases pass: pass + chat-close + job-cancel + offer_passed notif + idempotency; expire + offer_expired notif; withdraw-with-offer + offer_withdrawn notif to creator; withdraw-without-offer queue update. |
| `20260527126850_p5_cancel_reason_extend` | 2026-05-28T08:25Z | GREEN | B-complete prereq: extends cancel_reason enum with 'mutual', 'no_show', 'creator_pre_lock'. Existing 'safety', 'misconduct', 'schedule_conflict', 'venue_issue', 'changed_mind', 'account_closed', 'other' preserved. |
| `20260527126900_p5_b_complete` | 2026-05-28T08:28Z | GREEN | **B-complete**: replaces B-lite auto_roll stub with real implementation (cutoff freeze + report freeze + standby promotion + offer + standby_promoted notif). Adds match_autoclose_creator_conflicts (closes overlapping seeking instances on lock) + match_autowithdraw_user_conflicts (throttled withdraw from overlapping queues; cap 25; overflow → bulk_withdraw job). Adds reciprocal_pairs table (RLS: self-read) + match_resolve_reciprocal (full chooser flow: create offer if needed, inline accept, close other side, dispatch new_match). Adds match_cancel_lock with 4-reason taxonomy + safety atomicity (standing→warned + admin_alerts insert + bulk_withdraw enqueue + lock_cancelled_frozen notif) + non-safety branch (lock_cancelled_rolled notif + auto_roll). Smoke-tested: auto_roll on pass promotes next standby + dispatches standby_promoted; cancel_lock mutual reopens instance to seeking + lock_cancelled_rolled notif; cancel_lock safety updates all 4 atomic outputs. |
| `20260527127000_p5_c_sql` | 2026-05-28T08:42Z | GREEN | **C-SQL** (SQL portion of sub-project C; Deno Edge Functions deferred to follow-on session): `match_demand_hint(p_instance)` swipe-count heuristic stub returning quiet/warming_up/filling_up/almost_full at 0/5/15/30 thresholds. **`feature_config('match_v2_enabled','false')` row inserted** (Task 10 rollout flips per cohort). `admin_force_expire_offer` + `admin_force_cancel_lock` (service-role-only support tools; REVOKE'd from anon and authenticated). `prune_idempotency_ledger(interval)` callable function (pg_cron not enabled on this project — invoke manually or via S2 job runner). Centralized REVOKE backstop on all new functions. |

---

## Risk register linked to overview spec §5.2

- **R1 (migration runbook):** THIS DOCUMENT. Update on each apply.
- **R8 (idempotency ledger growth):** C.4 prune cron.
- **R10 (advisory-lock collision):** A.1 helpers — collision is intrinsically possible but the key space (`bigint` from md5-hash) makes it astronomically unlikely; document the chosen hash strategy in A.1's body.
- **R11 (JWT bypass):** Every SECURITY DEFINER RPC checks `auth.uid() = p_actor` first. C.5 grants migration is the last-line defense.
- **R12 (edge cold starts):** C.6 deploy protocol smokes each function.

Other risks (R2-R7, R9) are surfaced in the consuming sub-project's brainstorm input rather than the runbook.

---

## Open questions deferred to sub-project brainstorms

These were surfaced during Task 0 verification but are NOT for this runbook to answer:

1. **Z.1 — Option A vs Option B** for the `chat_lock_ready=true` amendment (predicate replacement vs data flip). Z's brainstorm decides; this runbook only needs the chosen option's SQL.
2. **Z.2 ship-or-skip** for the `promoted_at` column add. Z's brainstorm decides.
3. **Rank collision policy** (overview spec seam 8) — bumps vs swaps vs append-only. A's brainstorm decides; A.3 reflects the choice.
4. **Reciprocal-pair tracking shape** (table vs column on offers) — B's brainstorm.
5. **Lock-completion mechanism** (overview spec seam 7) — when does a lock transition from "active" to "completed" for purposes of standing / rating window / cleanup. B's brainstorm.
6. **Advisory-lock key hash strategy** (R10) — `('x'||substr(md5(uuid::text),1,16))::bit(64)::bigint` vs `hashtext`. A.1's brainstorm.

This runbook is updated when each sub-project's brainstorm picks an option — the SQL block above becomes the concrete final SQL at that point.
