# P5 — Matching State Machine (The Core Loop) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is the most complex phase in the roadmap — do not skip the FAIL step, and do not collapse two tasks into one commit. Every transition is a tested DB function; invariants live in the database, never in app code.

**Goal:** Implement the experience-first dating core loop (spec §6, §7) as a set of **race-safe, idempotent, audited state-transition functions in Postgres** — shortlist/rank, make_offer, accept→lock, pass/expire→auto-roll, reciprocal-pair chooser, reason-coded cancel→safe-roll, swiper-reveal consent, and a bucketed presence-backed demand hint — each proven by psql concurrency/invariant tests and exposed to clients through thin Deno Edge Functions tested with `Deno.test`.

**Architecture:** Every transition is a **`SECURITY DEFINER` plpgsql function** that runs inside one transaction, takes a `pg_advisory_xact_lock` on the contended resource (the date instance, or a canonical user-pair) **before** reading state, enforces the spec invariants, appends to `audit_log`, and enqueues async work through the P2 `jobs`/`enqueue()` interface. The functions bypass RLS by design (SECURITY DEFINER) but **re-check authorization internally** against the passed `p_actor uuid` (which the Edge Function sets from the verified JWT — never trusting client input). Edge Functions are a thin transport layer: verify JWT → call the RPC with `p_actor = jwt.sub` and an `Idempotency-Key` → map SQL exceptions to HTTP. No business logic in TypeScript.

**The two hard invariants P0 already enforces structurally (we build on, never duplicate, them):**
1. **One `active` offer per date instance** — P0 partial unique index `offers_one_active_per_instance`. `make_offer` relies on it as a backstop; the advisory lock makes the violation impossible in the first place.
2. **No user double-booked across overlapping windows** — P0 GiST exclusion on `lock_participants` (`exclude using gist (user_id with =, time_range with &&) where (active)`), kept in sync by the P0 `sync_lock_participants` trigger. `accept_offer` relies on it; a concurrent second accept that would double-book a user fails with `exclusion_violation`, which we catch and translate.

**Tech Stack:** Supabase Postgres (plpgsql, `SECURITY DEFINER`, `pg_advisory_xact_lock`, `FOR UPDATE`/`FOR NO KEY UPDATE`, savepoints), psql-based concurrency + invariant tests (`supabase/tests/p5_*.sql`, plus two-session race tests via background `psql` jobs), Deno Edge Functions (`supabase/functions/match-*`) with `Deno.test`, the P2 `jobs` table + `enqueue()` helper (dependency — see "Dependencies & assumed interfaces").

**Source docs:** spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§6 shortlist/rank, §7.1 states, §7.2 reveal-on-offer-only + demand hint, §7.3 offer/standby, §7.4 double-booking, §7.5 reciprocal, §7.6 cancel/safe-roll); roadmap `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (P5 scope + Closes); foundation `docs/superpowers/plans/2026-05-25-p0-data-model.md` (tables/enums/invariants this plan consumes).

---

## Dependencies & assumed interfaces

This phase **Depends on: P0, P2, P4**. P0 is landed (the migrations/tables/enums above exist). **P2 and P4 plans do not exist yet** at the time of writing; this plan declares the exact interface it needs from each so P5 can be executed once they land, and ships a **clearly-labelled local shim** so P5's own tests run in isolation.

**From P2 (scheduler + notifications) — assumed interface:**
- A `jobs` table with at least: `id uuid`, `kind text`, `run_at timestamptz`, `payload jsonb`, `status text` (`pending|done|cancelled|...`), `dedupe_key text` (nullable, unique-when-present), `created_at`.
- A SQL helper `enqueue(p_kind text, p_run_at timestamptz, p_payload jsonb, p_dedupe_key text default null) returns uuid` that inserts a `pending` job (idempotent on `dedupe_key`) and returns its id.
- A SQL helper `cancel_jobs(p_kind text, p_dedupe_key text)` (or by payload match) to cancel a still-pending timer (used when an offer resolves before it expires, so the `offer_expiry` job no-ops).
- A SQL helper `notify(p_user_id uuid, p_kind text, p_payload jsonb)` that enqueues a push/notification (rate-limited inside P2).
- The **`run_offer_expiry(p_offer_id uuid)`** worker P2 runs when an `offer_expiry` job fires **calls our `expire_offer(...)` function** (defined in Task 6). P2 owns the timer; **P5 owns the transition logic**.

> **Task 0 ships `supabase/migrations/2026052513____0_p5_p2_shim.sql`** creating `jobs`, `enqueue()`, `cancel_jobs()`, and `notify()` as **minimal stand-ins guarded by `create ... if not exists` / `create or replace`** so P5 tests pass standalone. The shim is explicitly marked "SUPERSEDED BY P2" and uses the exact signatures above; when P2 lands it replaces these with the real implementations (same names) and P5 needs no change. **This shim is the only place P5 fabricates infrastructure, and only because P2 is not yet written.**

**From P4 (browse & interest feed) — assumed interface:**
- `swipes` rows (P0) are written by P4's swipe action: `(swiper_id, date_instance_id, creator_id, direction)`. P5 **reads** right-swipes to seed `queue_entries` (`status='interested'`). P4 is responsible for the compatibility pre-filter and writing the swipe; P5 does **not** re-implement filtering.
- A swipe-right is the trigger for the **consent disclosure** in Task 2 (the swiper consents to revealing *their* profile to the anonymous creator). P4 surfaces the consent copy; P5 enforces that the creator can only read swiper profiles for **right-swipes on their own instances** (P0 `swipes_visible` RLS already does this) and records the disclosure event.

**From P0 — consumed directly (no changes):** `cities`, `profiles`, `profiles_private`, `date_instances` (+ generated `time_range`), `swipes`, `queue_entries` (status enum incl. `interested|shortlisted|offer_active|offer_passed|offer_expired|standby|locked`), `offers` (+ `offers_one_active_per_instance`), `locks` + `lock_participants` (+ GiST exclusion + `sync_lock_participants` trigger), `match_ratings`, `reports`, `blocks`, `audit_log` (+ `log_status_transition` triggers), `browse_feed` view. P5 **adds** a small number of columns/tables (idempotency ledger, demand presence, reciprocal-pair tracking, cascade-throttle ledger, standby ordering) — see File Structure.

**Migration timestamps:** P0 uses `20260525120000`–`20260525121100`. P5 uses `20260525130000`+ so it always sorts after P0.

**Convention reminders (inherited from P0, follow exactly):** migration filenames `YYYYMMDDHHMMSS_snake_description.sql`; enable RLS on every new table; idempotent policies via `do $$ begin create policy … exception when duplicate_object then null; end $$;`; attach `set_updated_at()` to tables with `updated_at`; uuid PKs via `gen_random_uuid()`. SECURITY DEFINER functions **must** set `search_path = public` and be `revoke execute ... from public; grant execute ... to authenticated, service_role;`.

**Local test loop (same as P0):** `supabase db reset` then
`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>`.
Single-session tests use `DO $$ … END $$;` blocks that `RAISE EXCEPTION` on wrong behavior (clean exit = PASS). **Concurrency tests** use a helper that opens two real psql sessions (the `DO`-block approach can't model two transactions) — see Task 0.

**Edge Function test loop:** `supabase functions serve` is not needed for unit tests; transition logic is pure SQL. Edge Functions are tested with `deno test --allow-env --allow-net supabase/functions/match-*/**/*.test.ts` against a running local stack (`supabase start`).

---

## File Structure

```
supabase/migrations/
  20260525130000_p5_p2_shim.sql              # Task 0  jobs/enqueue/cancel/notify stand-in (SUPERSEDED BY P2)
  20260525130100_p5_idempotency.sql          # Task 1  transition_idempotency ledger + helper
  20260525130200_p5_standby_order.sql        # Task 2  queue_entries.standby_pos + swiper-disclosure log + shortlist/rank fns
  20260525130300_p5_make_offer.sql           # Task 4  make_offer() + reveal scoping
  20260525130400_p5_demand_presence.sql      # Task 3  presence table + bucketed demand_hint() (capped, trusted-only)
  20260525130500_p5_accept_lock.sql          # Task 5  accept_offer() → lock (advisory + exclusion + off-market + cascade auto-withdraw)
  20260525130600_p5_pass_expire_roll.sql     # Task 6  pass_offer(), expire_offer(), auto_roll() w/ cascade-withdrawal throttle
  20260525130700_p5_reciprocal.sql           # Task 7  reciprocal-pair detection + resolve_reciprocal() chooser
  20260525130800_p5_cancel_safe_roll.sql     # Task 8  cancel_lock(reason) → safe auto-roll (benign-only, reconfirm, freeze near cutoff/after report)
  20260525130900_p5_grants.sql               # Task 9  centralized revoke/grant on all p5 functions + RLS read views

supabase/tests/
  p5_helpers.sql                             # Task 0  pair-lock key helper + fixtures factory (psql \set vars)
  p5_concurrency_lib.sh                      # Task 0  two-session race harness (background psql jobs)
  p5_shortlist_rank.sql                      # Task 2
  p5_swiper_disclosure.sql                   # Task 2
  p5_demand_hint.sql                         # Task 3
  p5_make_offer.sql                          # Task 4
  p5_reveal_scope.sql                        # Task 4
  p5_accept_lock.sql                         # Task 5
  p5_accept_idempotent.sql                   # Task 5
  p5_race_two_accepts.sh                     # Task 5  (concurrency: two simultaneous accepts)
  p5_race_expiry_vs_accept.sh                # Task 6  (concurrency: offer-expiry vs accept)
  p5_pass_roll.sql                           # Task 6
  p5_cascade_throttle.sql                    # Task 6
  p5_reciprocal.sql                          # Task 7
  p5_cancel_safe_roll.sql                    # Task 8
  p5_cancel_freeze.sql                       # Task 8

supabase/functions/
  _shared/match.ts                           # Task 10 verifyJwt(), callRpc(), idempotency + error→HTTP mapping
  match-shortlist/index.ts        + .test.ts # Task 10
  match-rank/index.ts             + .test.ts # Task 10
  match-make-offer/index.ts       + .test.ts # Task 10
  match-accept/index.ts           + .test.ts # Task 10 (idempotency-key required)
  match-pass/index.ts             + .test.ts # Task 10
  match-cancel/index.ts           + .test.ts # Task 10
  match-resolve-reciprocal/index.ts + .test.ts # Task 10
  match-demand-hint/index.ts      + .test.ts # Task 10
```

**Naming note:** all SECURITY DEFINER transition functions are prefixed `match_` (e.g. `match_make_offer`) to namespace them; tests/docs may abbreviate. The plan below uses the `match_`-prefixed names in code.

---

## Task 0: Test harness, pair-lock helper, and the P2 shim

**Files:**
- Create: `supabase/migrations/20260525130000_p5_p2_shim.sql`
- Create: `supabase/tests/p5_helpers.sql`
- Create: `supabase/tests/p5_concurrency_lib.sh`

### Why first
P5 has zero functions yet; before any transition test can run we need (a) the P2 job/notify interface to exist, (b) a deterministic fixtures factory, and (c) a two-session race harness. The concurrency tests are the whole point of this phase, so the harness is task #1.

- [ ] **Step 1: Write the failing test** (`supabase/tests/p5_helpers.sql` asserts the shim + the pair-lock key function exist)

```sql
-- supabase/tests/p5_helpers.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_proc WHERE proname='enqueue';
  IF NOT FOUND THEN RAISE EXCEPTION 'enqueue() missing (P2 shim not applied)'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='notify';
  IF NOT FOUND THEN RAISE EXCEPTION 'notify() missing (P2 shim not applied)'; END IF;
  PERFORM 1 FROM pg_tables WHERE tablename='jobs';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs table missing'; END IF;
  -- canonical pair-lock key must be order-independent
  IF match_pair_lock_key('00000000-0000-0000-0000-000000000001'::uuid,
                         '00000000-0000-0000-0000-000000000002'::uuid)
   <> match_pair_lock_key('00000000-0000-0000-0000-000000000002'::uuid,
                         '00000000-0000-0000-0000-000000000001'::uuid)
  THEN RAISE EXCEPTION 'pair-lock key is not order-independent'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** — `function match_pair_lock_key(...) does not exist` / `jobs` missing.

- [ ] **Step 3: Write the migration (P2 shim) + the helper**

