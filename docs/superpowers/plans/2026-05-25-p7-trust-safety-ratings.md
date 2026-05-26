# P7 — Trust, Safety & Ratings (+ Proof of Attendance) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make After5's post-lock trust machinery *real*: structured ratings that resist retaliation, a reliability score with a concrete recency-weighted formula and min-volume gating, an enforcement ladder driven by data (not vibes), a **geofenced proof-of-attendance check-in** so no-show penalties are not pure self-report, report/block flows that actually **propagate** (hide content, revoke reveal, prevent rematch), an **emergency-contact + safety-check-in escalation policy** with backend teeth, and a user-facing **safety center** API.

**Architecture:** Build *on top of* P0's tables — `match_ratings`, `locks`/`lock_participants`, `reports`, `blocks`, `profiles.reliability_score`, `verifications`, `audit_log`, `date_instances` (with `time_range` + `venue_id`), `swipes`, `queue_entries`, `offers`. The heart of every state-mutating safety action is a **`SECURITY DEFINER` Postgres function** invoked over RPC (so RLS stays default-deny for direct writes, and invariants live in the DB). Pure scoring math (the reliability formula, ladder threshold evaluation) lives in **`packages/business`** as I/O-free functions (vitest-tested, portable to Deno + Node), and is *also* re-implemented as the canonical SQL the DB function uses — the TS version is the spec/oracle the SQL must match (a parity test asserts they agree). Two **Edge Functions** (Deno) cover the things the DB can't do alone: the **geofence adjudication** of disputed no-shows (PostGIS distance at submit time) and the **safety check-in escalation** webhook the P2 scheduler calls.

**Tech Stack:** Supabase Postgres + SQL migrations (`supabase/migrations/`), RLS with `auth.uid()`, PostGIS (geofence distance — already enabled in P0 Task 1), psql invariant/behavior tests (`supabase/tests/`), `SECURITY DEFINER` RPCs, `packages/business` pure TS (vitest), Edge Functions (`supabase/functions/`, Deno, `Deno.test`).

**Source docs:** spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` §8 (and §7.6 safety-gated auto-roll, §6 audit log); roadmap `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (P7 scope + Closes); foundation `docs/superpowers/plans/2026-05-25-p0-data-model.md` (all tables this builds on).

**Dependency contracts (P0/P2/P5/P6 — assumed present, this plan does NOT build them):**
- **P0** provides: `profiles` (`+ reliability_score numeric(4,2)`, `+ verification`), `profiles_private` (`emergency_contact jsonb`), `date_instances` (`venue_id`, `time_range`, `starts_at`, `duration_min`), `places` (`lat`, `lng`), `match_ratings` (`lock_id`, `rater_id`, `ratee_id`, four boolean outcomes, `submitted_at`, `unique(lock_id, rater_id)`), `locks` (`status active|completed|cancelled|no_show`, `cancel_reason`, `cancelled_by`), `lock_participants`, `swipes` (`unique(swiper_id, date_instance_id)`), `queue_entries`, `offers`, `reports` (`target_type`, `target_id`, `status`), `blocks` (`unique(blocker_id, blocked_id)`), `audit_log` + `log_status_transition()`, `set_updated_at()`, `cancel_reason` enum, `lock_status` enum.
- **P2** provides: a **`jobs`** table + scheduled runner, and a notification/push send path. P7 *enqueues* jobs (`kind` rows) and *exposes Edge Functions the runner invokes*; it does NOT build the runner. Where P2 is not yet merged, P7 Task 12 defines a **minimal `jobs` insert contract + a stub `enqueue_job()`** guarded by `create table if not exists` so P7 is testable standalone and a no-op when P2's richer table already exists (P7 only ever inserts; never owns the schema).
- **P5** provides: the matching state machine + the lock-creation/auto-roll RPCs. P7 *adds a guard* P5 calls (`can_rematch(a,b)` / a safety freeze flag) and *consumes* `locks`. P7 does not re-implement auto-roll; it provides the **`rematch_blocked` signal** and the **safety-report freeze** P5's §7.6 logic reads.
- **P6** provides: `chat_threads` / `messages` (or equivalent) opened at offer. P7's block propagation *revokes thread access*; this plan references the thread table by the name **`chat_threads`** and degrades gracefully (`if to_regclass('public.chat_threads') is not null`) so it runs before or after P6.

