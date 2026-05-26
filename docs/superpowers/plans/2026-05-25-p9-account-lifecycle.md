# P9 — Account Lifecycle & Compliance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a real, accountable human three distinct ways to leave (PAUSE / SUSPEND / DELETE), make each one *safe for everyone still in flight*, and satisfy GDPR/CCPA (data export + erasure) — **without** ever blind-cascading away the report history and audit trail we are legally and ethically required to keep on a person who harmed someone. Deletion is a coordinated teardown (notify + cancel + free the other party + safe-roll + anonymize), driven by a `deletion_requests` table and a worker that runs on the P2 job layer.

**Architecture:** Build on P0's schema (`profiles`, `profiles_private`, `date_instances`, `swipes`, `queue_entries`, `offers`, `locks`/`lock_participants`, `match_ratings`, `reports`, `blocks`, `verifications`, `audit_log`) and on the existing planner schema. The three lifecycle states are a single `profiles.account_status` enum plus dated columns — *not* three different mechanisms. The hard separation we enforce in the DB: **destroy the person's identity (PII + profile content), preserve the accountability skeleton (reports they are a subject of, audit_log, anonymized rating outcomes they caused).** P0 already set FK on-delete behaviors that make a literal `DELETE FROM profiles` *dangerous* — `reports.reporter_id` is `on delete set null` but `reports.target_id` is a free uuid (no FK, so a row about the deleting user survives by construction), while `match_ratings`, `locks`, `offers`, `queue_entries`, `swipes` all `cascade` from `profiles`. So a real hard-delete would erase the very rows safety needs. P9 therefore **never deletes the `profiles` row for a user under legal hold**; it *anonymizes in place* and tombstones. For users with no hold, the worker first detaches/relocates the accountability rows it must keep, *then* hard-deletes. Orphan-handling for in-flight state is done by calling the **P5 transition functions** (`cancel_lock`, `withdraw_from_queue`, `expire_offer`) with reason `account_closed`, so the state machine's invariants and auto-roll logic stay authoritative — P9 does not re-implement the loop, it *drives* it.

**Tech Stack:** Supabase Postgres, SQL migrations (`supabase/migrations/`), RLS with `auth.uid()`, SECURITY DEFINER functions for the privileged teardown, psql-based behavioral tests (`supabase/tests/`), one Deno Edge Function worker (`supabase/functions/`) tested with `Deno.test`, regenerated TS types.

**Source docs:** spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§7.6 cancellation/safe-roll, §8 enforcement ladder → suspension, §6 audit log); roadmap `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (P9 scope + 'Closes': account deletion mid-flow → orphaned locks, GDPR/CCPA, soft-delete regret); foundation `docs/superpowers/plans/2026-05-25-p0-data-model.md` (FK on-delete behaviors, RLS conventions, invariants).

**Dependency contract (tables/functions owned by sibling phases, referenced here):**
- **P2** owns `jobs` (a `jobs` table + runner) and `notifications`. P9 enqueues work by inserting into `jobs` and surfaces user-facing messages by inserting into `notifications`. P9 declares the *shape it needs* in Task 1's compatibility shim so this phase is testable in isolation and reconciles cleanly when P2 lands.
- **P5** owns the transition functions `cancel_lock(p_lock_id, p_reason, p_actor)`, `withdraw_from_queue(p_queue_entry_id, p_reason)`, `expire_offer(p_offer_id, p_reason)`, and the `cancel_reason` enum. P9 **adds the `account_closed` value to `cancel_reason`** (Task 2) and **calls** these functions; it does not own the loop logic. If P5 has not landed, the worker test (Task 9) uses thin stand-in functions with the identical signature so the orchestration is provable now.
- **P6** owns `chats`/`messages`. P9 redacts message *bodies* authored by a deleted user but keeps the message envelope (sender tombstoned) so the other party's thread is not corrupted and so moderation/legal can still see *that* a message existed.
- **P7** owns reliability-score computation + the enforcement ladder. SUSPEND is the ladder's terminal rung; P9 provides the `account_status='suspended'` state and the data effects, P7 decides *when* to flip it.

**Reconciliation note:** P0's `match_ratings` cascades on `profiles` delete via `on delete cascade`. For a user who *rated others*, we keep those rows (they describe the ratee's behavior, not the deleter's identity) by **re-pointing `rater_id` to the sentinel `[deleted-user]` profile** before any hard delete, never by cascade. For ratings *about* the deleter, we keep the structured outcomes (anonymized) because they feed the ratee/reporter safety picture. This is the core "deletion ≠ blind cascade" mechanic.

---

## File Structure

- `supabase/migrations/20260525130000_p9_account_status.sql` — Task 2: `account_status` enum + columns + `account_closed` cancel reason + sentinel "deleted user" profile.
- `supabase/migrations/20260525130100_p9_jobs_notifications_shim.sql` — Task 1: P2-compat shim (only created `if not exists`; P2 supersedes).
- `supabase/migrations/20260525130200_p9_deletion_requests.sql` — Task 3: `deletion_requests` table + RLS + dedupe invariant.
- `supabase/migrations/20260525130300_p9_legal_hold.sql` — Task 4: `legal_holds` table + `has_active_legal_hold()` helper.
- `supabase/migrations/20260525130400_p9_pause_suspend_fns.sql` — Task 5: `pause_account`/`resume_account`/`suspend_account` SECURITY DEFINER fns + feed-suppression hook.
- `supabase/migrations/20260525130500_p9_request_deletion_fn.sql` — Task 6: `request_account_deletion()` + `cancel_deletion_request()` (the 30-day soft-delete grace window).
- `supabase/migrations/20260525130600_p9_orphan_teardown_fn.sql` — Task 7: `_p9_release_in_flight_state(user)` — drives P5 transitions for locks/offers/queue.
- `supabase/migrations/20260525130700_p9_anonymize_fn.sql` — Task 8: `_p9_anonymize_user(user)` (retention-aware) + `_p9_hard_delete_user(user)` (only when no hold).
- `supabase/migrations/20260525130800_p9_export_fn.sql` — Task 10: `build_data_export(user)` (GDPR/CCPA access request) + `data_exports` table.
- `supabase/functions/process-deletion-requests/index.ts` — Task 9: the worker (claims due requests, runs teardown, idempotent, service-role gated).
- `supabase/functions/process-deletion-requests/index_test.ts` — Task 9: `Deno.test` orchestration/idempotency tests.
- `supabase/tests/p9_*.sql` — one psql behavioral test file per task that warrants it.
- `packages/types/src/database.ts` — regenerated in Task 11.

---

## Task 1: P2-compatibility shim — `jobs` + `notifications` (only if absent)

P9 must enqueue async deletion processing and emit user-facing messages. P2 owns these tables. To keep P9 independently testable *and* avoid a duplicate-definition clash when P2 lands, create them only `if not exists` with the minimal columns P9 reads/writes. When P2 lands first, this migration is a no-op.

**Files:**
- Create: `supabase/migrations/20260525130100_p9_jobs_notifications_shim.sql`
- Test: `supabase/tests/p9_jobs_shim.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p9_jobs_shim.sql
DO $$
BEGIN
  PERFORM 1 FROM information_schema.tables WHERE table_name='jobs';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs table missing'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='jobs' AND column_name='run_after';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs.run_after missing (worker needs scheduling)'; END IF;
  PERFORM 1 FROM information_schema.tables WHERE table_name='notifications';
  IF NOT FOUND THEN RAISE EXCEPTION 'notifications table missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`jobs table missing`).

