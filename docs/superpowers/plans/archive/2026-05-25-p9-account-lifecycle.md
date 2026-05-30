> ⚠️ STALE / DO NOT EXECUTE — superseded by docs/after5-current-implementation-plan.md and docs/INTEGRATION-CONTRACT.md (2026-05-30). Kept for history only. May reference phantom columns, scalar return shapes, and wrong ownership.

SUBORDINATE EXECUTION SLICE. This plan is not authoritative by itself. It must be implemented only through INTEGRATION-CONTRACT.md v2 and RECONCILED-MASTER-PLAN.md. If this file conflicts with either, this file loses.

# P9 — Account Lifecycle & Compliance — Implementation Plan

> **Staging:** This is the **S10 — Account lifecycle** slice of the reconciled build order. It runs after S1 (schema spine: `account_lifecycle`/`standing` enums+columns, `reports`/`disputes`), S2 (jobs/`enqueue_job`, notifications, `can_enter_lock_flow`, chat-core), S6 (the C2 `match_*` transition API), S7 (rich chat + tombstones), and S8 (enforcement ladder writing `standing`, legal-hold/reports). See "Depends on" below.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a real, accountable human three lifecycle outcomes — PAUSE / DELETE (user-initiated) and the data effects of SUSPEND (platform-initiated; the *gate* lives in `profiles.standing`, owned by P7/S8, not here) — make each one *safe for everyone still in flight*, and satisfy GDPR/CCPA (data export + erasure) — **without** ever blind-cascading away the report history and audit trail we are legally and ethically required to keep on a person who harmed someone. Deletion is a coordinated teardown (notify + cancel + free the other party + safe-roll + anonymize), driven by a `deletion_requests` table and a worker that runs on the C1 (S2) job layer via `enqueue_job`.

**Architecture:** Build on the S1 schema spine (`profiles`, `profiles_private`, `date_instances`, `swipes`, `queue_entries`, `offers`, `locks`/`lock_participants`, `match_ratings`, `reports`, `blocks`, `verifications`, `audit_log`). **Account state is the C3/C11.5 two-field model, restated canonically — do not redefine it here:** `profiles.account_state account_lifecycle` (owner: P9/S10; values `active,paused,deletion_pending,deleted`) is orthogonal to `profiles.standing standing_state` (owner: P7/S8; carries `suspended`). **`suspended` is NOT in `account_lifecycle`** — suspension is a `standing` value and is gated by `can_enter_lock_flow` (C3). P9 reads/writes only `account_state`; it never defines a `suspended` lifecycle value, a `suspend_account()` gate, or a competing `account_active()`. The hard separation we enforce in the DB: **destroy the person's identity (PII + profile content), preserve the accountability skeleton (reports they are a subject of, audit_log, anonymized rating outcomes they caused).** P0/S1 FK on-delete behaviors make a literal `DELETE FROM profiles` *dangerous* — `reports.reporter_id` is `on delete set null` but `reports.target_id` is a free uuid (no FK, so a row about the deleting user survives by construction), while `match_ratings`, `locks`, `offers`, `queue_entries`, `swipes` all `cascade` from `profiles`. So a real hard-delete would erase the very rows safety needs. P9 therefore **never deletes the `profiles` row for a user under legal hold**; it *anonymizes in place* and tombstones. For users with no hold, the worker first detaches/relocates the accountability rows it must keep, then deletes BOTH the `profiles` row AND the `auth.users` row (MD8), and records a re-signup defense fingerprint. Orphan-handling for in-flight state is done by calling the **C2 (S6) match transition functions** by their real names — `match_cancel_lock(p_actor, p_lock, 'account_closed', p_idem)`, `match_expire_offer(p_offer)`, `match_withdraw(p_actor, p_instance)` — so the state machine's invariants and auto-roll logic stay authoritative. `account_closed` is a **benign** cancel reason in C2 (auto-rolls the night). P9 does not re-implement the loop, it *drives* it.

**Tech Stack:** Supabase Postgres, SQL migrations (`supabase/migrations/`), RLS with `auth.uid()`, SECURITY DEFINER functions for the privileged teardown, psql-based behavioral tests (`supabase/tests/`), one Deno Edge Function worker (`supabase/functions/`) tested with `Deno.test`, regenerated TS types.

**Source docs:** AUTHORITY (governing) — `docs/superpowers/plans/2026-05-25-INTEGRATION-CONTRACT.md` (v2; C1, C2, C3, C9, C11.5, C11.9) and `docs/superpowers/plans/2026-05-25-RECONCILED-MASTER-PLAN.md` (S10). Background only — spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§7.6 cancellation/safe-roll, §6 audit log); roadmap `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` ('Closes': account deletion mid-flow → orphaned locks, GDPR/CCPA, soft-delete regret).