```sql
-- supabase/migrations/20260525130000_p5_p2_shim.sql
-- ⚠️ SUPERSEDED BY P2. Minimal stand-in for the scheduler/notification interface so
-- P5 transition functions can be built and tested in isolation. P2 replaces the bodies
-- (same names/signatures); P5 needs no change when it lands.

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  run_at timestamptz not null default now(),
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','done','cancelled','failed')),
  dedupe_key text,
  created_at timestamptz not null default now()
);
create unique index if not exists jobs_dedupe_uq on jobs (dedupe_key) where dedupe_key is not null and status='pending';
alter table jobs enable row level security; -- service-role only; no policies = default deny.

create or replace function enqueue(p_kind text, p_run_at timestamptz, p_payload jsonb, p_dedupe_key text default null)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare jid uuid;
begin
  insert into jobs(kind, run_at, payload, dedupe_key)
  values (p_kind, p_run_at, coalesce(p_payload,'{}'::jsonb), p_dedupe_key)
  on conflict (dedupe_key) where dedupe_key is not null and status='pending'
  do update set run_at = excluded.run_at   -- reschedule keeps a single pending timer
  returning id into jid;
  return jid;
end $fn$;

create or replace function cancel_jobs(p_kind text, p_dedupe_key text)
returns int language plpgsql security definer set search_path=public as $fn$
declare n int;
begin
  update jobs set status='cancelled'
   where kind=p_kind and dedupe_key=p_dedupe_key and status='pending';
  get diagnostics n = row_count; return n;
end $fn$;

create or replace function notify(p_user_id uuid, p_kind text, p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $fn$
begin
  -- shim: notifications are modeled as immediate jobs; P2 adds rate-limiting + push transport.
  return enqueue('notify:'||p_kind, now(), jsonb_build_object('user_id',p_user_id) || coalesce(p_payload,'{}'::jsonb), null);
end $fn$;

-- Canonical, order-independent advisory-lock key for a pair of users (used by reciprocal + accept).
create or replace function match_pair_lock_key(a uuid, b uuid)
returns bigint language sql immutable as $fn$
  select ('x' || substr(md5(least(a::text,b::text) || greatest(a::text,b::text)),1,16))::bit(64)::bigint
$fn$;

-- Single-instance advisory-lock key (used by make_offer/accept/auto_roll on one date instance).
create or replace function match_instance_lock_key(inst uuid)
returns bigint language sql immutable as $fn$
  select ('x' || substr(md5('date_instance:'||inst::text),1,16))::bit(64)::bigint
$fn$;
```

- [ ] **Step 4: Apply + run test, expect PASS** (`supabase db reset && psql … -f supabase/tests/p5_helpers.sql`).

- [ ] **Step 5: Build the two-session race harness + fixtures factory**

`p5_helpers.sql` also defines a **fixtures factory** function so every test builds identical seed data:

```sql
-- append to supabase/tests/p5_helpers.sql:
-- Reusable fixtures. Seeds auth.users (profiles.id FKs to auth.users — see Risk note),
-- two creators, three candidates, one scheduled instance per creator. Returns nothing;
-- callers select the ids back out by stable email.
create or replace function p5_fixture_reset() returns void language plpgsql as $fn$
declare cre uuid; c1 uuid; c2 uuid; c3 uuid; cid uuid; it uuid;
begin
  -- auth.users first (real FK target), then profiles. Use fixed UUIDs for stable lookups.
  delete from auth.users where email like 'p5_%@test.local';
  insert into auth.users (id, email) values
    (gen_random_uuid(),'p5_creator@test.local'),
    (gen_random_uuid(),'p5_cand1@test.local'),
    (gen_random_uuid(),'p5_cand2@test.local'),
    (gen_random_uuid(),'p5_cand3@test.local');
  insert into profiles (id, first_name, email, dating_enabled, verification)
    select id, split_part(email,'@',1), email, true, 'verified' from auth.users where email like 'p5_%@test.local'
    on conflict (id) do update set dating_enabled=true, verification='verified';
  select id into cre from profiles where email='p5_creator@test.local';
  select id into cid from cities where slug='kelowna';
  insert into itineraries (id,user_id,is_evergreen) values (gen_random_uuid(),cre,false) returning id into it;
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at,duration_min,status)
    values (it,cre,cid, now()+interval '3 days', 120, 'seeking');
end $fn$;
```

```bash
# supabase/tests/p5_concurrency_lib.sh
#!/usr/bin/env bash
# Two-session race harness. Usage: run two SQL blobs "simultaneously" by starting
# both as backgrounded psql jobs that each BEGIN, wait on the same advisory lock
# (via a coordinating sleep), then commit. We assert exactly one succeeds.
set -euo pipefail
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
psql_bg() { psql "$DB" -v ON_ERROR_STOP=0 -f "$1" > "$2" 2>&1 & echo $!; }
# Callers: write two .sql session files, launch both, wait, then diff exit/notice output.
```

> **Design note (why a shell harness, not a `DO` block):** a single transaction cannot model two clients contending for a `pg_advisory_xact_lock`. The race tests (Task 5/6) write two session SQL files that each call the transition function, launch both with `psql_bg`, `wait`, and assert that exactly one returns success and the other returns the mapped conflict (`OFFER_CONFLICT` / `exclusion_violation` → `DOUBLE_BOOKED`). The advisory lock + a small intra-tx pacing makes the interleaving deterministic.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260525130000_p5_p2_shim.sql supabase/tests/p5_helpers.sql supabase/tests/p5_concurrency_lib.sh
git commit -m "P5: P2 interface shim (jobs/enqueue/notify), advisory-lock key helpers, race harness + fixtures factory"
```

---

## Task 1: Idempotency ledger (accept/lock/cancel safety)

**Files:**
- Create: `supabase/migrations/20260525130100_p5_idempotency.sql`

### Why
Accept/lock and cancel are money-state transitions; a client retry (lost ACK, double-tap, push-driven retry) must not lock twice or roll twice. We add a tiny ledger keyed on `(actor, action, idempotency_key)` that the transition functions consult **inside** their advisory-locked transaction.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260525130100_p5_idempotency.sql
create table if not exists transition_idempotency (
  actor uuid not null,
  action text not null,                 -- 'accept_offer' | 'cancel_lock' | 'resolve_reciprocal' | ...
  idempotency_key text not null,
  result jsonb not null,                -- the original function's return value, replayed on retry
  created_at timestamptz not null default now(),
  primary key (actor, action, idempotency_key)
);
alter table transition_idempotency enable row level security; -- service/definer only.

-- Helper: returns stored result if seen before, else null. Called first inside a transition.
create or replace function match_idem_lookup(p_actor uuid, p_action text, p_key text)
returns jsonb language sql stable security definer set search_path=public as $fn$
  select result from transition_idempotency
   where actor=p_actor and action=p_action and idempotency_key=p_key
$fn$;

create or replace function match_idem_store(p_actor uuid, p_action text, p_key text, p_result jsonb)
returns void language plpgsql security definer set search_path=public as $fn$
begin
  insert into transition_idempotency(actor,action,idempotency_key,result)
  values (p_actor,p_action,p_key,p_result)
  on conflict (actor,action,idempotency_key) do nothing;
end $fn$;
```

- [ ] **Step 2: Apply, expect clean** (`supabase db reset`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525130100_p5_idempotency.sql
git commit -m "P5: transition idempotency ledger + lookup/store helpers"
```

---

## Task 2: Shortlist + rank (frozen for the active offer slot) + swiper-disclosure consent

**Files:**
- Create: `supabase/migrations/20260525130200_p5_standby_order.sql`
- Test: `supabase/tests/p5_shortlist_rank.sql`
- Test: `supabase/tests/p5_swiper_disclosure.sql`

### Design decisions locked
- **Two orderings, one source of truth.** Per audit ("standby vs creator-rank ambiguity"), `queue_entries.rank` is the **creator's preference order over shortlisted candidates**; **standby is just the same rank order filtered to the non-offered shortlist**. We do **not** keep a second `standby_pos`; we add a column only to *freeze* a snapshot of order when an offer goes out so an in-flight reorder cannot reshuffle who's "next." `match_next_standby(instance)` = lowest-`rank` `shortlisted` candidate. This makes "standby order" deterministic and identical to rank, eliminating the dual-ordering bug.
- **Rank freeze at the #1 slot.** Spec §6: once the #1 holds an active offer, that slot is frozen; reordering applies only to positions ≥2. We enforce in `match_set_rank`: if there is an `offer_active` row for the instance, **reject any rank change that would move the offer-holder out of rank 1**, but allow reordering of positions ≥2.
- **Swiper-disclosure consent (honeypot mitigation).** Per audit + spec §7.2: when the creator shortlists a candidate (or first views the right-swipe pool), that is the moment the swiper's profile becomes visible to the still-anonymous creator. P0 RLS already restricts swiper-profile reads to right-swipes on the creator's own instances; here we make the disclosure **explicit and logged** so it's auditable and surfaceable in UI ("by swiping right, your profile is shown to the night's creator"). We add a `swiper_disclosed_at` stamp on the queue entry and an `audit_log` row. The creator's identity stays hidden until offer (Task 4); only the *swiper's* profile is disclosed here — the asymmetry the spec intends.

- [ ] **Step 1: Write the failing tests**

```sql
-- supabase/tests/p5_shortlist_rank.sql
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; inst uuid; r1 int; r2 int;
BEGIN
  PERFORM p5_fixture_reset();
  select id into cre from profiles where email='p5_creator@test.local';
  select id into c1 from profiles where email='p5_cand1@test.local';
  select id into c2 from profiles where email='p5_cand2@test.local';
  select id into inst from date_instances where creator_id=cre limit 1;
  -- candidates expressed interest (P4 normally writes swipes; simulate the seeded queue rows)
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values
    (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);                 -- seeds queue_entries(status='interested')
  perform match_shortlist(cre, inst, c1);              -- creator shortlists c1
  perform match_shortlist(cre, inst, c2);
  perform match_set_rank(cre, inst, c1, 1);
  perform match_set_rank(cre, inst, c2, 2);
  select rank into r1 from queue_entries where date_instance_id=inst and candidate_id=c1;
  select rank into r2 from queue_entries where date_instance_id=inst and candidate_id=c2;
  IF r1<>1 OR r2<>2 THEN RAISE EXCEPTION 'rank not set: %, %', r1, r2; END IF;

  -- next standby == lowest-rank shortlisted == c1
  IF match_next_standby(inst) <> c1 THEN RAISE EXCEPTION 'next standby should be c1'; END IF;

  -- a non-creator cannot shortlist
  BEGIN
    PERFORM match_shortlist(c2, inst, c1);
    RAISE EXCEPTION 'non-creator was allowed to shortlist';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM NOT LIKE '%NOT_CREATOR%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'shortlist/rank OK';
  ROLLBACK;
END $$;
```

```sql
-- supabase/tests/p5_swiper_disclosure.sql
DO $$
DECLARE cre uuid; c1 uuid; inst uuid; n int;
BEGIN
  PERFORM p5_fixture_reset();
  select id into cre from profiles where email='p5_creator@test.local';
  select id into c1 from profiles where email='p5_cand1@test.local';
  select id into inst from date_instances where creator_id=cre limit 1;
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre, inst, c1);
  -- disclosure stamped + audited
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=c1 AND swiper_disclosed_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'swiper_disclosed_at not stamped on shortlist'; END IF;
  select count(*) into n from audit_log where entity='swiper_disclosure' and entity_id=c1;
  IF n < 1 THEN RAISE EXCEPTION 'disclosure not audited'; END IF;
  RAISE NOTICE 'swiper disclosure OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run both, expect FAIL** (`function match_ingest_interest(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130200_p5_standby_order.sql
alter table queue_entries
  add column if not exists swiper_disclosed_at timestamptz,
  add column if not exists offer_frozen_rank int;   -- snapshot of rank=1 when an offer is live

-- Seed queue_entries from right-swipes (idempotent). Called by P4 post-swipe or batched.
create or replace function match_ingest_interest(p_instance uuid)
returns int language plpgsql security definer set search_path=public as $fn$
declare n int := 0; cre uuid;
begin
  select creator_id into cre from date_instances where id=p_instance;
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
  select s.date_instance_id, s.swiper_id, s.creator_id, 'interested'
    from swipes s
   where s.date_instance_id=p_instance and s.direction='right'
     -- never enqueue a blocked pair in either direction
     and not exists (select 1 from blocks b where (b.blocker_id=cre and b.blocked_id=s.swiper_id)
                                                or (b.blocker_id=s.swiper_id and b.blocked_id=cre))
  on conflict (date_instance_id, candidate_id) do nothing;
  get diagnostics n = row_count; return n;
end $fn$;

-- Creator shortlists an interested candidate. Discloses the swiper's profile (already RLS-allowed;
-- we make it explicit + audited) and moves them to 'shortlisted'.
create or replace function match_shortlist(p_actor uuid, p_instance uuid, p_candidate uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare cre uuid;
begin
  select creator_id into cre from date_instances where id=p_instance;
  if cre is null then raise exception 'NO_INSTANCE'; end if;
  if cre <> p_actor then raise exception 'NOT_CREATOR'; end if;
  update queue_entries
     set status='shortlisted',
         swiper_disclosed_at = coalesce(swiper_disclosed_at, now())
   where date_instance_id=p_instance and candidate_id=p_candidate
     and status in ('interested','shortlisted');
  if not found then raise exception 'NOT_INTERESTED'; end if;
  insert into audit_log(entity, entity_id, action, new_status, actor)
  values ('swiper_disclosure', p_candidate, 'disclosed_to_creator', 'shortlisted', p_actor);
end $fn$;

-- Set/reorder rank. Frozen rule: while an offer is active, rank=1 (the offer-holder) is immutable.
create or replace function match_set_rank(p_actor uuid, p_instance uuid, p_candidate uuid, p_rank int)
returns void language plpgsql security definer set search_path=public as $fn$
declare cre uuid; offer_holder uuid;
begin
  select creator_id into cre from date_instances where id=p_instance;
  if cre is null then raise exception 'NO_INSTANCE'; end if;
  if cre <> p_actor then raise exception 'NOT_CREATOR'; end if;
  if p_rank < 1 then raise exception 'BAD_RANK'; end if;

  -- serialize against make_offer/auto_roll on this instance
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));

  select candidate_id into offer_holder
    from queue_entries where date_instance_id=p_instance and status='offer_active';

  if offer_holder is not null then
    -- frozen slot: cannot move the offer-holder off rank 1, and cannot assign rank 1 to anyone else.
    if (p_candidate = offer_holder and p_rank <> 1)
       or (p_candidate <> offer_holder and p_rank = 1)
    then raise exception 'RANK_FROZEN'; end if;
  end if;

  update queue_entries set rank=p_rank
   where date_instance_id=p_instance and candidate_id=p_candidate and status in ('shortlisted','standby');
  if not found then raise exception 'NOT_SHORTLISTED'; end if;