Run: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p9_jobs_shim.sql`

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130100_p9_jobs_notifications_shim.sql
-- P2-COMPAT SHIM. P2 (async backbone) owns these tables authoritatively. We create
-- the minimal shape P9 depends on, guarded by `if not exists`, so P9 is testable in
-- isolation. When P2 lands it must keep AT LEAST these columns. Do not add P9-only
-- columns here; coordinate widening with P2.
do $$ begin
  if not exists (select 1 from pg_type where typname='job_status') then
    create type job_status as enum ('queued','running','done','failed');
  end if;
end $$;

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                       -- e.g. 'process_deletion_request'
  payload jsonb not null default '{}',
  status job_status not null default 'queued',
  run_after timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_due_idx on jobs (run_after) where status='queued';
do $$ begin
  if exists (select 1 from pg_proc where proname='set_updated_at') then
    create trigger set_jobs_updated_at before update on jobs
      for each row execute function set_updated_at();
  end if;
exception when duplicate_object then null; end $$;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications(user_id, created_at desc);

alter table jobs enable row level security;          -- service-role only; no policies = deny.
alter table notifications enable row level security;
do $$ begin
  create policy "notifications_owner_read" on notifications for select
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
```

- [ ] **Step 4: Apply + run test, expect PASS**

Run: `supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p9_jobs_shim.sql`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130100_p9_jobs_notifications_shim.sql supabase/tests/p9_jobs_shim.sql
git commit -m "P9: P2-compat shim for jobs + notifications (if not exists)"
```

---

## Task 2: `account_status` enum + lifecycle columns + sentinel profile + `account_closed` cancel reason

The single source of truth for which lifecycle state a user is in. Plus the `[deleted user]` sentinel that surviving accountability rows re-point to, and the new `cancel_reason` value the orphan teardown uses.

**Lifecycle semantics (load-bearing — referenced by every later task):**
- `active` — normal.
- `paused` — **user-initiated, fully reversible, identity intact.** Hidden from feeds, cannot create/receive offers, but PII + profile + in-flight non-locked interest *survive*. A paused user with an **active lock keeps that lock** (you don't strand a confirmed date by going invisible). Resume is one tap, no data loss.
- `suspended` — **platform-initiated (P7 enforcement ladder terminal rung), involuntary, identity retained for accountability.** Same feed/offer suppression as paused, *plus* in-flight non-locked interest is withdrawn and active locks are cancelled with reason `account_closed` (the other party is freed + safe-rolled). Reports/audit fully retained. Not user-reversible (appeal only).
- `deletion_pending` — user requested DELETE; a grace window is running (regret protection). Treated like `paused` for visibility, but a `deletion_requests` row is counting down.
- `deleted` — terminal. Worker has run: PII erased/anonymized, in-flight state released, profile either hard-deleted (no hold) or tombstoned (hold). The `account_status='deleted'` value only ever persists on a *tombstoned* (held) row.

**Files:**
- Create: `supabase/migrations/20260525130000_p9_account_status.sql`
- Test: `supabase/tests/p9_account_status.sql`

> **Migration-order note:** filename timestamp `130000` sorts *before* the `130100` shim. That is intentional — the shim's `notifications` FK targets `profiles`, which already exists from P0, so order between 130000 and 130100 is independent. Keep 130000 first so the sentinel exists before anything references it.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p9_account_status.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_type WHERE typname='account_status';
  IF NOT FOUND THEN RAISE EXCEPTION 'account_status enum missing'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='profiles' AND column_name='account_status';
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles.account_status missing'; END IF;
  -- sentinel deleted-user profile must exist at a fixed uuid
  PERFORM 1 FROM profiles WHERE id='00000000-0000-0000-0000-0000000de1e7';
  IF NOT FOUND THEN RAISE EXCEPTION 'deleted-user sentinel profile missing'; END IF;
  -- account_closed must be a valid cancel_reason value
  PERFORM 'account_closed'::cancel_reason;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`account_status enum missing` — or `type "cancel_reason" does not exist` if P5/P0 not applied; P0 defines `cancel_reason`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130000_p9_account_status.sql
create type account_status as enum
  ('active','paused','suspended','deletion_pending','deleted');

alter table profiles
  add column if not exists account_status account_status not null default 'active',
  add column if not exists status_changed_at timestamptz not null default now(),
  add column if not exists status_reason text,           -- free-text for suspend/appeal context
  add column if not exists deleted_at timestamptz,        -- set when worker tombstones/erases
  add column if not exists is_tombstone boolean not null default false;  -- true = held, anonymized in place

-- Add the orphan-teardown cancel reason to P0's enum (idempotent).
do $$ begin
  alter type cancel_reason add value if not exists 'account_closed';
exception when undefined_object then
  raise notice 'cancel_reason enum not present yet (P0/P5 pending); account_closed will be added when it lands';
end $$;

-- The sentinel "[deleted user]" profile. Surviving accountability rows (ratings authored
-- by a deleted user, message envelopes) re-point here instead of cascading away. Fixed uuid
-- so the worker and tests can reference it without a lookup.
insert into profiles (id, first_name, account_status, is_tombstone, dating_enabled)
values ('00000000-0000-0000-0000-0000000de1e7', '[deleted user]', 'deleted', true, false)
on conflict (id) do nothing;

create index if not exists profiles_account_status_idx on profiles(account_status)
  where account_status <> 'active';
```

> If `profiles.dating_enabled` is not yet present (P0 Task 2 not applied), drop it from the sentinel insert; it is not load-bearing for the sentinel. Keep `first_name` (P0 fixture column).

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130000_p9_account_status.sql supabase/tests/p9_account_status.sql
git commit -m "P9: account_status lifecycle enum + columns + deleted-user sentinel + account_closed reason"
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
DO $$
DECLARE u uuid;
BEGIN
  PERFORM 1 FROM pg_indexes
   WHERE tablename='deletion_requests'
     AND indexdef ILIKE '%unique%user_id%';
  IF NOT FOUND THEN RAISE EXCEPTION 'deletion_requests: missing one-open-per-user unique index'; END IF;

  insert into profiles (id, first_name) values (gen_random_uuid(),'dr') returning id into u;
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

A user who is the **subject of an open or actioned report**, or under an explicit moderation/legal hold, must have their accountability data **retained even through a deletion request**. This table records explicit holds (set by P8 moderation); the helper also derives an *implicit* hold from open/actioned `reports` where they are the target. The anonymization function (Task 8) consults this to decide hard-delete vs anonymize-in-place.

**Files:**
- Create: `supabase/migrations/20260525130300_p9_legal_hold.sql`
- Test: `supabase/tests/p9_legal_hold.sql`

- [ ] **Step 1: Write the failing test** (an open report about a user yields an implicit hold)