**Depends on (cross-stage; these must already exist when S10 runs):**
- **S2 (C1 jobs):** the single `jobs` table + `job_type`/`job_status` enums + `enqueue_job(...)`/`cancel_jobs(...)` + runner, and `dispatch_notification`/`notification_preferences`/`devices`. P9 enqueues deletion work via `enqueue_job('deletion_process', run_after, payload, dedup_key)` (the `deletion_process` value is already in C1's `job_type` enum) and surfaces user-facing messages via `dispatch_notification`. **P9 does NOT define its own `jobs`/`job_status`/`enqueue` — that is a C11.5 violation that hard-fails `db reset`.** Task 1 is a **test-only** `if not exists` shim, never shipped in a migration, dropped the moment S2 lands.
- **S6 (C2 match transition API):** the only legal names are the C2 `match_*` functions. P9 calls `match_cancel_lock(p_actor uuid, p_lock uuid, p_reason cancel_reason, p_idem_key text)`, `match_expire_offer(p_offer uuid)`, and `match_withdraw(p_actor uuid, p_instance uuid)`. The `cancel_reason` enum (incl. `account_closed`) is defined in C2 (S6) — **P9 does not own or extend it**. `account_closed` is **benign** (auto-rolls the night). `can_enter_lock_flow` (C3, defined in S2) returns false for any non-`active` `account_state`, so a `paused`/`deletion_pending` user cannot create or accept offers (C11.9).
- **S7 (C9 chat tombstone):** chat threads survive a profile delete by tombstone (not cascade) and carry `revoked_at`; `chat_messages.sender_id on delete set null` + sender tombstone; held threads are exempt from purge (P9 legal-hold). **Chat tombstoning is P6/C9-owned — P9 references it for held-thread survival and does not redefine message/sender redaction.**
- **S8 (standing + legal-hold/reports):** P7/S8 owns `profiles.standing` (incl. the `suspended` value) and the enforcement ladder that writes it, the `reports` schema (C5/C11.6, `report_status` = `open,reviewing,actioned,dismissed`), and `disputes`. P9 reads `reports`/explicit holds to derive legal hold; it never writes `standing` and never owns a suspend mechanism.

**Reconciliation note:** S1's `match_ratings` cascades on `profiles` delete via `on delete cascade`. For a user who *rated others*, we keep those rows (they describe the ratee's behavior, not the deleter's identity) by **re-pointing `rater_id` to the sentinel `[deleted-user]` profile** before any hard delete, never by cascade. For ratings *about* the deleter, we keep the structured outcomes (anonymized) because they feed the ratee/reporter safety picture. This is the core "deletion ≠ blind cascade" mechanic.

---

## File Structure

P9 owns the C6 band `130000–1309xx`. Migrations sort within the band by dependency.

- `supabase/migrations/20260525130000_p9_account_state.sql` — Task 2: lifecycle columns on `profiles` (the `account_lifecycle` enum + `account_state` column are added in S1, NOT here — this migration only adds the P9-owned dated/tombstone columns + the sentinel "deleted user" profile). **No `account_status` enum, no `suspended`, no `cancel_reason` extension here.**
- `supabase/migrations/20260525130200_p9_deletion_requests.sql` — Task 3: `deletion_requests` table + RLS + dedupe invariant.
- `supabase/migrations/20260525130300_p9_legal_hold.sql` — Task 4: `legal_holds` table + `has_active_legal_hold()` helper (reads S8 `reports`).
- `supabase/migrations/20260525130400_p9_pause_resume_fns.sql` — Task 5: `pause_account`/`resume_account` SECURITY DEFINER fns (write `account_state` only). **No feed-suppression view here** (the feed filter lives in the single C11.3 `browse_feed` finalization, S12) and **no `suspend_account`** (suspension is S8's `standing` ladder).
- `supabase/migrations/20260525130500_p9_request_deletion_fn.sql` — Task 6: `request_account_deletion()` + `cancel_deletion_request()` (the 30-day soft-delete grace window) — enqueues via C1 `enqueue_job`.
- `supabase/migrations/20260525130600_p9_orphan_teardown_fn.sql` — Task 7: `_p9_release_in_flight_state(user)` — drives the C2 (S6) `match_*` transitions for offers/locks/queue.
- `supabase/migrations/20260525130700_p9_anonymize_fn.sql` — Task 8: `_p9_anonymize_user(user)` (retention-aware) + `_p9_purge_profile_rows(user)` (DB-side cascade prep, only when no hold).
- `supabase/migrations/20260525130650_p9_process_deletion_fn.sql` — Task 9: `_p9_process_deletion(request_id)` transactional orchestrator RPC.
- `supabase/migrations/20260525130800_p9_export_fn.sql` — Task 10: `build_data_export(user)` (GDPR/CCPA access request) + `data_exports` table.
- `supabase/migrations/20260525130900_p9_resignup_defense.sql` — Task 12 (MD8): `tombstoned_identities` fingerprint table + signup-time check helper.
- `supabase/functions/process-deletion-requests/index.ts` — Task 9: the worker (claims due requests, runs the DB orchestrator, then `auth.admin.deleteUser()` / ban for `auth.users` teardown; idempotent, service-role gated).
- `supabase/functions/process-deletion-requests/index_test.ts` — Task 9: `Deno.test` orchestration/idempotency tests.
- `supabase/tests/p9_*.sql` — one psql behavioral test file per task that warrants it; all fixtures via C8 `mk_user`/`mk_itinerary`/`mk_instance`.
- `packages/types/src/database.ts` — regenerated in Task 11.

---

## Task 1: Confirm the C1 (S2) job/notification backbone exists — TEST-ONLY shim

**No migration. P9 does NOT define `jobs`/`job_status`/`enqueue_job`/`notifications` — that is a C11.5 violation (duplicate `create type` hard-fails `db reset`).** S2 ships the single C1 `jobs` table + `job_type`/`job_status` enums + `enqueue_job(...)`/`cancel_jobs(...)` + runner, plus `dispatch_notification`/`notification_preferences`/`devices`. Because S10 runs after S2, these always exist at execution time. The previous "P2-compat shim migration" is **SUPERSEDED and removed** — no `20260525130100_*` migration ships.

P9 enqueues deletion work with the canonical C1 signature:
```sql
-- C1 signature (do not redefine):
-- enqueue_job(p_type job_type, p_run_after timestamptz, p_payload jsonb default '{}', p_dedup_key text default null) returns uuid
select enqueue_job('deletion_process', v_after,
                   jsonb_build_object('user_id', p_user, 'deletion_request_id', v_req),
                   v_req::text);
```
(`deletion_process` is already a value in C1's `job_type` enum; `dedup_key` = the request id so a re-request can't double-enqueue.)

**For isolated test runs only** (when S2 is not loaded in a local harness), the psql tests may `\i` a thin guard file that creates a `jobs` table `if not exists` matching the C1 shape (`type job_type`, `run_after`, `dedup_key`, `status job_status default 'pending'`). This guard lives **inside the test fixture tree, never in `supabase/migrations/`**, and is dropped the instant S2's real migration is present.

**Files:**
- Test (presence assertion): `supabase/tests/p9_jobs_present.sql`
- Optional test guard (isolated harness only, test-tree, NOT a migration; `if not exists`, C1/C2-shaped): `supabase/tests/_p9_s2_guard.sql`

- [ ] **Step 1: Assert the C1 backbone is present (failing test if S2 not applied)**

```sql
-- supabase/tests/p9_jobs_present.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_type WHERE typname='job_type';
  IF NOT FOUND THEN RAISE EXCEPTION 'C1 job_type enum missing — S2 must land first'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='enqueue_job';
  IF NOT FOUND THEN RAISE EXCEPTION 'C1 enqueue_job() missing — S2 must land first'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='jobs' AND column_name='dedup_key';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs.dedup_key missing — wrong jobs table (not C1)'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='dispatch_notification';
  IF NOT FOUND THEN RAISE EXCEPTION 'C1 dispatch_notification() missing — S2 must land first'; END IF;
END $$;
```

- [ ] **Step 2: Run against a full `supabase db reset` (S1+S2+…+S10), expect PASS.**

Run: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p9_jobs_present.sql`

- [ ] **Step 3: No commit of a migration here.** (The old `p9_jobs_notifications_shim` migration is deleted as part of this slice; nothing in `supabase/migrations/` is added by Task 1.)

---

## Task 2: P9-owned lifecycle columns on `profiles` + sentinel profile

> **CANONICAL REFERENCE — do not redefine here.** The `account_lifecycle` enum (`'active','paused','deletion_pending','deleted'` — **no `suspended`**, C11.5) and the `profiles.account_state account_lifecycle` column are defined in **S1 (schema spine, C3)**. The `cancel_reason` enum (incl. `account_closed`) is defined in **S6/C2** — P9 does NOT extend it. The C1 `job_type`/`job_status` enums are defined in **S2**. This task adds ONLY the P9-owned dated/tombstone columns and the sentinel profile.

The lifecycle state lives in `profiles.account_state` (S1). The `[deleted user]` sentinel that surviving accountability rows re-point to is added here.

**Lifecycle semantics (load-bearing — referenced by every later task; values are exactly C3/C11.5's `account_lifecycle`):**
- `active` — normal.
- `paused` — **user-initiated, fully reversible, identity intact.** Hidden from feed/offers/new swipes (the C11.3 feed filter excludes non-`active` creators; `can_enter_lock_flow` returns false), but PII + profile + in-flight non-locked interest *survive*. **A paused user with an active lock keeps that lock** — pause does NOT cancel it; the reconfirm/check-in jobs still fire and that user still owes the date (C11.9). Resume is one tap, no data loss.
- `deletion_pending` — user requested DELETE; a grace window is running (regret protection). Treated like `paused` for visibility/gating (`can_enter_lock_flow` false), but a `deletion_requests` row is counting down.
- `deleted` — terminal. Worker has run: PII erased/anonymized, in-flight state released, `auth.users` row removed/banned, profile either hard-deleted (no hold) or tombstoned (hold). `account_state='deleted'` only ever persists on a *tombstoned* (held) row.
- **`suspended` is NOT an `account_lifecycle` value.** Suspension is `profiles.standing='suspended'` (owner P7/S8) and is enforced via `can_enter_lock_flow` (C3). P9 has no `suspend_account` and writes no suspension state. The data-effects teardown a suspension triggers (free counterparties, withdraw queues) is the SAME `_p9_release_in_flight_state` helper (Task 7), which S8's ladder calls — P9 owns the helper, S8 owns *when*.

**Files:**
- Create: `supabase/migrations/20260525130000_p9_account_state.sql`
- Test: `supabase/tests/p9_account_state.sql`

> **Migration-order note:** band `130000` (start of P9's C6 band). S1's `account_lifecycle` enum + `account_state` column already exist (much earlier band). This migration only `alter table … add column if not exists` for the P9-owned columns and inserts the sentinel.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p9_account_state.sql
\i supabase/tests/_fixtures.sql   -- C8: mk_user/mk_itinerary/mk_instance
DO $$
BEGIN
  -- S1 owns the enum + column; assert they exist (S1 must have landed)
  PERFORM 1 FROM pg_type WHERE typname='account_lifecycle';
  IF NOT FOUND THEN RAISE EXCEPTION 'account_lifecycle enum missing — S1 must land first'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='profiles' AND column_name='account_state';
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles.account_state missing — S1 must land first'; END IF;
  -- 'suspended' must NOT be an account_lifecycle value (C11.5)
  IF EXISTS (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
             where t.typname='account_lifecycle' and e.enumlabel='suspended') THEN
    RAISE EXCEPTION 'account_lifecycle must NOT contain suspended (lives in profiles.standing)';
  END IF;
  -- P9-owned columns present
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='profiles' AND column_name='is_tombstone';
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles.is_tombstone missing'; END IF;
  -- sentinel deleted-user profile must exist at a fixed uuid
  PERFORM 1 FROM profiles WHERE id='00000000-0000-0000-0000-0000000de1e7';
  IF NOT FOUND THEN RAISE EXCEPTION 'deleted-user sentinel profile missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`profiles.is_tombstone missing` once S1 is applied).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130000_p9_account_state.sql
-- account_lifecycle enum + profiles.account_state column are owned by S1 (C3/C11.5) — NOT created here.
-- cancel_reason (incl. account_closed) is owned by S6/C2 — NOT extended here.
-- C1 jobs/job_status are owned by S2 — NOT created here.

alter table profiles
  add column if not exists status_changed_at timestamptz not null default now(),
  add column if not exists status_reason text,           -- free-text for deletion/appeal context
  add column if not exists deleted_at timestamptz,        -- set when worker tombstones/erases
  add column if not exists is_tombstone boolean not null default false;  -- true = held, anonymized in place

-- The sentinel "[deleted user]" profile. Surviving accountability rows (ratings authored
-- by a deleted user) re-point here instead of cascading away. Fixed uuid so the worker and
-- tests can reference it without a lookup. account_state='deleted' so the C11.3 feed filter
-- excludes it automatically; flag it as a system row in analytics.
insert into profiles (id, first_name, account_state, is_tombstone)
values ('00000000-0000-0000-0000-0000000de1e7', '[deleted user]', 'deleted', true)
on conflict (id) do nothing;

create index if not exists profiles_account_state_idx on profiles(account_state)
  where account_state <> 'active';
```

> The sentinel insert lists only columns guaranteed by S1 (`id`, `first_name`, `account_state`). If S1/S3 require additional NOT-NULL profile columns, satisfy them with neutral system values; never insert PII.

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130000_p9_account_state.sql supabase/tests/p9_account_state.sql
git commit -m "P9: lifecycle columns (status/tombstone) on profiles + deleted-user sentinel"
```

---

## Task 3: `deletion_requests` table (the soft-delete grace window + worker work-item)

A DELETE is *requested*, not executed inline. The row records when it was requested, when the grace window expires (regret protection — "soft-delete regret" from the audit), which state the worker has reached, and is idempotently consumed by the worker.

**Files:**
- Create: `supabase/migrations/20260525130200_p9_deletion_requests.sql`
- Test: `supabase/tests/p9_deletion_requests.sql`

- [ ] **Step 1: Write the failing test** (one open request per user; grace window column present)

```sql
-- supabase/tests/p9_deletion_requests.sql
\i supabase/tests/_fixtures.sql   -- C8: mk_user
DO $$
DECLARE u uuid;
BEGIN
  PERFORM 1 FROM pg_indexes
   WHERE tablename='deletion_requests'
     AND indexdef ILIKE '%unique%user_id%';
  IF NOT FOUND THEN RAISE EXCEPTION 'deletion_requests: missing one-open-per-user unique index'; END IF;

  u := mk_user('dr');
  insert into deletion_requests (user_id, process_after)
    values (u, now()+interval '30 days');
  -- a second OPEN request for the same user must be rejected
  BEGIN
    insert into deletion_requests (user_id, process_after)
      values (u, now()+interval '30 days');
    RAISE EXCEPTION 'INVARIANT FAILED: two open deletion requests allowed for one user';
  EXCEPTION WHEN unique_violation THEN NULL;  -- expected
  END;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "deletion_requests" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130200_p9_deletion_requests.sql
create type deletion_request_status as enum
  ('grace_period','processing','completed','cancelled','failed');

create table if not exists deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  requested_at timestamptz not null default now(),
  process_after timestamptz not null,        -- end of the regret grace window
  status deletion_request_status not null default 'grace_period',
  reason text,                               -- optional user-given reason (analytics)
  legal_hold_blocked boolean not null default false,  -- worker found a hold → anonymize-not-delete
  processed_at timestamptz,
  worker_error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most ONE non-terminal request per user (grace_period or processing). Terminal
-- requests (completed/cancelled/failed) are history and don't block a new request,
-- though a 'deleted' user can't re-request anyway.
create unique index if not exists deletion_requests_one_open_per_user
  on deletion_requests (user_id)
  where status in ('grace_period','processing');

create index if not exists deletion_requests_due_idx
  on deletion_requests (process_after)
  where status='grace_period';

do $$ begin
  if exists (select 1 from pg_proc where proname='set_updated_at') then
    create trigger set_deletion_requests_updated_at before update on deletion_requests
      for each row execute function set_updated_at();
  end if;
exception when duplicate_object then null; end $$;

alter table deletion_requests enable row level security;
do $$ begin
  -- a user may see their own request (to show "deletion scheduled, cancel by [T]")
  create policy "deletion_requests_owner_read" on deletion_requests for select
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
-- inserts/updates go through SECURITY DEFINER fns (Task 6) + the worker; no direct write policy.
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130200_p9_deletion_requests.sql supabase/tests/p9_deletion_requests.sql
git commit -m "P9: deletion_requests table (grace window + worker work-item + one-open-per-user)"
```

---

## Task 4: `legal_holds` + `has_active_legal_hold()` (retention / "deletion ≠ blind cascade")

A user who is the **subject of an open/reviewing/actioned report**, or under an explicit moderation/legal hold, must have their accountability data **retained even through a deletion request**. This table records explicit holds (set by S8 moderation); the helper also derives an *implicit* hold from non-dismissed `reports` where they are the target. The anonymization function (Task 8) consults this to decide hard-delete vs anonymize-in-place.

> The `reports` table and its `report_status` enum (`open,reviewing,actioned,dismissed`) and `report_reason_category` taxonomy are owned by **S8 (C5/C11.6)** — referenced here, not defined. There is no gating `reason` column; `reason_category` is canonical, `detail` is free-text (C11.6).

**Files:**
- Create: `supabase/migrations/20260525130300_p9_legal_hold.sql`
- Test: `supabase/tests/p9_legal_hold.sql`

- [ ] **Step 1: Write the failing test** (an open report about a user yields an implicit hold)

```sql
-- supabase/tests/p9_legal_hold.sql
\i supabase/tests/_fixtures.sql   -- C8: mk_user
DO $$
DECLARE u uuid; r uuid; held boolean;
BEGIN
  u := mk_user('reported');
  r := mk_user('reporter');

  -- no report yet → no hold
  SELECT has_active_legal_hold(u) INTO held;
  IF held THEN RAISE EXCEPTION 'unexpected hold with no report'; END IF;

  -- open report ABOUT u → implicit hold (C5/C11.6 columns: reason_category, detail, status)
  insert into reports (reporter_id, target_type, target_id, reason_category, detail, status)
    values (r, 'user', u, 'harassment', null, 'open');
  SELECT has_active_legal_hold(u) INTO held;
  IF NOT held THEN RAISE EXCEPTION 'open report about user did NOT create a legal hold'; END IF;

  -- dismissed report → hold clears (no longer safety-relevant)
  update reports set status='dismissed' where target_id=u;
  SELECT has_active_legal_hold(u) INTO held;
  IF held THEN RAISE EXCEPTION 'dismissed report should not hold'; END IF;

  RAISE NOTICE 'legal hold derivation OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function has_active_legal_hold(uuid) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130300_p9_legal_hold.sql
-- Explicit holds set by moderation (S8) or legal. retain_until null = indefinite.
create table if not exists legal_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  reason text not null,                 -- 'open_safety_report','litigation','law_enforcement','ban'
  placed_by uuid references profiles(id),
  retain_until timestamptz,             -- null = indefinite
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists legal_holds_user_idx on legal_holds(user_id)
  where released_at is null;

alter table legal_holds enable row level security;  -- moderation/service-role only; no policies.

-- A user has an active hold if: an explicit unreleased hold exists, OR a non-dismissed
-- report names them as the target. Dismissed reports do NOT hold. SECURITY DEFINER so it
-- can read reports (which are admin-deny under RLS). report_status values per C11.6.
create or replace function has_active_legal_hold(p_user uuid)
returns boolean
language sql security definer set search_path = public
stable as $fn$
  select exists (
    select 1 from legal_holds h
     where h.user_id = p_user
       and h.released_at is null
       and (h.retain_until is null or h.retain_until > now())
  )
  or exists (
    select 1 from reports r
     where r.target_type = 'user'
       and r.target_id = p_user
       and r.status in ('open','reviewing','actioned')
  );
$fn$;
revoke all on function has_active_legal_hold(uuid) from public, anon, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `legal hold derivation OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130300_p9_legal_hold.sql supabase/tests/p9_legal_hold.sql
git commit -m "P9: legal_holds table + has_active_legal_hold() (explicit + implicit from open reports)"
```

---

## Task 5: PAUSE / RESUME functions (write `account_state` only)

The reversible, identity-intact states. These are SECURITY DEFINER so they can flip `account_state` while RLS keeps direct writes to the lifecycle column locked (C7).

> **SUSPEND is NOT here.** Suspension is `profiles.standing='suspended'`, owned by P7/S8's enforcement ladder; it gates via `can_enter_lock_flow` (C3), not via `account_state`. P9 does not define `suspend_account`, `account_active()`, or a `suspended` lifecycle value (C3/C11.5, removing the dual-suspended model). The data-effects teardown a suspension needs (free counterparties, withdraw queues) is the shared `_p9_release_in_flight_state` helper (Task 7), which S8 calls.

> **No `browse_feed` definition here.** Feed visibility is the single C11.3 `browse_feed` finalization migration (S12, band `133000`), whose mandatory filter already excludes non-`active` creators: `cr.account_state='active' and cr.standing not in ('suspended','locked_ban')`. **P9 must NOT `create or replace browse_feed`** (CV4/C11.3 forbid a second definition). Pausing simply sets `account_state='paused'`, and the S12 feed drops the creator's instances. P9 only `alter table`/writes base columns, never the feed view.

> **Paused user with an active lock (C11.9):** pause does NOT cancel the lock. The reconfirm/check-in jobs (S8) still fire and the user still owes the date. Pause only suppresses feed/offers/new swipes (via `can_enter_lock_flow` + the S12 feed filter). Resume restores feed visibility. `pause_account` therefore does NOT call `_p9_release_in_flight_state`.

**Files:**
- Create: `supabase/migrations/20260525130400_p9_pause_resume_fns.sql`
- Test: `supabase/tests/p9_pause_resume.sql`

- [ ] **Step 1: Write the failing test** (pause sets state + keeps an active lock; resume restores)

```sql
-- supabase/tests/p9_pause_resume.sql
\i supabase/tests/_fixtures.sql   -- C8: mk_user/mk_itinerary/mk_instance
DO $$
DECLARE u uuid; cre uuid; itin uuid; inst uuid; lk uuid; lstatus text;
BEGIN
  u   := mk_user('pauser');
  cre := mk_user('creator');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now()+interval '5 days');
  -- pauser holds an ACTIVE lock as the matched party (must survive pause — C11.9)
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, u, 'active') returning id into lk;

  -- pause sets state
  PERFORM pause_account(u);
  PERFORM 1 FROM profiles WHERE id=u AND account_state='paused';
  IF NOT FOUND THEN RAISE EXCEPTION 'pause_account did not set account_state=paused'; END IF;

  -- C11.9: the active lock is NOT cancelled by pause
  select status::text into lstatus from locks where id=lk;
  IF lstatus <> 'active' THEN RAISE EXCEPTION 'pause cancelled an active lock (status=%) — violates C11.9', lstatus; END IF;

  -- resume restores active
  PERFORM resume_account(u);
  PERFORM 1 FROM profiles WHERE id=u AND account_state='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'resume_account did not restore account_state=active'; END IF;

  RAISE NOTICE 'pause/resume OK (lock survived pause)';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function pause_account(uuid) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130400_p9_pause_resume_fns.sql
-- NO browse_feed here (C11.3: single definition in S12). NO suspend (S8 owns standing).

-- PAUSE: user-initiated, reversible. Sets account_state='paused'. Keeps PII + active locks.
-- Feed/offer suppression is enforced by can_enter_lock_flow (C3) + the S12 feed filter; the
-- active lock survives (C11.9) — pause does NOT call _p9_release_in_flight_state.
create or replace function pause_account(p_user uuid default auth.uid())
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_user is distinct from auth.uid() and auth.uid() is not null then
    raise exception 'pause_account: may only pause your own account';
  end if;
  update profiles
     set account_state='paused', status_changed_at=now()
   where id=p_user and account_state='active';
  if not found then
    raise exception 'pause_account: account is not active';
  end if;
end $fn$;

-- RESUME: only from paused (deletion_pending uses cancel_deletion_request; deleted is terminal).
create or replace function resume_account(p_user uuid default auth.uid())
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_user is distinct from auth.uid() and auth.uid() is not null then
    raise exception 'resume_account: may only resume your own account';
  end if;
  update profiles
     set account_state='active', status_changed_at=now()
   where id=p_user and account_state='paused';
  if not found then
    raise exception 'resume_account: account is not paused';
  end if;
end $fn$;

-- pause/resume are owner-callable; grant to authenticated (self-scoped via auth.uid() guard).
grant execute on function pause_account(uuid) to authenticated;
grant execute on function resume_account(uuid) to authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `pause/resume OK (lock survived pause)`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130400_p9_pause_resume_fns.sql supabase/tests/p9_pause_resume.sql
git commit -m "P9: pause/resume account_state fns (no feed redef, no suspend, lock survives pause)"
```

---

## Task 6: `request_account_deletion()` + `cancel_deletion_request()` (regret protection)

DELETE is a *request* with a grace window, not an immediate teardown. This is the "soft-delete regret" fix: the account flips to `deletion_pending` (gated like paused: `can_enter_lock_flow` false) and a `deletion_requests` row counts down; the worker only acts after `process_after`. Cancelling restores the account to `active`. A C1 job is enqueued via `enqueue_job('deletion_process', …)` so the C1 runner (S2) wakes the worker at the right time; cancel uses `cancel_jobs('deletion_process', dedup_key)`.

> **Uses C1 `enqueue_job`/`cancel_jobs` (S2) — never a raw `insert into jobs` (C11.5).** The C1 `job_type` value is `deletion_process`; the `dedup_key` is the request id (text), which also prevents a double-enqueue.

**Files:**
- Create: `supabase/migrations/20260525130500_p9_request_deletion_fn.sql`
- Test: `supabase/tests/p9_request_deletion.sql`

- [ ] **Step 1: Write the failing test** (request → pending + row + C1 job; cancel → active + cancelled)

```sql
-- supabase/tests/p9_request_deletion.sql
\i supabase/tests/_fixtures.sql   -- C8: mk_user
DO $$
DECLARE u uuid; njobs int; rstatus deletion_request_status; v_req uuid;
BEGIN
  u := mk_user('leaver');

  v_req := request_account_deletion(u, 14, 'moving on');
  PERFORM 1 FROM profiles WHERE id=u AND account_state='deletion_pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'request did not set deletion_pending'; END IF;
  PERFORM 1 FROM deletion_requests WHERE user_id=u AND status='grace_period'
                                     AND process_after > now()+interval '13 days';
  IF NOT FOUND THEN RAISE EXCEPTION 'deletion_requests grace row missing/short window'; END IF;
  -- C1 job enqueued (type=deletion_process, dedup_key=request id)
  select count(*) into njobs from jobs where type='deletion_process'
    and (payload->>'user_id')::uuid = u and status in ('pending','running');
  IF njobs < 1 THEN RAISE EXCEPTION 'no deletion_process job enqueued via enqueue_job'; END IF;

  -- a duplicate request must be rejected (one open per user)
  BEGIN
    PERFORM request_account_deletion(u, 14, 'again');
    RAISE EXCEPTION 'INVARIANT FAILED: duplicate deletion request allowed';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- cancel restores active + marks request cancelled + cancels the C1 job
  PERFORM cancel_deletion_request(u);
  PERFORM 1 FROM profiles WHERE id=u AND account_state='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'cancel did not restore active'; END IF;
  select status into rstatus from deletion_requests where user_id=u order by requested_at desc limit 1;
  IF rstatus <> 'cancelled' THEN RAISE EXCEPTION 'request not marked cancelled (%)', rstatus; END IF;
  select count(*) into njobs from jobs where type='deletion_process'
    and (payload->>'user_id')::uuid = u and status in ('pending','running');
  IF njobs <> 0 THEN RAISE EXCEPTION 'C1 job not cancelled on cancel (got %)', njobs; END IF;

  RAISE NOTICE 'request/cancel deletion OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function request_account_deletion(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130500_p9_request_deletion_fn.sql

-- Request deletion: flip to deletion_pending, open a grace-window request, enqueue via C1.
-- p_grace_days defaults to 30 (regret protection); clamp to a sane minimum so an imminent-rating
-- dodge can't request instant deletion.
create or replace function request_account_deletion(
  p_user uuid default auth.uid(),
  p_grace_days int default 30,
  p_reason text default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_req uuid; v_after timestamptz;
begin
  if p_user is distinct from auth.uid() and auth.uid() is not null then
    raise exception 'request_account_deletion: may only delete your own account';
  end if;
  if exists (select 1 from profiles where id=p_user and account_state='deleted') then
    raise exception 'request_account_deletion: account already deleted';
  end if;

  v_after := now() + make_interval(days => greatest(1, p_grace_days));  -- >=1d floor

  insert into deletion_requests (user_id, process_after, reason)
    values (p_user, v_after, p_reason)
    returning id into v_req;   -- raises unique_violation if an open request exists

  update profiles set account_state='deletion_pending', status_changed_at=now()
    where id=p_user;

  -- C1 enqueue (S2). job_type='deletion_process'; dedup_key=request id prevents double-enqueue.
  perform enqueue_job('deletion_process', v_after,
                      jsonb_build_object('user_id', p_user, 'deletion_request_id', v_req),
                      v_req::text);

  return v_req;
end $fn$;

-- Cancel during the grace window: restore active, mark request cancelled, cancel the C1 job.
create or replace function cancel_deletion_request(p_user uuid default auth.uid())
returns void language plpgsql security definer set search_path = public as $fn$
declare v_req uuid;
begin
  if p_user is distinct from auth.uid() and auth.uid() is not null then
    raise exception 'cancel_deletion_request: may only cancel your own request';
  end if;
  update deletion_requests set status='cancelled'
    where user_id=p_user and status='grace_period'
    returning id into v_req;
  if v_req is null then
    raise exception 'cancel_deletion_request: no open request to cancel';
  end if;
  update profiles set account_state='active', status_changed_at=now()
    where id=p_user and account_state='deletion_pending';
  -- C1 cancel (S2): dedup_key = request id.
  perform cancel_jobs('deletion_process', v_req::text);
end $fn$;

grant execute on function request_account_deletion(uuid,int,text) to authenticated;
grant execute on function cancel_deletion_request(uuid) to authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `request/cancel deletion OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130500_p9_request_deletion_fn.sql supabase/tests/p9_request_deletion.sql
git commit -m "P9: request/cancel account deletion with grace window + job enqueue (soft-delete regret)"
```

---

## Task 7: `_p9_release_in_flight_state()` — orphan teardown driving the C2 (S6) match transitions

The heart of the orphan fix ("account deletion mid-flow → orphaned locks"). When a user leaves mid-flow, every piece of in-flight state must resolve *safely* and the **other party must be freed and safe-rolled** — never left staring at a lock to a ghost. This function **drives the C2 (S6) transition functions by their real names/signatures** so the loop's invariants/auto-roll stay authoritative; it does not hand-edit `offers`/`locks`/`queue_entries`.

> **C2 names/signatures (do not invent variants):**
> - `match_cancel_lock(p_actor uuid, p_lock uuid, p_reason cancel_reason, p_idem_key text)` — actor FIRST, requires an idempotency key.
> - `match_expire_offer(p_offer uuid)` — single arg, idempotent, no reason param.
> - `match_withdraw(p_actor uuid, p_instance uuid)` — withdraws the actor from a given date instance's queue (replaces the fictional `withdraw_from_queue`). It is **instance-scoped**, so P9 iterates the distinct instances the departing user has any queue interest in and calls `match_withdraw` once per instance.
> - `account_closed` is **benign** in C2 (auto-rolls the night). The old `cancel_lock`/`expire_offer(reason)`/`withdraw_from_queue` signatures and the "account_closed freezes" assumption are wrong and removed.

**Effects, per artifact (from S1 schema, driven via C2):**
- **Active `offers` to/from the user** → `match_expire_offer(offer_id)` so the offer slot frees and standby can advance. (Expiring the offer also revokes the C2 reveal predicate for that offer.)
- **Active `locks` where the user is `creator_id` or `matched_user_id`** → `match_cancel_lock(p_user, lock_id, 'account_closed', <stable idem_key>)`. C2 frees the counterpart and (benign reason) auto-rolls the night to standby. Idempotency key derived from `lock_id` so worker retries are safe.
- **Queue interest by the user** → for each distinct `date_instance_id` the user has a non-terminal `queue_entries` row in, `match_withdraw(p_user, instance_id)`. This removes the departing user from those queues so they cannot be re-rolled to. **Order matters:** run withdraws BEFORE/independent of auto-roll so a just-freed slot does not re-offer to the departing user.
- **Owed ratings** → any `locks` that completed but the departing user never rated: close the rating window for them so there is no orphaned "please rate" prompt. (Coordinate with S8: prefer S8's rating-window-close mechanism over fabricating rows; see coupling note.)

**Files:**
- Create: `supabase/migrations/20260525130600_p9_orphan_teardown_fn.sql`
- Test: `supabase/tests/p9_orphan_teardown.sql`

- [ ] **Step 1: Write the failing test** (a user with an active lock leaves → lock cancelled with `account_closed` via `match_cancel_lock`, counterpart freed)

```sql
-- supabase/tests/p9_orphan_teardown.sql
-- This slice runs AFTER S6, so the real C2 match_* functions exist — no stand-ins are
-- shipped. (If a local harness lacks S6, \i a test-tree-only C1/C2 guard with the EXACT
-- C2 signatures: match_cancel_lock(p_actor,p_lock,p_reason,p_idem_key),
-- match_expire_offer(p_offer), match_withdraw(p_actor,p_instance). Never ship such a guard
-- in supabase/migrations/.)
\i supabase/tests/_fixtures.sql   -- C8: mk_user/mk_itinerary/mk_instance
DO $$
DECLARE cre uuid; leaver uuid; itin uuid; inst uuid; lk uuid; lstatus text; lreason text;
BEGIN
  cre   := mk_user('creator');
  leaver := mk_user('leaver');
  itin  := mk_itinerary(cre);
  inst  := mk_instance(itin, cre, now()+interval '4 days');
  -- leaver holds an active lock as the matched user
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, leaver, 'active') returning id into lk;

  -- leaver departs (deletion path; p_full_delete=true)
  PERFORM _p9_release_in_flight_state(leaver, true);

  select status::text, cancel_reason::text into lstatus, lreason from locks where id=lk;
  IF lstatus <> 'cancelled' THEN RAISE EXCEPTION 'orphaned lock not cancelled (status=%)', lstatus; END IF;
  IF lreason <> 'account_closed' THEN RAISE EXCEPTION 'lock not cancelled with account_closed (%)', lreason; END IF;

  RAISE NOTICE 'orphan teardown OK (lock freed via match_cancel_lock, counterpart % no longer bound)', cre;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function _p9_release_in_flight_state(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130600_p9_orphan_teardown_fn.sql
-- Drive the C2 (S6) state machine to release every in-flight artifact for a departing user.
-- p_full_delete distinguishes deletion (true) from a suspension-triggered teardown (false)
-- only for the audit marker; the in-flight release is identical for both — the
-- safe-roll/free-counterpart behavior must happen in BOTH cases.
create or replace function _p9_release_in_flight_state(p_user uuid, p_full_delete boolean default false)
returns void language plpgsql security definer set search_path = public as $fn$
declare r record;
begin
  -- 1) Withdraw the departing user from EVERY date-instance queue first, so a slot freed in
  --    steps 2/3 cannot auto-roll back onto them. match_withdraw is instance-scoped (C2).
  for r in
    select distinct date_instance_id from queue_entries
     where candidate_id=p_user
       and status in ('interested','shortlisted','offer_active','standby')
  loop
    perform match_withdraw(p_user, r.date_instance_id);
  end loop;

  -- 2) Active offers involving the user (as candidate or creator) → expire (frees the slot,
  --    revokes reveal). match_expire_offer is single-arg + idempotent (C2).
  for r in
    select id from offers
     where status='active' and (candidate_id=p_user or creator_id=p_user)
  loop
    perform match_expire_offer(r.id);
  end loop;

  -- 3) Active locks involving the user → cancel(account_closed): C2 frees the counterpart and
  --    (benign reason) auto-rolls the night to standby. Actor = the departing user; idem key
  --    derived from the lock id so worker retries are safe.
  for r in
    select id from locks
     where status='active' and (creator_id=p_user or matched_user_id=p_user)
  loop
    perform match_cancel_lock(p_user, r.id, 'account_closed', 'p9-close-' || r.id::text);
  end loop;

  -- 4) Owed ratings: close the rating window for the departing user so there is no orphaned
  --    "please rate" prompt. PREFER S8's rating-window-close path; the all-null sentinel insert
  --    below is a fallback ONLY if S8 exposes no close primitive (coordinate at execution).
  --    (S8 owns match_ratings' revealed_at/disputed + reliability recompute — see coupling note.)
  insert into match_ratings (lock_id, rater_id, ratee_id, showed_up, on_time,
                             cancelled_with_notice, unsafe_or_disrespectful)
  select l.id, p_user,
         case when l.creator_id=p_user then l.matched_user_id else l.creator_id end,
         null, null, null, null
    from locks l
   where l.status='completed'
     and (l.creator_id=p_user or l.matched_user_id=p_user)
     and not exists (select 1 from match_ratings m where m.lock_id=l.id and m.rater_id=p_user)
  on conflict (lock_id, rater_id) do nothing;

  -- Audit marker for the lifecycle teardown event itself (entity-status changes are captured
  -- by the per-table triggers). Use S1's actual audit_log columns; do NOT overload a status
  -- column with an event-type string. (If S1's audit_log lacks a metadata/detail column, write
  -- only entity/entity_id/action/actor and drop the jsonb arg — match the spine's real shape.)
  insert into audit_log (entity, entity_id, action, detail, actor)
  values ('profiles', p_user, 'in_flight_released',
          jsonb_build_object('full_delete', p_full_delete), p_user);
end $fn$;

revoke all on function _p9_release_in_flight_state(uuid,boolean) from public, anon, authenticated;
```

> **C2 coupling checks (at execution time):**
> - `account_closed` is benign in C2 (auto-roll), so the creator's night re-offers to standby — confirmed by C2's BENIGN set (`schedule_conflict,venue_issue,changed_mind,account_closed,other`). The withdraw-first ordering (step 1) guarantees the departing user is not a re-roll candidate.
> - If a per-date **safety freeze** is in effect (an open safety report on the instance), C2's auto-roll is frozen independent of the benign reason — P9 inherits that freeze automatically because it only *calls* `match_cancel_lock`; it does not decide roll-vs-freeze.
> - Counterparty notification ("the date is off because the other person left") is emitted by C2/`dispatch_notification` on `match_cancel_lock`; P9 does not send a duplicate. If C2's cancel notification does not cover the account-closed case, raise a contract amendment rather than adding a P9-local notify.
> - Owed-ratings: coordinate with S8. If S8 exposes a rating-window-close primitive, call it instead of the all-null sentinel insert (the sentinel approach risks colliding with S8's `revealed_at`/reliability recompute).

- [ ] **Step 4: Apply + run test, expect PASS** (prints `orphan teardown OK ...`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130600_p9_orphan_teardown_fn.sql supabase/tests/p9_orphan_teardown.sql
git commit -m "P9: orphan teardown drives C2 match_cancel_lock/match_expire_offer/match_withdraw on account close"
```

---

## Task 8: Anonymize (retention-aware) vs hard-delete

The "deletion ≠ blind cascade" core. After in-flight state is released, the worker must erase identity. What it's *allowed* to erase depends on `has_active_legal_hold()`:
- **No hold** → safe to fully remove. First **re-point** the accountability rows that must outlive the person (ratings *authored by* them → `rater_id` = sentinel; `reports.target_id` is a free uuid so report rows about them already survive). *Then* delete the `profiles` row (S1 cascades clear `swipes`, `queue_entries`, terminal `offers`/`locks`, `verifications`, `profiles_private`). The `auth.users` row is removed by the worker in Task 9 (MD8) — the DB function only handles the `profiles`-side teardown.
- **Hold present** → **never** delete the `profiles` row (cascade would erase report-linked context). Instead **anonymize in place**: scrub `profiles_private` PII, blank profile content fields, set `account_state='deleted'`, `is_tombstone=true`, `deleted_at=now()`. The retained `reports`/`audit_log`/anonymized rating outcomes stay attached to a real (now identity-less) `profiles.id`. The `auth.users` row is **banned/disabled** (not deleted) by the worker (Task 9) so the held identity cannot re-authenticate.

> **Chat is P6/C9-owned (S7) — P9 does NOT redact messages here.** Under C9, `chat_messages.sender_id` is `on delete set null` with a sender tombstone, and `chat_threads` survive a profile delete (tombstone + `revoked_at`); held threads are exempt from purge (P9 legal-hold). So the hard-delete cascade does NOT corrupt the counterparty's thread, and held-thread survival/redaction is S7's responsibility. P9 references this; it does not re-implement message/sender handling.

**Files:**
- Create: `supabase/migrations/20260525130700_p9_anonymize_fn.sql`
- Test: `supabase/tests/p9_anonymize.sql`

- [ ] **Step 1: Write the failing test** (held user → tombstoned + PII gone + report survives; unheld user → row gone + report still survives via free target_id)

```sql
-- supabase/tests/p9_anonymize.sql
\i supabase/tests/_fixtures.sql   -- C8: mk_user
DO $$
DECLARE held uuid; unheld uuid; reporter uuid; pii_rows int; prof_rows int; rep_rows int;
BEGIN
  held    := mk_user('held');
  unheld  := mk_user('unheld');
  reporter := mk_user('reporter');
  insert into profiles_private (user_id, full_name, phone) values (held,'Held Person','+15550001');
  insert into profiles_private (user_id, full_name, phone) values (unheld,'Unheld Person','+15550002');

  -- a report ABOUT each user (target_id is a free uuid in S1 → survives deletion). C5/C11.6 cols.
  insert into reports (reporter_id, target_type, target_id, reason_category, status)
    values (reporter,'user',held,'harassment','actioned');     -- actioned → hold
  insert into reports (reporter_id, target_type, target_id, reason_category, status)
    values (reporter,'user',unheld,'inappropriate_content','dismissed');  -- dismissed → no hold

  -- HELD path: anonymize-in-place
  PERFORM _p9_anonymize_user(held);
  PERFORM 1 FROM profiles WHERE id=held AND account_state='deleted' AND is_tombstone=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'held user not tombstoned'; END IF;
  select count(*) into pii_rows from profiles_private where user_id=held
    and (full_name is not null or phone is not null);
  IF pii_rows <> 0 THEN RAISE EXCEPTION 'held user PII not scrubbed'; END IF;
  select count(*) into rep_rows from reports where target_id=held;
  IF rep_rows <> 1 THEN RAISE EXCEPTION 'report about held user lost (%)', rep_rows; END IF;

  -- UNHELD path: profiles-side purge
  PERFORM _p9_purge_profile_rows(unheld);
  select count(*) into prof_rows from profiles where id=unheld;
  IF prof_rows <> 0 THEN RAISE EXCEPTION 'unheld user profile not deleted'; END IF;
  select count(*) into pii_rows from profiles_private where user_id=unheld;
  IF pii_rows <> 0 THEN RAISE EXCEPTION 'unheld user PII not cascaded away'; END IF;
  -- report about them STILL survives (target_id has no FK by S1 design)
  select count(*) into rep_rows from reports where target_id=unheld;
  IF rep_rows <> 1 THEN RAISE EXCEPTION 'report about unheld user lost (%)', rep_rows; END IF;

  RAISE NOTICE 'anonymize vs purge OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function _p9_anonymize_user(uuid) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130700_p9_anonymize_fn.sql
-- Sentinel uuid (must match Task 2): '00000000-0000-0000-0000-0000000de1e7'.
-- Chat redaction/tombstone is S7/C9-owned and NOT touched here.

-- Anonymize in place: used when a legal hold exists. NEVER deletes the profiles row.
create or replace function _p9_anonymize_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  -- 1) scrub PII (owner-only table; this fn is definer so it can write)
  update profiles_private
     set full_name=null, phone=null, birthdate=null, bio=null,
         instagram_handle=null, emergency_contact=null
   where user_id=p_user;

  -- 2) blank identity-bearing profile content but keep the row + reliability_score (the score
  --    describes conduct, feeds the safety picture). Also clear status_reason (may name 3rd parties).
  update profiles
     set first_name='[deleted user]',
         blurred_photo_url=null, clear_photo_url=null,
         vibe_tags='{}', gender=null, gender_preferences='{}',
         status_reason=null,
         account_state='deleted', is_tombstone=true, deleted_at=now()
   where id=p_user;

  -- 3) re-point ratings AUTHORED by the user to the sentinel (keep the outcome about the ratee)
  update match_ratings set rater_id='00000000-0000-0000-0000-0000000de1e7'
   where rater_id=p_user;

  insert into audit_log (entity, entity_id, action, detail, actor)
  values ('profiles', p_user, 'anonymized', jsonb_build_object('held', true), p_user);
  -- actor = p_user (the subject); the worker (Task 9) records the operator/request id separately.
end $fn$;

-- Profiles-side purge: used ONLY when has_active_legal_hold() is false. Re-points the rows that
-- must outlive the person, THEN deletes the profile (S1 cascades clear the rest). The worker
-- (Task 9) deletes the matching auth.users row AFTER this returns (MD8).
create or replace function _p9_purge_profile_rows(p_user uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if has_active_legal_hold(p_user) then
    raise exception '_p9_purge_profile_rows: user % is under legal hold; use _p9_anonymize_user', p_user;
  end if;

  -- preserve accountability authored by the user before cascade wipes them:
  update match_ratings set rater_id='00000000-0000-0000-0000-0000000de1e7'
   where rater_id=p_user;
  -- (reports.reporter_id is on-delete-set-null per S1, so those self-heal; reports.target_id
  --  has no FK so reports ABOUT the user survive automatically. Chat sender is on-delete-set-null
  --  per C9, so the counterparty's thread is not corrupted.)

  insert into audit_log (entity, entity_id, action, detail, actor)
  values ('profiles', p_user, 'profile_purged', jsonb_build_object('held', false), p_user);

  delete from profiles where id=p_user;   -- cascades: profiles_private, swipes, queue_entries,
                                           -- terminal offers/locks, lock_participants, verifications, blocks.
end $fn$;

revoke all on function _p9_anonymize_user(uuid)     from public, anon, authenticated;
revoke all on function _p9_purge_profile_rows(uuid) from public, anon, authenticated;
```

> **Cascade-loss caveat to verify at execution:** `match_ratings.lock_id` and `locks` cascade from `profiles`. For an *unheld* purge, ratings *about other people* authored by this user are re-pointed (step above) and survive; ratings on locks where this user is a *participant* cascade away with the lock — acceptable for an unheld (no safety concern) user. For a *held* user we never delete, so nothing cascades. Confirm against S1's exact `on delete` rules (`match_ratings.lock_id → locks(id)` cascade; `locks.*_id → profiles(id)` cascade) and C9's `chat_messages.sender_id on delete set null`.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `anonymize vs purge OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130700_p9_anonymize_fn.sql supabase/tests/p9_anonymize.sql
git commit -m "P9: retention-aware anonymize-in-place vs profiles purge (deletion != blind cascade)"
```

---

## Task 9: The deletion worker (Edge Function) + orchestration/idempotency tests

The worker the roadmap requires, on the C1 (S2) job layer. It claims due `deletion_process` work (or scans `deletion_requests`), runs the teardown in the correct order, and is **idempotent** (safe to re-run after a crash). It calls a single SECURITY DEFINER orchestrator RPC `_p9_process_deletion(request_id)` so the DB does the transactional profiles-side work atomically; then the Deno layer performs the **`auth.users` teardown** (MD8) that SQL cannot do, and records the re-signup fingerprint (Task 12).

**Worker order:**
1. `_p9_process_deletion(request_id)` (atomic, idempotent in the DB): verify grace window elapsed → guard that the user is still `deletion_pending` (refuse if `paused`/`active`/`deleted`) → `_p9_release_in_flight_state(user, true)` → branch on `has_active_legal_hold`: hold → `_p9_anonymize_user` + set `legal_hold_blocked=true`; no hold → `_p9_purge_profile_rows` → record the re-signup fingerprint via `record_tombstoned_identity(user_email_hash, user_phone_hash, held)` (Task 12) → mark `deletion_requests.status='completed'`, `processed_at=now()`.
2. **Deno layer, after the RPC succeeds:** `supabase.auth.admin.deleteUser(user_id)` on the no-hold path (full `auth.users` erasure for GDPR), or ban/disable the auth user (`auth.admin.updateUserById(user_id, { ban_duration: '876000h' })`) on the held path so the tombstoned identity cannot re-authenticate. This is MD8 — without it a "deleted" user keeps valid credentials.

**Files:**
- Create: orchestrator migration `20260525130650_p9_process_deletion_fn.sql`.
- Create: `supabase/functions/process-deletion-requests/index.ts`
- Create: `supabase/functions/process-deletion-requests/index_test.ts`
- Test (DB orchestrator): `supabase/tests/p9_process_deletion.sql`

- [ ] **Step 1a: Write the failing DB test for the orchestrator**

```sql
-- supabase/tests/p9_process_deletion.sql
-- Runs AFTER S6 (real C2 match_* exist) and S2 (jobs/enqueue). No P5 stand-ins.
\i supabase/tests/_fixtures.sql   -- C8: mk_user
DO $$
DECLARE u uuid; req uuid; nprof int; rstatus deletion_request_status;
BEGIN
  -- unheld user, grace already elapsed
  u := mk_user('gone');
  update profiles set account_state='deletion_pending' where id=u;
  insert into profiles_private (user_id, full_name) values (u,'Gone Person');
  insert into deletion_requests (user_id, process_after, status)
    values (u, now()-interval '1 day', 'grace_period') returning id into req;

  PERFORM _p9_process_deletion(req);

  select count(*) into nprof from profiles where id=u;
  IF nprof <> 0 THEN RAISE EXCEPTION 'unheld user profile not purged by worker'; END IF;
  select status into rstatus from deletion_requests where id=req;
  IF rstatus <> 'completed' THEN RAISE EXCEPTION 'request not marked completed (%)', rstatus; END IF;

  -- idempotency: re-running a completed request is a no-op, not an error
  PERFORM _p9_process_deletion(req);
  RAISE NOTICE 'process_deletion (purge + idempotent) OK';
  ROLLBACK;
END $$;

-- held user → anonymize, request flagged legal_hold_blocked
DO $$
DECLARE u uuid; req uuid; reporter uuid; blocked boolean;
BEGIN
  u := mk_user('heldgone');
  update profiles set account_state='deletion_pending' where id=u;
  reporter := mk_user('rep');
  insert into reports (reporter_id,target_type,target_id,reason_category,status)
    values (reporter,'user',u,'harassment','open');
  insert into deletion_requests (user_id, process_after, status)
    values (u, now()-interval '1 day','grace_period') returning id into req;

  PERFORM _p9_process_deletion(req);
  PERFORM 1 FROM profiles WHERE id=u AND is_tombstone=true AND account_state='deleted';
  IF NOT FOUND THEN RAISE EXCEPTION 'held user not anonymized-in-place'; END IF;
  select legal_hold_blocked into blocked from deletion_requests where id=req;
  IF NOT blocked THEN RAISE EXCEPTION 'request not flagged legal_hold_blocked'; END IF;

  RAISE NOTICE 'process_deletion (held → anonymize) OK';
  ROLLBACK;
END $$;

-- guard: user no longer deletion_pending (e.g. resumed) → orchestrator refuses
DO $$
DECLARE u uuid; req uuid; ok boolean := false;
BEGIN
  u := mk_user('resumed');  -- left as 'active' (default)
  insert into deletion_requests (user_id, process_after, status)
    values (u, now()-interval '1 day','grace_period') returning id into req;
  BEGIN PERFORM _p9_process_deletion(req);
  EXCEPTION WHEN others THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'orchestrator processed a non-deletion_pending user'; END IF;
  RAISE NOTICE 'process_deletion lifecycle-guard OK';
  ROLLBACK;
END $$;

-- grace NOT elapsed → orchestrator refuses
DO $$
DECLARE u uuid; req uuid; ok boolean := false;
BEGIN
  u := mk_user('tooearly');
  update profiles set account_state='deletion_pending' where id=u;
  insert into deletion_requests (user_id, process_after, status)
    values (u, now()+interval '10 days','grace_period') returning id into req;
  BEGIN PERFORM _p9_process_deletion(req);
  EXCEPTION WHEN others THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'orchestrator processed a request before grace window elapsed'; END IF;
  RAISE NOTICE 'process_deletion grace-guard OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 1b: Run it, expect FAIL** (`function _p9_process_deletion(uuid) does not exist`).

- [ ] **Step 2: Write the orchestrator migration**

```sql
-- supabase/migrations/20260525130650_p9_process_deletion_fn.sql
-- Single transactional orchestrator the worker calls. Idempotent: a completed/cancelled
-- request is a no-op; only requests for a still-deletion_pending user past the grace window proceed.
create or replace function _p9_process_deletion(p_request uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare r deletion_requests%rowtype; v_state account_lifecycle; v_hold boolean;
begin
  select * into r from deletion_requests where id=p_request for update;
  if not found then raise exception '_p9_process_deletion: request % not found', p_request; end if;

  if r.status in ('completed','cancelled') then
    return;  -- idempotent no-op
  end if;
  if r.process_after > now() then
    raise exception '_p9_process_deletion: grace window not elapsed (process_after=%)', r.process_after;
  end if;

  -- Lifecycle interlock: only act on a user STILL in deletion_pending. If they resumed/paused
  -- to active (cancel should have fired, but guard against TOCTOU/races), refuse.
  select account_state into v_state from profiles where id=r.user_id;
  if v_state is distinct from 'deletion_pending' then
    raise exception '_p9_process_deletion: user % is % (not deletion_pending); refusing', r.user_id, v_state;
  end if;

  update deletion_requests set status='processing', attempts=attempts+1 where id=p_request;

  -- 1) release all in-flight state (drives C2 transitions; frees counterparties)
  perform _p9_release_in_flight_state(r.user_id, true);

  -- 2) erase identity, retention-aware. record the re-signup fingerprint (Task 12) either way.
  v_hold := has_active_legal_hold(r.user_id);
  perform record_tombstoned_identity(r.user_id, v_hold);   -- hashes email/phone from auth.users
  if v_hold then
    perform _p9_anonymize_user(r.user_id);
    update deletion_requests set legal_hold_blocked=true where id=p_request;
  else
    perform _p9_purge_profile_rows(r.user_id);
  end if;

  update deletion_requests set status='completed', processed_at=now() where id=p_request;
end $fn$;

revoke all on function _p9_process_deletion(uuid) from public, anon, authenticated;
```

> **Note:** `_p9_process_deletion` does the **profiles-side** teardown only. The `auth.users` deletion/ban (MD8) is performed by the Deno worker after this RPC succeeds (SQL cannot delete `auth.users` safely from a definer fn in all Supabase configs; the admin API is the supported path). `record_tombstoned_identity` reads `auth.users.email`/`phone` (definer, `search_path=auth,public`) and stores only salted hashes (Task 12).

- [ ] **Step 3: Run the DB test, expect PASS** (prints the three `... OK` notices).

- [ ] **Step 4: Write the worker Edge Function**

```ts
// supabase/functions/process-deletion-requests/index.ts
// Deletion-request worker on the C1 (S2) job layer. Scans due deletion_requests, calls the
// transactional orchestrator _p9_process_deletion (profiles-side, idempotent), then performs
// the auth.users teardown (MD8) the DB cannot: full delete on the no-hold path, ban on the
// held path. Safe to re-run (orchestrator is idempotent; auth ops are idempotent-by-effect).
//
// Auth: service-role bearer required (admin-only). verify_jwt OFF on deploy.
// Invoke (C1 runner or cron):
//   curl -X POST $URL/functions/v1/process-deletion-requests \
//     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
//     -H "Content-Type: application/json" -d '{"batch_size": 25}'

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';

interface DueRequest { id: string; user_id: string }

export async function processDueRequests(
  supabase: ReturnType<typeof createClient>,
  batchSize: number,
): Promise<{ processed: number; failed: number; errors: Array<{ id: string; error: string }> }> {
  const { data, error } = await supabase
    .from('deletion_requests')
    .select('id, user_id')
    .eq('status', 'grace_period')
    .lte('process_after', new Date().toISOString())
    .order('process_after', { ascending: true })
    .limit(batchSize);

  if (error) throw new Error(`claim failed: ${error.message}`);
  const due = (data ?? []) as DueRequest[];

  let processed = 0, failed = 0;
  const errors: Array<{ id: string; error: string }> = [];
  for (const req of due) {
    // 1) profiles-side teardown (atomic, idempotent)
    const { error: rpcErr } = await supabase.rpc('_p9_process_deletion', { p_request: req.id });
    if (rpcErr) {
      failed++;
      errors.push({ id: req.id, error: rpcErr.message });
      await supabase.from('deletion_requests')
        .update({ worker_error: rpcErr.message })
        .eq('id', req.id);
      continue;
    }
    // 2) auth.users teardown (MD8) — the DB orchestrator set legal_hold_blocked; read it back.
    const { data: doneRow } = await supabase
      .from('deletion_requests')
      .select('legal_hold_blocked')
      .eq('id', req.id)
      .single();
    const held = !!doneRow?.legal_hold_blocked;
    const { error: authErr } = held
      ? await supabase.auth.admin.updateUserById(req.user_id, { ban_duration: '876000h' }) // ~100y ban
      : await supabase.auth.admin.deleteUser(req.user_id);                                  // full erasure
    if (authErr) {
      failed++;
      errors.push({ id: req.id, error: `auth teardown: ${authErr.message}` });
      await supabase.from('deletion_requests')
        .update({ worker_error: `auth teardown: ${authErr.message}` })
        .eq('id', req.id);
      continue;
    }
    processed++;
  }
  return { processed, failed, errors };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const auth = req.headers.get('Authorization');
  const expected = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (auth !== expected) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({})) as { batch_size?: number };
  const batchSize = Math.min(100, Math.max(1, body.batch_size ?? 25));

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const result = await processDueRequests(supabase, batchSize);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});
```

- [ ] **Step 5: Write the Deno test (pure orchestration, mocked client)**

```ts
// supabase/functions/process-deletion-requests/index_test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { processDueRequests } from './index.ts';