**Conventions (follow exactly, same as P0):** migration filenames `YYYYMMDDHHMMSS_snake_description.sql` (P7 uses the `20260525130000+` block, after P0's `1211xx`); enable RLS on every new table; create policies idempotently with `do $$ begin create policy … exception when duplicate_object then null; end $$;`; attach `set_updated_at()` to tables with `updated_at`; `auth.uid()` in policies; uuid PKs via `gen_random_uuid()`; all state-mutating safety actions go through `SECURITY DEFINER` functions with `set search_path = public` (never direct table writes from clients); every status mutation must reach `audit_log` (reuse `log_status_transition()` or write explicitly inside the RPC).

**Local test loops:**
- SQL: `supabase db reset` then `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>`. Tests use `DO $$ … END $$;` blocks that `RAISE EXCEPTION` on wrong behavior; clean exit = PASS. Fixtures insert directly into `profiles` (FKs point at `profiles`, not `auth.users`) and `ROLLBACK` at the end.
- TS (business): `pnpm --filter @after5/business test` (vitest).
- Edge Functions: `deno test --allow-env supabase/functions/<fn>/*_test.ts`.

---

## Design decisions (read before coding)

### D1 — Reliability score formula (concrete)

`profiles.reliability_score` is `numeric(4,2)` on a **0.00–100.00** scale (higher = more reliable; `null` = "not enough data yet" → renders as **"Verified · New"**, never as a low score).

Each *completed* lock the user was the **ratee** in yields a **counterparty rating** with the four P0 booleans. We collapse those into a per-rating **outcome value `v ∈ [0,1]`** and a per-rating **weight `w`**:

```
behavior_value(r):
  start at 1.0
  if r.showed_up is false            → 0.0     # hard floor: a no-show dominates
  else:
    if r.on_time is false            → subtract 0.15
    if r.cancelled_with_notice true  → set to 0.70   # cancelled, but courteously (better than ghost, worse than showed)
    if r.unsafe_or_disrespectful true→ subtract 0.50
  clamp to [0,1]
```

A rating is only counted toward the score once it is **revealed** (blind-until-both, see D2) AND, for the critical `showed_up=false` case, only after **geofence adjudication** has resolved any dispute (see D3) — an *un-adjudicated disputed no-show does not yet move the score*.

**Recency weighting (EWMA over events, not wall-clock decay):** order a ratee's revealed ratings oldest→newest; apply an exponential half-life of **`H = 10` events** so the most recent ~10 dates dominate:

```
weight_i = 0.5 ^ ((n - i) / H)          # i = 0 oldest … n-1 newest; newest weight = 1.0
score_raw = Σ(weight_i * behavior_value_i) / Σ(weight_i)
```

**Min-volume gate (confidence):** require **`MIN_RATED = 3`** revealed ratings before a score is exposed. Below that, `reliability_score` stays `null` ("Verified · New"). Between 3 and a `FULL_CONFIDENCE = 8` ramp, **shrink toward a neutral prior** `PRIOR = 0.80` (Bayesian-style) so a single early bad date can't tank a new user, and a single early perfect date can't crown them:

```
n_eff = min(count, FULL_CONFIDENCE)
confidence = n_eff / FULL_CONFIDENCE                       # 3/8 … 8/8
score_shrunk = confidence * score_raw + (1 - confidence) * PRIOR
reliability_score = round(score_shrunk * 100, 2)          # 0..100
```

Constants live in one place: SQL `reliability_config()` (a `STABLE` function returning a row) and TS `RELIABILITY_CONFIG`. The TS `computeReliability(ratings[])` is the **oracle**; the SQL `recompute_reliability(user_id)` must produce the identical number for the same inputs (parity test, Task 4).

### D2 — Anti-retaliation: blind-until-both, then reveal

`match_ratings` rows exist the moment a party submits, but a rating is **`revealed`** only when **both** parties have submitted **OR** the **rating window closes** (`lock` scheduled end + `RATING_WINDOW = 72h`). We add a nullable `revealed_at` (and a `disputed` flag) to `match_ratings`. Before `revealed_at`, neither party can read the *other's* row (P0 RLS already restricts `select` to `rater_id = auth.uid()`), and the score recompute ignores unrevealed rows. A P2 job (`rating_window_close`) flips lone ratings to revealed at the deadline so a non-responding counterparty cannot indefinitely hide a bad review. Serious flags (`unsafe_or_disrespectful = true`) **also auto-open a `report`** routed to moderation (P8) regardless of reveal state.

### D3 — Proof of attendance & no-show adjudication (geofenced check-in)

The penalty-bearing claim is **"the other person did not show up"** (`showed_up = false` in your rating of them). To stop that from being pure self-report, each party may file an **attendance check-in** at the venue: a record `attendance_checkins(lock_id, user_id, lat, lng, accuracy_m, distance_m, within_geofence, captured_at)`. The Edge Function `attendance-checkin` computes `distance_m` from the device coords to `places.lat/lng` (PostGIS) and sets `within_geofence = distance_m <= GEOFENCE_RADIUS_M (default 150) AND accuracy_m <= MAX_ACCURACY_M (200) AND captured_at within [starts_at − 30m, starts_at + duration + 30m]`.

**Adjudication rule (deterministic, in `adjudicate_no_show(lock_id)`):** when party A rates party B `showed_up = false`:
- If **B has a valid geofenced check-in** → the no-show claim is **contradicted by proof**. Mark A's rating `disputed = true`, do **not** apply the no-show penalty to B, and **open a moderation report** (`reason='disputed_no_show'`) so a human resolves the conflict (one of them is lying). B's score is unaffected pending resolution.
- If **B has no valid check-in** AND **A does** (A proved they were there) → the no-show is **corroborated**; the penalty stands and counts immediately.
- If **neither** checked in → the no-show is **unverified self-report**: it still records, but with **reduced weight** (`w *= UNVERIFIED_NOSHOW_WEIGHT = 0.5`) until/unless a human reviews. (We never *fully* trust an unproven no-show, and never *fully* ignore it.)

Mutual valid check-ins are also the positive signal: if both parties checked in, a later `showed_up=false` is overwhelmingly likely false and is always disputed.

### D4 — Enforcement ladder (data-driven)

A user's **standing** is recomputed whenever ratings/reports change, into `profiles.standing` (`good | warned | cooldown | throttled | reconfirm_required | locked_ban | suspended`) plus a `user_sanctions` audit table (every transition, with `reason`, `until`, `actor`). Drivers and thresholds (in `evaluate_standing(user_id)` / TS `evaluateStanding`):

| Trigger (within trailing 60 days unless noted) | New standing | Effect (enforced where) |
|---|---|---|
| 1 corroborated/ unverified no-show OR reliability dips below 70 | `warned` | notification only |
| 2 no-shows, OR reliability < 60 | `cooldown` | cannot create/accept a new lock for `COOLDOWN = 48h` (offer-accept RPC checks) |
| 3 no-shows, OR reliability < 50 | `throttled` | feed rank suppressed + queue priority lowered (P4/P5 read `standing`) |
| 4 no-shows, OR reliability < 40 | `reconfirm_required` | every future lock forces a **mandatory day-of reconfirm** (P2 job + accept-RPC flag) |
| 5 no-shows in 60d, OR any **upheld** `unsafe_or_disrespectful`/safety report | `locked_ban` | cannot enter the lock flow at all for `LOCKBAN = 14d` |
| 2 upheld safety reports, OR a severe moderator action | `suspended` | account-level; all RPC guards reject; handled with P8/P9 |

Standing is **monotone-by-severity within a window** (you can't be auto-downgraded from `suspended` to `warned`; only a moderator or the clock lifts the heavier states). The ladder is *additive* to the slow reliability score: the score is the long-run reputation; the ladder is the fast circuit-breaker for a thin market (spec §8).

### D5 — Report/block propagation (the "dead buttons" fix)

`block_user(blocker, blocked)` (RPC) is **idempotent** and triggers full propagation in one transaction:
1. Insert the `blocks` row (P0 unique pair).
2. **Hide content both directions:** the blind feed and any shortlist views must exclude each party's `date_instances` from the other (a `blocks`-aware predicate added to the P0 `browse_feed` view + a `visible_to(viewer, owner)` helper).
3. **Revoke reveal / kill chat:** if an `offer` is `active` between them, resolve it `passed`; revoke the chat thread (P6 `chat_threads.revoked_at`), so the identity reveal stops.
4. **Cancel an active lock** between them with `cancel_reason='safety'` (this trips §7.6's rollover freeze).
5. **Prevent rematch:** `can_rematch(a,b)` returns false whenever a block exists OR an upheld safety report exists between them; P5's swipe/shortlist/offer RPCs must consult it (this plan adds the function + a swipe-time guard).

`file_report(...)` writes the `reports` row, and if `reason` is a safety/harassment class it **freezes rollover** on the implicated lock (`locks.rollover_frozen = true`, read by P5 §7.6) and escalates serious classes immediately.

### D6 — Emergency contact + safety check-in escalation (real backend, not UI)

`profiles_private.emergency_contact jsonb` (P0) holds `{name, phone, relationship, share_optin}`. For each active lock whose start has passed, P2 schedules a **safety check-in** job (`safety_checkin` at `starts_at + 30m`, default). P7 owns the **escalation state machine** in `safety_checkins(lock_id, user_id, status, due_at, responded_at, escalated_at, contact_notified_at)`:
- Job fires → push "Are you OK? Tap to confirm you're safe." (`status='awaiting'`).
- User taps safe → `status='ok'` (RPC `respond_safety_checkin('ok')`).
- User taps **not safe / SOS** → `status='alarm'`; immediately notify emergency contact (if `share_optin`), surface venue + lock detail to the T&S queue at top priority, and open a `report(reason='safety_sos')`.
- **No response within `ESCALATION_GRACE = 30m`** → the `safety-escalation` Edge Function (called by the P2 runner re-poll) moves `status='escalated'`: send a second push, then if still silent notify the emergency contact (if opted in) and raise a T&S alert. *Missing the check-in is itself an escalation trigger* — the whole point is that silence is not "fine."

The user-facing **safety center** (Task 11) is a read API (`safety_center(user_id)` RPC + `packages/api-client` helper) returning: verification status, current standing + any active sanction & its `until`, emergency-contact on file (masked), active locks with venue + their check-in status, block list, and report history — the single screen that proves the safety features are wired to real data.

---

## File Structure

- `supabase/migrations/202605251300NN_p7_*.sql` — one migration per task (columns, tables, RPCs, view changes, indexes, RLS).
- `supabase/tests/p7_*.sql` — one psql behavior/invariant test per task that warrants it.
- `packages/business/src/reliability.ts`, `packages/business/src/standing.ts` — pure scoring/ladder math (the SQL oracle).
- `packages/business/src/__tests__/reliability.test.ts`, `standing.test.ts` — vitest.
- `supabase/functions/attendance-checkin/index.ts` (+ `index_test.ts`) — geofence compute + adjudication trigger.
- `supabase/functions/safety-escalation/index.ts` (+ `index_test.ts`) — missed-check-in escalation invoked by the P2 runner.
- No client/UI code (web/native is a thin layer over these RPCs + `api-client` helpers, per spec §10).

---

## Task 1: Ratings reveal + dispute columns (anti-retaliation scaffolding)

**Files:**
- Create: `supabase/migrations/20260525130000_p7_match_ratings_reveal.sql`
- Test: `supabase/tests/p7_ratings_reveal.sql`

- [ ] **Step 1: Write the failing test** (new columns exist; default not-revealed)

```sql
-- supabase/tests/p7_ratings_reveal.sql
DO $$
BEGIN
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='match_ratings' AND column_name='revealed_at';
  IF NOT FOUND THEN RAISE EXCEPTION 'match_ratings.revealed_at missing'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='match_ratings' AND column_name='disputed';
  IF NOT FOUND THEN RAISE EXCEPTION 'match_ratings.disputed missing'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='match_ratings' AND column_name='weight';
  IF NOT FOUND THEN RAISE EXCEPTION 'match_ratings.weight (adjudication weight) missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`column ... does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130000_p7_match_ratings_reveal.sql
-- Anti-retaliation: a rating is hidden from the counterparty until both submit
-- or the rating window closes. `disputed` flags a no-show contradicted by proof.
-- `weight` carries the adjudication multiplier (1.0 verified, 0.5 unverified no-show).
alter table match_ratings
  add column if not exists revealed_at timestamptz,
  add column if not exists disputed boolean not null default false,
  add column if not exists weight numeric(3,2) not null default 1.00;

create index if not exists match_ratings_ratee_revealed_idx
  on match_ratings (ratee_id) where revealed_at is not null;
```

- [ ] **Step 4: Apply + run test, expect PASS** (`supabase db reset && psql … -f supabase/tests/p7_ratings_reveal.sql`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130000_p7_match_ratings_reveal.sql supabase/tests/p7_ratings_reveal.sql
git commit -m "P7: match_ratings reveal/dispute/weight columns (anti-retaliation scaffolding)"
```

---

## Task 2: `submit_rating()` RPC + blind-until-both reveal logic

**Files:**
- Create: `supabase/migrations/20260525130100_p7_submit_rating.sql`
- Test: `supabase/tests/p7_submit_rating.sql`

- [ ] **Step 1: Write the failing test** (both submit → both revealed; one alone → not revealed)

```sql
-- supabase/tests/p7_submit_rating.sql
DO $$
DECLARE cre uuid; usr uuid; cid uuid; inst uuid; lk uuid; cnt int;
BEGIN
  insert into profiles (id,first_name) values (gen_random_uuid(),'cre') returning id into cre;
  insert into profiles (id,first_name) values (gen_random_uuid(),'usr') returning id into usr;
  insert into cities (slug,name,timezone,is_active) values ('p7a','p7a','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='p7a';
  insert into itineraries (id,user_id) values (gen_random_uuid(),cre);
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at,duration_min)
    select i.id,cre,cid, now()-interval '3 hours', 120 from itineraries i where i.user_id=cre limit 1
    returning id into inst;
  insert into locks (date_instance_id,creator_id,matched_user_id,status)
    values (inst,cre,usr,'completed') returning id into lk;

  -- creator submits first → their row NOT revealed yet (counterparty hasn't)
  perform submit_rating(lk, cre, usr, true, true, false, false);
  select count(*) into cnt from match_ratings where lock_id=lk and revealed_at is not null;
  IF cnt <> 0 THEN RAISE EXCEPTION 'rating revealed before both submitted (got %)', cnt; END IF;

  -- matched user submits → BOTH rows reveal
  perform submit_rating(lk, usr, cre, true, false, false, false);
  select count(*) into cnt from match_ratings where lock_id=lk and revealed_at is not null;
  IF cnt <> 2 THEN RAISE EXCEPTION 'both ratings should reveal once both submit (got %)', cnt; END IF;

  RAISE NOTICE 'submit_rating blind-until-both OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function submit_rating(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130100_p7_submit_rating.sql
-- Records a structured rating and reveals both rows once both parties submit.
-- Serious flags auto-open a moderation report (P8 triage) regardless of reveal.
create or replace function submit_rating(
  p_lock_id uuid, p_rater uuid, p_ratee uuid,
  p_showed_up boolean, p_on_time boolean,
  p_cancelled_with_notice boolean, p_unsafe boolean
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_other_exists boolean;
begin
  -- guard: rater must be a party to a completed/cancelled lock
  if not exists (
    select 1 from locks l
     where l.id = p_lock_id
       and l.status in ('completed','cancelled','no_show')
       and p_rater in (l.creator_id, l.matched_user_id)
       and p_ratee in (l.creator_id, l.matched_user_id)
       and p_rater <> p_ratee
  ) then
    raise exception 'rater % is not a party to ratable lock %', p_rater, p_lock_id;
  end if;

  insert into match_ratings (lock_id, rater_id, ratee_id, showed_up, on_time,
                             cancelled_with_notice, unsafe_or_disrespectful, submitted_at)
  values (p_lock_id, p_rater, p_ratee, p_showed_up, p_on_time,
          p_cancelled_with_notice, p_unsafe, now())
  on conflict (lock_id, rater_id) do update
     set showed_up = excluded.showed_up, on_time = excluded.on_time,
         cancelled_with_notice = excluded.cancelled_with_notice,
         unsafe_or_disrespectful = excluded.unsafe_or_disrespectful,
         submitted_at = now()
  returning id into v_id;

  -- serious flag → moderation report immediately (does not wait for reveal)
  if p_unsafe then
    insert into reports (reporter_id, target_type, target_id, reason, status)
    values (p_rater, 'user', p_ratee, 'unsafe_or_disrespectful', 'open');
  end if;

  -- blind-until-both: reveal both rows iff the counterparty has also submitted
  select exists (
    select 1 from match_ratings where lock_id = p_lock_id and rater_id = p_ratee
  ) into v_other_exists;
  if v_other_exists then
    update match_ratings set revealed_at = now()
     where lock_id = p_lock_id and revealed_at is null;
  end if;

  -- no-show requires geofence adjudication before it counts (Task 6 hooks here)
  if p_showed_up is false then
    perform adjudicate_no_show(p_lock_id);
  end if;

  -- recompute the ratee's reliability (Task 4) from revealed rows only
  perform recompute_reliability(p_ratee);
  return v_id;
end $fn$;

revoke all on function submit_rating(uuid,uuid,uuid,boolean,boolean,boolean,boolean) from public;
grant execute on function submit_rating(uuid,uuid,uuid,boolean,boolean,boolean,boolean) to authenticated, service_role;
```

> **Forward-reference note:** `adjudicate_no_show()` (Task 6) and `recompute_reliability()` (Task 4) are created in later migrations. To keep `supabase db reset` clean *during* this task's development, add **temporary no-op stubs at the TOP of this migration** guarded by `create or replace function … returns void … begin return; end;` — Tasks 4 and 6 `create or replace` the real bodies (same signatures, listed below). Migrations run in filename order, so the stubs (130100) are superseded by the real definitions (130300, 130500). Signatures: `recompute_reliability(p_user uuid) returns void`; `adjudicate_no_show(p_lock_id uuid) returns void`.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `submit_rating blind-until-both OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130100_p7_submit_rating.sql supabase/tests/p7_submit_rating.sql
git commit -m "P7: submit_rating RPC with blind-until-both reveal + serious-flag report"
```

---

## Task 3: Reliability formula in `packages/business` (the oracle)

**Files:**
- Create: `packages/business/src/reliability.ts`
- Create: `packages/business/src/__tests__/reliability.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/business/src/__tests__/reliability.test.ts
import { describe, it, expect } from 'vitest';
import { behaviorValue, computeReliability, RELIABILITY_CONFIG } from '../reliability';

const base = { showedUp: true, onTime: true, cancelledWithNotice: false, unsafe: false, weight: 1 };

describe('behaviorValue', () => {
  it('perfect date = 1', () => expect(behaviorValue(base)).toBe(1));
  it('no-show floors to 0 regardless of other fields', () =>
    expect(behaviorValue({ ...base, showedUp: false, onTime: true })).toBe(0));
  it('late docks 0.15', () =>
    expect(behaviorValue({ ...base, onTime: false })).toBeCloseTo(0.85, 5));
  it('cancelled-with-notice = 0.70', () =>
    expect(behaviorValue({ ...base, cancelledWithNotice: true })).toBeCloseTo(0.70, 5));
  it('unsafe docks 0.50', () =>
    expect(behaviorValue({ ...base, unsafe: true })).toBeCloseTo(0.50, 5));
});

describe('computeReliability', () => {
  it('below MIN_RATED returns null (Verified · New)', () => {
    expect(computeReliability([base, base])).toBeNull(); // 2 < 3
  });
  it('3 perfect dates: shrunk toward prior at 3/8 confidence', () => {
    // confidence=3/8=0.375; raw=1; score=0.375*1 + 0.625*0.80 = 0.875 → 87.50
    expect(computeReliability([base, base, base])).toBeCloseTo(87.5, 2);
  });
  it('recency: newest events dominate (half-life 10)', () => {
    const old = { ...base, showedUp: false }; // value 0
    const recentGood = Array(9).fill(base);
    const a = computeReliability([old, ...recentGood])!;
    const b = computeReliability([...recentGood, old])!; // bad date most recent
    expect(a).toBeGreaterThan(b);
  });
  it('reduced-weight unverified no-show counts less than a full no-show', () => {
    const noshowFull = { ...base, showedUp: false, weight: 1 };
    const noshowHalf = { ...base, showedUp: false, weight: 0.5 };
    const ctx = Array(7).fill(base);
    const full = computeReliability([...ctx, noshowFull])!;
    const half = computeReliability([...ctx, noshowHalf])!;
    expect(half).toBeGreaterThan(full);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`Cannot find module '../reliability'`).
Run: `pnpm --filter @after5/business test`

- [ ] **Step 3: Write the implementation**

```ts
// packages/business/src/reliability.ts
// Pure, I/O-free reliability scoring. This is the ORACLE the SQL
// recompute_reliability() must match (see supabase/tests/p7_reliability_parity.sql).

export const RELIABILITY_CONFIG = {
  HALF_LIFE_EVENTS: 10,
  MIN_RATED: 3,
  FULL_CONFIDENCE: 8,
  PRIOR: 0.8,
  LATE_PENALTY: 0.15,
  CANCEL_WITH_NOTICE_VALUE: 0.7,
  UNSAFE_PENALTY: 0.5,
} as const;

export interface RatingInput {
  showedUp: boolean;
  onTime: boolean;
  cancelledWithNotice: boolean;
  unsafe: boolean;
  weight: number; // adjudication multiplier (1.0 verified, 0.5 unverified no-show)
}

export function behaviorValue(r: RatingInput): number {
  if (r.showedUp === false) return 0;
  let v = 1;
  if (r.cancelledWithNotice) v = RELIABILITY_CONFIG.CANCEL_WITH_NOTICE_VALUE;
  if (!r.onTime) v -= RELIABILITY_CONFIG.LATE_PENALTY;
  if (r.unsafe) v -= RELIABILITY_CONFIG.UNSAFE_PENALTY;
  return Math.min(1, Math.max(0, v));
}

/** ratings ordered oldest -> newest; returns 0..100 or null if under MIN_RATED. */
export function computeReliability(ratings: RatingInput[]): number | null {
  const n = ratings.length;
  if (n < RELIABILITY_CONFIG.MIN_RATED) return null;
  const H = RELIABILITY_CONFIG.HALF_LIFE_EVENTS;
  let num = 0;
  let den = 0;
  ratings.forEach((r, i) => {
    const recency = Math.pow(0.5, (n - 1 - i) / H); // newest (i=n-1) => 1.0
    const w = recency * r.weight;
    num += w * behaviorValue(r);
    den += w;
  });
  const raw = den === 0 ? RELIABILITY_CONFIG.PRIOR : num / den;
  const nEff = Math.min(n, RELIABILITY_CONFIG.FULL_CONFIDENCE);
  const confidence = nEff / RELIABILITY_CONFIG.FULL_CONFIDENCE;
  const shrunk = confidence * raw + (1 - confidence) * RELIABILITY_CONFIG.PRIOR;
  return Math.round(shrunk * 100 * 100) / 100; // 2dp, 0..100
}
```

- [ ] **Step 4: Re-run, expect PASS.** Run: `pnpm --filter @after5/business test`

- [ ] **Step 5: Export from package index**

Add `export * from './reliability';` to `packages/business/src/index.ts` (replace the placeholder export region; keep the file's header comment).

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/reliability.ts packages/business/src/__tests__/reliability.test.ts packages/business/src/index.ts
git commit -m "P7: reliability formula in business package (recency EWMA + min-volume shrinkage)"
```

---

## Task 4: `recompute_reliability()` SQL + parity with the TS oracle

**Files:**
- Create: `supabase/migrations/20260525130200_p7_reliability_config.sql`
- Create: `supabase/migrations/20260525130300_p7_recompute_reliability.sql`
- Test: `supabase/tests/p7_reliability_parity.sql`

- [ ] **Step 1: Write the failing test** (SQL must equal the oracle's published numbers)

```sql
-- supabase/tests/p7_reliability_parity.sql
-- Fixed-input checks mirroring reliability.test.ts so SQL == TS oracle.
DO $$
DECLARE cre uuid; usr uuid; cid uuid; inst uuid; lk uuid; got numeric; i int;
BEGIN
  insert into profiles (id,first_name) values (gen_random_uuid(),'rel') returning id into usr;
  insert into profiles (id,first_name) values (gen_random_uuid(),'rc') returning id into cre;
  insert into cities (slug,name,timezone,is_active) values ('p7r','p7r','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='p7r';

  -- helper: create a completed lock + a revealed rating of usr with given outcome
  for i in 1..3 loop
    insert into itineraries (id,user_id) values (gen_random_uuid(),cre);
    insert into date_instances (itinerary_id,creator_id,city_id,starts_at,duration_min)
      select id,cre,cid, now()-interval '1 day', 120 from itineraries
      where user_id=cre order by id desc limit 1 returning id into inst;
    insert into locks (date_instance_id,creator_id,matched_user_id,status)
      values (inst,cre,usr,'completed') returning id into lk;
    insert into match_ratings (lock_id,rater_id,ratee_id,showed_up,on_time,
                               cancelled_with_notice,unsafe_or_disrespectful,
                               weight,revealed_at)
      values (lk,cre,usr,true,true,false,false,1.00, now());
  end loop;

  perform recompute_reliability(usr);
  select reliability_score into got from profiles where id=usr;
  -- 3 perfect dates, 3/8 confidence, prior 0.80 → 87.50 (matches TS test)
  IF got is null OR abs(got - 87.50) > 0.01 THEN
    RAISE EXCEPTION 'parity FAIL: expected 87.50 got %', got;
  END IF;
  RAISE NOTICE 'reliability parity OK (%).', got;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function recompute_reliability(...) does not exist`).

- [ ] **Step 3a: Write the config migration**

```sql
-- supabase/migrations/20260525130200_p7_reliability_config.sql
-- Single source of truth for constants; mirrors RELIABILITY_CONFIG in TS.
create or replace function reliability_config()
returns table (
  half_life_events int, min_rated int, full_confidence int,
  prior numeric, late_penalty numeric, cancel_value numeric, unsafe_penalty numeric
) language sql immutable as $fn$
  select 10, 3, 8, 0.80::numeric, 0.15::numeric, 0.70::numeric, 0.50::numeric;
$fn$;

create or replace function behavior_value(
  p_showed_up boolean, p_on_time boolean, p_cancel_notice boolean, p_unsafe boolean
) returns numeric language plpgsql immutable as $fn$
declare c record; v numeric := 1;
begin
  select * into c from reliability_config();
  if p_showed_up is false then return 0; end if;
  if p_cancel_notice then v := c.cancel_value; end if;
  if not coalesce(p_on_time, true) then v := v - c.late_penalty; end if;
  if p_unsafe then v := v - c.unsafe_penalty; end if;
  return greatest(0, least(1, v));
end $fn$;
```

- [ ] **Step 3b: Write the recompute migration** (replaces the Task-2 stub)

```sql
-- supabase/migrations/20260525130300_p7_recompute_reliability.sql
-- Recomputes profiles.reliability_score from REVEALED, non-disputed ratings
-- (oldest->newest), recency-weighted (half-life 10 events) and shrunk toward a
-- neutral prior below FULL_CONFIDENCE. Writes null when under MIN_RATED.
create or replace function recompute_reliability(p_user uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare c record; n int; num numeric := 0; den numeric := 0;
        raw numeric; conf numeric; shrunk numeric; idx int := 0; r record;
begin
  select * into c from reliability_config();
  select count(*) into n from match_ratings
   where ratee_id = p_user and revealed_at is not null and disputed = false;
  if n < c.min_rated then
    update profiles set reliability_score = null where id = p_user;
    return;
  end if;
  for r in
    select showed_up, on_time, cancelled_with_notice, unsafe_or_disrespectful, weight
      from match_ratings
     where ratee_id = p_user and revealed_at is not null and disputed = false
     order by submitted_at asc
  loop
    declare recency numeric; w numeric;
    begin
      recency := power(0.5, (n - 1 - idx)::numeric / c.half_life_events);
      w := recency * r.weight;
      num := num + w * behavior_value(r.showed_up, r.on_time,
                                      r.cancelled_with_notice, r.unsafe_or_disrespectful);
      den := den + w;
      idx := idx + 1;
    end;
  end loop;
  raw := case when den = 0 then c.prior else num / den end;
  conf := least(n, c.full_confidence)::numeric / c.full_confidence;
  shrunk := conf * raw + (1 - conf) * c.prior;
  update profiles set reliability_score = round(shrunk * 100, 2) where id = p_user;
  -- standing depends on the score; refresh it (Task 8)
  perform evaluate_standing(p_user);
end $fn$;

revoke all on function recompute_reliability(uuid) from public;
grant execute on function recompute_reliability(uuid) to service_role;
```

> Same forward-reference handling as Task 2: `evaluate_standing(uuid)` is a no-op stub here (top of file) until Task 8 supplies the body.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `reliability parity OK (87.50)`).
Also re-run the TS oracle to confirm both still agree: `pnpm --filter @after5/business test`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130200_p7_reliability_config.sql supabase/migrations/20260525130300_p7_recompute_reliability.sql supabase/tests/p7_reliability_parity.sql
git commit -m "P7: SQL recompute_reliability + reliability_config, parity-tested against TS oracle"
```

---

## Task 5: Attendance check-in table + RPC (proof of attendance)

**Files:**
- Create: `supabase/migrations/20260525130400_p7_attendance_checkins.sql`
- Test: `supabase/tests/p7_attendance_checkins.sql`

- [ ] **Step 1: Write the failing test** (one check-in per (lock,user); geofence flag stored)

```sql
-- supabase/tests/p7_attendance_checkins.sql
DO $$
DECLARE cre uuid; usr uuid; cid uuid; pl uuid; inst uuid; lk uuid; ok boolean := false;
BEGIN
  insert into profiles (id,first_name) values (gen_random_uuid(),'c') returning id into cre;
  insert into profiles (id,first_name) values (gen_random_uuid(),'u') returning id into usr;
  insert into cities (slug,name,timezone,is_active) values ('p7c','p7c','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='p7c';
  insert into places (name,slug,neighborhood,drive_cluster,type,lat,lng)
    values ('Venue','venue-p7','Downtown','core','cafe',49.8880,-119.4960)
    on conflict (slug) do nothing returning id into pl;
  if pl is null then select id into pl from places where slug='venue-p7'; end if;
  insert into itineraries (id,user_id) values (gen_random_uuid(),cre);
  insert into date_instances (itinerary_id,creator_id,city_id,venue_id,starts_at,duration_min)
    select id,cre,cid,pl, now(),120 from itineraries where user_id=cre limit 1
    returning id into inst;
  insert into locks (date_instance_id,creator_id,matched_user_id,status)
    values (inst,cre,usr,'active') returning id into lk;

  insert into attendance_checkins (lock_id,user_id,lat,lng,accuracy_m,distance_m,within_geofence,captured_at)
    values (lk,usr,49.8881,-119.4961,20,15,true, now());
  BEGIN
    insert into attendance_checkins (lock_id,user_id,lat,lng,accuracy_m,distance_m,within_geofence,captured_at)
      values (lk,usr,49.8881,-119.4961,20,15,true, now());
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'expected one check-in per (lock,user)'; END IF;
  RAISE NOTICE 'attendance_checkins uniqueness OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "attendance_checkins" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130400_p7_attendance_checkins.sql
-- Proof of attendance: a geofenced check-in at the venue. distance_m / within_geofence
-- are computed server-side (the attendance-checkin Edge Function), never trusted from client.
create table if not exists attendance_checkins (
  id uuid primary key default gen_random_uuid(),
  lock_id uuid not null references locks(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m numeric,
  distance_m numeric,                 -- server-computed metres from venue centroid
  within_geofence boolean not null default false,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (lock_id, user_id)
);
create index if not exists attendance_checkins_lock_idx on attendance_checkins(lock_id);

alter table attendance_checkins enable row level security;
do $$ begin
  -- a party may read check-ins on their own lock (theirs + counterparty's verdict)
  create policy "attendance_party_read" on attendance_checkins for select
    using (exists (
      select 1 from locks l
       where l.id = attendance_checkins.lock_id
         and auth.uid() in (l.creator_id, l.matched_user_id)
    ));
exception when duplicate_object then null; end $$;
-- inserts go ONLY through record_attendance_checkin() (SECURITY DEFINER); no insert policy.

-- record_attendance_checkin: trusts only lat/lng/accuracy from caller; the Edge Function
-- pre-computes distance + geofence using PostGIS and passes them in via service role.
create or replace function record_attendance_checkin(
  p_lock_id uuid, p_user uuid, p_lat double precision, p_lng double precision,
  p_accuracy_m numeric, p_distance_m numeric, p_within boolean
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_start timestamptz; v_end timestamptz;
begin
  if not exists (select 1 from locks l where l.id=p_lock_id
                   and p_user in (l.creator_id,l.matched_user_id)) then
    raise exception 'user % not a party to lock %', p_user, p_lock_id;
  end if;
  -- time-window guard duplicated here as defence in depth
  select lower(di.time_range)-interval '30 min', upper(di.time_range)+interval '30 min'
    into v_start, v_end
    from locks l join date_instances di on di.id=l.date_instance_id where l.id=p_lock_id;
  insert into attendance_checkins (lock_id,user_id,lat,lng,accuracy_m,distance_m,
                                   within_geofence,captured_at)
  values (p_lock_id,p_user,p_lat,p_lng,p_accuracy_m,p_distance_m,
          p_within and now() between v_start and v_end, now())
  on conflict (lock_id,user_id) do update
     set lat=excluded.lat, lng=excluded.lng, accuracy_m=excluded.accuracy_m,
         distance_m=excluded.distance_m, within_geofence=excluded.within_geofence,
         captured_at=now()
  returning id into v_id;
  return v_id;
end $fn$;

revoke all on function record_attendance_checkin(uuid,uuid,double precision,double precision,numeric,numeric,boolean) from public;
grant execute on function record_attendance_checkin(uuid,uuid,double precision,double precision,numeric,numeric,boolean) to service_role;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130400_p7_attendance_checkins.sql supabase/tests/p7_attendance_checkins.sql
git commit -m "P7: attendance_checkins (geofenced proof) + service-role record RPC"
```

---

## Task 6: `adjudicate_no_show()` — disputed-no-show resolution

**Files:**
- Create: `supabase/migrations/20260525130500_p7_adjudicate_no_show.sql`
- Test: `supabase/tests/p7_adjudicate.sql`

- [ ] **Step 1: Write the failing test** (proof contradicts the claim → disputed, no penalty)

```sql
-- supabase/tests/p7_adjudicate.sql
DO $$
DECLARE cre uuid; usr uuid; cid uuid; pl uuid; inst uuid; lk uuid;
        v_disputed boolean; v_weight numeric; v_reports int;
BEGIN
  insert into profiles (id,first_name) values (gen_random_uuid(),'c') returning id into cre;
  insert into profiles (id,first_name) values (gen_random_uuid(),'u') returning id into usr;
  insert into cities (slug,name,timezone,is_active) values ('p7d','p7d','UTC',true)
    on conflict (slug) do nothing; select id into cid from cities where slug='p7d';
  insert into places (name,slug,neighborhood,drive_cluster,type,lat,lng)
    values ('V','venue-p7d','DT','core','cafe',49.888,-119.496)
    on conflict (slug) do nothing; select id into pl from places where slug='venue-p7d';
  insert into itineraries (id,user_id) values (gen_random_uuid(),cre);
  insert into date_instances (itinerary_id,creator_id,city_id,venue_id,starts_at,duration_min)
    select id,cre,cid,pl, now(),120 from itineraries where user_id=cre limit 1 returning id into inst;
  insert into locks (date_instance_id,creator_id,matched_user_id,status)
    values (inst,cre,usr,'completed') returning id into lk;

  -- B (usr) HAS a valid geofenced check-in
  insert into attendance_checkins (lock_id,user_id,lat,lng,distance_m,within_geofence,captured_at)
    values (lk,usr,49.888,-119.496,10,true, now());
  -- A (cre) claims B did not show up
  insert into match_ratings (lock_id,rater_id,ratee_id,showed_up,on_time,
                             cancelled_with_notice,unsafe_or_disrespectful)
    values (lk,cre,usr,false,true,false,false);

  perform adjudicate_no_show(lk);

  select disputed, weight into v_disputed, v_weight
    from match_ratings where lock_id=lk and rater_id=cre;
  IF v_disputed is not true THEN RAISE EXCEPTION 'no-show contradicted by proof should be disputed'; END IF;
  select count(*) into v_reports from reports where reason='disputed_no_show' and target_id=cre;
  IF v_reports < 1 THEN RAISE EXCEPTION 'disputed no-show should open a moderation report'; END IF;
  RAISE NOTICE 'adjudicate disputed-no-show OK (weight %)', v_weight;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (the real body doesn't exist; the Task-2 stub is a no-op so `disputed` stays false → raises).

- [ ] **Step 3: Write the migration** (replaces the stub)

```sql
-- supabase/migrations/20260525130500_p7_adjudicate_no_show.sql
-- Adjudicates every fresh `showed_up=false` rating on a lock against geofenced proof.
--   B has valid check-in              -> claim DISPUTED, no penalty, open moderation report
--   B none but A (claimant) has proof -> CORROBORATED, full weight
--   neither has proof                 -> UNVERIFIED self-report, weight *= 0.5
create or replace function adjudicate_no_show(p_lock_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare r record; b_proof boolean; a_proof boolean;
begin
  for r in
    select id, rater_id, ratee_id from match_ratings
     where lock_id = p_lock_id and showed_up is false
  loop
    select coalesce(bool_or(within_geofence), false) into b_proof
      from attendance_checkins where lock_id = p_lock_id and user_id = r.ratee_id;
    select coalesce(bool_or(within_geofence), false) into a_proof
      from attendance_checkins where lock_id = p_lock_id and user_id = r.rater_id;

    if b_proof then
      update match_ratings set disputed = true, weight = 0.00 where id = r.id;
      insert into reports (reporter_id, target_type, target_id, reason, status)
      values (r.rater_id, 'user', r.ratee_id, 'disputed_no_show', 'open')
      on conflict do nothing;
    elsif a_proof then
      update match_ratings set disputed = false, weight = 1.00 where id = r.id;
    else
      update match_ratings set disputed = false, weight = 0.50 where id = r.id;  -- unverified
    end if;

    -- recompute the accused's score with the adjudicated weight
    perform recompute_reliability(r.ratee_id);
  end loop;
end $fn$;

revoke all on function adjudicate_no_show(uuid) from public;
grant execute on function adjudicate_no_show(uuid) to service_role;
```

> `reports` has no natural unique key for `on conflict do nothing`; if P0's `reports` lacks a constraint, replace the `on conflict do nothing` with a guarded `if not exists (select 1 from reports where reason='disputed_no_show' and target_id=r.ratee_id and status in ('open','reviewing'))` insert. (Test asserts ≥1 either way.)

- [ ] **Step 4: Apply + run test, expect PASS** (prints `adjudicate disputed-no-show OK`).

- [ ] **Step 5: Add the corroborated + unverified cases to the test** (extend `p7_adjudicate.sql` with two more `DO` blocks: one where only A has proof → `weight=1.00, disputed=false`; one where neither does → `weight=0.50`). Re-run, expect PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260525130500_p7_adjudicate_no_show.sql supabase/tests/p7_adjudicate.sql
git commit -m "P7: adjudicate_no_show (geofence-backed dispute resolution + weighting)"
```

---

## Task 7: Enforcement ladder math in `packages/business`

**Files:**
- Create: `packages/business/src/standing.ts`
- Create: `packages/business/src/__tests__/standing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/business/src/__tests__/standing.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateStanding, STANDING_CONFIG } from '../standing';

const good = { recentNoShows: 0, reliability: 95, recentUpheldSafetyReports: 0, currentSeverity: 0 };

describe('evaluateStanding', () => {
  it('clean record stays good', () =>
    expect(evaluateStanding(good).standing).toBe('good'));
  it('1 no-show OR reliability<70 -> warned', () => {
    expect(evaluateStanding({ ...good, recentNoShows: 1 }).standing).toBe('warned');
    expect(evaluateStanding({ ...good, reliability: 65 }).standing).toBe('warned');
  });
  it('2 no-shows -> cooldown', () =>
    expect(evaluateStanding({ ...good, recentNoShows: 2 }).standing).toBe('cooldown'));
  it('3 no-shows -> throttled', () =>
    expect(evaluateStanding({ ...good, recentNoShows: 3 }).standing).toBe('throttled'));
  it('4 no-shows -> reconfirm_required', () =>
    expect(evaluateStanding({ ...good, recentNoShows: 4 }).standing).toBe('reconfirm_required'));
  it('5 no-shows OR an upheld safety report -> locked_ban', () => {
    expect(evaluateStanding({ ...good, recentNoShows: 5 }).standing).toBe('locked_ban');
    expect(evaluateStanding({ ...good, recentUpheldSafetyReports: 1 }).standing).toBe('locked_ban');
  });
  it('2 upheld safety reports -> suspended', () =>
    expect(evaluateStanding({ ...good, recentUpheldSafetyReports: 2 }).standing).toBe('suspended'));
  it('monotone: never auto-downgrades below currentSeverity', () => {
    // currently suspended (severity 6); clean inputs must not drop to good
    const r = evaluateStanding({ ...good, currentSeverity: 6 });
    expect(r.standing).toBe('suspended');
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** `pnpm --filter @after5/business test`

- [ ] **Step 3: Write the implementation**

```ts
// packages/business/src/standing.ts
// Pure enforcement-ladder evaluation. The SQL evaluate_standing() must match this.
export const STANDING_ORDER = [
  'good', 'warned', 'cooldown', 'throttled', 'reconfirm_required', 'locked_ban', 'suspended',
] as const;
export type Standing = (typeof STANDING_ORDER)[number];

export const STANDING_CONFIG = {
  WARN_RELIABILITY: 70,
  COOLDOWN_RELIABILITY: 60,
  THROTTLE_RELIABILITY: 50,
  RECONFIRM_RELIABILITY: 40,
  COOLDOWN_HOURS: 48,
  LOCKBAN_DAYS: 14,
} as const;

export interface StandingInput {
  recentNoShows: number;            // trailing 60 days, adjudicated (weight>0)
  reliability: number | null;       // 0..100 or null (new user)
  recentUpheldSafetyReports: number;// moderator-upheld, trailing 60 days
  currentSeverity: number;          // index into STANDING_ORDER of current standing
}

export function evaluateStanding(i: StandingInput): { standing: Standing; severity: number } {
  const rel = i.reliability ?? 100; // new users are not penalised by absence of data
  let sev = 0; // good
  if (i.recentUpheldSafetyReports >= 2) sev = 6;          // suspended
  else if (i.recentNoShows >= 5 || i.recentUpheldSafetyReports >= 1) sev = 5; // locked_ban
  else if (i.recentNoShows >= 4 || rel < STANDING_CONFIG.RECONFIRM_RELIABILITY) sev = 4;
  else if (i.recentNoShows >= 3 || rel < STANDING_CONFIG.THROTTLE_RELIABILITY) sev = 3;
  else if (i.recentNoShows >= 2 || rel < STANDING_CONFIG.COOLDOWN_RELIABILITY) sev = 2;
  else if (i.recentNoShows >= 1 || rel < STANDING_CONFIG.WARN_RELIABILITY) sev = 1;
  // monotone within the window: never auto-drop below current severity
  sev = Math.max(sev, i.currentSeverity);
  return { standing: STANDING_ORDER[sev], severity: sev };
}
```

- [ ] **Step 4: Re-run, expect PASS.** Add `export * from './standing';` to `packages/business/src/index.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/business/src/standing.ts packages/business/src/__tests__/standing.test.ts packages/business/src/index.ts
git commit -m "P7: enforcement-ladder evaluator in business package (monotone severity)"
```

---

## Task 8: Standing storage + `evaluate_standing()` SQL + `user_sanctions`

**Files:**
- Create: `supabase/migrations/20260525130600_p7_standing.sql`
- Test: `supabase/tests/p7_standing.sql`

- [ ] **Step 1: Write the failing test** (no-shows drive standing; sanction row recorded)

```sql
-- supabase/tests/p7_standing.sql
DO $$
DECLARE usr uuid; cre uuid; cid uuid; inst uuid; lk uuid; i int; v_standing text; v_sanctions int;
BEGIN
  insert into profiles (id,first_name) values (gen_random_uuid(),'s') returning id into usr;
  insert into profiles (id,first_name) values (gen_random_uuid(),'sc') returning id into cre;
  insert into cities (slug,name,timezone,is_active) values ('p7s','p7s','UTC',true)
    on conflict (slug) do nothing; select id into cid from cities where slug='p7s';
  -- give usr 2 adjudicated no-shows (weight>0, revealed) -> cooldown
  for i in 1..2 loop
    insert into itineraries (id,user_id) values (gen_random_uuid(),cre);
    insert into date_instances (itinerary_id,creator_id,city_id,starts_at,duration_min)
      select id,cre,cid, now()-interval '5 days',120 from itineraries
      where user_id=cre order by id desc limit 1 returning id into inst;
    insert into locks (date_instance_id,creator_id,matched_user_id,status)
      values (inst,cre,usr,'completed') returning id into lk;
    insert into match_ratings (lock_id,rater_id,ratee_id,showed_up,on_time,
                               cancelled_with_notice,unsafe_or_disrespectful,weight,revealed_at)
      values (lk,cre,usr,false,true,false,false,1.00, now());
  end loop;

  perform evaluate_standing(usr);
  select standing::text into v_standing from profiles where id=usr;
  IF v_standing <> 'cooldown' THEN RAISE EXCEPTION 'expected cooldown, got %', v_standing; END IF;
  select count(*) into v_sanctions from user_sanctions where user_id=usr;
  IF v_sanctions < 1 THEN RAISE EXCEPTION 'expected a sanction audit row'; END IF;
  RAISE NOTICE 'standing ladder OK (% / % sanctions)', v_standing, v_sanctions;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`type "standing" does not exist` / stub no-op leaves standing `good`).

- [ ] **Step 3: Write the migration** (replaces the Task-4 stub of `evaluate_standing`)

```sql
-- supabase/migrations/20260525130600_p7_standing.sql
create type user_standing as enum
  ('good','warned','cooldown','throttled','reconfirm_required','locked_ban','suspended');

alter table profiles
  add column if not exists standing user_standing not null default 'good',
  add column if not exists standing_until timestamptz;   -- when an auto state expires

create table if not exists user_sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  from_standing user_standing,
  to_standing user_standing not null,
  reason text not null,
  until timestamptz,
  actor uuid,                       -- null = automatic; set = moderator
  created_at timestamptz not null default now()
);
create index if not exists user_sanctions_user_idx on user_sanctions(user_id);
alter table user_sanctions enable row level security;
do $$ begin
  create policy "sanctions_owner_read" on user_sanctions for select
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- severity index mirrors STANDING_ORDER in standing.ts
create or replace function standing_severity(s user_standing) returns int
language sql immutable as $fn$
  select case s
    when 'good' then 0 when 'warned' then 1 when 'cooldown' then 2
    when 'throttled' then 3 when 'reconfirm_required' then 4
    when 'locked_ban' then 5 when 'suspended' then 6 end;
$fn$;
create or replace function severity_standing(i int) returns user_standing
language sql immutable as $fn$
  select (array['good','warned','cooldown','throttled','reconfirm_required',
                'locked_ban','suspended']::user_standing[])[i+1];
$fn$;

create or replace function evaluate_standing(p_user uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare rel numeric; no_shows int; safety_reports int; cur int; sev int;
        new_s user_standing; old_s user_standing; v_until timestamptz;
begin
  select reliability_score, standing into rel, old_s from profiles where id = p_user;
  rel := coalesce(rel, 100);
  -- adjudicated no-shows (weight>0) in the trailing 60 days
  select count(*) into no_shows from match_ratings
   where ratee_id = p_user and showed_up is false and weight > 0
     and disputed = false and submitted_at > now() - interval '60 days';
  select count(*) into safety_reports from reports
   where target_type='user' and target_id = p_user
     and reason in ('unsafe_or_disrespectful','safety_sos','harassment')
     and status = 'actioned' and created_at > now() - interval '60 days';

  cur := standing_severity(old_s);
  if safety_reports >= 2 then sev := 6;
  elsif no_shows >= 5 or safety_reports >= 1 then sev := 5;
  elsif no_shows >= 4 or rel < 40 then sev := 4;
  elsif no_shows >= 3 or rel < 50 then sev := 3;
  elsif no_shows >= 2 or rel < 60 then sev := 2;
  elsif no_shows >= 1 or rel < 70 then sev := 1;
  else sev := 0; end if;
  sev := greatest(sev, cur);                 -- monotone within window
  new_s := severity_standing(sev);

  v_until := case new_s
    when 'cooldown' then now() + interval '48 hours'
    when 'locked_ban' then now() + interval '14 days'
    else null end;

  if new_s is distinct from old_s then
    update profiles set standing = new_s, standing_until = v_until where id = p_user;
    insert into user_sanctions (user_id, from_standing, to_standing, reason, until, actor)
    values (p_user, old_s, new_s,
            format('auto: no_shows=%s reliability=%s safety=%s', no_shows, rel, safety_reports),
            v_until, null);
  end if;
end $fn$;

revoke all on function evaluate_standing(uuid) from public;
grant execute on function evaluate_standing(uuid) to service_role;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `standing ladder OK`).

- [ ] **Step 5: Add the `can_enter_lock_flow()` guard** (consumed by P5's accept/offer RPCs)

Append to the same migration:
```sql
-- P5's offer-accept / lock-create RPCs must call this before locking.
create or replace function can_enter_lock_flow(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select case
      when standing in ('locked_ban','suspended') then false
      when standing = 'cooldown' and standing_until > now() then false
      else true end
    from profiles where id = p_user), true);
$fn$;
grant execute on function can_enter_lock_flow(uuid) to authenticated, service_role;
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260525130600_p7_standing.sql supabase/tests/p7_standing.sql
git commit -m "P7: enforcement ladder in DB (user_standing, user_sanctions, evaluate_standing, can_enter_lock_flow)"
```

---

## Task 9: Block propagation + rematch prevention

**Files:**
- Create: `supabase/migrations/20260525130700_p7_block_propagation.sql`
- Test: `supabase/tests/p7_block_propagation.sql`

- [ ] **Step 1: Write the failing test** (block → active offer passed, active lock cancelled(safety), rematch blocked)

```sql
-- supabase/tests/p7_block_propagation.sql
DO $$
DECLARE a uuid; b uuid; cid uuid; inst uuid; off_id uuid; lk uuid;
        v_off text; v_lock text; v_reason text; v_can boolean;
BEGIN
  insert into profiles (id,first_name) values (gen_random_uuid(),'a') returning id into a;
  insert into profiles (id,first_name) values (gen_random_uuid(),'b') returning id into b;
  insert into cities (slug,name,timezone,is_active) values ('p7b','p7b','UTC',true)
    on conflict (slug) do nothing; select id into cid from cities where slug='p7b';
  insert into itineraries (id,user_id) values (gen_random_uuid(),a);
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at,duration_min)
    select id,a,cid, now()+interval '2 days',120 from itineraries where user_id=a limit 1
    returning id into inst;
  insert into offers (date_instance_id,candidate_id,creator_id,status,expires_at)
    values (inst,b,a,'active', now()+interval '1 day') returning id into off_id;
  insert into locks (date_instance_id,creator_id,matched_user_id,status)
    values (inst,a,b,'active') returning id into lk;

  perform block_user(a, b);

  select status::text into v_off from offers where id=off_id;
  IF v_off <> 'passed' THEN RAISE EXCEPTION 'active offer not revoked on block (got %)', v_off; END IF;
  select status::text, cancel_reason::text into v_lock, v_reason from locks where id=lk;
  IF v_lock <> 'cancelled' OR v_reason <> 'safety' THEN
    RAISE EXCEPTION 'active lock not safely cancelled on block (% / %)', v_lock, v_reason; END IF;
  select can_rematch(a,b) into v_can;
  IF v_can THEN RAISE EXCEPTION 'blocked pair should not be allowed to rematch'; END IF;
  RAISE NOTICE 'block propagation OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function block_user(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130700_p7_block_propagation.sql
alter table locks add column if not exists rollover_frozen boolean not null default false;

-- can_rematch: false if a block (either direction) or an upheld safety report exists.
create or replace function can_rematch(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select not exists (
    select 1 from blocks
     where (blocker_id=p_a and blocked_id=p_b) or (blocker_id=p_b and blocked_id=p_a)
  ) and not exists (
    select 1 from reports
     where target_type='user' and reason in ('unsafe_or_disrespectful','safety_sos','harassment')
       and status='actioned'
       and ((reporter_id=p_a and target_id=p_b) or (reporter_id=p_b and target_id=p_a))
  );
$fn$;
grant execute on function can_rematch(uuid,uuid) to authenticated, service_role;

-- block_user: idempotent; propagates everywhere in one transaction.
create or replace function block_user(p_blocker uuid, p_blocked uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_blocker = p_blocked then raise exception 'cannot block self'; end if;
  insert into blocks (blocker_id, blocked_id) values (p_blocker, p_blocked)
    on conflict (blocker_id, blocked_id) do nothing;

  -- revoke any active offer between the pair (either direction)
  update offers set status='passed', resolved_at=now()
   where status='active'
     and ((creator_id=p_blocker and candidate_id=p_blocked)
       or (creator_id=p_blocked and candidate_id=p_blocker));

  -- cancel any active lock between the pair with safety reason (freezes §7.6 rollover)
  update locks set status='cancelled', cancel_reason='safety',
                   cancelled_by=p_blocker, rollover_frozen=true
   where status='active'
     and ((creator_id=p_blocker and matched_user_id=p_blocked)
       or (creator_id=p_blocked and matched_user_id=p_blocker));

  -- kill chat thread reveal if P6 is present (degrade gracefully otherwise)
  if to_regclass('public.chat_threads') is not null then
    execute $q$
      update chat_threads set revoked_at = now()
       where revoked_at is null
         and ((user_a=$1 and user_b=$2) or (user_a=$2 and user_b=$1))
    $q$ using p_blocker, p_blocked;
  end if;
end $fn$;

revoke all on function block_user(uuid,uuid) from public;
grant execute on function block_user(uuid,uuid) to authenticated, service_role;
```

> If P6's thread columns differ from `(user_a,user_b,revoked_at)`, adjust the dynamic SQL when P6 lands; the `to_regclass` guard keeps this migration safe to run before P6.

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Add the swipe-time rematch guard**

Append to the same migration — a trigger on `swipes` that blocks a right-swipe onto a date whose creator is un-rematchable:
```sql
create or replace function enforce_rematch_guard() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.direction = 'right' and not can_rematch(new.swiper_id, new.creator_id) then
    raise exception 'rematch blocked between % and %', new.swiper_id, new.creator_id
      using errcode = 'check_violation';
  end if;
  return new;
end $fn$;
create trigger swipes_rematch_guard before insert on swipes
  for each row execute function enforce_rematch_guard();
```
Add a sub-test to `p7_block_propagation.sql`: after `block_user`, inserting a right-swipe from b onto a's instance must raise.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260525130700_p7_block_propagation.sql supabase/tests/p7_block_propagation.sql
git commit -m "P7: block_user propagation (revoke offer/lock/chat) + can_rematch guard on swipe"
```

---

## Task 10: `file_report()` + safety-report rollover freeze

**Files:**
- Create: `supabase/migrations/20260525130800_p7_file_report.sql`
- Test: `supabase/tests/p7_file_report.sql`

- [ ] **Step 1: Write the failing test** (safety report on a lock freezes rollover; opens report)

```sql
-- supabase/tests/p7_file_report.sql
DO $$
DECLARE a uuid; b uuid; cid uuid; inst uuid; lk uuid; v_frozen boolean; v_reports int;
BEGIN
  insert into profiles (id,first_name) values (gen_random_uuid(),'a') returning id into a;
  insert into profiles (id,first_name) values (gen_random_uuid(),'b') returning id into b;
  insert into cities (slug,name,timezone,is_active) values ('p7f','p7f','UTC',true)
    on conflict (slug) do nothing; select id into cid from cities where slug='p7f';
  insert into itineraries (id,user_id) values (gen_random_uuid(),a);
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at,duration_min)
    select id,a,cid, now()+interval '2 days',120 from itineraries where user_id=a limit 1
    returning id into inst;
  insert into locks (date_instance_id,creator_id,matched_user_id,status)
    values (inst,a,b,'active') returning id into lk;

  perform file_report(b, 'lock', lk, 'harassment', 'made me uncomfortable');

  select rollover_frozen into v_frozen from locks where id=lk;
  IF v_frozen is not true THEN RAISE EXCEPTION 'safety report should freeze rollover'; END IF;
  select count(*) into v_reports from reports where target_type='lock' and target_id=lk;
  IF v_reports < 1 THEN RAISE EXCEPTION 'report row not written'; END IF;
  RAISE NOTICE 'file_report freeze OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function file_report(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130800_p7_file_report.sql
-- Files a report; safety/harassment classes freeze §7.6 rollover on the implicated lock.
create or replace function file_report(
  p_reporter uuid, p_target_type text, p_target_id uuid, p_reason text, p_detail text
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_safety boolean;
begin
  if p_target_type not in ('user','date_instance','message','lock') then
    raise exception 'invalid target_type %', p_target_type;
  end if;
  v_safety := p_reason in ('unsafe_or_disrespectful','safety_sos','harassment','threat','assault');

  insert into reports (reporter_id, target_type, target_id, reason, detail, status)
  values (p_reporter, p_target_type, p_target_id, p_reason, p_detail,
          case when v_safety then 'reviewing' else 'open' end)
  returning id into v_id;

  if v_safety then
    if p_target_type = 'lock' then
      update locks set rollover_frozen = true where id = p_target_id;
    elsif p_target_type = 'date_instance' then
      update locks set rollover_frozen = true where date_instance_id = p_target_id;
    end if;
  end if;
  return v_id;
end $fn$;

revoke all on function file_report(uuid,text,uuid,text,text) from public;
grant execute on function file_report(uuid,text,uuid,text,text) to authenticated, service_role;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130800_p7_file_report.sql supabase/tests/p7_file_report.sql
git commit -m "P7: file_report RPC + safety-class rollover freeze (§7.6)"
```

---

## Task 11: Safety check-in escalation table + RPC + safety center

**Files:**
- Create: `supabase/migrations/20260525130900_p7_safety_checkins.sql`
- Test: `supabase/tests/p7_safety_checkins.sql`

- [ ] **Step 1: Write the failing test** ("not safe" → alarm + emergency contact notified + report)

```sql
-- supabase/tests/p7_safety_checkins.sql
DO $$
DECLARE usr uuid; cre uuid; cid uuid; inst uuid; lk uuid; sc uuid;
        v_status text; v_notified timestamptz; v_reports int;
BEGIN
  insert into profiles (id,first_name) values (gen_random_uuid(),'u') returning id into usr;
  insert into profiles (id,first_name) values (gen_random_uuid(),'c') returning id into cre;
  insert into profiles_private (user_id, emergency_contact)
    values (usr, jsonb_build_object('name','Mom','phone','+1','share_optin',true));
  insert into cities (slug,name,timezone,is_active) values ('p7sc','p7sc','UTC',true)
    on conflict (slug) do nothing; select id into cid from cities where slug='p7sc';
  insert into itineraries (id,user_id) values (gen_random_uuid(),cre);
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at,duration_min)
    select id,cre,cid, now()-interval '40 min',120 from itineraries where user_id=cre limit 1
    returning id into inst;
  insert into locks (date_instance_id,creator_id,matched_user_id,status)
    values (inst,cre,usr,'active') returning id into lk;
  insert into safety_checkins (lock_id,user_id,status,due_at)
    values (lk,usr,'awaiting', now()) returning id into sc;

  perform respond_safety_checkin(sc, usr, 'alarm');

  select status::text, contact_notified_at into v_status, v_notified
    from safety_checkins where id=sc;
  IF v_status <> 'alarm' THEN RAISE EXCEPTION 'expected alarm, got %', v_status; END IF;
  IF v_notified is null THEN RAISE EXCEPTION 'opted-in emergency contact should be notified'; END IF;
  select count(*) into v_reports from reports where reason='safety_sos' and target_id=usr;
  IF v_reports < 1 THEN RAISE EXCEPTION 'SOS should open a safety report'; END IF;
  RAISE NOTICE 'safety check-in alarm escalation OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "safety_checkins" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130900_p7_safety_checkins.sql
create type safety_checkin_status as enum ('awaiting','ok','alarm','escalated','missed');

create table if not exists safety_checkins (
  id uuid primary key default gen_random_uuid(),
  lock_id uuid not null references locks(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  status safety_checkin_status not null default 'awaiting',
  due_at timestamptz not null,
  responded_at timestamptz,
  escalated_at timestamptz,
  contact_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lock_id, user_id)
);
create index if not exists safety_checkins_due_idx
  on safety_checkins(due_at) where status='awaiting';
create trigger set_safety_checkins_updated_at before update on safety_checkins
  for each row execute function set_updated_at();

alter table safety_checkins enable row level security;
do $$ begin
  create policy "safety_checkins_owner_read" on safety_checkins for select
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- respond_safety_checkin: 'ok' clears; 'alarm' notifies emergency contact + opens SOS report.
create or replace function respond_safety_checkin(p_id uuid, p_user uuid, p_response text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_lock uuid; v_optin boolean;
begin
  if p_response not in ('ok','alarm') then raise exception 'invalid response %', p_response; end if;
  select lock_id into v_lock from safety_checkins where id=p_id and user_id=p_user;
  if v_lock is null then raise exception 'check-in % not owned by %', p_id, p_user; end if;

  if p_response = 'ok' then
    update safety_checkins set status='ok', responded_at=now() where id=p_id;
  else
    select coalesce((emergency_contact->>'share_optin')::boolean, false)
      into v_optin from profiles_private where user_id=p_user;
    update safety_checkins
       set status='alarm', responded_at=now(),
           contact_notified_at = case when v_optin then now() else null end
     where id=p_id;
    insert into reports (reporter_id, target_type, target_id, reason, status)
      values (p_user, 'user', p_user, 'safety_sos', 'reviewing');  -- top-priority human review
    -- enqueue a high-priority T&S + (if opted-in) emergency-contact notification (P2)
    perform enqueue_job('safety_alarm_notify',
      jsonb_build_object('safety_checkin_id', p_id, 'lock_id', v_lock,
                         'user_id', p_user, 'notify_contact', v_optin));
  end if;
end $fn$;

revoke all on function respond_safety_checkin(uuid,uuid,text) from public;
grant execute on function respond_safety_checkin(uuid,uuid,text) to authenticated, service_role;

-- escalate_missed_checkin: called by the safety-escalation Edge Function for overdue 'awaiting' rows.
create or replace function escalate_missed_checkin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_user uuid; v_lock uuid; v_optin boolean;
begin
  select user_id, lock_id into v_user, v_lock from safety_checkins
   where id=p_id and status='awaiting';
  if v_user is null then return; end if;  -- already responded; nothing to do
  select coalesce((emergency_contact->>'share_optin')::boolean,false)
    into v_optin from profiles_private where user_id=v_user;
  update safety_checkins
     set status='escalated', escalated_at=now(),
         contact_notified_at = case when v_optin then now() else null end
   where id=p_id;
  perform enqueue_job('safety_escalation_notify',
    jsonb_build_object('safety_checkin_id', p_id, 'lock_id', v_lock,
                       'user_id', v_user, 'notify_contact', v_optin));
end $fn$;
revoke all on function escalate_missed_checkin(uuid) from public;
grant execute on function escalate_missed_checkin(uuid) to service_role;
```

> `enqueue_job(text, jsonb)` is the P2 contract; Task 12 supplies a standalone stub so this migration applies before P2.

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Add the safety-center read RPC** (append to the migration)

```sql
-- Single read surface backing the user-facing Safety Center (api-client helper in Task 13).
create or replace function safety_center(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'verification', (select verification from profiles where id=p_user),
    'standing',     (select standing from profiles where id=p_user),
    'standing_until',(select standing_until from profiles where id=p_user),
    'reliability_score', (select reliability_score from profiles where id=p_user),
    'emergency_contact_on_file',
      (select (emergency_contact ? 'phone') from profiles_private where user_id=p_user),
    'active_locks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'lock_id', l.id, 'starts_at', di.starts_at, 'venue_id', di.venue_id,
        'my_checkin', (select status from safety_checkins
                        where lock_id=l.id and user_id=p_user))), '[]'::jsonb)
      from locks l join date_instances di on di.id=l.date_instance_id
      where l.status='active' and p_user in (l.creator_id, l.matched_user_id)),
    'blocks', (select coalesce(jsonb_agg(blocked_id), '[]'::jsonb)
                 from blocks where blocker_id=p_user),
    'reports_filed', (select count(*) from reports where reporter_id=p_user)
  );
$fn$;
grant execute on function safety_center(uuid) to authenticated, service_role;
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260525130900_p7_safety_checkins.sql supabase/tests/p7_safety_checkins.sql
git commit -m "P7: safety_checkins escalation (respond/escalate) + safety_center read RPC"
```

---

## Task 12: `jobs` enqueue contract (P2 bridge) + scheduled-job rows P7 owns

**Files:**
- Create: `supabase/migrations/20260525131000_p7_jobs_bridge.sql`
- Test: `supabase/tests/p7_jobs_bridge.sql`

- [ ] **Step 1: Write the failing test** (locking a date enqueues reconfirm + safety check-in jobs)

```sql
-- supabase/tests/p7_jobs_bridge.sql
DO $$
DECLARE cre uuid; usr uuid; cid uuid; inst uuid; lk uuid; v_jobs int;
BEGIN
  insert into profiles (id,first_name) values (gen_random_uuid(),'c') returning id into cre;
  insert into profiles (id,first_name) values (gen_random_uuid(),'u') returning id into usr;
  insert into cities (slug,name,timezone,is_active) values ('p7j','p7j','UTC',true)
    on conflict (slug) do nothing; select id into cid from cities where slug='p7j';
  insert into itineraries (id,user_id) values (gen_random_uuid(),cre);
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at,duration_min)
    select id,cre,cid, now()+interval '2 days',120 from itineraries where user_id=cre limit 1
    returning id into inst;
  -- inserting an ACTIVE lock should enqueue the day-of reconfirm + safety check-in jobs
  insert into locks (date_instance_id,creator_id,matched_user_id,status)
    values (inst,cre,usr,'active') returning id into lk;

  select count(*) into v_jobs from jobs
   where kind in ('day_of_reconfirm','safety_checkin') and payload->>'lock_id' = lk::text;
  IF v_jobs < 2 THEN RAISE EXCEPTION 'lock should enqueue reconfirm + safety check-in (got %)', v_jobs; END IF;
  RAISE NOTICE 'jobs bridge OK (% jobs)', v_jobs;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "jobs" does not exist` if P2 absent; otherwise no jobs enqueued).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525131000_p7_jobs_bridge.sql
-- P2 owns the rich jobs table + runner. P7 only INSERTS. If P2 hasn't landed,
-- create a minimal compatible jobs table so P7 is testable standalone; if P2's
-- table already exists, `create table if not exists` is a no-op and we insert into it.
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}',
  run_at timestamptz not null default now(),
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
alter table jobs enable row level security;  -- service-role only (no policies)

-- enqueue_job: P2-compatible insert helper. Idempotent-by-design at the call site.
create or replace function enqueue_job(p_kind text, p_payload jsonb, p_run_at timestamptz default now())
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  insert into jobs (kind, payload, run_at) values (p_kind, p_payload, p_run_at)
  returning id into v_id;
  return v_id;
end $fn$;
grant execute on function enqueue_job(text, jsonb, timestamptz) to service_role;

-- On lock activation, schedule the day-of reconfirm and the +30m safety check-in.
-- (Mandatory reconfirm for reconfirm_required users is enforced separately by P5's
--  accept-RPC reading profiles.standing; this just schedules the default prompt.)
create or replace function schedule_lock_safety_jobs() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_start timestamptz; v_dur int;
begin
  if tg_op='INSERT' and new.status='active' then
    select starts_at, duration_min into v_start, v_dur
      from date_instances where id=new.date_instance_id;
    perform enqueue_job('day_of_reconfirm',
      jsonb_build_object('lock_id', new.id),
      v_start - interval '12 hours');
    perform enqueue_job('safety_checkin',
      jsonb_build_object('lock_id', new.id),
      v_start + interval '30 minutes');
    perform enqueue_job('rating_window_close',
      jsonb_build_object('lock_id', new.id),
      v_start + make_interval(mins => coalesce(v_dur,150)) + interval '72 hours');
  end if;
  return new;
end $fn$;
create trigger locks_schedule_safety_jobs after insert on locks
  for each row execute function schedule_lock_safety_jobs();
```

> When P2 lands with its own `jobs` schema, drop this file's `create table jobs` block (keep `enqueue_job` + the trigger) in a follow-up P2 migration if columns differ. The contract P7 relies on is only `(kind text, payload jsonb, run_at timestamptz)`.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `jobs bridge OK (3 jobs)`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525131000_p7_jobs_bridge.sql supabase/tests/p7_jobs_bridge.sql
git commit -m "P7: jobs enqueue bridge + lock-triggered reconfirm/check-in/rating-window scheduling"
```

---

## Task 13: `attendance-checkin` Edge Function (geofence compute)

**Files:**
- Create: `supabase/functions/attendance-checkin/index.ts`
- Create: `supabase/functions/attendance-checkin/geofence.ts`
- Create: `supabase/functions/attendance-checkin/geofence_test.ts`
- Modify: `supabase/config.toml` (register the function; `verify_jwt = true`)

- [ ] **Step 1: Write the failing test** (haversine distance + geofence verdict, pure)

```ts
// supabase/functions/attendance-checkin/geofence_test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { haversineMeters, withinGeofence, GEOFENCE } from './geofence.ts';

Deno.test('haversine ~0 at same point', () => {
  assertEquals(Math.round(haversineMeters(49.888, -119.496, 49.888, -119.496)), 0);
});

Deno.test('within geofence: at venue, good accuracy', () => {
  const d = haversineMeters(49.888, -119.496, 49.8881, -119.4961);
  assertEquals(withinGeofence(d, 20), true);
});

Deno.test('outside geofence: 1km away rejected', () => {
  const d = haversineMeters(49.888, -119.496, 49.897, -119.496); // ~1km north
  assertEquals(withinGeofence(d, 20), false);
});

Deno.test('rejected when accuracy worse than MAX', () => {
  assertEquals(withinGeofence(10, GEOFENCE.MAX_ACCURACY_M + 1), false);
});
```

- [ ] **Step 2: Run it, expect FAIL.** Run: `deno test --allow-env supabase/functions/attendance-checkin/geofence_test.ts`

- [ ] **Step 3: Write the pure geofence module**

```ts
// supabase/functions/attendance-checkin/geofence.ts
export const GEOFENCE = { RADIUS_M: 150, MAX_ACCURACY_M: 200 } as const;

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function withinGeofence(distanceM: number, accuracyM: number): boolean {
  return distanceM <= GEOFENCE.RADIUS_M && accuracyM <= GEOFENCE.MAX_ACCURACY_M;
}
```

- [ ] **Step 4: Re-run, expect PASS.**

- [ ] **Step 5: Write the handler** (auth user, fetch venue coords, compute, call `record_attendance_checkin`, then re-run `adjudicate_no_show` defensively)

```ts
// supabase/functions/attendance-checkin/index.ts
// Receives {lock_id, lat, lng, accuracy_m}; computes server-side distance to the
// venue and persists a check-in via the SECURITY DEFINER RPC. Distance/geofence are
// NEVER trusted from the client.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';
import { haversineMeters, withinGeofence } from './geofence.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { lock_id, lat, lng, accuracy_m } = await req.json();
    if (!lock_id || typeof lat !== 'number' || typeof lng !== 'number') {
      return json({ error: 'lock_id, lat, lng required' }, 400);
    }
    const authHeader = req.headers.get('Authorization') ?? '';
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // identify the caller from their JWT
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    const admin = createClient(url, service);
    // fetch venue coords for the lock's instance (service role; bypasses RLS)
    const { data: di, error: diErr } = await admin
      .from('date_instances')
      .select('venue_id, places:venue_id (lat, lng)')
      .eq('id', (await admin.from('locks').select('date_instance_id').eq('id', lock_id).single()).data?.date_instance_id)
      .single();
    if (diErr || !di?.places?.lat) return json({ error: 'venue coordinates unavailable' }, 422);

    const distance = haversineMeters(lat, lng, di.places.lat, di.places.lng);
    const within = withinGeofence(distance, accuracy_m ?? 9999);

    const { data: id, error } = await admin.rpc('record_attendance_checkin', {
      p_lock_id: lock_id, p_user: user.id, p_lat: lat, p_lng: lng,
      p_accuracy_m: accuracy_m ?? null, p_distance_m: distance, p_within: within,
    });
    if (error) return json({ error: error.message }, 400);
    // a fresh proof may flip an existing disputed no-show; re-adjudicate
    await admin.rpc('adjudicate_no_show', { p_lock_id: lock_id });

    return json({ checkin_id: id, distance_m: Math.round(distance), within_geofence: within }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 6: Register in config.toml**

```toml
[functions.attendance-checkin]
verify_jwt = true
```

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/attendance-checkin/ supabase/config.toml
git commit -m "P7: attendance-checkin Edge Function (server-side geofence) + tested haversine"
```

---

## Task 14: `safety-escalation` Edge Function (missed check-in escalation)

**Files:**
- Create: `supabase/functions/safety-escalation/index.ts`
- Create: `supabase/functions/safety-escalation/index_test.ts`
- Modify: `supabase/config.toml` (register; `verify_jwt = false` — invoked by the P2 runner with the service key)

- [ ] **Step 1: Write the failing test** (overdue-awaiting selection logic is pure + tested)

```ts
// supabase/functions/safety-escalation/index_test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { isOverdue, GRACE_MS } from './index.ts';

Deno.test('awaiting + past grace = overdue', () => {
  const due = new Date(Date.now() - GRACE_MS - 1000).toISOString();
  assertEquals(isOverdue({ status: 'awaiting', due_at: due }), true);
});
Deno.test('awaiting within grace = not overdue', () => {
  const due = new Date(Date.now() - 1000).toISOString();
  assertEquals(isOverdue({ status: 'awaiting', due_at: due }), false);
});
Deno.test('already ok = never overdue', () => {
  const due = new Date(Date.now() - GRACE_MS - 1000).toISOString();
  assertEquals(isOverdue({ status: 'ok', due_at: due }), false);
});
```

- [ ] **Step 2: Run it, expect FAIL.** Run: `deno test --allow-env supabase/functions/safety-escalation/index_test.ts`

- [ ] **Step 3: Write the handler** (pure `isOverdue` export + service-role sweep calling `escalate_missed_checkin`)

```ts
// supabase/functions/safety-escalation/index.ts
// Invoked by the P2 scheduler. Finds 'awaiting' safety check-ins past the grace
// window and escalates them (escalate_missed_checkin RPC notifies the emergency
// contact when opted in). MISSING the check-in is itself the escalation trigger.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export const GRACE_MS = 30 * 60 * 1000; // 30 minutes

export function isOverdue(row: { status: string; due_at: string }): boolean {
  if (row.status !== 'awaiting') return false;
  return Date.now() - new Date(row.due_at).getTime() >= GRACE_MS;
}

serve(async () => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service);

  const { data: rows, error } = await admin
    .from('safety_checkins')
    .select('id, status, due_at')
    .eq('status', 'awaiting');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let escalated = 0;
  for (const row of rows ?? []) {
    if (isOverdue(row)) {
      await admin.rpc('escalate_missed_checkin', { p_id: row.id });
      escalated++;
    }
  }
  return new Response(JSON.stringify({ checked: rows?.length ?? 0, escalated }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 4: Re-run, expect PASS.**

- [ ] **Step 5: Register in config.toml**

```toml
[functions.safety-escalation]
verify_jwt = false
```

> **P2 hand-off:** P2's runner must (a) on `safety_checkin` job fire, insert a `safety_checkins` row (`status='awaiting'`, `due_at=now`) and push the prompt, and (b) on a recurring tick, invoke this `safety-escalation` function. Documented here; built in P2.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/safety-escalation/ supabase/config.toml
git commit -m "P7: safety-escalation Edge Function (missed-check-in sweep → escalate_missed_checkin)"
```

---

## Task 15: `api-client` safety helpers (thin typed layer for web + native)

**Files:**
- Modify: `packages/api-client/src/index.ts`

- [ ] **Step 1: Add typed helpers** (no new test infra; these wrap the RPCs above and are exercised by app integration tests in P11)

Add to `packages/api-client/src/index.ts`:
```ts
// ─── Trust & Safety (P7) ────────────────────────────────────────────────

export async function submitRating(
  client: After5Client,
  args: { lockId: string; raterId: string; rateeId: string;
          showedUp: boolean; onTime: boolean; cancelledWithNotice: boolean; unsafe: boolean }
): Promise<string> {
  const { data, error } = await client.rpc('submit_rating', {
    p_lock_id: args.lockId, p_rater: args.raterId, p_ratee: args.rateeId,
    p_showed_up: args.showedUp, p_on_time: args.onTime,
    p_cancelled_with_notice: args.cancelledWithNotice, p_unsafe: args.unsafe,
  });
  if (error) throw error;
  return data as string;
}

export async function checkInAtVenue(
  client: After5Client,
  args: { lockId: string; lat: number; lng: number; accuracyM?: number }
): Promise<{ checkin_id: string; distance_m: number; within_geofence: boolean }> {
  const { data, error } = await client.functions.invoke('attendance-checkin', {
    body: { lock_id: args.lockId, lat: args.lat, lng: args.lng, accuracy_m: args.accuracyM },
  });
  if (error) throw error;
  return data as { checkin_id: string; distance_m: number; within_geofence: boolean };
}

export async function blockUser(client: After5Client, blockerId: string, blockedId: string) {
  const { error } = await client.rpc('block_user', { p_blocker: blockerId, p_blocked: blockedId });
  if (error) throw error;
}

export async function fileReport(
  client: After5Client,
  args: { reporterId: string; targetType: 'user' | 'date_instance' | 'message' | 'lock';
          targetId: string; reason: string; detail?: string }
) {
  const { error } = await client.rpc('file_report', {
    p_reporter: args.reporterId, p_target_type: args.targetType,
    p_target_id: args.targetId, p_reason: args.reason, p_detail: args.detail ?? null,
  });
  if (error) throw error;
}

export async function respondSafetyCheckin(
  client: After5Client, checkinId: string, userId: string, response: 'ok' | 'alarm'
) {
  const { error } = await client.rpc('respond_safety_checkin', {
    p_id: checkinId, p_user: userId, p_response: response,
  });
  if (error) throw error;
}

export async function getSafetyCenter(client: After5Client, userId: string): Promise<unknown> {
  const { data, error } = await client.rpc('safety_center', { p_user: userId });
  if (error) throw error;
  return data;
}
```

- [ ] **Step 2: Typecheck** Run: `pnpm --filter @after5/api-client build` (or repo `pnpm -w typecheck`). Expect clean (RPC names match the migrations; `Database` types regenerate in Task 16).

- [ ] **Step 3: Commit**

```bash
git add packages/api-client/src/index.ts
git commit -m "P7: api-client safety helpers (submitRating/checkIn/block/report/safetyCheckin/safetyCenter)"
```

---

## Task 16: Full reset, regenerate types, run all P7 tests

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)

- [ ] **Step 1: Full reset** Run: `supabase db reset` — all P0 + P7 migrations apply in filename order with no error.

- [ ] **Step 2: Run every P7 SQL test**

```bash
for f in supabase/tests/p7_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expected: each exits 0; notices print `… OK`.

- [ ] **Step 3: Run TS + Deno tests**

```bash
pnpm --filter @after5/business test
deno test --allow-env supabase/functions/attendance-checkin/geofence_test.ts supabase/functions/safety-escalation/index_test.ts
```
Expected: all green.

- [ ] **Step 4: Regenerate types** Run: `pnpm db:types`
Expected: `packages/types/src/database.ts` gains `attendance_checkins`, `safety_checkins`, `user_sanctions`, `jobs`, the `user_standing`/`safety_checkin_status` enums, new `match_ratings`/`locks`/`profiles` columns, and the new functions.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P7: regenerate database types for trust/safety/ratings schema"
```

---

## Self-Review

**Spec coverage (vs roadmap P7 'Delivers' + 'Closes'):**
- Structured ratings into `match_ratings` (4 booleans) → Task 2 `submit_rating`. ✅
- Blind-until-both reveal (or window close) → Task 1 columns + Task 2 reveal logic + Task 12 `rating_window_close` job. ✅
- Reliability score: recency-weighting + min-volume-before-it-counts, written to `profiles.reliability_score`, formula defined concretely → D1 + Task 3 (TS oracle) + Task 4 (SQL parity). ✅
- Enforcement ladder (warning→cooldown→lower priority→mandatory reconfirm→temp lock-ban→suspension) with data + checks → D4 + Task 7 (math) + Task 8 (`user_standing`, `user_sanctions`, `evaluate_standing`, `can_enter_lock_flow`). ✅
- Proof of attendance: geofenced check-in record + disputed-no-show adjudication → D3 + Task 5 (`attendance_checkins`) + Task 6 (`adjudicate_no_show`) + Task 13 (geofence Edge Function). ✅
- Report/block flows with full propagation (hide content, revoke reveal, prevent rematch) → D5 + Task 9 (`block_user`, `can_rematch`, swipe guard) + Task 10 (`file_report`, rollover freeze). ✅
- Emergency contact + safety check-in escalation policy (what happens if a check-in is missed) → D6 + Task 11 (`safety_checkins`, `respond_safety_checkin`, `escalate_missed_checkin`) + Task 14 (escalation sweep). ✅
- User-facing safety center → Task 11 `safety_center` RPC + Task 15 `getSafetyCenter` helper. ✅
- Closes "no-show has no proof" → geofence check-in adjudication (Tasks 5/6/13). ✅
- Closes "ratings lifecycle/retaliation" → blind-until-both + window close + dispute weighting (Tasks 1/2/6). ✅
- Closes "fake safety UI" → real backend for check-in + emergency escalation (Tasks 11/13/14). ✅
- Closes "dead block/report" → propagating RPCs (Tasks 9/10). ✅

**Builds on P0 (no re-creation):** extends `match_ratings`, `locks`, `profiles`, `reports`, `blocks`, `profiles_private.emergency_contact`, `date_instances`, `places`, `swipes`, reuses `audit_log` + `set_updated_at()` + `cancel_reason`/`lock_status` enums. New tables only: `attendance_checkins`, `safety_checkins`, `user_sanctions`, plus the `jobs` *bridge* (no-op if P2's exists).

**Dependency hand-offs documented, not duplicated:** P2 (`jobs` runner + push + scheduling `safety_checkins` rows + invoking `safety-escalation`) — Tasks 12/14 note the contract. P5 (calls `can_enter_lock_flow`, `can_rematch`, reads `standing`/`rollover_frozen`) — Tasks 8/9. P6 (`chat_threads.revoked_at`) — Task 9 with `to_regclass` guard so it runs either order. P8 (moderator upholds reports → `status='actioned'` feeds ladder + lifts dispute) — consumed by `evaluate_standing`/`can_rematch`.

**Conventions honored:** migrations numbered after P0 (`1300xx`–`1310xx`), RLS on every new table, idempotent `do $$ … duplicate_object … $$` policies, all writes via `SECURITY DEFINER` RPCs (default-deny direct writes), `set_updated_at()` triggers on `safety_checkins`, psql `DO`-block tests that `RAISE EXCEPTION`/`ROLLBACK`, vitest for business, `Deno.test` for Edge Functions.

**Parity guard:** the reliability formula and ladder exist twice (TS oracle + SQL); Task 4's `p7_reliability_parity.sql` pins the SQL to the TS oracle's published number (87.50 for 3 perfect dates) so they cannot silently diverge. Standing parity is covered by matching threshold tables in Task 7 (TS) and Task 8 (SQL) plus the `p7_standing.sql` behavior test.

**Forward-reference handling:** `submit_rating` (Task 2) and `recompute_reliability` (Task 4) call functions defined in later migrations; resolved by no-op stubs at the top of the earlier migration, superseded by `create or replace` real bodies in later (higher-numbered) migrations — `supabase db reset` stays clean at every step. Noted inline at Tasks 2 and 4.

**Placeholder scan:** none — every step has runnable SQL/TS/Deno and exact commands.

**Risk notes:**
- The geofence radius (150 m) and accuracy ceiling (200 m) are tunable constants in one module; urban GPS multipath may need per-venue overrides (future).
- Adjudication assumes a venue has `lat/lng`; for venueless/at-home or live-event instances without coords, `record_attendance_checkin` stores the check-in but `within_geofence` defaults false → no-show stays *unverified* (0.5 weight), never wrongly *disproven*. Safe-by-default.
- `evaluate_standing` reads moderator-upheld reports (`status='actioned'`); until P8 ships the console, only the auto no-show/reliability arms of the ladder fire — the safety-report arms wait for human action, which is the correct conservative behavior.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-p7-trust-safety-ratings.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.

**2. Inline Execution** — execute tasks in this session via executing-plans with checkpoints.

**Prerequisite before executing:** P0 must be applied (its migrations present). P2/P5/P6 may be absent — Tasks 12/9/14 degrade gracefully — but the safety check-in *prompting* and the escalation *sweep cadence* only become live once P2's runner is wired (documented hand-offs in Tasks 12/14).