```sql
-- supabase/tests/p9_legal_hold.sql
DO $$
DECLARE u uuid; r uuid; held boolean;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(),'reported') returning id into u;
  insert into profiles (id, first_name) values (gen_random_uuid(),'reporter') returning id into r;

  -- no report yet → no hold
  SELECT has_active_legal_hold(u) INTO held;
  IF held THEN RAISE EXCEPTION 'unexpected hold with no report'; END IF;

  -- open report ABOUT u → implicit hold
  insert into reports (reporter_id, target_type, target_id, reason, status)
    values (r, 'user', u, 'harassment', 'open');
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
-- Explicit holds set by moderation (P8) or legal. retain_until null = indefinite.
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

-- A user has an active hold if: an explicit unreleased hold exists, OR an open/actioned
-- report names them as the target. Dismissed reports do NOT hold. SECURITY DEFINER so it
-- can read reports (which are admin-deny under RLS).
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

## Task 5: PAUSE / RESUME / SUSPEND functions + feed-suppression hook

The reversible, identity-intact states. These are SECURITY DEFINER so they can flip status and (for suspend) drive the orphan teardown, while RLS keeps direct writes locked. They also wire feed suppression: the P0 `browse_feed` view filters on `di.status='seeking'`, but a paused/suspended creator's *instances* must also drop out, so we extend the view's predicate to exclude non-active creators.

**Files:**
- Create: `supabase/migrations/20260525130400_p9_pause_suspend_fns.sql`
- Test: `supabase/tests/p9_pause_suspend.sql`

- [ ] **Step 1: Write the failing test** (pause hides feed, keeps locks; resume restores; suspend releases interest but the helper is invoked)

```sql
-- supabase/tests/p9_pause_suspend.sql
DO $$
DECLARE u uuid; cid uuid; inst uuid; cnt int;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(),'pauser') returning id into u;
  insert into cities (slug,name,timezone,is_active) values ('p9a','p9a','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='p9a';
  insert into itineraries (id,user_id) values (gen_random_uuid(),u);
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at)
    select i.id,u,cid,now()+interval '5 days' from itineraries i where i.user_id=u limit 1
    returning id into inst;

  -- instance is in the feed while active
  select count(*) into cnt from browse_feed where date_instance_id=inst;
  IF cnt <> 1 THEN RAISE EXCEPTION 'active creator instance not in feed (got %)', cnt; END IF;

  -- pause hides it
  PERFORM pause_account(u);
  PERFORM 1 FROM profiles WHERE id=u AND account_status='paused';
  IF NOT FOUND THEN RAISE EXCEPTION 'pause_account did not set status'; END IF;
  select count(*) into cnt from browse_feed where date_instance_id=inst;
  IF cnt <> 0 THEN RAISE EXCEPTION 'paused creator instance still in feed (got %)', cnt; END IF;

  -- resume restores it
  PERFORM resume_account(u);
  PERFORM 1 FROM profiles WHERE id=u AND account_status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'resume_account did not restore status'; END IF;
  select count(*) into cnt from browse_feed where date_instance_id=inst;
  IF cnt <> 1 THEN RAISE EXCEPTION 'resumed creator instance not back in feed (got %)', cnt; END IF;

  -- suspend sets status and stamps reason
  PERFORM suspend_account(u, 'enforcement: repeated no-shows');
  PERFORM 1 FROM profiles WHERE id=u AND account_status='suspended'
                            AND status_reason='enforcement: repeated no-shows';
  IF NOT FOUND THEN RAISE EXCEPTION 'suspend_account did not set status/reason'; END IF;

  RAISE NOTICE 'pause/resume/suspend OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function pause_account(uuid) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130400_p9_pause_suspend_fns.sql