// Minimal mock of the supabase client surface processDueRequests touches, incl. the
// auth.admin teardown (MD8) and the legal_hold_blocked read-back.
function mockClient(opts: {
  due: Array<{ id: string; user_id: string }>;
  rpcFails?: Set<string>;
  held?: Set<string>;            // request ids whose legal_hold_blocked=true
  authDeleteFails?: Set<string>; // user ids whose auth teardown fails
}) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const rpcCalls: string[] = [];
  const authDeleted: string[] = [];
  const authBanned: string[] = [];
  // deno-lint-ignore no-explicit-any
  const client: any = {
    from(_t: string) {
      return {
        select() { return this; },
        eq() { return this; },
        lte() { return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data: opts.due, error: null }); },
        // read-back of legal_hold_blocked for a single request
        single() { return Promise.resolve({ data: { legal_hold_blocked: false }, error: null }); },
        update(patch: Record<string, unknown>) {
          return { eq: (_c: string, id: string) => { updates.push({ id, patch }); return Promise.resolve({ error: null }); } };
        },
      };
    },
    rpc(_fn: string, args: { p_request: string }) {
      rpcCalls.push(args.p_request);
      if (opts.rpcFails?.has(args.p_request)) {
        return Promise.resolve({ error: { message: 'boom' } });
      }
      return Promise.resolve({ error: null });
    },
    auth: {
      admin: {
        deleteUser(id: string) {
          if (opts.authDeleteFails?.has(id)) return Promise.resolve({ error: { message: 'auth-boom' } });
          authDeleted.push(id); return Promise.resolve({ error: null });
        },
        updateUserById(id: string, _opts: unknown) {
          authBanned.push(id); return Promise.resolve({ error: null });
        },
      },
    },
  };
  return { client, updates, rpcCalls, authDeleted, authBanned };
}