end $fn$;

-- The single source of standby/next ordering: lowest-rank shortlisted (rank null sorts last).
create or replace function match_next_standby(p_instance uuid)
returns uuid language sql stable security definer set search_path=public as $fn$
  select candidate_id from queue_entries
   where date_instance_id=p_instance and status='shortlisted'
   order by rank nulls last, created_at
   limit 1
$fn$;
```

- [ ] **Step 4: Apply + run both tests, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130200_p5_standby_order.sql supabase/tests/p5_shortlist_rank.sql supabase/tests/p5_swiper_disclosure.sql
git commit -m "P5: shortlist + rank (rank-1 frozen during offer), single rank-based standby order, audited swiper disclosure"
```

---

## Task 3: Bucketed, capped, presence-backed demand hint

**Files:**
- Create: `supabase/migrations/20260525130400_p5_demand_presence.sql`
- Test: `supabase/tests/p5_demand_hint.sql`

### Design decisions locked (spec §7.2 "Demand signal (de-risked)")
- Return a **bucket label**, never a raw `N`: `none` (0), `a_few` (1–3), `several` (4–8), `lots` (9+ capped). The exact count never leaves the DB.
- **Capped + trusted-only:** counts only candidates whose profile is `verification='verified'` AND who are **currently present** (a heartbeat in the last `INTERVAL '10 min'`). This makes the signal honest social proof, not a fabricated retention number, and resists swipe-farm inflation (audited separately in P8).
- **Honesty guard:** a candidate viewing the hint **never** sees their own queue position contribute in a way that reveals rank. The hint is the same value for everyone viewing that instance; it is *not* personalized and *not* a retention lever.
- Presence heartbeats live in a small table P4/clients update; we provide the table + the read function here. The hint is computed at read time (no stored counter to drift).

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p5_demand_hint.sql
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; inst uuid; bucket text;
BEGIN
  PERFORM p5_fixture_reset();
  select id into cre from profiles where email='p5_creator@test.local';
  select id into c1 from profiles where email='p5_cand1@test.local';
  select id into c2 from profiles where email='p5_cand2@test.local';
  select id into inst from date_instances where creator_id=cre limit 1;

  -- 0 interested → 'none'
  IF match_demand_hint(inst) <> 'none' THEN RAISE EXCEPTION 'expected none'; END IF;

  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  -- both verified but NOT present yet → still 'none' (presence-backed honesty)
  IF match_demand_hint(inst) <> 'none' THEN RAISE EXCEPTION 'expected none w/o presence'; END IF;

  -- mark both present + verified → 'a_few'
  insert into presence_heartbeats(user_id, seen_at) values (c1, now()),(c2, now())
    on conflict (user_id) do update set seen_at=now();
  bucket := match_demand_hint(inst);
  IF bucket <> 'a_few' THEN RAISE EXCEPTION 'expected a_few, got %', bucket; END IF;
  RAISE NOTICE 'demand hint OK (%)', bucket;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "presence_heartbeats" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130400_p5_demand_presence.sql
create table if not exists presence_heartbeats (
  user_id uuid primary key references profiles(id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table presence_heartbeats enable row level security;
do $$ begin
  create policy "presence_self_upsert" on presence_heartbeats for all
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Bucketed, capped, presence+verification-weighted demand hint. Same value for all viewers.
create or replace function match_demand_hint(p_instance uuid)
returns text language sql stable security definer set search_path=public as $fn$
  with c as (
    select count(*) as n
      from queue_entries q
      join profiles p on p.id = q.candidate_id
      join presence_heartbeats h on h.user_id = q.candidate_id
     where q.date_instance_id = p_instance
       and q.status in ('interested','shortlisted','standby')
       and p.verification = 'verified'
       and h.seen_at > now() - interval '10 minutes'
  )
  select case
    when n = 0 then 'none'
    when n between 1 and 3 then 'a_few'
    when n between 4 and 8 then 'several'
    else 'lots'          -- capped: never reveals exact count beyond this bucket
  end from c
$fn$;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130400_p5_demand_presence.sql supabase/tests/p5_demand_hint.sql
git commit -m "P5: presence-backed, bucketed, capped, trusted-only demand hint (honest social proof, not a counter)"
```

---

## Task 4: `make_offer` — single active offer, expiry job, reveal+chat to offer-holder ONLY

**Files:**
- Create: `supabase/migrations/20260525130300_p5_make_offer.sql`
- Test: `supabase/tests/p5_make_offer.sql`
- Test: `supabase/tests/p5_reveal_scope.sql`

### Design decisions locked (spec §7.2, §7.3)
- **Advisory lock then check.** `match_make_offer` takes `pg_advisory_xact_lock(match_instance_lock_key(instance))` so two concurrent calls serialize; the second sees the existing `offer_active` and raises `OFFER_EXISTS` (the P0 partial-unique index is the structural backstop). This is race-free *by construction*, not by retry.
- **Offer = the only reveal.** Identity reveal and chat eligibility are **derived from offer state**, never stored as a separate flag that can drift. We expose a `match_reveal_allowed(viewer, instance)` predicate: a viewer may see the creator's full identity iff they currently hold the `offer_active` row for that instance (or are the creator). Pending/standby see nothing identifying. When the offer resolves, the predicate flips automatically → **reveal auto-revoke is real, not a fiction**, because nothing was granted; it was always computed live.
- **Expiry timer.** On offer creation we `enqueue('offer_expiry', expires_at, {offer_id}, dedupe_key='offer_expiry:'||offer_id)`. When the offer resolves early (accept/pass) we `cancel_jobs('offer_expiry', dedupe_key)` so the worker no-ops; even if it fires anyway, `expire_offer` (Task 6) is a guarded no-op when the offer is already resolved.
- **Offer window** default 24h (spec open question §11; configurable param `p_window_hours int default 24`).
- **Frozen rank snapshot.** On offer we set `offer_frozen_rank=1` on the offer-holder and set their `queue_entries.status='offer_active'`; the creator can still reorder ≥2 (Task 2 enforces the freeze).
- **Block guard:** cannot offer to a candidate who has blocked the creator or is blocked.

- [ ] **Step 1: Write the failing tests**

```sql
-- supabase/tests/p5_make_offer.sql
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; inst uuid; oid uuid; jcount int;
BEGIN
  PERFORM p5_fixture_reset();
  select id into cre from profiles where email='p5_creator@test.local';
  select id into c1 from profiles where email='p5_cand1@test.local';
  select id into c2 from profiles where email='p5_cand2@test.local';
  select id into inst from date_instances where creator_id=cre limit 1;
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1); perform match_set_rank(cre,inst,c1,1);
  perform match_shortlist(cre,inst,c2); perform match_set_rank(cre,inst,c2,2);

  oid := match_make_offer(cre, inst, c1);
  -- one active offer, expires in future, expiry job enqueued
  PERFORM 1 FROM offers WHERE id=oid AND status='active' AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not active/expiry'; END IF;
  select count(*) into jcount from jobs where kind='offer_expiry' and dedupe_key='offer_expiry:'||oid and status='pending';
  IF jcount <> 1 THEN RAISE EXCEPTION 'expiry job not enqueued (%).', jcount; END IF;
  -- candidate row is offer_active
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=c1 AND status='offer_active';
  IF NOT FOUND THEN RAISE EXCEPTION 'c1 not offer_active'; END IF;

  -- second concurrent-style offer on same instance rejected (single-session proxy via direct call)
  BEGIN
    PERFORM match_make_offer(cre, inst, c2);
    RAISE EXCEPTION 'second active offer allowed';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM NOT LIKE '%OFFER_EXISTS%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'make_offer OK';
  ROLLBACK;
END $$;
```

```sql
-- supabase/tests/p5_reveal_scope.sql
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; inst uuid;
BEGIN
  PERFORM p5_fixture_reset();
  select id into cre from profiles where email='p5_creator@test.local';
  select id into c1 from profiles where email='p5_cand1@test.local';
  select id into c2 from profiles where email='p5_cand2@test.local';
  select id into inst from date_instances where creator_id=cre limit 1;
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1); perform match_set_rank(cre,inst,c1,1);
  perform match_shortlist(cre,inst,c2); perform match_set_rank(cre,inst,c2,2);
  perform match_make_offer(cre, inst, c1);

  -- ONLY the active offer-holder may see the creator identity
  IF NOT match_reveal_allowed(c1, inst) THEN RAISE EXCEPTION 'offer-holder cannot reveal'; END IF;
  IF match_reveal_allowed(c2, inst) THEN RAISE EXCEPTION 'LEAK: standby can reveal creator'; END IF;
  IF NOT match_reveal_allowed(cre, inst) THEN RAISE EXCEPTION 'creator self-view blocked'; END IF;
  RAISE NOTICE 'reveal scope OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run both, expect FAIL** (`function match_make_offer(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130300_p5_make_offer.sql
create or replace function match_make_offer(p_actor uuid, p_instance uuid, p_candidate uuid,
                                            p_window_hours int default 24)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare cre uuid; oid uuid; exp timestamptz; st date_match_status;
begin
  -- 1. serialize all offer/lock/roll activity for this instance
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));

  select creator_id, status into cre, st from date_instances where id=p_instance for update;
  if cre is null then raise exception 'NO_INSTANCE'; end if;
  if cre <> p_actor then raise exception 'NOT_CREATOR'; end if;
  if st <> 'seeking' then raise exception 'INSTANCE_NOT_SEEKING'; end if;

  -- 2. single-active-offer guard (advisory lock makes this race-free; index is backstop)
  if exists (select 1 from offers where date_instance_id=p_instance and status='active') then
    raise exception 'OFFER_EXISTS';
  end if;

  -- 3. candidate must be shortlisted; block guard
  if not exists (select 1 from queue_entries
                  where date_instance_id=p_instance and candidate_id=p_candidate and status='shortlisted') then
    raise exception 'NOT_SHORTLISTED';
  end if;
  if exists (select 1 from blocks b where (b.blocker_id=cre and b.blocked_id=p_candidate)
                                       or (b.blocker_id=p_candidate and b.blocked_id=cre)) then
    raise exception 'BLOCKED';
  end if;

  -- 4. create offer (P0 partial-unique index is the structural invariant backstop)
  exp := now() + make_interval(hours => p_window_hours);
  insert into offers(date_instance_id, candidate_id, creator_id, status, expires_at)
  values (p_instance, p_candidate, cre, 'active', exp)
  returning id into oid;

  -- 5. promote candidate to offer_active, freeze rank-1 snapshot
  update queue_entries set status='offer_active', rank=1, offer_frozen_rank=1
   where date_instance_id=p_instance and candidate_id=p_candidate;

  -- 6. enqueue expiry timer (dedupe so cancel can target it) + notify the candidate
  perform enqueue('offer_expiry', exp, jsonb_build_object('offer_id',oid), 'offer_expiry:'||oid);
  perform notify(p_candidate, 'offer_received', jsonb_build_object('instance', p_instance, 'expires_at', exp));
  return oid;
end $fn$;

-- Reveal predicate: creator identity is visible ONLY to the active offer-holder (or the creator).
-- Derived live from offer state → revocation is automatic when the offer resolves.
create or replace function match_reveal_allowed(p_viewer uuid, p_instance uuid)
returns boolean language sql stable security definer set search_path=public as $fn$
  select exists (select 1 from date_instances di where di.id=p_instance and di.creator_id=p_viewer)
      or exists (select 1 from offers o
                  where o.date_instance_id=p_instance and o.candidate_id=p_viewer and o.status='active')
$fn$;
```

- [ ] **Step 4: Apply + run both tests, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130300_p5_make_offer.sql supabase/tests/p5_make_offer.sql supabase/tests/p5_reveal_scope.sql
git commit -m "P5: make_offer (advisory-locked single offer, expiry job) + live reveal predicate (offer-holder only)"
```

---

## Task 5: `accept_offer` → LOCK (transactional, advisory, no-overlap, off-market, cascade auto-withdraw, idempotent)

**Files:**
- Create: `supabase/migrations/20260525130500_p5_accept_lock.sql`
- Test: `supabase/tests/p5_accept_lock.sql`
- Test: `supabase/tests/p5_accept_idempotent.sql`
- Test: `supabase/tests/p5_race_two_accepts.sh`