-- Extend the blind feed to also exclude instances from non-active creators.
-- (Rebuilds P0's browse_feed with the same columns + a creator-status guard.)
create or replace view browse_feed
with (security_invoker = true) as
select
  di.id            as date_instance_id,
  di.city_id,
  date_trunc('hour', di.starts_at) as time_window_start,
  di.status,
  i.id             as itinerary_id,
  i.pay_setting,
  i.vibe_tags,
  i.why_note,
  i.ambient_sound_url,
  p.neighborhood   as venue_neighborhood
from date_instances di
join itineraries i on i.id = di.itinerary_id
join profiles    cr on cr.id = di.creator_id
left join places p on p.id = di.venue_id
where di.status = 'seeking'
  and cr.account_status = 'active';     -- paused/suspended/deletion_pending/deleted drop out
grant select on browse_feed to anon, authenticated;

-- PAUSE: user-initiated, reversible. Hides from feed, keeps PII + active locks.
create or replace function pause_account(p_user uuid default auth.uid())
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_user is distinct from auth.uid()
     and auth.uid() is not null then
    raise exception 'pause_account: may only pause your own account';
  end if;
  update profiles
     set account_status='paused', status_changed_at=now()
   where id=p_user and account_status in ('active','deletion_pending');
end $fn$;

-- RESUME: only from paused (NOT from suspended — that's appeal-only, NOT from deleted).
create or replace function resume_account(p_user uuid default auth.uid())
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_user is distinct from auth.uid() and auth.uid() is not null then
    raise exception 'resume_account: may only resume your own account';
  end if;
  update profiles
     set account_status='active', status_changed_at=now()
   where id=p_user and account_status='paused';
  if not found then
    raise exception 'resume_account: account is not paused (suspended/deleted are not user-reversible)';
  end if;
end $fn$;

-- SUSPEND: platform-initiated (P7 ladder). Releases non-locked in-flight interest +
-- cancels active locks (frees + safe-rolls the other party). Retains all accountability data.
-- Service-role/admin only: no auth.uid() self-suspend path.
create or replace function suspend_account(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  update profiles
     set account_status='suspended', status_changed_at=now(), status_reason=p_reason
   where id=p_user and account_status <> 'deleted';
  perform _p9_release_in_flight_state(p_user, false);  -- false = not a full deletion; defined Task 7
end $fn$;

revoke all on function suspend_account(uuid,text) from public, anon, authenticated;
-- pause/resume are owner-callable; grant to authenticated.
grant execute on function pause_account(uuid) to authenticated;
grant execute on function resume_account(uuid) to authenticated;
```

> **Ordering dependency:** `suspend_account` calls `_p9_release_in_flight_state` (Task 7). Postgres resolves function bodies at *call* time, not creation time, so this migration applies cleanly even though Task 7's migration sorts later — but the **test for Task 5's suspend path that invokes the helper must run after Task 7 is applied.** The Task 5 test above only checks status/reason (no in-flight rows), so it passes standalone; the full suspend-with-orphans path is covered in Task 7's test.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `pause/resume/suspend OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130400_p9_pause_suspend_fns.sql supabase/tests/p9_pause_suspend.sql
git commit -m "P9: pause/resume/suspend fns + feed suppression for non-active creators"
```

---

## Task 6: `request_account_deletion()` + `cancel_deletion_request()` (regret protection)

DELETE is a *request* with a grace window, not an immediate teardown. This is the audit's "soft-delete regret" fix: the account flips to `deletion_pending` (invisible like paused) and a `deletion_requests` row counts down; the worker only acts after `process_after`. Cancelling restores the account to `active`. A job is enqueued so the worker is woken at the right time.

**Files:**
- Create: `supabase/migrations/20260525130500_p9_request_deletion_fn.sql`
- Test: `supabase/tests/p9_request_deletion.sql`

- [ ] **Step 1: Write the failing test** (request → pending + row + job; cancel → active + cancelled)

```sql
-- supabase/tests/p9_request_deletion.sql
DO $$
DECLARE u uuid; njobs int; rstatus deletion_request_status;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(),'leaver') returning id into u;

  PERFORM request_account_deletion(u, 14, 'moving on');
  PERFORM 1 FROM profiles WHERE id=u AND account_status='deletion_pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'request did not set deletion_pending'; END IF;
  PERFORM 1 FROM deletion_requests WHERE user_id=u AND status='grace_period'
                                     AND process_after > now()+interval '13 days';
  IF NOT FOUND THEN RAISE EXCEPTION 'deletion_requests grace row missing/short window'; END IF;
  select count(*) into njobs from jobs where kind='process_deletion_request'
    and (payload->>'user_id')::uuid = u;
  IF njobs < 1 THEN RAISE EXCEPTION 'no process_deletion_request job enqueued'; END IF;

  -- a duplicate request must be rejected (one open per user)
  BEGIN
    PERFORM request_account_deletion(u, 14, 'again');
    RAISE EXCEPTION 'INVARIANT FAILED: duplicate deletion request allowed';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- cancel restores active + marks request cancelled
  PERFORM cancel_deletion_request(u);
  PERFORM 1 FROM profiles WHERE id=u AND account_status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'cancel did not restore active'; END IF;
  select status into rstatus from deletion_requests where user_id=u order by requested_at desc limit 1;
  IF rstatus <> 'cancelled' THEN RAISE EXCEPTION 'request not marked cancelled (%)', rstatus; END IF;

  RAISE NOTICE 'request/cancel deletion OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function request_account_deletion(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130500_p9_request_deletion_fn.sql

-- Request deletion: flip to deletion_pending, open a grace-window request, enqueue the worker.
-- p_grace_days defaults to 30 (regret protection); allow shorter for testing/legal-mandated.
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
  if exists (select 1 from profiles where id=p_user and account_status='deleted') then
    raise exception 'request_account_deletion: account already deleted';
  end if;

  v_after := now() + make_interval(days => greatest(0, p_grace_days));

  insert into deletion_requests (user_id, process_after, reason)
    values (p_user, v_after, p_reason)
    returning id into v_req;   -- raises unique_violation if an open request exists

  update profiles set account_status='deletion_pending', status_changed_at=now()
    where id=p_user;

  -- enqueue the worker to run at/after the grace window. P2's runner picks it up.
  insert into jobs (kind, payload, run_after)
    values ('process_deletion_request',
            jsonb_build_object('user_id', p_user, 'deletion_request_id', v_req),
            v_after);

  return v_req;
end $fn$;

-- Cancel during the grace window: restore active, mark request cancelled, drop pending job.
create or replace function cancel_deletion_request(p_user uuid default auth.uid())
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_user is distinct from auth.uid() and auth.uid() is not null then
    raise exception 'cancel_deletion_request: may only cancel your own request';
  end if;
  update deletion_requests set status='cancelled'
    where user_id=p_user and status='grace_period';
  if not found then
    raise exception 'cancel_deletion_request: no open request to cancel';
  end if;
  update profiles set account_status='active', status_changed_at=now()
    where id=p_user and account_status='deletion_pending';
  -- best-effort: drop the not-yet-run job so the worker doesn't wake for a cancelled request
  delete from jobs where kind='process_deletion_request' and status='queued'
    and (payload->>'user_id')::uuid = p_user;
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

## Task 7: `_p9_release_in_flight_state()` — orphan teardown driving the P5 state machine

The heart of the orphan fix (audit: "account deletion mid-flow → orphaned locks"). When a user leaves mid-flow, every piece of in-flight state must resolve *safely* and the **other party must be freed and safe-rolled** — never left staring at a lock to a ghost. This function **drives the P5 transition functions** so the loop's invariants/auto-roll stay authoritative; it does not hand-edit `offers`/`locks`/`queue_entries`.

**Effects, per artifact (from P0 schema):**
- **Active `locks` where the user is `creator_id` or `matched_user_id`** → call P5 `cancel_lock(lock_id, 'account_closed', p_user)`. P5's cancel frees the other party and, on a *benign* reason, may auto-roll to standby; `account_closed` is treated benign for the *night* (the creator-owned date can re-offer to standby) but the *departing user* is removed from all queues, so they cannot be re-rolled to.
- **Active `offers` to/from the user** → `expire_offer(offer_id, 'account_closed')` so the offer slot frees and standby can advance.
- **`queue_entries` for the user (interested/shortlisted/standby)** → `withdraw_from_queue(entry_id, 'account_closed')` (one-tap withdrawal semantics from spec §7.2).
- **Owed ratings** → any `locks` that completed but the departing user never rated: the rating window is *closed* for them (no orphaned "please rate" prompt to a deleted user); the counterpart's existing/forthcoming rating is unaffected.
- **`swipes`** → left in place during *suspend* (they only matter for the creator's own queue, which is being torn down anyway); fully removed by hard-delete in Task 8 (cascade) or anonymized under hold.

**Files:**
- Create: `supabase/migrations/20260525130600_p9_orphan_teardown_fn.sql`
- Test: `supabase/tests/p9_orphan_teardown.sql`

- [ ] **Step 1: Write the failing test** (a user with an active lock leaves → lock cancelled with `account_closed`, counterpart freed)

```sql
-- supabase/tests/p9_orphan_teardown.sql
-- NOTE: this test defines THIN STAND-IN P5 functions if P5 has not landed, so the
-- orchestration is provable in isolation. When P5 lands, its real functions exist and
-- these `create or replace` shims must NOT be shipped — they live only in this test file.
DO $$
BEGIN
  -- stand-ins (idempotent; real P5 supersedes). Match P5 signatures EXACTLY.
  if not exists (select 1 from pg_proc where proname='cancel_lock') then
    execute $f$
      create function cancel_lock(p_lock_id uuid, p_reason cancel_reason, p_actor uuid)
      returns void language plpgsql as $b$
      begin
        update locks set status='cancelled', cancelled_by=p_actor, cancel_reason=p_reason
         where id=p_lock_id and status='active';
      end $b$;
    $f$;
  end if;
  if not exists (select 1 from pg_proc where proname='withdraw_from_queue') then
    execute $f$
      create function withdraw_from_queue(p_entry uuid, p_reason cancel_reason)
      returns void language plpgsql as $b$
      begin delete from queue_entries where id=p_entry; end $b$;
    $f$;
  end if;
  if not exists (select 1 from pg_proc where proname='expire_offer') then
    execute $f$
      create function expire_offer(p_offer uuid, p_reason cancel_reason)
      returns void language plpgsql as $b$
      begin update offers set status='expired', resolved_at=now() where id=p_offer and status='active'; end $b$;
    $f$;
  end if;
END $$;

DO $$
DECLARE cre uuid; leaver uuid; cid uuid; inst uuid; lk uuid; lstatus lock_status; lreason cancel_reason;
BEGIN
  insert into profiles (id,first_name) values (gen_random_uuid(),'creator') returning id into cre;
  insert into profiles (id,first_name) values (gen_random_uuid(),'leaver') returning id into leaver;
  insert into cities (slug,name,timezone,is_active) values ('p9b','p9b','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='p9b';
  insert into itineraries (id,user_id) values (gen_random_uuid(),cre);
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at)
    select i.id,cre,cid,now()+interval '4 days' from itineraries i where i.user_id=cre limit 1
    returning id into inst;
  -- leaver holds an active lock as the matched user
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, leaver, 'active') returning id into lk;

  -- leaver departs (suspend path; p_full_delete=false)
  PERFORM _p9_release_in_flight_state(leaver, false);

  select status, cancel_reason into lstatus, lreason from locks where id=lk;
  IF lstatus <> 'cancelled' THEN RAISE EXCEPTION 'orphaned lock not cancelled (status=%)', lstatus; END IF;
  IF lreason <> 'account_closed' THEN RAISE EXCEPTION 'lock not cancelled with account_closed (%)', lreason; END IF;

  RAISE NOTICE 'orphan teardown OK (lock freed, counterpart % no longer bound)', cre;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function _p9_release_in_flight_state(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130600_p9_orphan_teardown_fn.sql
-- Drive the P5 state machine to release every in-flight artifact for a departing user.
-- p_full_delete distinguishes deletion (true) from suspension (false) only for downstream
-- callers; the in-flight release is identical for both — the safe-roll/free-counterpart
-- behavior must happen in BOTH cases (a suspended user must not strand a date either).
create or replace function _p9_release_in_flight_state(p_user uuid, p_full_delete boolean default false)
returns void language plpgsql security definer set search_path = public as $fn$
declare r record;
begin
  -- 1) Active offers involving the user (as candidate or creator) → expire, freeing the slot.
  for r in
    select id from offers
     where status='active' and (candidate_id=p_user or creator_id=p_user)
  loop
    perform expire_offer(r.id, 'account_closed');
  end loop;

  -- 2) Active locks involving the user → cancel(account_closed): P5 frees the counterpart
  --    and (benign reason) may auto-roll the night to standby. Actor = the departing user.
  for r in
    select id from locks
     where status='active' and (creator_id=p_user or matched_user_id=p_user)
  loop
    perform cancel_lock(r.id, 'account_closed', p_user);
  end loop;

  -- 3) Any non-terminal queue interest by the user → withdraw (so they can't be re-rolled to).
  for r in
    select id from queue_entries
     where candidate_id=p_user
       and status in ('interested','shortlisted','offer_active','standby')
  loop
    perform withdraw_from_queue(r.id, 'account_closed');
  end loop;

  -- 4) Owed ratings: close the rating window for the departing user. We DON'T fabricate a
  --    rating; we just ensure no orphaned "please rate" prompt. Mark by inserting a sentinel
  --    skipped rating (all-null outcomes) for completed locks they never rated, so P7's
  --    "rating window open" query no longer selects them.
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

  -- An explicit audit marker for the teardown (the per-table triggers in P0 capture the
  -- individual status changes; this one records the lifecycle event itself).
  insert into audit_log (entity, entity_id, action, new_status, actor)
  values ('profiles', p_user, 'in_flight_released',
          case when p_full_delete then 'deletion' else 'suspension' end, p_user);
end $fn$;

revoke all on function _p9_release_in_flight_state(uuid,boolean) from public, anon, authenticated;
```

> **P5 coupling check (do at execution time):** confirm the real P5 `cancel_lock` treats `account_closed` as a *benign* reason for the NIGHT (so the creator's date can re-offer to standby) but that the **departing user is removed from all standby queues first** (step 3 runs effects in order: offers → locks → queues; reorder to queues-first if P5's `cancel_lock` auto-rolls synchronously and could re-add the departing user). If P5 freezes auto-roll once a safety report is filed (spec §7.6), `account_closed` from a *suspended-for-safety* user must inherit that freeze — verify P5 honors the per-date safety freeze independent of the cancel reason.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `orphan teardown OK ...`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130600_p9_orphan_teardown_fn.sql supabase/tests/p9_orphan_teardown.sql
git commit -m "P9: orphan teardown drives P5 transitions (cancel/expire/withdraw) on account close"
```

---

## Task 8: Anonymize (retention-aware) vs hard-delete

The "deletion ≠ blind cascade" core. After in-flight state is released, the worker must erase identity. But what it's *allowed* to erase depends on `has_active_legal_hold()`:
- **No hold** → safe to fully remove. First **re-point** the accountability rows that must outlive the person (ratings *authored by* them → `rater_id` = sentinel; message envelopes → sender = sentinel; `reports.target_id` is a free uuid so report rows about them already survive). *Then* hard-delete the `profiles` row; P0 cascades clear `swipes`, `queue_entries`, terminal `offers`/`locks`, `verifications`, `profiles_private`.
- **Hold present** → **never** delete the `profiles` row (cascade would erase report-linked context). Instead **anonymize in place**: scrub `profiles_private` PII, blank profile content fields, set `account_status='deleted'`, `is_tombstone=true`, `deleted_at=now()`. The retained `reports`/`audit_log`/anonymized rating outcomes stay attached to a real (now identity-less) `profiles.id`.

**Files:**
- Create: `supabase/migrations/20260525130700_p9_anonymize_fn.sql`
- Test: `supabase/tests/p9_anonymize.sql`

- [ ] **Step 1: Write the failing test** (held user → tombstoned + PII gone + report survives; unheld user → row gone + report still survives via free target_id)

```sql
-- supabase/tests/p9_anonymize.sql
DO $$
DECLARE held uuid; unheld uuid; reporter uuid; pii_rows int; prof_rows int; rep_rows int;
BEGIN
  insert into profiles (id,first_name) values (gen_random_uuid(),'held') returning id into held;
  insert into profiles (id,first_name) values (gen_random_uuid(),'unheld') returning id into unheld;
  insert into profiles (id,first_name) values (gen_random_uuid(),'reporter') returning id into reporter;
  insert into profiles_private (user_id, full_name, phone) values (held,'Held Person','+15550001');
  insert into profiles_private (user_id, full_name, phone) values (unheld,'Unheld Person','+15550002');

  -- a report ABOUT each user (target_id is a free uuid in P0 → survives deletion)
  insert into reports (reporter_id, target_type, target_id, reason, status)
    values (reporter,'user',held,'harassment','actioned');     -- actioned → hold
  insert into reports (reporter_id, target_type, target_id, reason, status)
    values (reporter,'user',unheld,'spam','dismissed');        -- dismissed → no hold

  -- HELD path: anonymize-in-place
  PERFORM _p9_anonymize_user(held);
  PERFORM 1 FROM profiles WHERE id=held AND account_status='deleted' AND is_tombstone=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'held user not tombstoned'; END IF;
  select count(*) into pii_rows from profiles_private where user_id=held
    and (full_name is not null or phone is not null);
  IF pii_rows <> 0 THEN RAISE EXCEPTION 'held user PII not scrubbed'; END IF;
  select count(*) into rep_rows from reports where target_id=held;
  IF rep_rows <> 1 THEN RAISE EXCEPTION 'report about held user lost (%)', rep_rows; END IF;

  -- UNHELD path: hard delete
  PERFORM _p9_hard_delete_user(unheld);
  select count(*) into prof_rows from profiles where id=unheld;
  IF prof_rows <> 0 THEN RAISE EXCEPTION 'unheld user profile not deleted'; END IF;
  select count(*) into pii_rows from profiles_private where user_id=unheld;
  IF pii_rows <> 0 THEN RAISE EXCEPTION 'unheld user PII not cascaded away'; END IF;
  -- report about them STILL survives (target_id has no FK by P0 design)
  select count(*) into rep_rows from reports where target_id=unheld;
  IF rep_rows <> 1 THEN RAISE EXCEPTION 'report about unheld user lost (%)', rep_rows; END IF;

  RAISE NOTICE 'anonymize vs hard-delete OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function _p9_anonymize_user(uuid) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130700_p9_anonymize_fn.sql
-- Sentinel uuid (must match Task 2).
-- '00000000-0000-0000-0000-0000000de1e7'

-- Anonymize in place: used when a legal hold exists. NEVER deletes the profiles row.
create or replace function _p9_anonymize_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  -- 1) scrub PII (owner-only table; this fn is definer so it can write)
  update profiles_private
     set full_name=null, phone=null, birthdate=null, bio=null,
         instagram_handle=null, emergency_contact=null
   where user_id=p_user;

  -- 2) blank identity-bearing profile content but keep the row + reliability_score
  --    (the score describes their conduct and feeds the safety picture).
  update profiles
     set first_name='[deleted user]',
         blurred_photo_url=null, clear_photo_url=null,
         vibe_tags='{}', gender=null, gender_preferences='{}',
         account_status='deleted', is_tombstone=true, deleted_at=now(),
         dating_enabled=false
   where id=p_user;

  -- 3) re-point ratings AUTHORED by the user to the sentinel (keep the outcome about the ratee)
  update match_ratings set rater_id='00000000-0000-0000-0000-0000000de1e7'
   where rater_id=p_user;

  insert into audit_log (entity, entity_id, action, new_status, actor)
  values ('profiles', p_user, 'anonymized', 'deleted', auth.uid());