Deno.test('processes every due request: orchestrator RPC then auth.users delete (no hold)', async () => {
  const { client, rpcCalls, authDeleted } = mockClient({
    due: [{ id: 'r1', user_id: 'u1' }, { id: 'r2', user_id: 'u2' }],
  });
  const res = await processDueRequests(client, 25);
  assertEquals(res.processed, 2);
  assertEquals(res.failed, 0);
  assertEquals(rpcCalls, ['r1', 'r2']);
  assertEquals(authDeleted, ['u1', 'u2']);   // MD8: auth.users erased on no-hold path
});

Deno.test('records worker_error and counts failure without aborting the batch (rpc fail)', async () => {
  const { client, updates } = mockClient({
    due: [{ id: 'r1', user_id: 'u1' }, { id: 'r2', user_id: 'u2' }],
    rpcFails: new Set(['r1']),
  });
  const res = await processDueRequests(client, 25);
  assertEquals(res.processed, 1);
  assertEquals(res.failed, 1);
  assertEquals(updates.some((u) => u.id === 'r1' && u.patch.worker_error === 'boom'), true);
});

Deno.test('auth teardown failure is recorded and counted, batch continues', async () => {
  const { client, updates } = mockClient({
    due: [{ id: 'r1', user_id: 'u1' }, { id: 'r2', user_id: 'u2' }],
    authDeleteFails: new Set(['u1']),
  });
  const res = await processDueRequests(client, 25);
  assertEquals(res.processed, 1);
  assertEquals(res.failed, 1);
  assertEquals(updates.some((u) => u.id === 'r1' && String(u.patch.worker_error).includes('auth teardown')), true);
});