### Design decisions locked (spec §7.3, §7.4)
- **Idempotency-keyed.** `match_accept_offer(p_actor, p_offer_id, p_idem_key)` first `match_idem_lookup`; if seen, returns the stored result (no second lock). Otherwise it proceeds and stores the result before returning. The Edge Function **requires** an `Idempotency-Key` header for accept.
- **Authorization:** only the offer's `candidate_id` may accept (`p_actor = offer.candidate_id`).
- **Advisory lock on the instance** serializes against a competing `make_offer`/`auto_roll`. **The lock_participants GiST exclusion (P0)** is the structural guarantee that the *same user* cannot be double-booked across overlapping windows — a concurrent accept of an overlapping date raises `exclusion_violation`, which we catch → `DOUBLE_BOOKED`.
- **Two simultaneous accepts of the same offer:** both serialize on the instance advisory lock; the first flips the offer to `accepted` and inserts the lock; the second, after acquiring the lock, sees `offer.status<>'active'` → `OFFER_NOT_ACTIVE`. Exactly one lock is ever created (`locks.date_instance_id` is unique in P0 too).
- **Off-market + cascade auto-withdraw (spec §7.4):** on lock we (a) set `date_instances.status='matched'`; (b) auto-close **other scheduled instances the creator owns that overlap** the locked window (`status='cancelled'`, audited) — these are the creator's own conflicts; (c) auto-withdraw the **matched user** from conflicting offers/standbys on *other* instances. The matched user's withdrawal is bounded — see the throttle in Task 6 so withdrawing them does not cascade-collapse those other queues.
- **Notifications:** notify matched user + creator of the lock; the `sync_lock_participants` trigger (P0) writes `lock_participants` and the GiST exclusion enforces no-overlap automatically.

- [ ] **Step 1: Write the failing tests**

```sql
-- supabase/tests/p5_accept_lock.sql
DO $$
DECLARE cre uuid; c1 uuid; inst uuid; oid uuid; lid uuid; r jsonb; st date_match_status;
BEGIN
  PERFORM p5_fixture_reset();
  select id into cre from profiles where email='p5_creator@test.local';
  select id into c1 from profiles where email='p5_cand1@test.local';
  select id into inst from date_instances where creator_id=cre limit 1;
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1); perform match_set_rank(cre,inst,c1,1);
  oid := match_make_offer(cre, inst, c1);

  r := match_accept_offer(c1, oid, 'idem-accept-1');
  lid := (r->>'lock_id')::uuid;
  PERFORM 1 FROM locks WHERE id=lid AND status='active' AND matched_user_id=c1 AND creator_id=cre;
  IF NOT FOUND THEN RAISE EXCEPTION 'lock not created'; END IF;
  PERFORM 1 FROM offers WHERE id=oid AND status='accepted';
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not accepted'; END IF;
  select status into st from date_instances where id=inst;
  IF st <> 'matched' THEN RAISE EXCEPTION 'instance not off-market (status=%).', st; END IF;
  PERFORM 1 FROM lock_participants WHERE lock_id=lid AND user_id=c1 AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'lock_participants missing matched user'; END IF;
  -- expiry job cancelled
  PERFORM 1 FROM jobs WHERE dedupe_key='offer_expiry:'||oid AND status='cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'expiry job not cancelled on accept'; END IF;

  -- non-candidate cannot accept
  BEGIN PERFORM match_accept_offer(cre, oid, 'x'); RAISE EXCEPTION 'creator accepted own offer';
  EXCEPTION WHEN sqlstate 'P0001' THEN IF SQLERRM NOT LIKE '%NOT_OFFER_HOLDER%' THEN RAISE; END IF; END;
  RAISE NOTICE 'accept→lock OK';
  ROLLBACK;
END $$;
```

```sql
-- supabase/tests/p5_accept_idempotent.sql
DO $$
DECLARE cre uuid; c1 uuid; inst uuid; oid uuid; r1 jsonb; r2 jsonb; nlocks int;
BEGIN
  PERFORM p5_fixture_reset();
  select id into cre from profiles where email='p5_creator@test.local';
  select id into c1 from profiles where email='p5_cand1@test.local';
  select id into inst from date_instances where creator_id=cre limit 1;
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1); perform match_set_rank(cre,inst,c1,1);
  oid := match_make_offer(cre, inst, c1);
  r1 := match_accept_offer(c1, oid, 'same-key');
  r2 := match_accept_offer(c1, oid, 'same-key');   -- retry, same idem key
  IF (r1->>'lock_id') <> (r2->>'lock_id') THEN RAISE EXCEPTION 'idempotent retry returned different lock'; END IF;
  select count(*) into nlocks from locks where date_instance_id=inst;
  IF nlocks <> 1 THEN RAISE EXCEPTION 'idempotency created % locks', nlocks; END IF;
  RAISE NOTICE 'accept idempotent OK';
  ROLLBACK;
END $$;
```

```bash
# supabase/tests/p5_race_two_accepts.sh
#!/usr/bin/env bash
# Two clients accept the SAME offer simultaneously. Exactly one lock; the other gets OFFER_NOT_ACTIVE.
set -euo pipefail
source "$(dirname "$0")/p5_concurrency_lib.sh"
PSQL() { psql "$DB" -v ON_ERROR_STOP=1 -t -A; }
# Seed (committed, so both sessions see it):
psql "$DB" -v ON_ERROR_STOP=1 <<'SQL'
select p5_fixture_reset();
do $$ declare cre uuid; c1 uuid; inst uuid; oid uuid;
begin
  select id into cre from profiles where email='p5_creator@test.local';
  select id into c1 from profiles where email='p5_cand1@test.local';
  select id into inst from date_instances where creator_id=cre limit 1;
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1); perform match_set_rank(cre,inst,c1,1);
  oid := match_make_offer(cre,inst,c1);
  insert into temp_race(k,v) values ('oid',oid::text),('c1',c1::text)
  on conflict (k) do update set v=excluded.v;
end $$;
SQL
# (temp_race is a tiny created-if-not-exists table the harness uses to pass ids between shells.)
OID=$(psql "$DB" -t -A -c "select v from temp_race where k='oid'")
C1=$(psql "$DB" -t -A -c "select v from temp_race where k='c1'")
cat > /tmp/p5_acc_a.sql <<SQL
select match_accept_offer('$C1','$OID','race-a');
SQL
cat > /tmp/p5_acc_b.sql <<SQL
select match_accept_offer('$C1','$OID','race-b');
SQL
PA=$(psql_bg /tmp/p5_acc_a.sql /tmp/p5_acc_a.out)
PB=$(psql_bg /tmp/p5_acc_b.sql /tmp/p5_acc_b.out)
wait $PA $PB || true
# Assert exactly one lock + exactly one error mentioning OFFER_NOT_ACTIVE
N=$(psql "$DB" -t -A -c "select count(*) from locks l join offers o on o.id='$OID' where l.date_instance_id=o.date_instance_id")
ERR=$(cat /tmp/p5_acc_a.out /tmp/p5_acc_b.out | grep -c 'OFFER_NOT_ACTIVE' || true)
if [ "$N" != "1" ] || [ "$ERR" != "1" ]; then
  echo "FAIL: locks=$N offer_not_active_errors=$ERR"; cat /tmp/p5_acc_*.out; exit 1
fi
echo "PASS: two-accept race → 1 lock, 1 OFFER_NOT_ACTIVE"
```