end $fn$;

-- Hard delete: used ONLY when has_active_legal_hold() is false. Re-points the rows that
-- must outlive the person, THEN deletes the profile (P0 cascades clear the rest).
create or replace function _p9_hard_delete_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if has_active_legal_hold(p_user) then
    raise exception '_p9_hard_delete_user: user % is under legal hold; use _p9_anonymize_user', p_user;
  end if;

  -- preserve accountability authored by the user before cascade wipes them:
  update match_ratings set rater_id='00000000-0000-0000-0000-0000000de1e7'
   where rater_id=p_user;
  -- (reports.reporter_id is on-delete-set-null per P0, so those self-heal; reports.target_id
  --  has no FK so reports ABOUT the user survive automatically.)

  -- audit BEFORE the delete (the row's about-to-vanish).
  insert into audit_log (entity, entity_id, action, old_status, new_status, actor)
  values ('profiles', p_user, 'hard_deleted', 'deletion_pending', 'deleted', auth.uid());

  delete from profiles where id=p_user;   -- cascades: profiles_private, swipes, queue_entries,
                                           -- offers, locks, lock_participants, verifications, blocks.
end $fn$;

revoke all on function _p9_anonymize_user(uuid)   from public, anon, authenticated;
revoke all on function _p9_hard_delete_user(uuid) from public, anon, authenticated;
```

> **Cascade-loss caveat to verify at execution:** `match_ratings.lock_id` and `locks` cascade from `profiles`. For an *unheld* hard-delete, ratings *about other people* that were authored by this user are re-pointed (step above) and survive; but ratings on locks where this user is a *participant* will cascade away with the lock. That is acceptable for an unheld (no safety concern) user. For a *held* user we never delete, so nothing cascades. Confirm this matches P0's exact `on delete` on `match_ratings.lock_id → locks(id)` (P0 Task 9: `on delete cascade`) and `locks.*_id → profiles(id)` (P0 Task 8: `on delete cascade`).

- [ ] **Step 4: Apply + run test, expect PASS** (prints `anonymize vs hard-delete OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130700_p9_anonymize_fn.sql supabase/tests/p9_anonymize.sql
git commit -m "P9: retention-aware anonymize-in-place vs hard-delete (deletion != blind cascade)"
```

---

## Task 9: The deletion worker (Edge Function) + orchestration/idempotency tests

The worker the roadmap requires, coordinated with P2 jobs. It claims due `process_deletion_request` work, runs the teardown in the correct order, and is **idempotent** (safe to re-run after a crash). It calls a single SECURITY DEFINER orchestrator RPC `_p9_process_deletion(request_id)` so the DB does the transactional work atomically; the Deno layer only claims/marks/loops.

**Worker order (atomic in `_p9_process_deletion`):** verify grace window elapsed → `_p9_release_in_flight_state(user, true)` → branch on `has_active_legal_hold`: hold → `_p9_anonymize_user` + set `legal_hold_blocked=true`; no hold → `_p9_hard_delete_user` → mark `deletion_requests.status='completed'`, `processed_at=now()`, emit a `notifications` row? (No — the user is gone; instead emit an audit row, already done in Tasks 7/8.)

**Files:**
- Create: `supabase/migrations/20260525130600_p9_orphan_teardown_fn.sql` already exists; add the orchestrator in a new migration `20260525130650_p9_process_deletion_fn.sql`.
- Create: `supabase/functions/process-deletion-requests/index.ts`
- Create: `supabase/functions/process-deletion-requests/index_test.ts`
- Test (DB orchestrator): `supabase/tests/p9_process_deletion.sql`

- [ ] **Step 1a: Write the failing DB test for the orchestrator**

```sql
-- supabase/tests/p9_process_deletion.sql
-- Requires the P5 stand-ins from p9_orphan_teardown.sql when P5 absent; re-declare here too.
DO $$
BEGIN
  if not exists (select 1 from pg_proc where proname='cancel_lock') then
    execute 'create function cancel_lock(p_lock_id uuid, p_reason cancel_reason, p_actor uuid) returns void language plpgsql as $b$ begin update locks set status=''cancelled'', cancelled_by=p_actor, cancel_reason=p_reason where id=p_lock_id and status=''active''; end $b$;';
  end if;
  if not exists (select 1 from pg_proc where proname='expire_offer') then
    execute 'create function expire_offer(p_offer uuid, p_reason cancel_reason) returns void language plpgsql as $b$ begin update offers set status=''expired'', resolved_at=now() where id=p_offer and status=''active''; end $b$;';
  end if;
  if not exists (select 1 from pg_proc where proname='withdraw_from_queue') then
    execute 'create function withdraw_from_queue(p_entry uuid, p_reason cancel_reason) returns void language plpgsql as $b$ begin delete from queue_entries where id=p_entry; end $b$;';
  end if;
END $$;

DO $$
DECLARE u uuid; req uuid; nprof int; rstatus deletion_request_status;
BEGIN
  -- unheld user, grace already elapsed
  insert into profiles (id,first_name,account_status) values (gen_random_uuid(),'gone','deletion_pending') returning id into u;
  insert into profiles_private (user_id, full_name) values (u,'Gone Person');
  insert into deletion_requests (user_id, process_after, status)
    values (u, now()-interval '1 day', 'grace_period') returning id into req;

  PERFORM _p9_process_deletion(req);

  select count(*) into nprof from profiles where id=u;
  IF nprof <> 0 THEN RAISE EXCEPTION 'unheld user not hard-deleted by worker'; END IF;
  select status into rstatus from deletion_requests where id=req;
  IF rstatus <> 'completed' THEN RAISE EXCEPTION 'request not marked completed (%)', rstatus; END IF;

  -- idempotency: re-running a completed request is a no-op, not an error
  PERFORM _p9_process_deletion(req);
  RAISE NOTICE 'process_deletion (hard-delete + idempotent) OK';
  ROLLBACK;
END $$;

-- held user → anonymize, request flagged legal_hold_blocked, NOT before grace
DO $$
DECLARE u uuid; req uuid; reporter uuid; blocked boolean;
BEGIN
  insert into profiles (id,first_name,account_status) values (gen_random_uuid(),'heldgone','deletion_pending') returning id into u;
  insert into profiles (id,first_name) values (gen_random_uuid(),'rep') returning id into reporter;
  insert into reports (reporter_id,target_type,target_id,reason,status) values (reporter,'user',u,'harassment','open');
  insert into deletion_requests (user_id, process_after, status)
    values (u, now()-interval '1 day','grace_period') returning id into req;

  PERFORM _p9_process_deletion(req);
  PERFORM 1 FROM profiles WHERE id=u AND is_tombstone=true AND account_status='deleted';
  IF NOT FOUND THEN RAISE EXCEPTION 'held user not anonymized-in-place'; END IF;
  select legal_hold_blocked into blocked from deletion_requests where id=req;
  IF NOT blocked THEN RAISE EXCEPTION 'request not flagged legal_hold_blocked'; END IF;

  -- grace not elapsed → must refuse
  PERFORM 1;  -- (separate scenario below)
  RAISE NOTICE 'process_deletion (held → anonymize) OK';
  ROLLBACK;
END $$;

-- grace NOT elapsed → orchestrator refuses
DO $$
DECLARE u uuid; req uuid; ok boolean := false;
BEGIN
  insert into profiles (id,first_name,account_status) values (gen_random_uuid(),'tooearly','deletion_pending') returning id into u;
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
-- request is a no-op; only 'grace_period'/'processing' requests proceed.
create or replace function _p9_process_deletion(p_request uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare r deletion_requests%rowtype; v_hold boolean;
begin
  select * into r from deletion_requests where id=p_request for update;
  if not found then raise exception '_p9_process_deletion: request % not found', p_request; end if;

  if r.status in ('completed','cancelled') then
    return;  -- idempotent no-op
  end if;
  if r.process_after > now() then
    raise exception '_p9_process_deletion: grace window not elapsed (process_after=%)', r.process_after;
  end if;

  update deletion_requests set status='processing', attempts=attempts+1 where id=p_request;

  -- 1) release all in-flight state (drives P5 transitions; frees counterparties)
  perform _p9_release_in_flight_state(r.user_id, true);

  -- 2) erase identity, retention-aware
  v_hold := has_active_legal_hold(r.user_id);
  if v_hold then
    perform _p9_anonymize_user(r.user_id);
    update deletion_requests set legal_hold_blocked=true where id=p_request;
  else
    perform _p9_hard_delete_user(r.user_id);
  end if;

  update deletion_requests set status='completed', processed_at=now() where id=p_request;