Deno.test('no due requests → zero processed, no rpc calls', async () => {
  const { client, rpcCalls, authDeleted } = mockClient({ due: [] });
  const res = await processDueRequests(client, 25);
  assertEquals(res.processed, 0);
  assertEquals(rpcCalls.length, 0);
  assertEquals(authDeleted.length, 0);
});
```

- [ ] **Step 6: Run the Deno tests, expect PASS**

Run: `deno test --allow-net supabase/functions/process-deletion-requests/index_test.ts`
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260525130650_p9_process_deletion_fn.sql \
        supabase/functions/process-deletion-requests/index.ts \
        supabase/functions/process-deletion-requests/index_test.ts \
        supabase/tests/p9_process_deletion.sql
git commit -m "P9: deletion worker (Edge Function) + transactional idempotent orchestrator RPC"
```

---

## Task 10: GDPR/CCPA data export (right of access)

The other compliance half: a user can request a machine-readable copy of *their* data. SECURITY DEFINER `build_data_export(user)` assembles a single JSON document from every table that holds the user's data and stores it in a short-lived `data_exports` row (worker/edge fn streams it to a signed URL later; the assembly is the load-bearing, testable part here).

**Files:**
- Create: `supabase/migrations/20260525130800_p9_export_fn.sql`
- Test: `supabase/tests/p9_export.sql`