- [ ] **Step 2: Run all three, expect FAIL** (`function match_accept_offer(...) does not exist`). For the `.sh`, also create the tiny `temp_race(k text primary key, v text)` table in `p5_helpers.sql` (`create table if not exists temp_race(...)`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130500_p5_accept_lock.sql
create or replace function match_accept_offer(p_actor uuid, p_offer_id uuid, p_idem_key text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare prior jsonb; inst uuid; cre uuid; cand uuid; ostatus offer_status; rng tstzrange; lid uuid; result jsonb;
begin
  -- idempotency replay (outside the lock is fine; the row only appears after a committed success)
  prior := match_idem_lookup(p_actor, 'accept_offer', p_idem_key);
  if prior is not null then return prior; end if;

  -- load offer + serialize on its instance
  select date_instance_id, creator_id, candidate_id, status
    into inst, cre, cand, ostatus
    from offers where id=p_offer_id;
  if inst is null then raise exception 'NO_OFFER'; end if;
  if cand <> p_actor then raise exception 'NOT_OFFER_HOLDER'; end if;

  perform pg_advisory_xact_lock(match_instance_lock_key(inst));

  -- re-read under lock
  select status into ostatus from offers where id=p_offer_id for update;
  if ostatus <> 'active' then raise exception 'OFFER_NOT_ACTIVE'; end if;

  select time_range into rng from date_instances where id=inst for update;

  -- create the lock; P0 trigger writes lock_participants; GiST exclusion enforces no-overlap.
  begin
    insert into locks(date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, cand, 'active') returning id into lid;
  exception
    when exclusion_violation then raise exception 'DOUBLE_BOOKED';
    when unique_violation then raise exception 'ALREADY_LOCKED';   -- locks.date_instance_id unique
  end;

  -- resolve offer + queue
  update offers set status='accepted', resolved_at=now() where id=p_offer_id;
  update queue_entries set status='locked' where date_instance_id=inst and candidate_id=cand;
  update date_instances set status='matched' where id=inst;

  -- cancel the pending expiry timer (worker will no-op even if it still fires)
  perform cancel_jobs('offer_expiry', 'offer_expiry:'||p_offer_id);

  -- off-market cascade A: creator's OTHER overlapping scheduled instances auto-close
  perform match_autoclose_creator_conflicts(cre, inst, rng);
  -- off-market cascade B: matched user auto-withdrawn from conflicting offers/standbys (throttled in Task 6)
  perform match_autowithdraw_user_conflicts(cand, rng, inst);

  perform notify(cand, 'locked', jsonb_build_object('instance', inst, 'lock_id', lid));
  perform notify(cre,  'locked', jsonb_build_object('instance', inst, 'lock_id', lid));

  result := jsonb_build_object('lock_id', lid, 'instance', inst, 'status','locked');
  perform match_idem_store(p_actor, 'accept_offer', p_idem_key, result);
  return result;
end $fn$;

-- Creator's other scheduled instances that overlap the locked window auto-close (spec §7.4).
create or replace function match_autoclose_creator_conflicts(p_creator uuid, p_keep_instance uuid, p_rng tstzrange)
returns int language plpgsql security definer set search_path=public as $fn$
declare n int;
begin
  update date_instances
     set status='cancelled'
   where creator_id=p_creator and id<>p_keep_instance
     and status='seeking' and time_range && p_rng;
  get diagnostics n = row_count;
  -- any active offers on those now-closed instances are expired (their holders auto-roll elsewhere is N/A)
  update offers set status='expired', resolved_at=now()
   where status='active' and date_instance_id in (
     select id from date_instances where creator_id=p_creator and status='cancelled' and time_range && p_rng
   );
  return n;
end $fn$;
```

> `match_autowithdraw_user_conflicts` is **defined in Task 6** alongside the throttle (it withdraws the matched user from *other* creators' queues without collapsing them). Task 5's migration references it; order Task 6's migration timestamp **before** Task 5's? No — Postgres resolves function bodies at call time, not creation time, so the forward reference is fine as long as both migrations are applied before any call. They are (both run in `db reset`). The test in Task 5 does not create cross-creator conflicts, so it never calls the Task-6 function.

- [ ] **Step 4: Apply + run the two `.sql` tests, expect PASS.** Then run the race test:
`chmod +x supabase/tests/p5_race_two_accepts.sh && supabase db reset && supabase/tests/p5_race_two_accepts.sh` → expect `PASS: two-accept race → 1 lock, 1 OFFER_NOT_ACTIVE`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130500_p5_accept_lock.sql supabase/tests/p5_accept_lock.sql supabase/tests/p5_accept_idempotent.sql supabase/tests/p5_race_two_accepts.sh
git commit -m "P5: accept_offer→lock (advisory + GiST no-overlap + off-market cascade + idempotent) with two-accept race test"
```

---

## Task 6: `pass`/`expire` → auto-roll to next standby, with the cascade-withdrawal throttle

**Files:**
- Create: `supabase/migrations/20260525130600_p5_pass_expire_roll.sql`
- Test: `supabase/tests/p5_pass_roll.sql`
- Test: `supabase/tests/p5_cascade_throttle.sql`
- Test: `supabase/tests/p5_race_expiry_vs_accept.sh`

### Design decisions locked (spec §7.3, §7.6; audit "cascading auto-withdrawals")
- **`match_pass_offer(actor, offer_id)`** (the offer-holder declines) and **`match_expire_offer(offer_id)`** (the P2 worker calls this when the timer fires) share one private `match_resolve_offer_negative(offer_id, terminal_status)` that, under the instance advisory lock: re-reads the offer, **no-ops if already resolved** (idempotent against double-fire), sets the offer + queue entry to `offer_passed`/`offer_expired`, moves the candidate to `standby`, then calls `match_auto_roll(instance)`.
- **`match_auto_roll(instance)`** picks `match_next_standby` (lowest-rank shortlisted), and if present, makes them the new offer (same advisory lock context, so it's atomic with the resolution). If none, the instance stays `seeking` with no active offer.
- **Offer-expiry-vs-accept race:** both `match_accept_offer` and `match_expire_offer` take the instance advisory lock and re-read `offer.status` under it. Whichever wins the lock first commits its terminal state; the loser sees a non-`active` offer and no-ops (expire) / raises `OFFER_NOT_ACTIVE` (accept). **No lost lock, no double-roll.** Even if the P2 worker fires the stale timer after an accept, `match_expire_offer` finds `status='accepted'` and returns 0 (guarded no-op).
- **Cascade-withdrawal throttle (the core fix for "cascading auto-withdrawals collapse other queues"):** when a user locks date X, they are auto-withdrawn from conflicting offers/standbys on *other* instances. Naively this could (a) free up the #1 slot on another creator's date and trigger that date's auto-roll, which locks someone, who is then withdrawn elsewhere, … a chain. The throttle:
  1. **Withdrawal is per-window, not global:** a user is only auto-withdrawn from offers/standbys whose `time_range` **overlaps** the newly-locked window. Non-overlapping commitments are untouched.
  2. **Auto-roll is deferred, not synchronous:** when an auto-withdrawal vacates an `offer_active` slot on another instance, we **do not** roll inline. We `enqueue('auto_roll', now(), {instance}, dedupe_key='auto_roll:'||instance)` so the roll happens as a separate, rate-limitable job. This breaks the synchronous chain into discrete, throttleable steps and bounds fan-out per transaction.
  3. **Per-actor withdrawal cap:** a single lock transaction withdraws the user from at most `K` (default 25) conflicting entries; beyond that it enqueues a `bulk_withdraw` job (P2) to finish asynchronously, so one popular user locking a night cannot do unbounded work in one transaction.
- **`match_autowithdraw_user_conflicts(user, rng, keep_instance)`** implements 1–3: it withdraws the user (status→`standby`→removed from active offer if any) from overlapping commitments, enqueues a deferred `auto_roll` for each vacated offer slot, and respects the cap.

- [ ] **Step 1: Write the failing tests**

```sql
-- supabase/tests/p5_pass_roll.sql
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; inst uuid; oid uuid; newoid uuid;
BEGIN
  PERFORM p5_fixture_reset();
  select id into cre from profiles where email='p5_creator@test.local';
  select id into c1 from profiles where email='p5_cand1@test.local';
  select id into c2 from profiles where email='p5_cand2@test.local';
  select id into inst from date_instances where creator_id=cre limit 1;
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1); perform match_set_rank(cre,inst,c1,1);
  perform match_shortlist(cre,inst,c2); perform match_set_rank(cre,inst,c2,2);
  oid := match_make_offer(cre, inst, c1);

  -- c1 passes → c1 to standby/offer_passed, auto-roll makes a NEW offer to c2
  perform match_pass_offer(c1, oid);
  PERFORM 1 FROM offers WHERE id=oid AND status='passed';
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not passed'; END IF;
  select id into newoid from offers where date_instance_id=inst and status='active';
  IF newoid IS NULL THEN RAISE EXCEPTION 'auto-roll did not create new offer'; END IF;
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=c2 AND status='offer_active';
  IF NOT FOUND THEN RAISE EXCEPTION 'c2 not rolled to offer_active'; END IF;
  -- c1 reveal auto-revoked (no longer active holder)
  IF match_reveal_allowed(c1, inst) THEN RAISE EXCEPTION 'LEAK: passed holder still revealed'; END IF;

  -- expire is idempotent: expiring an already-passed offer no-ops
  IF match_expire_offer(oid) <> 0 THEN RAISE EXCEPTION 'expire of resolved offer did work'; END IF;
  RAISE NOTICE 'pass→auto-roll OK';
  ROLLBACK;
END $$;
```

```sql
-- supabase/tests/p5_cascade_throttle.sql
-- Two creators, one user who is offer_active on BOTH overlapping nights; locking one must
-- (a) withdraw the user from the other overlapping offer, (b) DEFER that date's roll to a job,
-- not roll inline (no synchronous cascade).
DO $$
DECLARE creA uuid; creB uuid; u uuid; instA uuid; instB uuid; oidA uuid; oidB uuid; itB uuid; cid uuid; jrolls int;
BEGIN
  PERFORM p5_fixture_reset();
  select id into creA from profiles where email='p5_creator@test.local';
  select id into u    from profiles where email='p5_cand1@test.local';
  select id into creB from profiles where email='p5_cand2@test.local'; -- reuse as a 2nd creator
  select id into cid from cities where slug='kelowna';
  select id into instA from date_instances where creator_id=creA limit 1;
  -- creB owns an overlapping instance, u is interested+shortlisted on both
  insert into itineraries(id,user_id,is_evergreen) values (gen_random_uuid(),creB,false) returning id into itB;
  insert into date_instances(itinerary_id,creator_id,city_id,starts_at,duration_min,status)
    select itB,creB,cid,(select starts_at from date_instances where id=instA),120,'seeking' returning id into instB;
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values
    (u,instA,creA,'right'),(u,instB,creB,'right');
  perform match_ingest_interest(instA); perform match_ingest_interest(instB);
  perform match_shortlist(creA,instA,u); perform match_set_rank(creA,instA,u,1);
  perform match_shortlist(creB,instB,u); perform match_set_rank(creB,instB,u,1);
  oidA := match_make_offer(creA, instA, u);
  oidB := match_make_offer(creB, instB, u);   -- allowed: offer != lock; double-booking only forbidden at lock

  -- u locks A → must auto-withdraw from B's offer AND defer B's roll to a job (not inline)
  perform match_accept_offer(u, oidA, 'cascade-1');
  PERFORM 1 FROM offers WHERE id=oidB AND status IN ('passed','expired');  -- B's offer to u withdrawn
  IF NOT FOUND THEN RAISE EXCEPTION 'B offer to u not withdrawn'; END IF;
  -- B's roll is DEFERRED: a job exists, but B has no NEW active offer created inline
  select count(*) into jrolls from jobs where kind='auto_roll' and dedupe_key='auto_roll:'||instB and status='pending';
  IF jrolls <> 1 THEN RAISE EXCEPTION 'B roll not deferred to a job (%).', jrolls; END IF;
  PERFORM 1 FROM offers WHERE date_instance_id=instB AND status='active';
  IF FOUND THEN RAISE EXCEPTION 'CASCADE: B rolled inline instead of via deferred job'; END IF;
  RAISE NOTICE 'cascade throttle OK';
  ROLLBACK;
END $$;
```

```bash
# supabase/tests/p5_race_expiry_vs_accept.sh
#!/usr/bin/env bash
# Offer-expiry worker fires AT THE SAME TIME as the holder accepts. Exactly one wins:
# either lock created (accept won) OR offer expired+rolled (expire won) — never both, never neither.
set -euo pipefail
source "$(dirname "$0")/p5_concurrency_lib.sh"
psql "$DB" -v ON_ERROR_STOP=1 <<'SQL'
select p5_fixture_reset();
do $$ declare cre uuid; c1 uuid; c2 uuid; inst uuid; oid uuid;
begin
  select id into cre from profiles where email='p5_creator@test.local';
  select id into c1 from profiles where email='p5_cand1@test.local';
  select id into c2 from profiles where email='p5_cand2@test.local';
  select id into inst from date_instances where creator_id=cre limit 1;
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1); perform match_set_rank(cre,inst,c1,1);
  perform match_shortlist(cre,inst,c2); perform match_set_rank(cre,inst,c2,2);
  oid := match_make_offer(cre,inst,c1);
  insert into temp_race(k,v) values ('oid',oid::text),('c1',c1::text) on conflict (k) do update set v=excluded.v;
end $$;
SQL
OID=$(psql "$DB" -t -A -c "select v from temp_race where k='oid'")
C1=$(psql "$DB" -t -A -c "select v from temp_race where k='c1'")
echo "select match_accept_offer('$C1','$OID','race-acc');" > /tmp/p5_ax.sql
echo "select match_expire_offer('$OID');"                  > /tmp/p5_ex.sql
PA=$(psql_bg /tmp/p5_ax.sql /tmp/p5_ax.out)
PB=$(psql_bg /tmp/p5_ex.sql /tmp/p5_ex.out)
wait $PA $PB || true
LOCKED=$(psql "$DB" -t -A -c "select count(*) from locks where date_instance_id=(select date_instance_id from offers where id='$OID')")
OSTATUS=$(psql "$DB" -t -A -c "select status from offers where id='$OID'")
# Exactly one outcome holds:
if { [ "$LOCKED" = "1" ] && [ "$OSTATUS" = "accepted" ]; } || { [ "$LOCKED" = "0" ] && [ "$OSTATUS" = "expired" ]; }; then
  echo "PASS: expiry-vs-accept consistent (locked=$LOCKED, offer=$OSTATUS)"
else
  echo "FAIL: inconsistent (locked=$LOCKED, offer=$OSTATUS)"; cat /tmp/p5_ax.out /tmp/p5_ex.out; exit 1
fi
```

- [ ] **Step 2: Run all, expect FAIL** (`function match_pass_offer(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130600_p5_pass_expire_roll.sql

-- Private: resolve an active offer to a terminal negative state, then auto-roll. Idempotent.
create or replace function match_resolve_offer_negative(p_offer_id uuid, p_terminal offer_status)
returns int language plpgsql security definer set search_path=public as $fn$
declare inst uuid; cand uuid; ostatus offer_status;
begin
  select date_instance_id, candidate_id, status into inst, cand, ostatus from offers where id=p_offer_id;
  if inst is null then return 0; end if;
  perform pg_advisory_xact_lock(match_instance_lock_key(inst));
  -- re-read under lock; no-op if already resolved (handles double-fire / expiry-after-accept)
  select status into ostatus from offers where id=p_offer_id for update;
  if ostatus <> 'active' then return 0; end if;

  update offers set status=p_terminal, resolved_at=now() where id=p_offer_id;
  update queue_entries
     set status = case when p_terminal='passed' then 'offer_passed'::queue_status
                       else 'offer_expired'::queue_status end
   where date_instance_id=inst and candidate_id=cand;
  -- candidate goes to standby (eligible for future rolls) per spec §7.1
  update queue_entries set status='standby' where date_instance_id=inst and candidate_id=cand;
  perform cancel_jobs('offer_expiry', 'offer_expiry:'||p_offer_id);

  perform match_auto_roll(inst);   -- inline roll for the instance that just freed up (single instance, no cascade)
  return 1;
end $fn$;

-- Offer-holder declines.
create or replace function match_pass_offer(p_actor uuid, p_offer_id uuid)
returns int language plpgsql security definer set search_path=public as $fn$
declare cand uuid;
begin
  select candidate_id into cand from offers where id=p_offer_id;
  if cand is null then raise exception 'NO_OFFER'; end if;
  if cand <> p_actor then raise exception 'NOT_OFFER_HOLDER'; end if;
  perform notify((select creator_id from offers where id=p_offer_id), 'offer_passed',
                 jsonb_build_object('offer', p_offer_id));
  return match_resolve_offer_negative(p_offer_id, 'passed');
end $fn$;

-- P2 worker calls this when the offer_expiry timer fires. Idempotent no-op if already resolved.
create or replace function match_expire_offer(p_offer_id uuid)
returns int language plpgsql security definer set search_path=public as $fn$
begin
  return match_resolve_offer_negative(p_offer_id, 'expired');
end $fn$;

-- Promote the next standby to a fresh offer. Single-instance; caller holds/takes the advisory lock.
create or replace function match_auto_roll(p_instance uuid)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare nxt uuid; cre uuid; st date_match_status; oid uuid; cutoff timestamptz;
begin
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));
  select creator_id, status, starts_at into cre, st, cutoff from date_instances where id=p_instance for update;
  if st <> 'seeking' then return null; end if;                 -- already matched/cancelled
  if exists (select 1 from offers where date_instance_id=p_instance and status='active') then return null; end if;
  -- freeze rollover within the cutoff window before the night (spec §7.6)
  if cutoff < now() + interval '2 hours' then return null; end if;
  -- freeze entirely if any safety report exists on this instance/pair (spec §7.6)
  if exists (select 1 from reports where target_type='date_instance' and target_id=p_instance and status<>'dismissed') then
    return null;
  end if;

  -- promote next standby back to shortlisted then offer them
  nxt := match_next_standby(p_instance);
  if nxt is null then
    -- also consider candidates parked in 'standby' (from prior passes), lowest rank first
    select candidate_id into nxt from queue_entries
      where date_instance_id=p_instance and status='standby'
      order by rank nulls last, created_at limit 1;
  end if;
  if nxt is null then return null; end if;
  update queue_entries set status='shortlisted' where date_instance_id=p_instance and candidate_id=nxt;
  oid := match_make_offer(cre, p_instance, nxt);   -- reuses single-offer guard + expiry enqueue
  return oid;
end $fn$;

-- Throttled cross-instance withdrawal (called by accept). DEFERS other instances' rolls to jobs.
create or replace function match_autowithdraw_user_conflicts(p_user uuid, p_rng tstzrange, p_keep_instance uuid)
returns int language plpgsql security definer set search_path=public as $fn$
declare rec record; withdrawn int := 0; cap int := 25;
begin
  for rec in
    select o.id as offer_id, o.date_instance_id as inst
      from offers o join date_instances di on di.id=o.date_instance_id
     where o.candidate_id=p_user and o.status='active'
       and o.date_instance_id<>p_keep_instance
       and di.time_range && p_rng                       -- per-window only (throttle #1)
     order by o.created_at
  loop
    exit when withdrawn >= cap;                          -- per-actor cap (throttle #3)
    -- withdraw the user from this conflicting OFFER, but DO NOT roll inline (throttle #2)
    update offers set status='expired', resolved_at=now() where id=rec.offer_id and status='active';
    update queue_entries set status='standby' where date_instance_id=rec.inst and candidate_id=p_user;
    perform cancel_jobs('offer_expiry', 'offer_expiry:'||rec.offer_id);
    perform enqueue('auto_roll', now(), jsonb_build_object('instance', rec.inst), 'auto_roll:'||rec.inst);
    perform notify((select creator_id from date_instances where id=rec.inst), 'candidate_withdrawn',
                   jsonb_build_object('instance', rec.inst, 'user', p_user));
    withdrawn := withdrawn + 1;
  end loop;
  -- also drop the user from overlapping standbys (no active offer to roll), throttled by the same cap
  update queue_entries q set status='offer_passed'
   from date_instances di
   where q.date_instance_id=di.id and q.candidate_id=p_user
     and q.status in ('shortlisted','standby') and di.time_range && p_rng
     and di.id<>p_keep_instance;
  if withdrawn >= cap then
    perform enqueue('bulk_withdraw', now(), jsonb_build_object('user',p_user,'window',jsonb_build_object('range',p_rng::text)), null);
  end if;
  return withdrawn;
end $fn$;
```

> **Note on `match_auto_roll` calling `match_make_offer`:** both take the same instance advisory lock; `pg_advisory_xact_lock` is re-entrant within a transaction (a session can re-acquire a lock it already holds), so the nested acquisition is safe and the whole roll is atomic.

- [ ] **Step 4: Apply + run the two `.sql` tests, expect PASS.** Then the race test:
`chmod +x supabase/tests/p5_race_expiry_vs_accept.sh && supabase db reset && supabase/tests/p5_race_expiry_vs_accept.sh` → expect `PASS: expiry-vs-accept consistent`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130600_p5_pass_expire_roll.sql supabase/tests/p5_pass_roll.sql supabase/tests/p5_cascade_throttle.sql supabase/tests/p5_race_expiry_vs_accept.sh
git commit -m "P5: pass/expire→auto-roll, cutoff/report rollover freeze, cascade-withdrawal throttle, expiry-vs-accept race test"
```

---

## Task 7: Reciprocal-pair detection → single chooser

**Files:**
- Create: `supabase/migrations/20260525130700_p5_reciprocal.sql`
- Test: `supabase/tests/p5_reciprocal.sql`

### Design decisions locked (spec §7.5)
- **Detection:** A reciprocal pair exists when A is `shortlisted`/`offer_active` on one of B's instances **and** B is `shortlisted`/`offer_active` on one of A's instances (i.e., each likes the other's night and each got far enough to be a real candidate, not merely browsed). We detect at shortlist/offer time via `match_detect_reciprocal(userX, userY)`; if found, we record one `reciprocal_pairs` row keyed by the canonical user-pair (uses `match_pair_lock_key`-style canonical ordering: `low_user`, `high_user`).
- **Chooser, not double-lock:** the pair gets **one** chooser. `match_resolve_reciprocal(actor, pair_id, chosen_instance, idem_key)` (idempotent) locks the chosen instance via the normal `match_accept_offer` path (creating an offer if needed for the chosen night, then accepting) and **closes the other side** so the same two people can't also lock the competing night. Both must be parties to the pair; the chosen instance must belong to one of them; the other instance is taken off the table (its queue entries for this pair resolved).
- **Advisory lock on the canonical pair** (`pg_advisory_xact_lock(match_pair_lock_key(low,high))`) serializes the chooser so two near-simultaneous resolutions can't both lock.
- **No duplicate competing matches:** after resolution the losing instance's cross-pair candidacy is closed; the GiST exclusion still independently prevents the pair from double-booking overlapping windows.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p5_reciprocal.sql
DO $$
DECLARE A uuid; B uuid; cid uuid; itA uuid; itB uuid; instA uuid; instB uuid; pair uuid; r jsonb; lid uuid;
BEGIN
  PERFORM p5_fixture_reset();
  select id into A from profiles where email='p5_creator@test.local';  -- A is creator of seeded instA
  select id into B from profiles where email='p5_cand1@test.local';
  select id into cid from cities where slug='kelowna';
  select id into instA from date_instances where creator_id=A limit 1;
  -- B owns an instance too; A likes B's night, B likes A's night
  insert into itineraries(id,user_id,is_evergreen) values (gen_random_uuid(),B,false) returning id into itB;
  insert into date_instances(itinerary_id,creator_id,city_id,starts_at,duration_min,status)
    values (itB,B,cid, now()+interval '5 days',120,'seeking') returning id into instB;
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values
    (B,instA,A,'right'),     -- B likes A's night
    (A,instB,B,'right');     -- A likes B's night
  perform match_ingest_interest(instA); perform match_ingest_interest(instB);
  perform match_shortlist(A,instA,B);   -- A shortlists B on A's night
  perform match_shortlist(B,instB,A);   -- B shortlists A on B's night → reciprocal!

  select id into pair from reciprocal_pairs
    where low_user=least(A,B) and high_user=greatest(A,B);
  IF pair IS NULL THEN RAISE EXCEPTION 'reciprocal pair not detected'; END IF;

  -- A resolves the chooser by picking A's night (instA)
  r := match_resolve_reciprocal(A, pair, instA, 'recip-1');
  lid := (r->>'lock_id')::uuid;
  PERFORM 1 FROM locks WHERE id=lid AND status='active'
    AND ((creator_id=A AND matched_user_id=B) OR (creator_id=B AND matched_user_id=A));
  IF NOT FOUND THEN RAISE EXCEPTION 'chooser did not lock chosen night'; END IF;
  -- the other night (instB) is closed for THIS pair (no competing active offer to this pair)
  PERFORM 1 FROM offers WHERE date_instance_id=instB AND candidate_id IN (A,B) AND status='active';
  IF FOUND THEN RAISE EXCEPTION 'competing offer still active on losing night'; END IF;

  -- idempotent resolve
  IF (match_resolve_reciprocal(A, pair, instA, 'recip-1')->>'lock_id') <> lid::text
    THEN RAISE EXCEPTION 'reciprocal resolve not idempotent'; END IF;
  RAISE NOTICE 'reciprocal OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "reciprocal_pairs" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130700_p5_reciprocal.sql
create table if not exists reciprocal_pairs (
  id uuid primary key default gen_random_uuid(),
  low_user uuid not null references profiles(id) on delete cascade,
  high_user uuid not null references profiles(id) on delete cascade,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (low_user < high_user),
  unique (low_user, high_user)
);
alter table reciprocal_pairs enable row level security;
do $$ begin
  create policy "reciprocal_party_read" on reciprocal_pairs for select
    using (low_user = auth.uid() or high_user = auth.uid());
exception when duplicate_object then null; end $$;

-- Detect: both users are real candidates (shortlisted/offer_active) on each other's instances.
create or replace function match_detect_reciprocal(p_x uuid, p_y uuid)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare lo uuid := least(p_x,p_y); hi uuid := greatest(p_x,p_y); pid uuid;
begin
  if not exists (
    -- x is candidate on one of y's nights AND y is candidate on one of x's nights
    select 1 from queue_entries qx join date_instances dx on dx.id=qx.date_instance_id
     where qx.candidate_id=p_x and dx.creator_id=p_y and qx.status in ('shortlisted','offer_active')
  ) or not exists (
    select 1 from queue_entries qy join date_instances dy on dy.id=qy.date_instance_id
     where qy.candidate_id=p_y and dy.creator_id=p_x and qy.status in ('shortlisted','offer_active')
  ) then
    return null;
  end if;
  insert into reciprocal_pairs(low_user, high_user) values (lo, hi)
    on conflict (low_user, high_user) do nothing
    returning id into pid;
  if pid is null then select id into pid from reciprocal_pairs where low_user=lo and high_user=hi; end if;
  perform notify(lo, 'reciprocal_detected', jsonb_build_object('pair', pid));
  perform notify(hi, 'reciprocal_detected', jsonb_build_object('pair', pid));
  return pid;
end $fn$;

-- Hook detection into shortlist: after a creator shortlists a candidate, check reciprocity.
create or replace function match_shortlist_with_reciprocal(p_actor uuid, p_instance uuid, p_candidate uuid)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare cre uuid;
begin
  perform match_shortlist(p_actor, p_instance, p_candidate);
  select creator_id into cre from date_instances where id=p_instance;
  return match_detect_reciprocal(cre, p_candidate);
end $fn$;

-- Resolve the chooser: lock the chosen instance; close the competing side for this pair. Idempotent.
create or replace function match_resolve_reciprocal(p_actor uuid, p_pair uuid, p_chosen_instance uuid, p_idem_key text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare lo uuid; hi uuid; pstatus text; prior jsonb; cre uuid; cand uuid; oid uuid; r jsonb;
begin
  prior := match_idem_lookup(p_actor, 'resolve_reciprocal', p_idem_key);
  if prior is not null then return prior; end if;

  select low_user, high_user, status into lo, hi, pstatus from reciprocal_pairs where id=p_pair;
  if lo is null then raise exception 'NO_PAIR'; end if;
  if p_actor not in (lo,hi) then raise exception 'NOT_PARTY'; end if;

  perform pg_advisory_xact_lock(match_pair_lock_key(lo,hi));
  select status into pstatus from reciprocal_pairs where id=p_pair for update;
  if pstatus='resolved' then  -- another concurrent resolve won; replay its stored result
    r := match_idem_lookup(p_actor,'resolve_reciprocal',p_idem_key);
    if r is not null then return r; end if;
    raise exception 'PAIR_ALREADY_RESOLVED';
  end if;

  -- the chosen instance must belong to one of the pair; the other party is the candidate
  select creator_id into cre from date_instances where id=p_chosen_instance;
  if cre is null or cre not in (lo,hi) then raise exception 'CHOSEN_NOT_OWNED_BY_PAIR'; end if;
  cand := case when cre=lo then hi else lo end;

  -- ensure an active offer to the candidate exists on the chosen night (create if needed)
  select id into oid from offers where date_instance_id=p_chosen_instance and candidate_id=cand and status='active';
  if oid is null then
    -- make sure candidate is shortlisted on the chosen night, then offer
    update queue_entries set status='shortlisted'
      where date_instance_id=p_chosen_instance and candidate_id=cand and status in ('interested','standby');
    if not exists (select 1 from queue_entries where date_instance_id=p_chosen_instance and candidate_id=cand) then
      insert into queue_entries(date_instance_id,candidate_id,creator_id,status)
      values (p_chosen_instance, cand, cre, 'shortlisted');
    end if;
    oid := match_make_offer(cre, p_chosen_instance, cand);
  end if;

  -- accept it (reuses the full lock path: advisory + GiST no-overlap + off-market + cascade)
  r := match_accept_offer(cand, oid, 'recip:'||p_pair::text);

  -- close the competing side: expire any active offers between this pair on OTHER instances
  update offers o set status='expired', resolved_at=now()
    from date_instances di
   where o.date_instance_id=di.id and o.status='active'
     and o.date_instance_id<>p_chosen_instance
     and ((di.creator_id=lo and o.candidate_id=hi) or (di.creator_id=hi and o.candidate_id=lo));

  update reciprocal_pairs set status='resolved', resolved_at=now() where id=p_pair;
  perform match_idem_store(p_actor, 'resolve_reciprocal', p_idem_key, r);
  return r;
end $fn$;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130700_p5_reciprocal.sql supabase/tests/p5_reciprocal.sql
git commit -m "P5: reciprocal-pair detection + idempotent chooser (locks chosen night, closes competing side)"
```

---

## Task 8: `cancel_lock(reason)` → SAFE auto-roll (benign only, reconfirm, freeze near cutoff / after report)

**Files:**
- Create: `supabase/migrations/20260525130800_p5_cancel_safe_roll.sql`
- Test: `supabase/tests/p5_cancel_safe_roll.sql`
- Test: `supabase/tests/p5_cancel_freeze.sql`

### Design decisions locked (spec §7.6)
- **Reason-coded** (reuses P0 `cancel_reason` enum: `schedule_conflict|venue_issue|changed_mind|safety|misconduct|other`). `match_cancel_lock(actor, lock_id, reason, idem_key)` (idempotent) must be a party to the lock.
- **Cancel always succeeds** (you can always get out of a date); what differs is the **aftermath**:
  - Set `locks.status='cancelled'`, `cancelled_by`, `cancel_reason`. The P0 `sync_lock_participants` trigger flips `lock_participants.active=false` → the user's window frees up (the GiST exclusion no longer blocks them).
  - Re-open the instance (`date_instances.status='seeking'`) **only for benign reasons** AND **only if outside the cutoff window** AND **only if no safety report** exists. Then **safe auto-roll**: instead of silently offering the next standby, we **reconfirm both** — set the next standby to a `pending_reconfirm` state and notify both the creator and the candidate; the actual offer is created only after both reconfirm (modeled as enqueued reconfirmation jobs + a `match_reconfirm` function).
  - For **non-benign reasons** (`safety`, `misconduct`) OR within the cutoff OR if any safety report exists: **freeze rollover** — the instance goes to `cancelled` (not re-seeking), no auto-roll, and a moderation `report`/flag path is left to P7/P8. The pair's other in-flight states between these two users are also frozen.
- **Reconfirmation** (`match_reconfirm(actor, instance, idem_key)`): records each party's reconfirm; when both have reconfirmed, calls `match_auto_roll` (which re-applies the cutoff/report freeze guards as a final backstop). This prevents a roll into someone who has gone cold or a creator who has moved on.

- [ ] **Step 1: Write the failing tests**

```sql
-- supabase/tests/p5_cancel_safe_roll.sql  (benign reason → re-seek + reconfirm flow)
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; inst uuid; oid uuid; r jsonb; lid uuid; st date_match_status;
BEGIN
  PERFORM p5_fixture_reset();
  select id into cre from profiles where email='p5_creator@test.local';
  select id into c1 from profiles where email='p5_cand1@test.local';
  select id into c2 from profiles where email='p5_cand2@test.local';
  select id into inst from date_instances where creator_id=cre limit 1;
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1); perform match_set_rank(cre,inst,c1,1);
  perform match_shortlist(cre,inst,c2); perform match_set_rank(cre,inst,c2,2);
  oid := match_make_offer(cre, inst, c1);
  r := match_accept_offer(c1, oid, 'pre-cancel'); lid := (r->>'lock_id')::uuid;

  -- benign cancel by creator → instance re-seeks, c1's window freed, reconfirm requested (NO inline new offer yet)
  perform match_cancel_lock(cre, lid, 'schedule_conflict', 'cancel-1');
  PERFORM 1 FROM locks WHERE id=lid AND status='cancelled' AND cancel_reason='schedule_conflict';
  IF NOT FOUND THEN RAISE EXCEPTION 'lock not cancelled'; END IF;
  PERFORM 1 FROM lock_participants WHERE lock_id=lid AND active=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'participants not deactivated (window still blocked)'; END IF;
  select status into st from date_instances where id=inst;
  IF st <> 'seeking' THEN RAISE EXCEPTION 'instance did not re-seek (status=%).', st; END IF;
  -- no NEW offer until BOTH reconfirm
  PERFORM 1 FROM offers WHERE date_instance_id=inst AND status='active';
  IF FOUND THEN RAISE EXCEPTION 'rolled inline before reconfirmation'; END IF;
  -- both reconfirm → next standby (c2) gets the offer
  perform match_reconfirm(cre, inst, 'rc-cre');
  perform match_reconfirm(c2,  inst, 'rc-c2');
  PERFORM 1 FROM offers WHERE date_instance_id=inst AND candidate_id=c2 AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'no offer after both reconfirm'; END IF;
  RAISE NOTICE 'cancel→safe-roll OK';
  ROLLBACK;
END $$;
```

```sql
-- supabase/tests/p5_cancel_freeze.sql  (safety reason → freeze, NO roll, instance cancelled)
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; inst uuid; oid uuid; r jsonb; lid uuid; st date_match_status;
BEGIN
  PERFORM p5_fixture_reset();
  select id into cre from profiles where email='p5_creator@test.local';
  select id into c1 from profiles where email='p5_cand1@test.local';
  select id into c2 from profiles where email='p5_cand2@test.local';
  select id into inst from date_instances where creator_id=cre limit 1;
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1); perform match_set_rank(cre,inst,c1,1);
  perform match_shortlist(cre,inst,c2); perform match_set_rank(cre,inst,c2,2);
  oid := match_make_offer(cre, inst, c1);
  r := match_accept_offer(c1, oid, 'pre-cancel2'); lid := (r->>'lock_id')::uuid;

  -- safety cancel → freeze: instance cancelled, NO re-seek, NO roll
  perform match_cancel_lock(c1, lid, 'safety', 'cancel-safety');
  select status into st from date_instances where id=inst;
  IF st <> 'cancelled' THEN RAISE EXCEPTION 'safety cancel did not freeze instance (status=%).', st; END IF;
  PERFORM 1 FROM offers WHERE date_instance_id=inst AND status='active';
  IF FOUND THEN RAISE EXCEPTION 'FREEZE VIOLATED: rolled after safety cancel'; END IF;
  -- reconfirm must be a no-op after a safety freeze
  IF match_reconfirm(cre, inst, 'rc-x') <> false THEN RAISE EXCEPTION 'reconfirm worked after freeze'; END IF;
  RAISE NOTICE 'cancel freeze OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run both, expect FAIL** (`function match_cancel_lock(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130800_p5_cancel_safe_roll.sql
-- Track per-party reconfirmation after a benign cancel before the seat re-offers.
create table if not exists reconfirmations (
  date_instance_id uuid not null references date_instances(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  reconfirmed_at timestamptz not null default now(),
  primary key (date_instance_id, user_id)
);
alter table reconfirmations enable row level security;
do $$ begin
  create policy "reconfirm_self" on reconfirmations for all
    using (user_id=auth.uid()) with check (user_id=auth.uid());
exception when duplicate_object then null; end $$;

create or replace function match_cancel_lock(p_actor uuid, p_lock_id uuid, p_reason cancel_reason, p_idem_key text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare prior jsonb; inst uuid; cre uuid; cand uuid; nxt uuid; benign boolean; cutoff timestamptz; result jsonb;
begin
  prior := match_idem_lookup(p_actor, 'cancel_lock', p_idem_key);
  if prior is not null then return prior; end if;

  select date_instance_id, creator_id, matched_user_id into inst, cre, cand from locks where id=p_lock_id for update;
  if inst is null then raise exception 'NO_LOCK'; end if;
  if p_actor not in (cre,cand) then raise exception 'NOT_PARTY'; end if;

  perform pg_advisory_xact_lock(match_instance_lock_key(inst));
  select starts_at into cutoff from date_instances where id=inst for update;

  -- cancel the lock (P0 trigger flips lock_participants.active=false → window frees)
  update locks set status='cancelled', cancelled_by=p_actor, cancel_reason=p_reason where id=p_lock_id;
  update queue_entries set status='standby' where date_instance_id=inst and candidate_id=cand;

  benign := p_reason in ('schedule_conflict','venue_issue','changed_mind','other');
  -- freeze conditions (spec §7.6): non-benign, within cutoff, or any safety report on the instance
  if (not benign)
     or (cutoff < now() + interval '2 hours')
     or exists (select 1 from reports where target_type='date_instance' and target_id=inst and status<>'dismissed')
  then
    update date_instances set status='cancelled' where id=inst;     -- freeze: no roll
    perform notify(cre,'lock_cancelled_frozen',jsonb_build_object('instance',inst,'reason',p_reason));
    perform notify(cand,'lock_cancelled_frozen',jsonb_build_object('instance',inst,'reason',p_reason));
    result := jsonb_build_object('instance',inst,'rolled',false,'frozen',true,'reason',p_reason);
    perform match_idem_store(p_actor,'cancel_lock',p_idem_key,result);
    return result;
  end if;

  -- benign + safe: re-seek and request reconfirmation from BOTH before re-offering
  update date_instances set status='seeking' where id=inst;
  delete from reconfirmations where date_instance_id=inst;          -- fresh round
  nxt := match_next_standby(inst);
  if nxt is null then
    select candidate_id into nxt from queue_entries
     where date_instance_id=inst and status='standby' order by rank nulls last, created_at limit 1;
  end if;
  if nxt is not null then
    perform notify(cre, 'reconfirm_requested', jsonb_build_object('instance',inst));
    perform notify(nxt, 'reconfirm_requested', jsonb_build_object('instance',inst));
    -- timers so a non-reconfirm expires the re-seek (P2)
    perform enqueue('reconfirm_timeout', now()+interval '24 hours', jsonb_build_object('instance',inst), 'reconfirm_timeout:'||inst);
  end if;
  result := jsonb_build_object('instance',inst,'rolled',false,'awaiting_reconfirm',true,'next',nxt);
  perform match_idem_store(p_actor,'cancel_lock',p_idem_key,result);
  return result;
end $fn$;

-- Each party reconfirms; when both have (creator + next standby), perform the safe roll.
create or replace function match_reconfirm(p_actor uuid, p_instance uuid, p_idem_key text)
returns boolean language plpgsql security definer set search_path=public as $fn$
declare cre uuid; nxt uuid; st date_match_status; both boolean;
begin
  if match_idem_lookup(p_actor,'reconfirm',p_idem_key) is not null then return true; end if;
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));
  select creator_id, status into cre, st from date_instances where id=p_instance for update;
  if st <> 'seeking' then return false; end if;   -- frozen/matched/cancelled → reconfirm is a no-op
  nxt := match_next_standby(p_instance);
  if nxt is null then
    select candidate_id into nxt from queue_entries
      where date_instance_id=p_instance and status='standby' order by rank nulls last, created_at limit 1;
  end if;
  if p_actor not in (cre, nxt) then raise exception 'NOT_RECONFIRM_PARTY'; end if;

  insert into reconfirmations(date_instance_id,user_id) values (p_instance, p_actor)
    on conflict do nothing;
  perform match_idem_store(p_actor,'reconfirm',p_idem_key, jsonb_build_object('ok',true));

  both := exists (select 1 from reconfirmations where date_instance_id=p_instance and user_id=cre)
      and nxt is not null
      and exists (select 1 from reconfirmations where date_instance_id=p_instance and user_id=nxt);
  if both then
    -- safe roll: auto_roll re-applies cutoff/report freeze guards as a final backstop
    if nxt is not null then
      update queue_entries set status='shortlisted' where date_instance_id=p_instance and candidate_id=nxt;
    end if;
    perform match_auto_roll(p_instance);
    return true;
  end if;
  return true;
end $fn$;
```

- [ ] **Step 4: Apply + run both tests, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130800_p5_cancel_safe_roll.sql supabase/tests/p5_cancel_safe_roll.sql supabase/tests/p5_cancel_freeze.sql
git commit -m "P5: cancel_lock(reason) — benign safe-roll w/ both-party reconfirm; freeze on safety/cutoff/report"
```

---

## Task 9: Centralized grants + read-side helpers

**Files:**
- Create: `supabase/migrations/20260525130900_p5_grants.sql`

### Why
SECURITY DEFINER functions are `EXECUTE`-able by `public` by default — a security hole. Lock execution down to `authenticated`/`service_role`. Also expose two read helpers the clients (and Edge Functions) need: a candidate's own queue status (no other candidates, no rank leak) and the demand hint, both honoring blindness.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260525130900_p5_grants.sql

-- Lock down every P5 transition function (default-deny then explicit grant).
do $$
declare f text;
begin
  for f in
    select p.oid::regprocedure::text from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname like 'match\_%'        -- match_make_offer, match_accept_offer, ...
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- Candidate-facing read: their own status on an instance + the bucketed demand hint. No rank, no other candidates.
create or replace function match_my_status(p_instance uuid)
returns table(status queue_status, demand text, reveal_allowed boolean)
language sql stable security definer set search_path=public as $fn$
  select q.status, match_demand_hint(p_instance), match_reveal_allowed(auth.uid(), p_instance)
    from queue_entries q
   where q.date_instance_id=p_instance and q.candidate_id=auth.uid()
$fn$;
revoke all on function match_my_status(uuid) from public;
grant execute on function match_my_status(uuid) to authenticated, service_role;
```

- [ ] **Step 2: Apply, expect clean.** Add a quick assertion test inline (optional) confirming `has_function_privilege('public', 'match_make_offer(uuid,uuid,uuid,integer)', 'execute')` is false.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525130900_p5_grants.sql
git commit -m "P5: lock down SECURITY DEFINER fns (revoke public, grant authenticated/service) + candidate read helper"
```

---

## Task 10: Edge Functions (thin transport) + Deno tests

**Files:**
- Create: `supabase/functions/_shared/match.ts`
- Create per action: `supabase/functions/match-shortlist/{index.ts,index.test.ts}`, `match-rank`, `match-make-offer`, `match-accept`, `match-pass`, `match-cancel`, `match-resolve-reciprocal`, `match-demand-hint`.

### Design decisions locked
- **Functions are transport only.** Each: handle `OPTIONS` (CORS), verify the JWT → derive `actor = jwt.sub` (never read actor from the body), validate the body with Zod, call the matching RPC via the service-role client passing `p_actor = actor`, map known SQL errors (`P0001` with our codes) to HTTP status, return JSON. **All business logic stays in SQL.**
- **Idempotency:** `match-accept`, `match-cancel`, `match-resolve-reciprocal` **require** an `Idempotency-Key` header (400 if missing) and pass it as `p_idem_key`.
- **Error mapping** (shared): `OFFER_EXISTS|OFFER_NOT_ACTIVE|ALREADY_LOCKED` → 409; `DOUBLE_BOOKED` → 409; `NOT_CREATOR|NOT_OFFER_HOLDER|NOT_PARTY|NOT_RECONFIRM_PARTY` → 403; `RANK_FROZEN|BLOCKED|INSTANCE_NOT_SEEKING` → 422; `NO_INSTANCE|NO_OFFER|NO_LOCK|NO_PAIR` → 404; unknown → 500.

- [ ] **Step 1: Write the failing test** (start with `match-accept` — the highest-stakes path)

```ts
// supabase/functions/match-accept/index.test.ts
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

const BASE = Deno.env.get("FUNCTIONS_URL") ?? "http://127.0.0.1:54321/functions/v1";

Deno.test("match-accept requires an Idempotency-Key", async () => {
  const res = await fetch(`${BASE}/match-accept`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer <test-jwt>" },
    body: JSON.stringify({ offer_id: "00000000-0000-0000-0000-000000000000" }),
  });
  assertEquals(res.status, 400);
  const j = await res.json();
  assertEquals(j.error, "missing_idempotency_key");
  await res.body?.cancel();
});

Deno.test("match-accept maps OFFER_NOT_ACTIVE to 409", async () => {
  // Seeded via SQL helper before the run; uses a known resolved offer id from env.
  const offer = Deno.env.get("TEST_RESOLVED_OFFER_ID");
  if (!offer) return; // skip if fixture not provisioned
  const res = await fetch(`${BASE}/match-accept`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${Deno.env.get("TEST_CAND_JWT")}`, "idempotency-key": "t1" },
    body: JSON.stringify({ offer_id: offer }),
  });
  assertEquals(res.status, 409);
  await res.body?.cancel();
});
```

- [ ] **Step 2: Run it, expect FAIL** (`connection refused` / 404 — function not written). Run with `supabase start && supabase functions serve match-accept` then `deno test --allow-env --allow-net supabase/functions/match-accept/index.test.ts`.

- [ ] **Step 3: Write `_shared/match.ts` + the function**

```ts
// supabase/functions/_shared/match.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "./cors.ts";