end $fn$;

revoke all on function _p9_process_deletion(uuid) from public, anon, authenticated;
```

- [ ] **Step 3: Run the DB test, expect PASS** (prints the three `... OK` notices).

- [ ] **Step 4: Write the worker Edge Function**

```ts
// supabase/functions/process-deletion-requests/index.ts
// Deletion-request worker. Claims due process_deletion_request jobs (P2 layer) OR scans
// deletion_requests directly, calls the transactional orchestrator _p9_process_deletion,
// and is safe to re-run (the orchestrator is idempotent).
//
// Auth: service-role bearer required (admin-only). verify_jwt OFF on deploy.
// Invoke (P2 runner or cron):
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
    const { error: rpcErr } = await supabase.rpc('_p9_process_deletion', { p_request: req.id });
    if (rpcErr) {
      failed++;
      errors.push({ id: req.id, error: rpcErr.message });
      await supabase.from('deletion_requests')
        .update({ worker_error: rpcErr.message })
        .eq('id', req.id);
    } else {
      processed++;
    }
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

// Minimal mock of the supabase client surface processDueRequests touches.
function mockClient(opts: {
  due: Array<{ id: string; user_id: string }>;
  rpcFails?: Set<string>;
}) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const rpcCalls: string[] = [];
  // deno-lint-ignore no-explicit-any
  const client: any = {
    from(_t: string) {
      return {
        select() { return this; },
        eq() { return this; },
        lte() { return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data: opts.due, error: null }); },
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
  };
  return { client, updates, rpcCalls };
}