- [ ] **Step 1: Write the failing test** (export includes profile + private PII + the user's swipes/ratings, excludes other users' rows)

```sql
-- supabase/tests/p9_export.sql
\i supabase/tests/_fixtures.sql   -- C8: mk_user/mk_itinerary/mk_instance
DO $$
DECLARE u uuid; counterpart uuid; itin uuid; inst uuid; doc jsonb;
BEGIN
  u := mk_user('exporter');
  counterpart := mk_user('counterpart');
  insert into profiles_private (user_id, full_name, phone) values (u,'Export Me','+15559999');
  itin := mk_itinerary(counterpart);
  inst := mk_instance(itin, counterpart, now()+interval '2 days');
  insert into swipes (swiper_id,date_instance_id,creator_id,direction)
    values (u, inst, counterpart, 'right');

  doc := build_data_export(u);

  IF doc->'profile'->>'first_name' <> 'exporter'
     THEN RAISE EXCEPTION 'export missing profile'; END IF;
  IF doc->'profile_private'->>'phone' <> '+15559999'
     THEN RAISE EXCEPTION 'export missing private PII'; END IF;
  IF jsonb_array_length(coalesce(doc->'swipes','[]'::jsonb)) <> 1
     THEN RAISE EXCEPTION 'export missing the user swipe'; END IF;
  -- must NOT leak the counterpart's name (only ids the user already knows)
  IF doc::text ILIKE '%counterpart%'
     THEN RAISE EXCEPTION 'export leaked another user identity'; END IF;

  RAISE NOTICE 'data export OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function build_data_export(uuid) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130800_p9_export_fn.sql
create table if not exists data_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'ready' check (status in ('pending','ready','expired')),
  document jsonb,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
alter table data_exports enable row level security;
do $$ begin
  create policy "data_exports_owner_read" on data_exports for select
    using (user_id = auth.uid() and expires_at > now());
exception when duplicate_object then null; end $$;

-- Assemble the access-request document. Only the requesting user's own rows; deliberately
-- omits creator/counterparty identities in joined rows (only ids + the user's own action).
create or replace function build_data_export(p_user uuid default auth.uid())
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare doc jsonb;
begin
  if p_user is distinct from auth.uid() and auth.uid() is not null then
    raise exception 'build_data_export: may only export your own data';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) - 'id' from profiles p where p.id=p_user),
    'profile_private', (select to_jsonb(pp) - 'user_id' from profiles_private pp where pp.user_id=p_user),
    'verifications', (select coalesce(jsonb_agg(to_jsonb(v) - 'user_id'),'[]') from verifications v where v.user_id=p_user),
    'swipes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'date_instance_id', s.date_instance_id, 'direction', s.direction, 'at', s.created_at)),'[]')
                from swipes s where s.swiper_id=p_user),
    'queue_entries', (select coalesce(jsonb_agg(jsonb_build_object(
                  'date_instance_id', q.date_instance_id, 'status', q.status, 'at', q.created_at)),'[]')
                from queue_entries q where q.candidate_id=p_user),
    'ratings_authored', (select coalesce(jsonb_agg(jsonb_build_object(
                  'lock_id', m.lock_id, 'showed_up', m.showed_up, 'on_time', m.on_time,
                  'cancelled_with_notice', m.cancelled_with_notice,
                  'unsafe_or_disrespectful', m.unsafe_or_disrespectful, 'at', m.submitted_at)),'[]')
                from match_ratings m where m.rater_id=p_user),
    'reports_filed', (select coalesce(jsonb_agg(jsonb_build_object(
                  'target_type', r.target_type, 'reason_category', r.reason_category,
                  'detail', r.detail, 'status', r.status, 'at', r.created_at)),'[]')
                from reports r where r.reporter_id=p_user),  -- C5/C11.6 columns
    'blocks', (select coalesce(jsonb_agg(jsonb_build_object('at', b.created_at)),'[]')
                from blocks b where b.blocker_id=p_user)
    -- NOTE (compliance gaps to close in coordination, not invented here): a fully GDPR-complete
    -- right-of-access export should also include the user's CHAT MESSAGES (S7/C9-owned) and the
    -- user's auth identity (email/phone from auth.users). These are owned by other stages; add
    -- them via the owning stage rather than duplicating their schema in P9. Flag as a contract
    -- amendment if the export scope must be authoritative.
  ) into doc;

  insert into data_exports (user_id, document) values (p_user, doc);
  return doc;
end $fn$;

grant execute on function build_data_export(uuid) to authenticated;
```