export function svc() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// Verify JWT and return the user id (sub). Throws on missing/invalid.
export async function actorFromJwt(req: Request): Promise<string> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) throw new HttpError(401, "unauthenticated");
  const { data, error } = await svc().auth.getUser(auth.slice(7));
  if (error || !data.user) throw new HttpError(401, "unauthenticated");
  return data.user.id;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

const CODE_TO_STATUS: Record<string, number> = {
  OFFER_EXISTS: 409, OFFER_NOT_ACTIVE: 409, ALREADY_LOCKED: 409, DOUBLE_BOOKED: 409, PAIR_ALREADY_RESOLVED: 409,
  NOT_CREATOR: 403, NOT_OFFER_HOLDER: 403, NOT_PARTY: 403, NOT_RECONFIRM_PARTY: 403, CHOSEN_NOT_OWNED_BY_PAIR: 403,
  RANK_FROZEN: 422, BLOCKED: 422, INSTANCE_NOT_SEEKING: 422, NOT_SHORTLISTED: 422, NOT_INTERESTED: 422, BAD_RANK: 422,
  NO_INSTANCE: 404, NO_OFFER: 404, NO_LOCK: 404, NO_PAIR: 404,
};

export function sqlErrorToHttp(e: { message?: string }): HttpError {
  const msg = e?.message ?? "";
  for (const [code, status] of Object.entries(CODE_TO_STATUS)) {
    if (msg.includes(code)) return new HttpError(status, code);
  }
  return new HttpError(500, "internal_error");
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}
```

```ts
// supabase/functions/match-accept/index.ts
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { z } from "npm:zod@3.23.8";
import { corsHeaders } from "../_shared/cors.ts";
import { actorFromJwt, svc, sqlErrorToHttp, HttpError, json } from "../_shared/match.ts";