Deno.test('processes every due request via the orchestrator RPC', async () => {
  const { client, rpcCalls } = mockClient({
    due: [{ id: 'r1', user_id: 'u1' }, { id: 'r2', user_id: 'u2' }],
  });
  const res = await processDueRequests(client, 25);
  assertEquals(res.processed, 2);
  assertEquals(res.failed, 0);
  assertEquals(rpcCalls, ['r1', 'r2']);
});

Deno.test('records worker_error and counts failure without aborting the batch', async () => {
  const { client, updates } = mockClient({
    due: [{ id: 'r1', user_id: 'u1' }, { id: 'r2', user_id: 'u2' }],
    rpcFails: new Set(['r1']),
  });
  const res = await processDueRequests(client, 25);
  assertEquals(res.processed, 1);
  assertEquals(res.failed, 1);
  assertEquals(updates.some((u) => u.id === 'r1' && u.patch.worker_error === 'boom'), true);
});

Deno.test('no due requests → zero processed, no rpc calls', async () => {
  const { client, rpcCalls } = mockClient({ due: [] });
  const res = await processDueRequests(client, 25);
  assertEquals(res.processed, 0);
  assertEquals(rpcCalls.length, 0);
});
```

- [ ] **Step 6: Run the Deno tests, expect PASS**

Run: `deno test --allow-net supabase/functions/process-deletion-requests/index_test.ts`
Expected: 3 passed.

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
DO $$
DECLARE u uuid; other uuid; cid uuid; inst uuid; doc jsonb;
BEGIN
  insert into profiles (id,first_name) values (gen_random_uuid(),'exporter') returning id into u;
  insert into profiles (id,first_name) values (gen_random_uuid(),'other') returning id into other;
  insert into profiles_private (user_id, full_name, phone) values (u,'Export Me','+15559999');
  insert into cities (slug,name,timezone,is_active) values ('p9e','p9e','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='p9e';
  insert into itineraries (id,user_id) values (gen_random_uuid(),other);
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at)
    select i.id,other,cid,now()+interval '2 days' from itineraries i where i.user_id=other limit 1
    returning id into inst;
  insert into swipes (swiper_id,date_instance_id,creator_id,direction)
    values (u, inst, other, 'right');

  doc := build_data_export(u);

  IF doc->'profile'->>'first_name' <> 'exporter'
     THEN RAISE EXCEPTION 'export missing profile'; END IF;
  IF doc->'profile_private'->>'phone' <> '+15559999'
     THEN RAISE EXCEPTION 'export missing private PII'; END IF;
  IF jsonb_array_length(coalesce(doc->'swipes','[]'::jsonb)) <> 1
     THEN RAISE EXCEPTION 'export missing the user swipe'; END IF;
  -- must NOT leak the other user's identity
  IF doc::text ILIKE '%"other"%'
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
                  'target_type', r.target_type, 'reason', r.reason, 'status', r.status, 'at', r.created_at)),'[]')
                from reports r where r.reporter_id=p_user),
    'blocks', (select coalesce(jsonb_agg(jsonb_build_object('at', b.created_at)),'[]')
                from blocks b where b.blocker_id=p_user)
  ) into doc;

  insert into data_exports (user_id, document) values (p_user, doc);
  return doc;
end $fn$;

grant execute on function build_data_export(uuid) to authenticated;
```