> **Note on `to_jsonb(p) - 'id'`:** the export keeps the user's own `first_name`; counterparty *names* are never joined in (only ids the user already knows), so the non-leakage assertion holds. The load-bearing assertion is identity non-leakage of *joined* rows.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `data export OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130800_p9_export_fn.sql supabase/tests/p9_export.sql
git commit -m "P9: GDPR/CCPA data export (build_data_export + data_exports, owner-only, self-only)"
```

---

## Task 12: `auth.users` deletion + same-email/phone re-signup defense (MD8)

Two halves of the abuse vector the audit flagged: (a) a "deleted" user keeps valid `auth.users` credentials and can re-authenticate into a profile-less app; (b) a suspended/deleted/held person re-registers with the same email/phone to shed `reliability_score`/`standing`/open reports/holds. P9 closes both:
- **`auth.users` teardown** is performed by the worker (Task 9) via the admin API: full `deleteUser` on the no-hold path; ban/disable on the held path. (SQL alone can't do this portably.)
- **Re-signup defense:** a `tombstoned_identities` table stores **salted hashes** of the user's email/phone (never plaintext) at teardown time. A signup-time check rejects (or routes to appeal) a registration whose email/phone hash matches a held/tombstoned identity. The DB owns the fingerprint + the check helper; the wiring into the actual signup flow is S3's auth front door (cross-stage — `Depends on` S3 for the call site).

**Files:**
- Create: `supabase/migrations/20260525130900_p9_resignup_defense.sql`
- Test: `supabase/tests/p9_resignup_defense.sql`

- [ ] **Step 1: Write the failing test** (record a tombstoned identity → its email hash is flagged; a fresh email is not)

```sql
-- supabase/tests/p9_resignup_defense.sql
\i supabase/tests/_fixtures.sql   -- C8: mk_user
DO $$
DECLARE u uuid; flagged boolean;
BEGIN
  u := mk_user('banned');   -- mk_user creates the matching auth.users row (C8)
  -- record the tombstone fingerprint (held=true → durable ban-class hold)
  PERFORM record_tombstoned_identity(u, true);

  -- the same email is now flagged at signup time
  SELECT identity_is_tombstoned((select email from auth.users where id=u), null) INTO flagged;
  IF NOT flagged THEN RAISE EXCEPTION 're-signup with a tombstoned email was NOT flagged'; END IF;

  -- a brand-new email is not flagged
  SELECT identity_is_tombstoned('totally-new-'||gen_random_uuid()||'@test.local', null) INTO flagged;
  IF flagged THEN RAISE EXCEPTION 'fresh email wrongly flagged as tombstoned'; END IF;

  RAISE NOTICE 're-signup defense OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function record_tombstoned_identity(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130900_p9_resignup_defense.sql