const Body = z.object({ offer_id: z.string().uuid() });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const idem = req.headers.get("Idempotency-Key");
    if (!idem) return json({ error: "missing_idempotency_key" }, 400);
    const actor = await actorFromJwt(req);
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: "invalid_input", details: parsed.error.flatten() }, 400);

    const { data, error } = await svc().rpc("match_accept_offer", {
      p_actor: actor, p_offer_id: parsed.data.offer_id, p_idem_key: idem,
    });
    if (error) { const h = sqlErrorToHttp(error); return json({ error: h.code }, h.status); }
    return json(data, 200);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code }, e.status);
    return json({ error: "internal_error" }, 500);
  }
});
```

The other functions follow the identical skeleton, swapping the Zod body + RPC name:
- `match-shortlist` → `match_shortlist_with_reciprocal(p_actor, p_instance, p_candidate)` (so reciprocity is detected on shortlist).
- `match-rank` → `match_set_rank(p_actor, p_instance, p_candidate, p_rank)`.
- `match-make-offer` → `match_make_offer(p_actor, p_instance, p_candidate, p_window_hours?)`.
- `match-pass` → `match_pass_offer(p_actor, p_offer_id)`.
- `match-cancel` → `match_cancel_lock(p_actor, p_lock_id, p_reason, p_idem_key)` (idem required).
- `match-resolve-reciprocal` → `match_resolve_reciprocal(p_actor, p_pair, p_chosen_instance, p_idem_key)` (idem required).
- `match-demand-hint` → `match_my_status(p_instance)` (read-only; returns status + demand + reveal flag; uses the **caller's** JWT client so RLS applies, not service role).

- [ ] **Step 4: Run the Deno test, expect PASS.** Repeat Steps 1–4 per function (one failing test → impl → PASS each). Add at least: `match-make-offer` "second offer → 409 OFFER_EXISTS", `match-cancel` "missing idem → 400", `match-shortlist` "non-creator → 403 NOT_CREATOR", `match-demand-hint` "standby sees `reveal_allowed=false`".

- [ ] **Step 5: Commit** (one commit per function, or a batched commit after all pass)

```bash
git add supabase/functions/_shared/match.ts supabase/functions/match-*/
git commit -m "P5: thin Edge Functions for every transition (JWT actor, idempotency, SQL-error→HTTP) + Deno tests"
```

---

## Task 11: Full reset + run-all gate + regenerate types

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)

- [ ] **Step 1: Full reset** — `supabase db reset` applies P0 + all P5 migrations in order. Expect no error.

- [ ] **Step 2: Run every P5 SQL test**

```bash
for f in supabase/tests/p5_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expected: every file exits 0; notices print `… OK`.