> **Note on `to_jsonb(p) - 'id'`:** the test inserts `first_name='exporter'` into `profiles`, and the export keeps `first_name`. The "must not leak other" check passes because `creator_id`/counterparty *names* are never joined in — only ids the user already knows. If P0 added a column whose name literally contains `other` test fixtures, adjust the fixture name; the load-bearing assertion is identity non-leakage of *joined* rows.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `data export OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130800_p9_export_fn.sql supabase/tests/p9_export.sql
git commit -m "P9: GDPR/CCPA data export (build_data_export + data_exports, owner-only, self-only)"
```

---

## Task 11: Full reset verification + regenerate types

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)

- [ ] **Step 1: Full reset** — `supabase db reset` (applies every P0 + P9 migration in order; expect no error).

- [ ] **Step 2: Run all P9 tests**

```bash
for f in supabase/tests/p9_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expected: every file exits 0; notices print `… OK`.

- [ ] **Step 3: Run the worker Deno tests** — `deno test --allow-net supabase/functions/process-deletion-requests/index_test.ts` (expect 3 passed).

- [ ] **Step 4: Regenerate TypeScript types** — `pnpm db:types`
Expected: `packages/types/src/database.ts` gains `deletion_requests`, `legal_holds`, `data_exports`, `jobs`, `notifications`, the `account_status`/`deletion_request_status`/`job_status` enums, and the new `account_closed` `cancel_reason` value.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P9: regenerate database types for account lifecycle + compliance schema"
```

---

## Self-Review

**Spec/roadmap coverage (vs P9 'Closes'):**
- "account deletion mid-flow → orphaned locks" → Task 7 `_p9_release_in_flight_state` drives P5 `cancel_lock(account_closed)` / `expire_offer` / `withdraw_from_queue`, freeing + safe-rolling the counterparty; tested with an active lock held by the leaver (Task 7 test) and within the worker (Task 9). ✅
- "GDPR/CCPA" → Task 10 `build_data_export` (right of access) + Tasks 6–9 (right of erasure: request → grace → worker → erase). ✅
- "soft-delete regret" → Task 6 grace window (`deletion_pending` + `cancel_deletion_request` restores `active`), worker only acts after `process_after` (Task 9 grace-guard test). ✅
- "retain banned user's report history + audit_log even after deletion" → Task 4 `has_active_legal_hold` (explicit + implicit-from-open-report) + Task 8 anonymize-in-place never deletes the held `profiles` row; reports about a user survive by P0's free-uuid `target_id` even on hard-delete (Task 8 test asserts both). ✅
- "deletion_requests table + worker, coordinate with P2 jobs" → Task 3 table + Task 9 worker enqueued via Task 1 `jobs` shim (P2-compat, `if not exists`). ✅
- "anonymization + retention/legal-hold" → Task 8 two-path erasure. ✅
- "orphan-handling for offers/locks/queue/chat/ratings" → Task 7 (offers/locks/queue/owed-ratings); chat envelopes/sender re-point noted as P6-owned (sentinel re-point in Task 8 covers ratings; message-body redaction is flagged for P6 coordination since P6 owns `chats`/`messages`). ✅

**Delete vs Suspend vs Pause — decision recorded (Task 2):**
- PAUSE: user-initiated, reversible, **identity + active locks retained**, only feed/offer suppression. Resume one-tap.
- SUSPEND: platform-initiated (P7 ladder terminal rung), involuntary, **identity retained for accountability**, in-flight non-locked interest withdrawn + active locks cancelled(`account_closed`), appeal-only.
- DELETE: user-initiated, **grace window** (default 30d) then worker erases — hard-delete if no hold, anonymize-in-place if hold; in-flight released either way.

**Retention policy — decision recorded:** deletion never blind-cascades. A user under an active legal hold (explicit moderation hold OR any open/reviewing/actioned report naming them) is **anonymized in place** (PII scrubbed, profile blanked, `is_tombstone=true`) so `reports`, `audit_log`, and anonymized rating *outcomes* survive attached to a real id. Only users with no hold are hard-deleted; even then, ratings *they authored* re-point to the `[deleted user]` sentinel and reports *about* them survive via P0's FK-less `reports.target_id`.

**Dependency coordination:**
- **P2 (jobs/notifications):** consumed via a guarded `if not exists` shim (Task 1) declaring the minimal shape; P2 supersedes without clash. Worker is invokable by the P2 runner or cron.
- **P5 (transitions):** P9 *calls*, never re-implements; adds only the `account_closed` `cancel_reason` value (Task 2). Tests ship thin stand-ins **inside the test files** (never in migrations) so orchestration is provable before P5 lands; explicit execution-time coupling checks noted in Task 7.
- **P6 (chat):** message-body redaction + sender tombstoning flagged for coordination (P6 owns the tables); P9 owns the sentinel they re-point to.
- **P7 (ratings/enforcement):** P9 provides the `suspended` state + data effects; P7 owns *when* to suspend and reliability-score recompute after teardown.

**Idempotency / safety:** `_p9_process_deletion` is `for update` + no-ops on terminal requests + grace-guarded; worker records `worker_error` and continues the batch on failure (Task 9 Deno tests cover success, partial-failure, empty). All privileged fns are `security definer` with `revoke … from public/anon/authenticated` except the owner-callable `pause/resume/request/cancel/export` (granted to `authenticated`, self-scoped via `auth.uid()` guard).

**Migration ordering caveat:** `account_status` migration (`130000`) sorts before the orchestrator (`130650`) and teardown (`130600`); function bodies resolve at call time so forward references compile, and each task's standalone test only exercises rows that don't require the not-yet-applied later fn (full integration covered in Task 9 after all are applied).

**Placeholder scan:** none — every step has runnable SQL/TS and exact commands. The only non-shipped code is the P5 stand-in functions, which live *inside test files* and are explicitly gated `if not exists` so the real P5 supersedes.

**Type/name consistency:** `account_status`, `deletion_request_status`, `job_status` enums declared once; `deletion_requests`, `legal_holds`, `data_exports`, `jobs`, `notifications` referenced consistently; sentinel uuid `00000000-0000-0000-0000-0000000de1e7` identical across Tasks 2, 7, 8; `cancel_reason='account_closed'` used uniformly.

**Risk note:** the structural psql tests insert directly into `profiles` (bypassing `auth.users`), matching P0's convention — they verify data effects and invariants; `auth.uid()`-gated *policy* behavior (e.g. self-only export) is verified by app-level integration tests in later phases, consistent with P0's risk note.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-p9-account-lifecycle.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks; pause before Task 7/9 to reconcile the real P5 signatures.

**2. Inline Execution** — execute tasks in this session using executing-plans, with checkpoints after Task 4 (lifecycle states), Task 8 (retention), and Task 9 (worker).