-- Salted hashes of email/phone for deleted/held identities. NEVER plaintext PII.
create table if not exists tombstoned_identities (
  id uuid primary key default gen_random_uuid(),
  email_hash text,
  phone_hash text,
  held boolean not null default false,   -- true = ban-class (appeal-only); false = plain deletion
  created_at timestamptz not null default now()
);
create index if not exists tombstoned_identities_email_idx on tombstoned_identities(email_hash) where email_hash is not null;
create index if not exists tombstoned_identities_phone_idx on tombstoned_identities(phone_hash) where phone_hash is not null;
alter table tombstoned_identities enable row level security;  -- service-role only; no policies.

-- Salt comes from a DB setting (set via supabase secrets / GUC); never hardcode.
create or replace function _p9_identity_salt() returns text
language sql stable as $$ select coalesce(current_setting('app.identity_salt', true), 'p9-default-rotate-me') $$;

-- Record the departing user's email/phone hashes from auth.users. Definer + search_path so it
-- can read the auth schema. Called from _p9_process_deletion (Task 9).
create or replace function record_tombstoned_identity(p_user uuid, p_held boolean)
returns void language plpgsql security definer set search_path = auth, public as $fn$
declare v_email text; v_phone text;
begin
  select email, phone into v_email, v_phone from auth.users where id=p_user;
  insert into tombstoned_identities (email_hash, phone_hash, held)
  values (
    case when v_email is not null then encode(digest(lower(v_email) || _p9_identity_salt(), 'sha256'),'hex') end,
    case when v_phone is not null then encode(digest(v_phone || _p9_identity_salt(), 'sha256'),'hex') end,
    p_held
  );
end $fn$;
revoke all on function record_tombstoned_identity(uuid,boolean) from public, anon, authenticated;

-- Signup-time check (called from S3's auth front door). True = this email/phone matches a
-- tombstoned/held identity and must be rejected/routed to appeal.
create or replace function identity_is_tombstoned(p_email text, p_phone text)
returns boolean language sql security definer set search_path = public stable as $fn$
  select exists (
    select 1 from tombstoned_identities t
     where (p_email is not null and t.email_hash = encode(digest(lower(p_email) || _p9_identity_salt(),'sha256'),'hex'))
        or (p_phone is not null and t.phone_hash = encode(digest(p_phone || _p9_identity_salt(),'sha256'),'hex'))
  );
$fn$;
revoke all on function identity_is_tombstoned(text,text) from public, anon, authenticated;
grant execute on function identity_is_tombstoned(text,text) to service_role;
```

> **Cross-stage wiring (Depends on S3):** S3 (verification/onboarding front door) calls `identity_is_tombstoned(email, phone)` before creating a profile and rejects/routes-to-appeal on a match. P9 owns the fingerprint + check; S3 owns the call site. `pgcrypto` (`digest`) is enabled in S1's spine.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `re-signup defense OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130900_p9_resignup_defense.sql supabase/tests/p9_resignup_defense.sql
git commit -m "P9: tombstoned-identity fingerprint + signup-time re-signup defense (MD8)"
```

---

## Task 13: Full reset verification + regenerate types

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)

- [ ] **Step 1: Full reset** — `supabase db reset` (applies the full cumulative S1→…→S10 migration set in order; expect no error). **Verify there is NO `account_status` enum, NO duplicate `jobs`/`job_status` from P9, and NO `browse_feed` redefinition in P9's band.**

- [ ] **Step 2: Run all P9 tests**

```bash
for f in supabase/tests/p9_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expected: every file exits 0; notices print `… OK`.

- [ ] **Step 3: Run the worker Deno tests** — `deno test --allow-net supabase/functions/process-deletion-requests/index_test.ts` (expect 4 passed).

- [ ] **Step 4: Regenerate TypeScript types** — `pnpm db:types`
Expected: `packages/types/src/database.ts` gains `deletion_requests`, `legal_holds`, `data_exports`, `tombstoned_identities`, the `deletion_request_status` enum, and P9's new `profiles` columns (`status_changed_at`, `status_reason`, `deleted_at`, `is_tombstone`). It MUST NOT introduce a P9-owned `account_status`/`job_status` enum or a second `jobs` table (those are S1/S2-owned).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P9: regenerate database types for account lifecycle + compliance schema"
```

---

## Self-Review

**Spec/roadmap coverage (vs P9 'Closes'):**
- "account deletion mid-flow → orphaned locks" → Task 7 `_p9_release_in_flight_state` drives the C2 (S6) transitions `match_withdraw` / `match_expire_offer` / `match_cancel_lock(p_user, lock, 'account_closed', idem)`, freeing + safe-rolling the counterparty (`account_closed` is benign in C2); tested with an active lock held by the leaver (Task 7) and within the worker (Task 9). ✅
- "GDPR/CCPA" → Task 10 `build_data_export` (right of access) + Tasks 6–9 + Task 12 (right of erasure: request → grace → worker → profiles erase + `auth.users` teardown). ✅
- "soft-delete regret" → Task 6 grace window (`deletion_pending` + `cancel_deletion_request` restores `active`), worker only acts after `process_after` and only while still `deletion_pending` (Task 9 grace + lifecycle guards). ✅
- "retain banned user's report history + audit_log even after deletion" → Task 4 `has_active_legal_hold` (explicit + implicit-from-non-dismissed-report) + Task 8 anonymize-in-place never deletes the held `profiles` row; reports about a user survive by S1's free-uuid `target_id` even on purge (Task 8 asserts both). ✅
- "deletion_requests table + worker on the job layer" → Task 3 table + Task 9 worker enqueued via C1 `enqueue_job('deletion_process', …)` (S2). ✅
- "anonymization + retention/legal-hold" → Task 8 two-path erasure. ✅
- "auth.users deletion + re-signup defense" (MD8) → Task 9 (auth teardown) + Task 12 (`tombstoned_identities` fingerprint + `identity_is_tombstoned` check, wired at signup by S3). ✅
- "orphan-handling for offers/locks/queue/chat/ratings" → Task 7 (offers/locks/queue + owed-ratings); **chat tombstoning is S7/C9-owned** (`sender_id on delete set null`, threads survive + `revoked_at`, held threads purge-exempt) — referenced, not redefined. ✅

**Account-state model — decision recorded (C3/C11.5, restated not redefined):**
- `account_state account_lifecycle` (P9/S10) = exactly `active,paused,deletion_pending,deleted`. **No `suspended`.**
- `standing standing_state` (P7/S8) carries `suspended`; gating is `can_enter_lock_flow` (C3). P9 has no `suspend_account`/`account_active()`.
- PAUSE: user-initiated, reversible, identity + **active locks retained** (C11.9 — pause does not cancel a lock; reconfirm/check-in still fire); resume one-tap.
- DELETE: user-initiated, grace window (default 30d) → worker releases in-flight, then purges (no hold) or anonymizes-in-place (hold), then `auth.users` delete/ban (MD8).
- The data-effects teardown a SUSPEND triggers reuses P9's `_p9_release_in_flight_state` helper, invoked by S8's ladder; P9 owns the helper, S8 owns *when*.

**Retention policy:** deletion never blind-cascades. A user under an active legal hold (explicit hold OR any open/reviewing/actioned report naming them) is **anonymized in place** (PII scrubbed, profile blanked, `is_tombstone=true`) so `reports`, `audit_log`, and anonymized rating *outcomes* survive attached to a real id. No-hold users have their `profiles` row purged + `auth.users` deleted; ratings they authored re-point to the `[deleted user]` sentinel; reports about them survive via the FK-less `reports.target_id`.

**Dependency coordination (Depends on):**
- **S2 (C1):** jobs/`enqueue_job`/`cancel_jobs`/runner + `dispatch_notification` consumed by canonical signature. **No P9 `jobs`/`job_status`/`enqueue` definitions** (C11.5). Task 1 is a test-only `if not exists` C1-shaped guard, never a migration.
- **S6 (C2):** P9 *calls* the real `match_cancel_lock`/`match_expire_offer`/`match_withdraw`; it does NOT own or extend `cancel_reason` and does not invent `cancel_lock`/`expire_offer`/`withdraw_from_queue`. `account_closed` is benign (auto-roll).
- **S7 (C9):** chat tombstone/redaction referenced for held-thread survival; not redefined.
- **S8:** owns `standing` (incl. `suspended`), the enforcement ladder, `reports`/`disputes` (C5/C11.6); P9 reads `reports` for legal hold and exposes `_p9_release_in_flight_state` for the ladder to call.
- **S3:** owns the signup front door that calls `identity_is_tombstoned` (Task 12 call site).

**Idempotency / safety:** `_p9_process_deletion` is `for update` + terminal-no-op + grace-guarded + lifecycle-guarded (refuses non-`deletion_pending`); the worker records `worker_error` and continues on RPC *or* auth-teardown failure (Deno tests cover success, rpc-fail, auth-fail, empty). All privileged fns are `security definer` with `revoke … from public/anon/authenticated`; owner-callable `pause/resume/request/cancel/export` are granted to `authenticated`, self-scoped via the `auth.uid()` guard; `identity_is_tombstoned` is `service_role`-only.

**Migration banding:** all P9 migrations live in the C6 band `130000–1309xx` (`130000` lifecycle cols, `130300` legal_hold, `130400` pause/resume, `130500` request-deletion, `130600` orphan teardown, `130650` orchestrator, `130700` anonymize, `130800` export, `130900` re-signup defense). No `account_status` enum, no duplicate `jobs`/`job_status`, no `browse_feed` redefinition (C11.3 single definition lives in S12 `133000`).

**Placeholder scan:** none — every step has runnable SQL/TS and exact commands. The only non-shipped code is the optional test-tree C1/C2 guard for isolated harness runs (`if not exists`, C1/C2-shaped), never in `supabase/migrations/`.

**Type/name consistency:** P9 owns and declares once: `deletion_requests`/`deletion_request_status`, `legal_holds`, `data_exports`, `tombstoned_identities`, and the P9 `profiles` columns. P9 references (never redefines): `account_lifecycle`/`account_state` (S1), `standing` (S8), C1 `jobs`/`job_type`/`job_status`/`enqueue_job`/`cancel_jobs` (S2), C2 `match_*`/`cancel_reason` (S6), C9 chat tombstone (S7), `reports`/`report_status`/`report_reason_category` (S8). Sentinel uuid `00000000-0000-0000-0000-0000000de1e7` identical across Tasks 2, 7, 8.

**Risk note:** psql tests seed via C8 `mk_user`/`mk_itinerary`/`mk_instance` (which create the matching `auth.users` rows), so the re-signup-defense and auth-lifecycle paths are exercisable; `auth.uid()`-gated policy behavior is verified by app-level integration tests, consistent with the spine's convention.

---

## Execution Handoff

**Subordinate execution slice — implement only through INTEGRATION-CONTRACT.md v2 + RECONCILED-MASTER-PLAN.md. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks; confirm the C2 `match_*` signatures and C1 `enqueue_job` are present (S2/S6 landed) before Task 7/9.

**2. Inline Execution** — execute tasks in this session using executing-plans, with checkpoints after Task 5 (lifecycle states), Task 8 (retention), Task 9 (worker + auth teardown), and Task 12 (re-signup defense).