- [ ] **Step 3: Run both concurrency harnesses**

```bash
supabase db reset && supabase/tests/p5_race_two_accepts.sh
supabase db reset && supabase/tests/p5_race_expiry_vs_accept.sh
```
Expected: both print `PASS:`.

- [ ] **Step 4: Run Deno function tests** — `supabase start` then `deno test --allow-env --allow-net supabase/functions/match-*/**/*.test.ts`. Expected: all pass.

- [ ] **Step 5: Regenerate types** — `pnpm db:types`. Expect `transition_idempotency`, `presence_heartbeats`, `reciprocal_pairs`, `reconfirmations`, `jobs`, and the new functions to appear.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P5: regenerate database types for matching state-machine tables/functions"
```

---

## Self-Review

**Spec coverage (vs roadmap P5 'Delivers'/'Closes'):**
- Shortlist + set/reorder rank, frozen for the active offer slot → Task 2 (`match_shortlist`, `match_set_rank` with `RANK_FROZEN`). ✅
- `make_offer`: single ACTIVE offer (P0 partial-unique backstop + advisory lock), `expires_at`, offer-expiry job, reveal+chat to active holder ONLY → Task 4 (`match_make_offer`, `match_reveal_allowed` live predicate = automatic revoke). ✅
- Consent disclosure: swiping reveals the swiper's profile to the anonymous creator, explicit + audited → Task 2 (`swiper_disclosed_at`, audit row); P0 RLS already scopes swiper-profile reads. ✅
- `accept_offer` → LOCK: transactional, advisory lock, no-overlap via `lock_participants` GiST (P0), date off-market, audit (P0 trigger) → Task 5. ✅
- pass/expire → auto-roll to next standby (ordered) + cascade-withdrawal throttle → Task 6 (`match_pass_offer`/`match_expire_offer`/`match_auto_roll`, per-window + deferred-roll + per-actor-cap throttle). ✅
- Reciprocal-pair detection → chooser → Task 7 (`match_detect_reciprocal`, `match_resolve_reciprocal`). ✅
- `cancel(reason)` → safe auto-roll (benign only; reconfirm both; freeze near cutoff/after safety report) → Task 8. ✅
- Bucketed/capped DEMAND hint, presence-backed, honest → Task 3 (`match_demand_hint`). ✅
- Concurrency tests (two simultaneous accepts; offer-expiry-vs-accept race) → Tasks 5 & 6 shell harnesses. ✅
- Audit "Closes" — state/data-flow, honeypot consent (T2), cascading withdrawals (T6 throttle), offer-race/idempotency (T4/T5 + T1 ledger), standby-vs-rank ordering (T2 single rank-based order), reciprocal pairs (T7), double-booking enforcement (T5 via P0 GiST), reveal-on-offer-only (T4 live predicate). ✅

**Concurrency/design decisions locked (the load-bearing ones):**
1. **Advisory lock then check, never check-then-act.** Every contended transition takes `pg_advisory_xact_lock(match_instance_lock_key(instance))` (or `match_pair_lock_key` for reciprocal) before reading state. The P0 structural invariants (partial-unique offer index, GiST `lock_participants` exclusion, unique `locks.date_instance_id`) are the backstop, caught and translated (`exclusion_violation`→`DOUBLE_BOOKED`).
2. **Reveal is derived, not stored** → auto-revocation is real, not a flag that can drift.
3. **Standby order == rank order** (single source), eliminating the dual-ordering bug; `match_next_standby` is the only ordering authority.
4. **Cascade throttle = per-window scoping + deferred (job-based) rolls + per-actor cap.** A lock never synchronously cascades into another lock; it enqueues discrete `auto_roll` jobs P2 can rate-limit.
5. **Idempotency ledger** keyed `(actor, action, key)` makes accept/cancel/resolve safe under retry; the Edge layer requires the header.
6. **Expiry idempotent + cancellable:** the timer is cancelled on resolution and the expire function no-ops on an already-resolved offer, so the expiry-vs-accept race has exactly one outcome.
7. **Safe-roll requires both-party reconfirmation; freeze on non-benign reason / within cutoff / after any safety report** — safety beats liquidity.

**Dependencies flagged, not faked:** P2 (`jobs`/`enqueue`/`cancel_jobs`/`notify`) is shimmed in Task 0 with the exact signatures and a "SUPERSEDED BY P2" banner; P4 writes `swipes` (P5 only reads them to seed interest). When P2/P4 land, only the shim migration is replaced — P5 logic is unchanged. This is the **only** fabricated infrastructure and is explicitly scoped.

**Placeholder scan:** none — every step has runnable SQL/TS and exact commands. The Edge tests use `<test-jwt>` / env-provided fixtures as the *only* indirection, which is standard for integration tests against a live local stack.

**Risk notes:**
- **`profiles.id` FKs to `auth.users(id)`** (existing schema). P0's risk note assumed fixtures could insert directly into `profiles`; that is **false** given the auth FK. P5 fixtures (`p5_fixture_reset`) therefore seed `auth.users` first, then `profiles`. **Flag back to P0:** its test fixtures (`p0_offer_invariant.sql` etc.) insert into `profiles` with bare `gen_random_uuid()` and will fail the FK unless P0's tests are run with the auth FK deferred or also seed `auth.users`. P5 does it correctly; P0 should be corrected to match.
- **`pg_advisory_xact_lock` re-entrancy:** `match_auto_roll` calls `match_make_offer`, both acquiring the same instance key; advisory locks are re-entrant per session within a transaction, so this is safe (documented in the Task 6 note).
- **Cross-migration forward reference:** `match_accept_offer` (Task 5) references `match_autowithdraw_user_conflicts` (Task 6). plpgsql resolves bodies at call time, and both migrations apply before any call in `db reset`, so this is safe; the Task 5 test never triggers the cross-creator path.
- **`match_demand_hint` cost:** computed live with a 3-table join per read; for launch volume this is fine, but P11 (scale) should add a covering index on `queue_entries(date_instance_id, status, candidate_id)` and consider a short-TTL cache if read QPS climbs.
- **`reveal_allowed` for chat:** P6 (chat) gates message access on the same `match_reveal_allowed` predicate so chat opens exactly with the offer and closes when it resolves — this plan provides the predicate; P6 consumes it.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-p5-matching-state-machine.md`.** Recommended execution: **subagent-driven** (one subagent per task, review between tasks) given the concurrency tests — verify each race harness PASS before moving on. Hard prerequisite before execution: **P0 migrations applied** and (ideally) **P2 + P4 landed** so the shim/`swipes` assumptions are real; until then, the Task-0 shim lets P5 build and pass in isolation.
