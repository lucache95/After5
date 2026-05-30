> ⚠️ STALE / DO NOT EXECUTE — superseded by docs/after5-current-implementation-plan.md and docs/INTEGRATION-CONTRACT.md (2026-05-30). Kept for history only. May reference phantom columns, scalar return shapes, and wrong ownership.

SUBORDINATE EXECUTION SLICE. This plan is not authoritative by itself. It must be implemented only through INTEGRATION-CONTRACT.md v2 and RECONCILED-MASTER-PLAN.md. If this file conflicts with either, this file loses.

# P7 — Trust, Safety & Ratings (+ Proof of Attendance) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Conformance note (read first).** This is the **S8 — Trust & Safety** execution slice of the RECONCILED-MASTER-PLAN. It is subordinate to `INTEGRATION-CONTRACT.md` (v2, incl. C11). The shared spine it consumes — `standing standing_state`/`account_lifecycle` columns (C3), the `can_enter_lock_flow` gate (defined in **S2**, called by **P5/S6** — P7 does NOT define or wire it), the single `jobs` table + `enqueue_job`/`cancel_jobs` (C1), `notifications`/`devices`/`dispatch_notification` + `admin_alerts` (C1/C11.8), `reports`/`disputes` DDL + `report_status` keeping `actioned`/`reviewing` (C5/C11.6), `match_ratings` columns + `file_report` canonical writer (C5), `match_cancel_lock` (C2), chat-core thread hooks (C9/C11.7), and `_fixtures.sql` `mk_user`/`mk_itinerary`/`mk_instance` (C8) — is **owned elsewhere and only referenced here**. P7 owns: the **enforcement ladder that WRITES `profiles.standing`** (C3), the **reliability score** (EWMA → `profiles.reliability_score`), the **`disputes` table** + geofenced no-show adjudication that writes it (C11.6), **`attendance_checkins`**, **`safety_checkins`** escalation, and the **safety-center** read API. Migration band: **`128000`–`1289xx`** (C6).

**Goal:** Make After5's post-lock trust machinery *real*: structured ratings that resist retaliation, a reliability score with a concrete recency-weighted formula and min-volume gating, an enforcement ladder driven by data (not vibes), a **geofenced proof-of-attendance check-in** so no-show penalties are not pure self-report, report/block flows that actually **propagate** (hide content, revoke reveal, prevent rematch), an **emergency-contact + safety-check-in escalation policy** with backend teeth, and a user-facing **safety center** API.

**Architecture:** Build *on top of* the shared spine (S1/S2) — `match_ratings`, `locks`/`lock_participants`, `reports`, `disputes`, `blocks`, `profiles` (`reliability_score`, `standing standing_state`, `account_state account_lifecycle`), `audit_log`, `date_instances` (with `time_range` + `venue_id`), `swipes`, `queue_entries`, `offers`, the C1 `jobs` table + `enqueue_job`/`cancel_jobs`, `dispatch_notification`, `admin_alerts`. The heart of every state-mutating safety action is a **`SECURITY DEFINER` Postgres function** invoked over RPC that **derives the actor from `auth.uid()`** (C10 — never trust a passed actor id), so RLS stays default-deny for direct writes and invariants live in the DB. Pure scoring math (the reliability formula, ladder threshold evaluation) lives in **`packages/business`** as I/O-free functions (vitest-tested, portable to Deno + Node), and is *also* re-implemented as the canonical SQL the DB function uses — the TS version is the spec/oracle the SQL must match (a parity test asserts they agree). Two **Edge Functions** (Deno) cover the things the DB can't do alone: the **geofence adjudication** of disputed no-shows (PostGIS distance at submit time) and the **safety check-in escalation** webhook the C1 job runner (owner S2) calls.

> **Canonical references (do not redefine — one-line pointers per Build Rule 3):**
> - `can_enter_lock_flow(p_user)` gate → **defined in S2** (C3), **called by P5 `match_make_offer`/`match_accept_offer`** (S6). P7 only writes the `standing` it reads; P7 does NOT define the gate and does NOT wire it into P5 (P5 already calls it).
> - `jobs` + `job_type`/`job_status` + `enqueue_job`/`cancel_jobs` → **C1, owner P2/S2**. P7 only enqueues with the C1 signature.
> - `dispatch_notification`/`notifications`/`devices` + `admin_alerts` "fail-loud" sink → **C1/C11.8, owner P2/S2**. P7 consumes.
> - `reports` + `report_status` (keeps `actioned`/`reviewing`) + `report_reason_category` + `file_report(...)` canonical writer → **C5/C11.6, owner P8 schema (in S1)**. P7 calls `file_report`, reads `status='actioned'`.
> - `disputes` table → **C11.6, owned by P7 (this plan), band `128xxx`**; P8's resolution RPC calls back `recompute_reliability` + clears `match_ratings.disputed` (bidirectional loop).
> - `match_ratings` (P0/S1) base columns; `match_cancel_lock(p_actor,p_lock,p_reason,p_idem_key)` → **C2, owner P5/S6**.
> - chat-thread reveal/`revoked_at` + reveal predicate → **C9/C11.7, owner P6/chat-core**. `match_reveal_allowed` (C2) is the only reveal predicate.
> - `_fixtures.sql` `mk_user`/`mk_itinerary`/`mk_instance` → **C8, owner P0/S1**.

**Tech Stack:** Supabase Postgres + SQL migrations (`supabase/migrations/`), RLS with `auth.uid()`, PostGIS (geofence distance — already enabled in P0 Task 1), psql invariant/behavior tests (`supabase/tests/`), `SECURITY DEFINER` RPCs, `packages/business` pure TS (vitest), Edge Functions (`supabase/functions/`, Deno, `Deno.test`).

**Source docs:** spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` §8 (and §7.6 safety-gated auto-roll, §6 audit log); roadmap `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (P7 scope + Closes); foundation `docs/superpowers/plans/2026-05-25-p0-data-model.md` (all tables this builds on).

**Depends on (cross-stage — these ship before this slice and are referenced, not rebuilt):**
- **Depends on S1 (schema spine):** `profiles` (`reliability_score numeric(4,2)`, `standing standing_state not null default 'good'`, `account_state account_lifecycle`, `verification`); `profiles_private` (`emergency_contact jsonb`); `date_instances` (`venue_id`, `time_range`, `starts_at`, `duration_min`); `places` (`lat`, `lng`); `match_ratings` (`lock_id`, `rater_id`, `ratee_id`, four boolean outcomes, `submitted_at`, `unique(lock_id, rater_id)` — **P0/S1 owns this table**); `locks`/`lock_participants`; `swipes`/`queue_entries`/`offers`; `blocks`; `reports` + `report_status` (keeps `actioned`/`reviewing`, C5) + `report_reason_category` (C5/C11.6); `disputes` table (C11.6 — **owned by this plan**, placed in S1's schema-spine intent but timestamped in P7's band); `standing_state`/`account_lifecycle` enums (C3); `audit_log` + `set_updated_at()`; `cancel_reason`/`lock_status` enums; `_fixtures.sql` `mk_user`/`mk_itinerary`/`mk_instance` (C8).
- **Depends on S2 (async/config/notify/gate spine):** the C1 `jobs` table + `job_type`/`job_status` + `enqueue_job(p_type job_type, p_run_after timestamptz, p_payload jsonb, p_dedup_key text)`/`cancel_jobs` runner; `dispatch_notification(p_user, p_type notification_type, p_payload)` + `notifications`/`devices`/`notification_preferences`; `admin_alerts` table + ops sink (C11.8 fail-loud); **`can_enter_lock_flow(p_user)` gate** (C3 — defined here, NOT in P7).
- **Depends on S6 (P5 match API):** `match_cancel_lock(p_actor, p_lock, p_reason cancel_reason, p_idem_key)` (C2 — the only sanctioned lock-cancel path); P5 already calls `can_enter_lock_flow` on `match_make_offer`/`match_accept_offer` (P7 does NOT add that call). P5 reads `profiles.standing` for throttle/reconfirm rungs.
- **Depends on S9 (P8 moderation):** P8 upholds reports (`status='actioned'`, C5) which P7's ladder reads; **P8's dispute-resolution RPC calls back `recompute_reliability(user)` + clears `match_ratings.disputed`** (C11.6 bidirectional loop). P7 writes the `disputes` row; P8 resolves it.
- **Depends on S7 (P6 chat):** chat threads carry `revoked_at` (C9); `match_reveal_allowed` (C2) is the only reveal predicate. P7's block propagation references the chat-revoke hook; it does not define a competing thread model.

**Conventions (follow exactly, same as P0):** migration filenames `YYYYMMDDHHMMSS_snake_description.sql` — **P7 uses the `128000`–`1289xx` band (C6)**, sorting after P2 (`123xxx`) and P5 (`126xxx`) so the spine it reads already exists; enable RLS on every new table; create policies idempotently with `do $$ begin create policy … exception when duplicate_object then null; end $$;`; attach `set_updated_at()` to tables with `updated_at`; `auth.uid()` in policies; uuid PKs via `gen_random_uuid()`; every state-mutating safety action goes through a `SECURITY DEFINER` function with `set search_path = public` that **asserts `p_actor = auth.uid()` or derives the actor from `auth.uid()`** (C10), and internal helpers `revoke execute from public, authenticated`; every status mutation reaches `audit_log`.

**Local test loops:**
- SQL: `supabase db reset` then `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>`. Tests use `DO $$ … END $$;` blocks that `RAISE EXCEPTION` on wrong behavior; clean exit = PASS. **Every test `\i`'s `supabase/tests/_fixtures.sql` and creates users/itineraries/instances via `mk_user`/`mk_itinerary`/`mk_instance` (C8) — no bare inserts into `profiles`/`itineraries` (which seeds `auth.users` and satisfies `itineraries` NOT-NULLs).** `ROLLBACK` at the end.
- TS (business): `pnpm --filter @after5/business test` (vitest, single root config per C10 — P7 ships no vitest config).
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

`match_ratings` rows exist the moment a party submits, but a rating is **`revealed`** only when **both** parties have submitted **OR** the **rating window closes** (`lock` scheduled end + `RATING_WINDOW = 72h`). We add a nullable `revealed_at` (and a `disputed` flag + `weight`) to `match_ratings` (P0/S1 owns the base table; this is an `alter table` add). Before `revealed_at`, neither party can read the *other's* row (S1 RLS restricts `select` to `rater_id = auth.uid()`), and the score recompute ignores unrevealed rows. A C1 job of type **`rating_window`** (enqueued via `enqueue_job('rating_window', …)`; runner owned by S2) calls P7's `close_rating_window(lock_id)` RPC at the deadline to flip lone ratings to revealed, so a non-responding counterparty cannot indefinitely hide a bad review. Serious flags (`unsafe_or_disrespectful = true`) **also auto-open a `report` via the canonical `file_report(...)` writer** (C5) with `reason_category='safety_threat'` (routed to P8 moderation) regardless of reveal state.

### D3 — Proof of attendance & no-show adjudication (geofenced check-in)

The penalty-bearing claim is **"the other person did not show up"** (`showed_up = false` in your rating of them). To stop that from being pure self-report, each party may file an **attendance check-in** at the venue: a record `attendance_checkins(lock_id, user_id, lat, lng, accuracy_m, distance_m, within_geofence, captured_at)`. The Edge Function `attendance-checkin` computes `distance_m` from the device coords to `places.lat/lng` (PostGIS) and sets `within_geofence = distance_m <= GEOFENCE_RADIUS_M (default 150) AND accuracy_m <= MAX_ACCURACY_M (200) AND captured_at within [starts_at − 30m, starts_at + duration + 30m]`.

**Adjudication rule (deterministic, in `adjudicate_no_show(lock_id)`):** when party A rates party B `showed_up = false`:
- If **B (the accused) has a valid geofenced check-in** AND **A (the claimant) does NOT** → the no-show claim is **contradicted by proof and the claimant cannot prove they showed**. Mark A's rating `disputed = true` and **write a `disputes` row** (`kind='no_show'`, `state='open'`, C11.6) so a human resolves the conflict; B's score is unaffected **pending resolution**. *(Fixes audit A1: proof of the accused's presence alone no longer permanently shields a serial no-show — see the resolution loop below. It only defers to a human, and the disputed weight is restored/penalized by P8's callback, not frozen forever.)*
- If **B has no valid check-in** AND **A does** (A proved they were there) → the no-show is **corroborated**; the penalty stands and counts immediately at full weight.
- If **both** checked in → genuinely ambiguous; mark `disputed = true` and write a `disputes` row for human resolution (one of them is lying; neither side's score moves until P8 rules).
- If **neither** checked in → the no-show is **unverified self-report**: it still records, but with **reduced weight** (`w *= UNVERIFIED_NOSHOW_WEIGHT = 0.5`) until/unless a human reviews. (We never *fully* trust an unproven no-show, and never *fully* ignore it.)

**Bidirectional dispute loop (C11.6 — fixes audit B6/A1).** A contested no-show writes a `disputes` row (`kind='no_show'`); P8's resolution RPC (owner S9) updates `disputes.state` **and** calls back `recompute_reliability(user)` **and** clears `match_ratings.disputed` for the resolved lock. So a moderator overturning a dispute *restores* the wronged party's penalty on the liar (or clears a false claim) — the disputed rating is never frozen out of the score permanently. P7 owns the write side (`disputes` row + the recompute callback being callable); P8 owns the resolve side. `adjudicate_no_show` does **not** write a `reports` row for the dispute (the `disputes` table is the canonical dispute surface, C11.6); a separate safety `file_report` may still be filed for abuse.

### D4 — Enforcement ladder (data-driven)

A user's **standing** is recomputed whenever ratings/reports change, written into the **C3 column `profiles.standing standing_state`** (enum `good | warned | cooldown | throttled | reconfirm_required | locked_ban | suspended` — **owned by C3, NOT redefined here**) plus a `user_sanctions` audit table (every transition, with `reason`, `until`, `actor`). P7 **owns the ladder that writes `standing`**; it does **NOT** define the `standing_state` enum (S1) and does **NOT** define the `can_enter_lock_flow` gate (S2 owns it, P5/S6 calls it). Drivers and thresholds (in `evaluate_standing(user_id)` / TS `evaluateStanding`):

| Trigger (within trailing 60 days unless noted) | New standing | Effect — enforced where (consumer already wired per contract) |
|---|---|---|
| 1 corroborated/ unverified no-show OR reliability dips below 70 | `warned` | `dispatch_notification(account)` (C1); no flow block |
| 2 no-shows, OR reliability < 60 | `cooldown` | `can_enter_lock_flow` (S2) returns false while `standing='cooldown'`; P5's `match_make_offer`/`match_accept_offer` already call it (C3) for `COOLDOWN = 48h` |
| 3 no-shows, OR reliability < 50 | `throttled` | P4 feed rank / P5 queue priority read `profiles.standing` (their concern, not P7's) |
| 4 no-shows, OR reliability < 40 | `reconfirm_required` | P5 reads `standing` and enqueues the C1 `day_of_reconfirm`/`reconfirm_timeout` job (its concern) |
| 5 no-shows in 60d, OR any **upheld** safety `report` (`status='actioned'`, C5) | `locked_ban` | `can_enter_lock_flow` (S2) returns false for `standing='locked_ban'`; `LOCKBAN = 14d` |
| 2 upheld safety reports, OR a severe moderator action | `suspended` | `can_enter_lock_flow` (S2) returns false; P8 suspend also writes `standing='suspended'` (C3); P8's `suspensions` is an audit log only (C3/C11.5) |

> **Single source of truth (C3, fixes audit D-4/B1/M2/M3):** `profiles.standing` is the moderation/reliability gate. P7 writes it; **`can_enter_lock_flow` (S2) reads it and P5 (S6) already calls that gate** — P7 does NOT add the call and does NOT define `can_enter_lock_flow`. There is no separate P7 gate, no `rollover_frozen` flag owned by P7 (rollover/lock-cancel semantics live in P5's `match_cancel_lock`, C2), and no competing `account_active()`/`suspensions` source of truth.

Standing is **monotone-by-severity within a window** (you can't be auto-downgraded from `suspended` to `warned`; only a moderator or the clock lifts the heavier states). The ladder is *additive* to the slow reliability score: the score is the long-run reputation; the ladder is the fast circuit-breaker for a thin market (spec §8).

### D5 — Report/block propagation (the "dead buttons" fix)

`block_user(blocked)` (RPC; actor = `auth.uid()`, C10) is **idempotent** and triggers full propagation in one transaction:
1. Insert the `blocks` row (S1 unique pair).
2. **Hide content both directions:** `browse_feed` already excludes blocked users (C4/C11.3 — owner P4, finalized in S12); P7 adds the `can_rematch`/block-aware predicate consumers read, but does **NOT** `create or replace browse_feed` (one-definition rule, C4/C11.3). P7 only adds a `can_rematch(a,b)` helper.
3. **Revoke reveal / kill chat:** if an `offer` is `active` between them, resolve it via the C2 transition API (not a raw update); revoke the chat thread via the C9 chat-revoke hook (`chat_threads.revoked_at`, owner P6) so the identity reveal stops. P7 references this hook; chat-freeze is P6's mechanism (C9) — P7 does not own a competing thread model.
4. **Cancel an active lock** between them by calling **`match_cancel_lock(auth.uid(), lock_id, 'safety', idem_key)`** (C2 — the only sanctioned cancel path; it deactivates `lock_participants` to free the time window, audits, and applies the safety freeze). P7 does **not** raw-`update locks` (fixes audit S-3) and owns no `rollover_frozen` flag (that semantics is P5's, C2 `cancel_reason='safety'` = FREEZE/no-roll).
5. **Prevent rematch:** `can_rematch(a,b)` returns false whenever a block exists OR an upheld safety report (`reports.status='actioned'`, C5) exists between them; P5's swipe/shortlist/offer RPCs consult `blocks`/`can_rematch` (P5's concern).

`file_report(...)` is the **canonical C5 writer** `file_report(p_actor, p_target_type, p_target_id, p_reason_category report_reason_category, p_detail text, p_pay_setting_snapshot jsonb)` — **owned by P8 schema (S1), called by P7** (do not redefine its signature). P7's SOS and serious-flag paths call it with the appropriate `reason_category` (`safety_threat`, `harassment`, `no_show_dispute`). Safety-class reports escalate via `dispatch_notification(safety_alert)` + an `admin_alerts` row (C11.8). The lock-level safety freeze is achieved through `match_cancel_lock(...,'safety',...)` (C2), not a P7-owned column.

### D6 — Emergency contact + safety check-in escalation (real backend, not UI)

`profiles_private.emergency_contact jsonb` (S1) holds `{name, phone, relationship, share_optin}`. For each active lock whose start has passed, the C1 runner (owner S2) fires a **`safety_checkin`** job (enqueued via `enqueue_job('safety_checkin', starts_at + 30m, …, dedup=lock_id)`). P7 owns the **escalation state machine** in `safety_checkins(lock_id, user_id, status, due_at, responded_at, escalated_at, contact_notified_at)`:
- `safety_checkin` job fires → C1 runner calls P7's `open_safety_checkin(lock_id, user_id)` (`status='awaiting'`) then `dispatch_notification(user, 'safety_checkin', …)` — a **C1 safety type that bypasses consent/quiet/rate-limit and fails loud to `admin_alerts` if no device** (C11.8).
- User taps safe → `status='ok'` (RPC `respond_safety_checkin('ok')`, actor = `auth.uid()`).
- User taps **not safe / SOS** → `status='alarm'`; immediately `dispatch_notification(..., 'safety_alert', …)` to the emergency contact path (if `share_optin`), insert an `admin_alerts` row surfacing venue + lock + **the counterparty** at top priority (C11.8 — not the victim as their own target), and `file_report(...)` with `reason_category='safety_threat'` naming the counterparty.
- **No response within `ESCALATION_GRACE = 30m`** → the `safety-escalation` Edge Function (invoked by the C1 runner re-poll, owner S2) moves `status='escalated'`: a second `dispatch_notification('safety_alert', …)`, then if still silent notify the emergency contact (if opted in) and raise an `admin_alerts` row (C11.8). *Missing the check-in is itself an escalation trigger* — the whole point is that silence is not "fine." Emergency-contact outbound (SMS/voice to a third party) is delivered by `dispatch_notification`'s safety path / ops sink (C1/C11.8); P7 does not invent a separate channel.

The user-facing **safety center** (Task 11) is a read API (`safety_center()` RPC pinned to `auth.uid()`, C10/R-3 + `packages/api-client` helper) returning: verification status, current standing + any active sanction & its `until`, emergency-contact on file (masked boolean), active locks with venue + their check-in status, block list, and report history — the single screen that proves the safety features are wired to real data.

---

## File Structure

- `supabase/migrations/202605251280NN_p7_*.sql` — one migration per task in the **`128000`–`1289xx`** band (C6): columns, P7-owned tables (`disputes`, `attendance_checkins`, `safety_checkins`, `user_sanctions`), RPCs, indexes, RLS. **No `jobs` table, no `enqueue_job` definition, no `can_enter_lock_flow` definition, no `standing_state`/`report_status` enum definition, no `browse_feed` create-or-replace** — all referenced from S1/S2/P4.
- `supabase/tests/p7_*.sql` — one psql behavior/invariant test per task that warrants it; each `\i supabase/tests/_fixtures.sql` and uses `mk_user`/`mk_itinerary`/`mk_instance` (C8).
- `packages/business/src/reliability.ts`, `packages/business/src/standing.ts` — pure scoring/ladder math (the SQL oracle).
- `packages/business/src/__tests__/reliability.test.ts`, `standing.test.ts` — vitest (root config, C10 — no P7-local vitest config).
- `supabase/functions/attendance-checkin/index.ts` (+ `index_test.ts`) — geofence compute + adjudication trigger.
- `supabase/functions/safety-escalation/index.ts` (+ `index_test.ts`) — missed-check-in escalation invoked by the C1 runner (S2).
- No client/UI code (web/native is a thin layer over these RPCs + `api-client` helpers, per spec §10).

---

## Task 1: Ratings reveal + dispute columns (anti-retaliation scaffolding)

**Files:**
- Create: `supabase/migrations/20260525128000_p7_match_ratings_reveal.sql`
- Test: `supabase/tests/p7_ratings_reveal.sql`

> **Note:** `match_ratings` is owned by P0/S1 (C5). This task only `alter table … add column` the P7 fields — it does not create the table.

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
-- supabase/migrations/20260525128000_p7_match_ratings_reveal.sql
-- Anti-retaliation: a rating is hidden from the counterparty until both submit
-- or the rating window closes. `disputed` flags a no-show contradicted by proof
-- (cleared by P8's dispute-resolution callback, C11.6).
-- `weight` carries the adjudication multiplier (1.0 verified, 0.5 unverified no-show).
-- match_ratings itself is owned by P0/S1; this only adds P7 columns.
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
git add supabase/migrations/20260525128000_p7_match_ratings_reveal.sql supabase/tests/p7_ratings_reveal.sql
git commit -m "P7: match_ratings reveal/dispute/weight columns (anti-retaliation scaffolding)"
```

---

## Task 2: `submit_rating()` RPC + blind-until-both reveal logic

**Files:**
- Create: `supabase/migrations/20260525128100_p7_submit_rating.sql`
- Test: `supabase/tests/p7_submit_rating.sql`

> **Auth (C10):** `submit_rating` derives the actor from `auth.uid()` — the rater is **not** a trusted parameter (fixes audit M4/R-1). The test sets the session role via `set local role` / `select set_config('request.jwt.claims', …)` so `auth.uid()` resolves to the fixture user. The signature below keeps `p_rater`/`p_ratee` only for the *ratee* identity; `p_rater` is validated to equal `auth.uid()`.

- [ ] **Step 1: Write the failing test** (both submit → both revealed; one alone → not revealed) — uses `mk_*` fixtures (C8)

```sql
-- supabase/tests/p7_submit_rating.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; usr uuid; itin uuid; inst uuid; lk uuid; cnt int;
BEGIN
  cre := mk_user('cre');
  usr := mk_user('usr');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now()-interval '3 hours');
  insert into locks (date_instance_id,creator_id,matched_user_id,status)
    values (inst,cre,usr,'completed') returning id into lk;

  -- creator submits first → their row NOT revealed yet (counterparty hasn't)
  perform set_config('request.jwt.claims', json_build_object('sub', cre)::text, true);
  perform submit_rating(lk, cre, usr, true, true, false, false);
  select count(*) into cnt from match_ratings where lock_id=lk and revealed_at is not null;
  IF cnt <> 0 THEN RAISE EXCEPTION 'rating revealed before both submitted (got %)', cnt; END IF;

  -- matched user submits → BOTH rows reveal
  perform set_config('request.jwt.claims', json_build_object('sub', usr)::text, true);
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
-- supabase/migrations/20260525128100_p7_submit_rating.sql
-- Records a structured rating and reveals both rows once both parties submit.
-- Serious flags auto-open a moderation report via the canonical file_report (C5).
-- Actor is auth.uid() (C10): p_rater MUST equal it.
create or replace function submit_rating(
  p_lock_id uuid, p_rater uuid, p_ratee uuid,
  p_showed_up boolean, p_on_time boolean,
  p_cancelled_with_notice boolean, p_unsafe boolean
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_other_exists boolean;
begin
  if p_rater is distinct from auth.uid() then
    raise exception 'actor mismatch: p_rater must equal auth.uid()';
  end if;
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

  -- serious flag → moderation report immediately via the canonical C5 writer
  -- (report_reason_category, NOT a free-text `reason` column; C5/C11.6).
  if p_unsafe then
    perform file_report(p_rater, 'user', p_ratee, 'safety_threat'::report_reason_category,
                        'flagged unsafe/disrespectful in match rating', null);
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

revoke all on function submit_rating(uuid,uuid,uuid,boolean,boolean,boolean,boolean) from public, authenticated;
grant execute on function submit_rating(uuid,uuid,uuid,boolean,boolean,boolean,boolean) to authenticated, service_role;
```

> **Forward-reference note:** `adjudicate_no_show()` (Task 6) and `recompute_reliability()` (Task 4) are created in later (higher-numbered) P7 migrations; `file_report(...)` is the **C5 canonical writer owned by P8 schema (S1)** — already present when P7 runs (P7 band `128xxx` sorts after S1). To keep `supabase db reset` clean *during* this task's development, add **temporary no-op stubs at the TOP of this migration** for the two P7-internal forward refs (`recompute_reliability(p_user uuid) returns void`; `adjudicate_no_show(p_lock_id uuid) returns void`) guarded by `create or replace function … begin return; end;` — Tasks 4 and 6 `create or replace` the real bodies. Migrations run in filename order, so the stubs (`128100`) are superseded by the real definitions (`128300`, `128500`). Do **not** stub `file_report` — it is a cross-stage dependency (S1), referenced, never recreated.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `submit_rating blind-until-both OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525128100_p7_submit_rating.sql supabase/tests/p7_submit_rating.sql
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
- Create: `supabase/migrations/20260525128200_p7_reliability_config.sql`
- Create: `supabase/migrations/20260525128300_p7_recompute_reliability.sql`
- Test: `supabase/tests/p7_reliability_parity.sql`

- [ ] **Step 1: Write the failing test** (SQL must equal the oracle's published numbers) — uses `mk_*` fixtures (C8)

```sql
-- supabase/tests/p7_reliability_parity.sql
-- Fixed-input checks mirroring reliability.test.ts so SQL == TS oracle.
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; usr uuid; itin uuid; inst uuid; lk uuid; got numeric; i int;
BEGIN
  usr := mk_user('rel');
  cre := mk_user('rc');

  -- helper: create a completed lock + a revealed rating of usr with given outcome
  for i in 1..3 loop
    itin := mk_itinerary(cre);
    inst := mk_instance(itin, cre, now()-interval '1 day');
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
-- supabase/migrations/20260525128200_p7_reliability_config.sql
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
-- supabase/migrations/20260525128300_p7_recompute_reliability.sql
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

revoke all on function recompute_reliability(uuid) from public, authenticated;
grant execute on function recompute_reliability(uuid) to service_role;
```

> Same forward-reference handling as Task 2: `evaluate_standing(uuid)` is a no-op stub here (top of file) until Task 8 supplies the body.
>
> **Dispute callback (C11.6):** `recompute_reliability(p_user)` is the function P8's dispute-resolution RPC calls back (S9) to restore/penalize a user after a disputed no-show is ruled. Keep its signature stable (`(p_user uuid) returns void`) and grantable to `service_role` so the P8 RPC (also `security definer`) can invoke it. This is the P7 side of the bidirectional loop.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `reliability parity OK (87.50)`).
Also re-run the TS oracle to confirm both still agree: `pnpm --filter @after5/business test`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525128200_p7_reliability_config.sql supabase/migrations/20260525128300_p7_recompute_reliability.sql supabase/tests/p7_reliability_parity.sql
git commit -m "P7: SQL recompute_reliability + reliability_config, parity-tested against TS oracle"
```

---

## Task 5: Attendance check-in table + RPC (proof of attendance)

**Files:**
- Create: `supabase/migrations/20260525128400_p7_attendance_checkins.sql`
- Test: `supabase/tests/p7_attendance_checkins.sql`

- [ ] **Step 1: Write the failing test** (one check-in per (lock,user); geofence flag stored) — uses `mk_*` fixtures (C8)

> Venue/place insertion uses the columns S1 actually defines; `mk_instance` accepts a venue. If `mk_instance` does not take a venue arg, set `date_instances.venue_id` directly after creating the instance.

```sql
-- supabase/tests/p7_attendance_checkins.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; usr uuid; pl uuid; itin uuid; inst uuid; lk uuid; ok boolean := false;
BEGIN
  cre := mk_user('c');
  usr := mk_user('u');
  insert into places (name,slug,neighborhood,drive_cluster,type,lat,lng)
    values ('Venue','venue-p7','Downtown','core','cafe',49.8880,-119.4960)
    on conflict (slug) do nothing returning id into pl;
  if pl is null then select id into pl from places where slug='venue-p7'; end if;
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now());
  update date_instances set venue_id = pl where id = inst;
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
-- supabase/migrations/20260525128400_p7_attendance_checkins.sql
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

revoke all on function record_attendance_checkin(uuid,uuid,double precision,double precision,numeric,numeric,boolean) from public, authenticated;
grant execute on function record_attendance_checkin(uuid,uuid,double precision,double precision,numeric,numeric,boolean) to service_role;
```

> **Auth (C10):** `record_attendance_checkin` is `service_role`-only and called exclusively by the `attendance-checkin` Edge Function (Task 13), which has already verified the JWT caller is `p_user`. The Edge Function passes the real caller's id; the RPC re-checks party membership as defence in depth. No `authenticated` grant — clients never call it directly (fixes audit M4/R-1/R-2).

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525128400_p7_attendance_checkins.sql supabase/tests/p7_attendance_checkins.sql
git commit -m "P7: attendance_checkins (geofenced proof) + service-role record RPC"
```

---

## Task 6: `disputes` table + `adjudicate_no_show()` — disputed-no-show resolution (C11.6)

**Files:**
- Create: `supabase/migrations/20260525128450_p7_disputes.sql` (the `disputes` table — C11.6, owned by P7, band `128xxx`)
- Create: `supabase/migrations/20260525128500_p7_adjudicate_no_show.sql`
- Test: `supabase/tests/p7_adjudicate.sql`

> **C11.6 — disputes, not reports.** A contested no-show writes a **`disputes` row** (`kind='no_show'`), NOT a `reports(reason=…)` row (P0's free-text `reason` is gone; C11.6 makes `reason_category` the only taxonomy and removes a separate gating `reason` column). P8's resolution RPC (S9) flips `disputes.state` and calls back `recompute_reliability` + clears `match_ratings.disputed` — the bidirectional loop. The `disputes` DDL below is frozen by C11.6; reproduce it exactly.

- [ ] **Step 0: Create the `disputes` table (C11.6 frozen DDL)** — `supabase/migrations/20260525128450_p7_disputes.sql`

```sql
-- supabase/migrations/20260525128450_p7_disputes.sql
-- C11.6 frozen DDL. Owned by P7 (band 128xxx). P7 writes rows on contested no-shows;
-- P8 (S9) resolves them and calls back recompute_reliability + clears match_ratings.disputed.
create table if not exists disputes (
  id uuid primary key default gen_random_uuid(),
  lock_id uuid not null references locks(id) on delete cascade,
  raised_by uuid not null references profiles(id),
  kind text not null check (kind in ('no_show','payment','conduct')),
  state text not null default 'open' check (state in ('open','resolved','rejected')),
  resolution jsonb,
  created_at timestamptz not null default now()
);
create index if not exists disputes_lock_idx on disputes(lock_id);
create index if not exists disputes_open_idx on disputes(state) where state='open';

alter table disputes enable row level security;
do $$ begin
  create policy "disputes_party_read" on disputes for select
    using (exists (
      select 1 from locks l where l.id = disputes.lock_id
        and auth.uid() in (l.creator_id, l.matched_user_id)));
exception when duplicate_object then null; end $$;
-- inserts go ONLY through adjudicate_no_show / file_report (SECURITY DEFINER); no insert policy.
```

- [ ] **Step 1: Write the failing test** (proof contradicts the claim → disputed, no penalty, `disputes` row) — uses `mk_*` fixtures (C8)

```sql
-- supabase/tests/p7_adjudicate.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; usr uuid; pl uuid; itin uuid; inst uuid; lk uuid;
        v_disputed boolean; v_weight numeric; v_disputes int;
BEGIN
  cre := mk_user('c');
  usr := mk_user('u');
  insert into places (name,slug,neighborhood,drive_cluster,type,lat,lng)
    values ('V','venue-p7d','DT','core','cafe',49.888,-119.496)
    on conflict (slug) do nothing; select id into pl from places where slug='venue-p7d';
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now());
  update date_instances set venue_id = pl where id = inst;
  insert into locks (date_instance_id,creator_id,matched_user_id,status)
    values (inst,cre,usr,'completed') returning id into lk;

  -- B (usr) HAS a valid geofenced check-in; A (cre) does NOT
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
  select count(*) into v_disputes from disputes where lock_id=lk and kind='no_show' and state='open';
  IF v_disputes < 1 THEN RAISE EXCEPTION 'disputed no-show should open a disputes row (C11.6)'; END IF;
  RAISE NOTICE 'adjudicate disputed-no-show OK (weight %)', v_weight;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (the real body doesn't exist; the Task-2 stub is a no-op so `disputed` stays false → raises).

- [ ] **Step 3: Write the migration** (replaces the stub)

```sql
-- supabase/migrations/20260525128500_p7_adjudicate_no_show.sql
-- Adjudicates every fresh `showed_up=false` rating on a lock against geofenced proof.
--   B (accused) proof, A (claimant) none -> claim DISPUTED, no penalty yet, open disputes row
--   both proof                           -> ambiguous: DISPUTED, open disputes row (human rules)
--   B none but A has proof               -> CORROBORATED, full weight (penalty stands)
--   neither has proof                    -> UNVERIFIED self-report, weight *= 0.5
-- Fixes audit A1: proof of the accused alone no longer permanently shields a serial no-show;
-- it only DEFERS to a human via the disputes loop (C11.6), which can recompute either way.
create or replace function adjudicate_no_show(p_lock_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare r record; b_proof boolean; a_proof boolean;
begin
  for r in
    select id, rater_id, ratee_id from match_ratings
     where lock_id = p_lock_id and showed_up is false
  loop
    select coalesce(bool_or(within_geofence), false) into b_proof   -- accused (ratee)
      from attendance_checkins where lock_id = p_lock_id and user_id = r.ratee_id;
    select coalesce(bool_or(within_geofence), false) into a_proof   -- claimant (rater)
      from attendance_checkins where lock_id = p_lock_id and user_id = r.rater_id;

    if b_proof then
      -- accused has proof (with or without claimant proof): defer to a human, do not penalize yet
      update match_ratings set disputed = true, weight = 0.00 where id = r.id;
      if not exists (select 1 from disputes
                       where lock_id = p_lock_id and kind = 'no_show' and state = 'open') then
        insert into disputes (lock_id, raised_by, kind, state)
        values (p_lock_id, r.rater_id, 'no_show', 'open');
      end if;
    elsif a_proof then
      update match_ratings set disputed = false, weight = 1.00 where id = r.id;  -- corroborated
    else
      update match_ratings set disputed = false, weight = 0.50 where id = r.id;  -- unverified
    end if;

    -- recompute the accused's score with the adjudicated weight
    perform recompute_reliability(r.ratee_id);
  end loop;
end $fn$;

revoke all on function adjudicate_no_show(uuid) from public, authenticated;
grant execute on function adjudicate_no_show(uuid) to service_role;
```

> The `if not exists … insert into disputes` guard prevents duplicate dispute rows on repeated adjudication (e.g., a late check-in re-runs the function via the Edge Function). One open `no_show` dispute per lock at a time (fixes audit D-2 dispute-spam).

- [ ] **Step 4: Apply + run test, expect PASS** (prints `adjudicate disputed-no-show OK`).

- [ ] **Step 5: Add the corroborated + unverified cases to the test** (extend `p7_adjudicate.sql` with two more `DO` blocks: one where only A has proof → `weight=1.00, disputed=false`, no `disputes` row; one where neither does → `weight=0.50`). Re-run, expect PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260525128450_p7_disputes.sql supabase/migrations/20260525128500_p7_adjudicate_no_show.sql supabase/tests/p7_adjudicate.sql
git commit -m "P7: disputes table (C11.6) + adjudicate_no_show (geofence-backed dispute, no-show shield fixed)"
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

## Task 8: Enforcement ladder — `evaluate_standing()` writes `profiles.standing` + `user_sanctions`

**Files:**
- Create: `supabase/migrations/20260525128600_p7_standing.sql`
- Test: `supabase/tests/p7_standing.sql`

> **C3 ownership (critical conformance).** The `standing standing_state` column + the `standing_state` enum are **owned by C3/S1 — P7 does NOT create the type or the column** (`profiles.standing standing_state not null default 'good'` already exists with the C3 values `good,warned,cooldown,throttled,reconfirm_required,locked_ban,suspended`). The `can_enter_lock_flow` gate is **owned by S2 and called by P5/S6 — P7 does NOT define it and does NOT wire it** (P5 already calls it; that was the audit-B1 fix, resolved at the contract level). P7 owns **only**: the `user_sanctions` audit table, the `standing_until` companion column (auto-expiry timestamp), the severity helpers, and the `evaluate_standing(user)` ladder that **writes** `profiles.standing`. The clock-lift of an expired `standing_until` (audit D-5) is handled by S2's gate reading `standing_until` and by a C1 job; P7 only records `standing_until`.

- [ ] **Step 1: Write the failing test** (no-shows drive standing; sanction row recorded) — uses `mk_*` fixtures (C8)

```sql
-- supabase/tests/p7_standing.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE usr uuid; cre uuid; itin uuid; inst uuid; lk uuid; i int; v_standing text; v_sanctions int;
BEGIN
  usr := mk_user('s');
  cre := mk_user('sc');
  -- give usr 2 adjudicated no-shows (weight>0, revealed) -> cooldown
  for i in 1..2 loop
    itin := mk_itinerary(cre);
    inst := mk_instance(itin, cre, now()-interval '5 days');
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

- [ ] **Step 2: Run it, expect FAIL** (stub no-op leaves standing `good`; `user_sanctions` missing).

- [ ] **Step 3: Write the migration** (replaces the Task-4 stub of `evaluate_standing`)

```sql
-- supabase/migrations/20260525128600_p7_standing.sql
-- NOTE: standing_state enum + profiles.standing are owned by C3/S1; NOT created here.
-- P7 adds only the auto-expiry companion column + the sanctions audit + the ladder.
alter table profiles
  add column if not exists standing_until timestamptz;   -- when an auto state expires (read by S2 gate)

create table if not exists user_sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  from_standing standing_state,
  to_standing standing_state not null,
  reason text not null,
  until timestamptz,
  actor uuid,                       -- null = automatic; set = moderator
  created_at timestamptz not null default now()
);
create index if not exists user_sanctions_user_idx on user_sanctions(user_id);
alter table user_sanctions enable row level security;
-- NOTE (audit R-4): reason string is internal; do NOT expose the raw reliability number
-- to the sanctioned user. Owner-read is omitted; sanctions are read by admin (S9) only.

-- severity index mirrors STANDING_ORDER in standing.ts (C3 enum order)
create or replace function standing_severity(s standing_state) returns int
language sql immutable as $fn$
  select case s
    when 'good' then 0 when 'warned' then 1 when 'cooldown' then 2
    when 'throttled' then 3 when 'reconfirm_required' then 4
    when 'locked_ban' then 5 when 'suspended' then 6 end;
$fn$;
create or replace function severity_standing(i int) returns standing_state
language sql immutable as $fn$
  select (array['good','warned','cooldown','throttled','reconfirm_required',
                'locked_ban','suspended']::standing_state[])[i+1];
$fn$;

create or replace function evaluate_standing(p_user uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare rel numeric; no_shows int; safety_reports int; cur int; sev int;
        new_s standing_state; old_s standing_state; v_until timestamptz;
begin
  select reliability_score, standing into rel, old_s from profiles where id = p_user;
  rel := coalesce(rel, 100);
  -- adjudicated no-shows (weight>0, non-disputed) in the trailing 60 days
  select count(*) into no_shows from match_ratings
   where ratee_id = p_user and showed_up is false and weight > 0
     and disputed = false and submitted_at > now() - interval '60 days';
  -- upheld safety reports: report_status keeps 'actioned' (C5); reason_category is the
  -- taxonomy (C11.6) — no free-text `reason` column. Safety classes = harassment, safety_threat.
  select count(*) into safety_reports from reports
   where target_type='user' and target_id = p_user
     and reason_category in ('harassment','safety_threat')
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
    -- standing-change notification via C1 (account type); warned = notify-only rung
    perform dispatch_notification(p_user, 'account'::notification_type,
      jsonb_build_object('event','standing_changed','from',old_s,'to',new_s,'until',v_until));
  end if;
end $fn$;

revoke all on function evaluate_standing(uuid) from public, authenticated;
grant execute on function evaluate_standing(uuid) to service_role;
```

> `dispatch_notification` (C1) and `standing_state` (C3) are cross-stage dependencies present before P7's band — referenced, never recreated. **No `can_enter_lock_flow` is defined in this task** (it lives in S2; P5 already calls it). The throttle/reconfirm rungs are enforced by P4/P5 reading `profiles.standing` (their concern) — P7 only sets the value.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `standing ladder OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525128600_p7_standing.sql supabase/tests/p7_standing.sql
git commit -m "P7: enforcement ladder writes profiles.standing (standing_state, user_sanctions, evaluate_standing)"
```

---

## Task 9: Block propagation + rematch prevention

**Files:**
- Create: `supabase/migrations/20260525128700_p7_block_propagation.sql`
- Test: `supabase/tests/p7_block_propagation.sql`

> **Conformance.** Lock cancellation goes through **`match_cancel_lock(auth.uid(), lock_id, 'safety', idem_key)`** (C2 — owner P5/S6), NOT a raw `update locks` (fixes audit S-3). P7 owns **no** `locks.rollover_frozen` column — the safety freeze is the `cancel_reason='safety'` FREEZE class in C2. Offer revocation goes through the C2 transition API (`match_pass_offer`), not a raw update. Chat revoke uses the C9 `chat_threads.revoked_at` hook (owner P6) — actual column names per C9. `block_user` derives the blocker from `auth.uid()` (C10).

- [ ] **Step 1: Write the failing test** (block → active offer passed, active lock cancelled(safety), rematch blocked) — uses `mk_*` fixtures (C8)

```sql
-- supabase/tests/p7_block_propagation.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE a uuid; b uuid; itin uuid; inst uuid; off_id uuid; lk uuid;
        v_off text; v_lock text; v_reason text; v_can boolean;
BEGIN
  a := mk_user('a');
  b := mk_user('b');
  itin := mk_itinerary(a);
  inst := mk_instance(itin, a, now()+interval '2 days');
  insert into offers (date_instance_id,candidate_id,creator_id,status,expires_at)
    values (inst,b,a,'active', now()+interval '1 day') returning id into off_id;
  insert into locks (date_instance_id,creator_id,matched_user_id,status)
    values (inst,a,b,'active') returning id into lk;

  -- actor is auth.uid(); block_user takes only p_blocked
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  perform block_user(b);

  -- offer revoked via C2 transition (match_pass_offer); lock cancelled via match_cancel_lock('safety')
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
-- supabase/migrations/20260525128700_p7_block_propagation.sql
-- No rollover_frozen column (C2 cancel_reason='safety' is the freeze). No raw lock UPDATE.

-- can_rematch: false if a block (either direction) or an upheld safety report exists.
-- report_status keeps 'actioned' (C5); reason_category is the taxonomy (C11.6).
create or replace function can_rematch(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select not exists (
    select 1 from blocks
     where (blocker_id=p_a and blocked_id=p_b) or (blocker_id=p_b and blocked_id=p_a)
  ) and not exists (
    select 1 from reports
     where target_type='user' and reason_category in ('harassment','safety_threat')
       and status='actioned'
       and ((reporter_id=p_a and target_id=p_b) or (reporter_id=p_b and target_id=p_a))
  );
$fn$;
revoke all on function can_rematch(uuid,uuid) from public;
grant execute on function can_rematch(uuid,uuid) to authenticated, service_role;

-- block_user: idempotent; actor = auth.uid(); propagates everywhere in one transaction.
create or replace function block_user(p_blocked uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_blocker uuid := auth.uid(); r record;
begin
  if v_blocker is null then raise exception 'unauthenticated'; end if;
  if v_blocker = p_blocked then raise exception 'cannot block self'; end if;
  insert into blocks (blocker_id, blocked_id) values (v_blocker, p_blocked)
    on conflict (blocker_id, blocked_id) do nothing;

  -- revoke any active offer between the pair via the C2 transition API (no raw update)
  for r in
    select id from offers where status='active'
       and ((creator_id=v_blocker and candidate_id=p_blocked)
         or (creator_id=p_blocked and candidate_id=v_blocker))
  loop
    perform match_pass_offer(v_blocker, r.id);   -- C2 (owner P5)
  end loop;

  -- cancel any active lock between the pair via the C2 sanctioned cancel path (safety=FREEZE)
  for r in
    select id from locks where status='active'
       and ((creator_id=v_blocker and matched_user_id=p_blocked)
         or (creator_id=p_blocked and matched_user_id=v_blocker))
  loop
    perform match_cancel_lock(v_blocker, r.id, 'safety'::cancel_reason,
                              'block:'||v_blocker||':'||r.id);   -- C2 (owner P5)
  end loop;

  -- kill chat thread reveal via the C9 chat-revoke hook (owner P6; columns per C9)
  if to_regclass('public.chat_threads') is not null then
    update chat_threads set revoked_at = now()
     where revoked_at is null
       and ((creator_id=v_blocker and candidate_id=p_blocked)
         or (creator_id=p_blocked and candidate_id=v_blocker));
  end if;
end $fn$;

revoke all on function block_user(uuid) from public;
grant execute on function block_user(uuid) to authenticated, service_role;
```

> Chat-thread columns follow C9 (`creator_id`/`candidate_id` + `revoked_at`). The `to_regclass` guard keeps the migration safe if P6's chat tables land in a later applied migration during development; in the final ordered build P6/chat-core precedes P7.

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Note on rematch enforcement (no duplicate guard).** P5's swipe/shortlist/offer RPCs already consult `blocks`/`can_rematch` (C2/S6 — their concern). **P7 does NOT add a competing `before insert on swipes` trigger** (that would duplicate and diverge from P5's structured guard — fixes audit S-4). P7 only provides the `can_rematch` predicate; the enforcement point is P5's.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260525128700_p7_block_propagation.sql supabase/tests/p7_block_propagation.sql
git commit -m "P7: block_user propagation via C2 (match_pass_offer/match_cancel_lock) + can_rematch predicate"
```

---

## Task 10: Conform to the canonical `file_report` writer (C5) — reference, do not redefine

> **SUPERSEDED — `file_report` is NOT a P7 RPC.** The earlier draft created `file_report(uuid,text,uuid,text,text)` writing a free-text `reason` column and setting a P7-owned `locks.rollover_frozen`. That conflicts with **C5/C11.6** on three counts: (1) `file_report` is the **canonical writer owned by P8 schema (S1)** with signature `file_report(p_actor uuid, p_target_type text, p_target_id uuid, p_reason_category report_reason_category, p_detail text, p_pay_setting_snapshot jsonb default null) returns uuid` — P7, P6, P10 all *call* it (one definition, C5); (2) there is **no free-text `reason` column** and **no `'reviewing'`-as-write** quirk — `report_status` keeps `actioned`/`reviewing` for *reads* (C5) but the writer sets `status='open'` and a `reason_category` (C11.6); (3) the lock safety-freeze is **`match_cancel_lock(...,'safety',...)`** (C2), not a P7 `rollover_frozen` column. **This task therefore writes no migration and no `file_report` definition.** It only confirms P7's callers conform.

**P7 callers of the canonical `file_report` (already wired in earlier tasks):**
- Task 2 `submit_rating` serious-flag → `file_report(p_rater,'user',p_ratee,'safety_threat'::report_reason_category,'…',null)`.
- Task 11 `respond_safety_checkin('alarm')` SOS → `file_report(auth.uid(),'user', <counterparty>, 'safety_threat'::report_reason_category,'SOS during active lock',null)` (target = the counterparty, not the victim — fixes audit A5).
- `disputed no-show` does **not** call `file_report`; it writes a `disputes` row (C11.6, Task 6).

**Lock safety-freeze (replaces the deleted `rollover_frozen` logic):** when a safety report concerns an active lock, P7 calls `match_cancel_lock(auth.uid(), lock_id, 'safety', idem_key)` (C2) — the `safety` reason is the FREEZE/no-roll class (C2). P7 owns no freeze column.

- [ ] **Step 1: Verification check (no new migration).** Confirm every P7 `file_report` call uses the C5 signature + a `report_reason_category` value, and confirm no P7 migration defines `file_report`, writes `reports.reason`, or adds `locks.rollover_frozen`. Add a one-line psql guard test `supabase/tests/p7_no_orphan_report_writer.sql`:

```sql
-- supabase/tests/p7_no_orphan_report_writer.sql
DO $$
BEGIN
  -- file_report must exist with the C5 6-arg signature and NOT a P7 5-arg overload
  PERFORM 1 FROM pg_proc WHERE proname='file_report' AND pronargs=6;
  IF NOT FOUND THEN RAISE EXCEPTION 'canonical file_report (C5, 6-arg) missing'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='file_report' AND pronargs=5;
  IF FOUND THEN RAISE EXCEPTION 'P7 must not define a 5-arg file_report (C5 violation)'; END IF;
  -- P7 owns no rollover_frozen column on locks
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='locks' AND column_name='rollover_frozen';
  IF FOUND THEN RAISE EXCEPTION 'locks.rollover_frozen must not be created by P7 (C2 owns freeze)'; END IF;
  RAISE NOTICE 'report-writer conformance OK';
END $$;
```

- [ ] **Step 2: Run it after S1 (P8 schema) is present, expect PASS.**

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/p7_no_orphan_report_writer.sql
git commit -m "P7: conform to canonical file_report (C5) + match_cancel_lock freeze (C2); no orphan writer"
```

---

## Task 11: Safety check-in escalation table + RPC + safety center

**Files:**
- Create: `supabase/migrations/20260525128900_p7_safety_checkins.sql`
- Test: `supabase/tests/p7_safety_checkins.sql`

> **Conformance.** Escalation goes through **`dispatch_notification(safety_checkin/safety_alert)`** (C1 safety types that bypass consent/quiet/rate-limit and fail loud to `admin_alerts` if no device, C11.8) + an `admin_alerts` row — NOT a custom `safety_alarm_notify`/`safety_escalation_notify` job kind (those are not in the C1 `job_type` enum). The C1 runner fires the **`safety_checkin`** job (a valid `job_type`) which calls `open_safety_checkin` then dispatches the prompt. SOS opens a report via the **canonical `file_report` (C5)** targeting the **counterparty** (fixes audit A5), not a `reports(reason='safety_sos', target=self)` row. All RPCs derive the actor from `auth.uid()` (C10).

- [ ] **Step 1: Write the failing test** ("not safe" → alarm + emergency contact notified + report on counterparty) — uses `mk_*` fixtures (C8)

```sql
-- supabase/tests/p7_safety_checkins.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE usr uuid; cre uuid; itin uuid; inst uuid; lk uuid; sc uuid;
        v_status text; v_notified timestamptz; v_reports int; v_alerts int;
BEGIN
  usr := mk_user('u');
  cre := mk_user('c');
  insert into profiles_private (user_id, emergency_contact)
    values (usr, jsonb_build_object('name','Mom','phone','+1','share_optin',true))
    on conflict (user_id) do update set emergency_contact = excluded.emergency_contact;
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now()-interval '40 min');
  insert into locks (date_instance_id,creator_id,matched_user_id,status)
    values (inst,cre,usr,'active') returning id into lk;
  insert into safety_checkins (lock_id,user_id,status,due_at)
    values (lk,usr,'awaiting', now()) returning id into sc;

  perform set_config('request.jwt.claims', json_build_object('sub', usr)::text, true);
  perform respond_safety_checkin(sc, 'alarm');

  select status::text, contact_notified_at into v_status, v_notified
    from safety_checkins where id=sc;
  IF v_status <> 'alarm' THEN RAISE EXCEPTION 'expected alarm, got %', v_status; END IF;
  IF v_notified is null THEN RAISE EXCEPTION 'opted-in emergency contact should be notified'; END IF;
  -- SOS report targets the COUNTERPARTY (cre), not the victim (usr) — audit A5
  select count(*) into v_reports from reports
   where reason_category='safety_threat' and target_id=cre;
  IF v_reports < 1 THEN RAISE EXCEPTION 'SOS should open a safety report on the counterparty'; END IF;
  -- fail-loud admin alert raised (C11.8)
  select count(*) into v_alerts from admin_alerts where payload->>'safety_checkin_id' = sc::text;
  IF v_alerts < 1 THEN RAISE EXCEPTION 'SOS should raise an admin_alerts row (C11.8)'; END IF;
  RAISE NOTICE 'safety check-in alarm escalation OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "safety_checkins" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525128900_p7_safety_checkins.sql
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

-- open_safety_checkin: called by the C1 runner when the 'safety_checkin' job fires.
create or replace function open_safety_checkin(p_lock_id uuid, p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  insert into safety_checkins (lock_id, user_id, status, due_at)
  values (p_lock_id, p_user, 'awaiting', now())
  on conflict (lock_id, user_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from safety_checkins where lock_id=p_lock_id and user_id=p_user;
  end if;
  -- safety_checkin is a C1 safety type: bypasses consent/quiet/rate-limit, fails loud (C11.8)
  perform dispatch_notification(p_user, 'safety_checkin'::notification_type,
    jsonb_build_object('safety_checkin_id', v_id, 'lock_id', p_lock_id));
  return v_id;
end $fn$;
revoke all on function open_safety_checkin(uuid,uuid) from public, authenticated;
grant execute on function open_safety_checkin(uuid,uuid) to service_role;

-- respond_safety_checkin: actor = auth.uid(); 'ok' clears; 'alarm' notifies + reports counterparty.
create or replace function respond_safety_checkin(p_id uuid, p_response text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_user uuid := auth.uid(); v_lock uuid; v_optin boolean; v_other uuid;
begin
  if p_response not in ('ok','alarm') then raise exception 'invalid response %', p_response; end if;
  select lock_id into v_lock from safety_checkins where id=p_id and user_id=v_user;
  if v_lock is null then raise exception 'check-in % not owned by caller', p_id; end if;

  if p_response = 'ok' then
    update safety_checkins set status='ok', responded_at=now() where id=p_id;
  else
    select coalesce((emergency_contact->>'share_optin')::boolean, false)
      into v_optin from profiles_private where user_id=v_user;
    update safety_checkins
       set status='alarm', responded_at=now(),
           contact_notified_at = case when v_optin then now() else null end
     where id=p_id;
    -- the counterparty on the lock is the report subject (audit A5)
    select case when creator_id=v_user then matched_user_id else creator_id end
      into v_other from locks where id=v_lock;
    perform file_report(v_user, 'user', v_other, 'safety_threat'::report_reason_category,
                        'SOS during active lock', null);   -- canonical C5 writer
    -- safety_alert is a C1 safety type (bypass + fail-loud, C11.8)
    perform dispatch_notification(v_user, 'safety_alert'::notification_type,
      jsonb_build_object('safety_checkin_id', p_id, 'lock_id', v_lock, 'notify_contact', v_optin));
    -- fail-loud admin terminus (C11.8): surfaces venue + lock + counterparty to ops
    insert into admin_alerts (kind, payload)
      values ('safety_sos',
              jsonb_build_object('safety_checkin_id', p_id, 'lock_id', v_lock,
                                 'user_id', v_user, 'counterparty', v_other,
                                 'notify_contact', v_optin));
  end if;
end $fn$;

revoke all on function respond_safety_checkin(uuid,text) from public;
grant execute on function respond_safety_checkin(uuid,text) to authenticated, service_role;

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
  perform dispatch_notification(v_user, 'safety_alert'::notification_type,
    jsonb_build_object('safety_checkin_id', p_id, 'lock_id', v_lock,
                       'escalated', true, 'notify_contact', v_optin));
  insert into admin_alerts (kind, payload)
    values ('safety_checkin_missed',
            jsonb_build_object('safety_checkin_id', p_id, 'lock_id', v_lock,
                               'user_id', v_user, 'notify_contact', v_optin));
end $fn$;
revoke all on function escalate_missed_checkin(uuid) from public, authenticated;
grant execute on function escalate_missed_checkin(uuid) to service_role;
```

> `dispatch_notification`/`notification_type` (C1), `admin_alerts` (C11.8), and `file_report` (C5) are cross-stage dependencies present before P7's band — referenced, never recreated.

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Add the safety-center read RPC** (append to the migration) — **pinned to `auth.uid()`** (fixes audit R-3 stalking vector)

```sql
-- Single read surface backing the user-facing Safety Center (api-client helper in Task 15).
-- Pinned to the caller: no p_user param (C10/R-3). 'reliability_score' null = "Verified · New".
create or replace function safety_center()
returns jsonb language sql stable security definer set search_path = public as $fn$
  with me as (select auth.uid() as uid)
  select jsonb_build_object(
    'verification', (select verification from profiles p, me where p.id=me.uid),
    'standing',     (select standing from profiles p, me where p.id=me.uid),
    'standing_until',(select standing_until from profiles p, me where p.id=me.uid),
    'reliability_score', (select reliability_score from profiles p, me where p.id=me.uid),
    'emergency_contact_on_file',
      (select coalesce((emergency_contact ? 'phone'), false)
         from profiles_private pp, me where pp.user_id=me.uid),
    'active_locks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'lock_id', l.id, 'starts_at', di.starts_at, 'venue_id', di.venue_id,
        'my_checkin', (select status from safety_checkins
                        where lock_id=l.id and user_id=(select uid from me)))), '[]'::jsonb)
      from locks l join date_instances di on di.id=l.date_instance_id, me
      where l.status='active' and me.uid in (l.creator_id, l.matched_user_id)),
    'blocks', (select coalesce(jsonb_agg(blocked_id), '[]'::jsonb)
                 from blocks, me where blocker_id=me.uid),
    'reports_filed', (select count(*) from reports, me where reporter_id=me.uid)
  );
$fn$;
revoke all on function safety_center() from public;
grant execute on function safety_center() to authenticated, service_role;
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260525128900_p7_safety_checkins.sql supabase/tests/p7_safety_checkins.sql
git commit -m "P7: safety_checkins escalation via dispatch_notification + admin_alerts (C11.8); safety_center pinned to self"
```

---

## Task 12: Lock-activation safety scheduling via the C1 `enqueue_job` + `close_rating_window`

**Files:**
- Create: `supabase/migrations/20260525128950_p7_lock_safety_scheduling.sql`
- Test: `supabase/tests/p7_lock_safety_scheduling.sql`

> **SUPERSEDED — P7 does NOT own `jobs` or `enqueue_job`.** The earlier draft created a "minimal compatible" `jobs(kind text, run_at)` table + a `enqueue_job(text,jsonb,timestamptz)` overload. That is a **direct C1 violation** (single `jobs` table + `job_type`/`job_status` enums + `enqueue_job(p_type job_type, p_run_after timestamptz, p_payload jsonb, p_dedup_key text)` are **owned by P2/S2**; a second table/overload hard-fails or silently never runs — audit B4). In the reconciled build P2/S2 lands first; P7 only **calls** the C1 `enqueue_job` with **valid `job_type` values** (`safety_checkin`, `rating_window`). P7 does **not** schedule `day_of_reconfirm`/`reconfirm_timeout` — those are P5's concern (the matching loop reads `standing='reconfirm_required'`). P7 ships the `rating_window` **handler** (`close_rating_window`) the C1 runner calls.

- [ ] **Step 1: Write the failing test** (locking a date enqueues the C1 safety_checkin + rating_window jobs) — uses `mk_*` fixtures (C8)

```sql
-- supabase/tests/p7_lock_safety_scheduling.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; usr uuid; itin uuid; inst uuid; lk uuid; v_jobs int;
BEGIN
  cre := mk_user('c');
  usr := mk_user('u');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now()+interval '2 days');
  -- inserting an ACTIVE lock enqueues the safety check-in + rating-window C1 jobs
  insert into locks (date_instance_id,creator_id,matched_user_id,status)
    values (inst,cre,usr,'active') returning id into lk;

  select count(*) into v_jobs from jobs
   where type in ('safety_checkin'::job_type,'rating_window'::job_type)
     and payload->>'lock_id' = lk::text;
  IF v_jobs < 2 THEN RAISE EXCEPTION 'lock should enqueue safety_checkin + rating_window (got %)', v_jobs; END IF;
  RAISE NOTICE 'lock safety scheduling OK (% jobs)', v_jobs;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (no scheduling trigger yet → zero matching C1 jobs).

- [ ] **Step 3: Write the migration** (uses the C1 `enqueue_job` signature; no jobs table, no enqueue_job definition)

```sql
-- supabase/migrations/20260525128950_p7_lock_safety_scheduling.sql
-- jobs/job_type/enqueue_job are owned by C1/P2/S2 — referenced, never recreated.
-- On lock activation, enqueue the +30m safety check-in and the rating-window-close,
-- using the canonical C1 enqueue_job(p_type job_type, p_run_after, p_payload, p_dedup_key).
create or replace function schedule_lock_safety_jobs() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_start timestamptz; v_dur int;
begin
  if tg_op='INSERT' and new.status='active' then
    select starts_at, duration_min into v_start, v_dur
      from date_instances where id=new.date_instance_id;
    perform enqueue_job('safety_checkin'::job_type,
      v_start + interval '30 minutes',
      jsonb_build_object('lock_id', new.id),
      'safety_checkin:'||new.id);                       -- dedup_key (C1)
    perform enqueue_job('rating_window'::job_type,
      v_start + make_interval(mins => coalesce(v_dur,150)) + interval '72 hours',
      jsonb_build_object('lock_id', new.id),
      'rating_window:'||new.id);
  end if;
  return new;
end $fn$;
revoke all on function schedule_lock_safety_jobs() from public, authenticated;
create trigger locks_schedule_safety_jobs after insert on locks
  for each row execute function schedule_lock_safety_jobs();

-- close_rating_window: the C1 'rating_window' job handler. Flips lone (un-revealed)
-- ratings to revealed at the deadline so a non-responding counterparty can't hide a
-- bad review forever (D2). Recomputes both parties.
create or replace function close_rating_window(p_lock_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare r record;
begin
  update match_ratings set revealed_at = now()
   where lock_id = p_lock_id and revealed_at is null;
  for r in select distinct ratee_id from match_ratings where lock_id = p_lock_id loop
    perform recompute_reliability(r.ratee_id);
  end loop;
end $fn$;
revoke all on function close_rating_window(uuid) from public, authenticated;
grant execute on function close_rating_window(uuid) to service_role;
```

> The C1 runner (S2) dispatches `safety_checkin` → P7's `open_safety_checkin(lock_id, user_id)` (Task 11) and `rating_window` → P7's `close_rating_window(lock_id)`. P7 provides the handlers; P2 owns the dispatch table mapping (documented hand-off, fixes audit M5/L-1/L-3).

- [ ] **Step 4: Apply + run test, expect PASS** (prints `lock safety scheduling OK (2 jobs)`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525128950_p7_lock_safety_scheduling.sql supabase/tests/p7_lock_safety_scheduling.sql
git commit -m "P7: lock-activation safety scheduling via C1 enqueue_job + close_rating_window handler"
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
    // verify the caller is a party to this lock BEFORE computing/returning any distance
    // (fixes audit R-2 venue-coordinate oracle: never leak coords for arbitrary lock ids).
    const { data: lock } = await admin
      .from('locks')
      .select('date_instance_id, creator_id, matched_user_id')
      .eq('id', lock_id).single();
    if (!lock || (user.id !== lock.creator_id && user.id !== lock.matched_user_id)) {
      return json({ error: 'forbidden' }, 403);
    }
    // fetch venue coords for the lock's instance (service role; bypasses RLS)
    const { data: di, error: diErr } = await admin
      .from('date_instances')
      .select('venue_id, places:venue_id (lat, lng)')
      .eq('id', lock.date_instance_id)
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

> **S2/C1 hand-off:** the C1 runner (owner P2/S2) must (a) on a `safety_checkin` job fire, call P7's `open_safety_checkin(lock_id, user_id)` (Task 11) — which inserts the `awaiting` row and dispatches the C1 `safety_checkin` notification (bypass + fail-loud, C11.8) — and (b) on a recurring tick, invoke this `safety-escalation` function. The runner also maps `rating_window` → `close_rating_window` (Task 12). Documented here; the dispatch mapping is built in S2.

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

// block_user derives the blocker from auth.uid() (C10) — caller passes only the blocked id.
export async function blockUser(client: After5Client, blockedId: string) {
  const { error } = await client.rpc('block_user', { p_blocked: blockedId });
  if (error) throw error;
}

// file_report is the canonical C5 writer: reason_category (taxonomy), not a free-text reason.
export async function fileReport(
  client: After5Client,
  args: { actorId: string; targetType: 'user' | 'date_instance' | 'message' | 'lock';
          targetId: string;
          reasonCategory: 'harassment' | 'safety_threat' | 'no_show_dispute'
            | 'payment_dispute' | 'inappropriate_content' | 'fake_profile' | 'other';
          detail?: string; paySettingSnapshot?: unknown }
) {
  const { error } = await client.rpc('file_report', {
    p_actor: args.actorId, p_target_type: args.targetType,
    p_target_id: args.targetId, p_reason_category: args.reasonCategory,
    p_detail: args.detail ?? null, p_pay_setting_snapshot: args.paySettingSnapshot ?? null,
  });
  if (error) throw error;
}

// respond_safety_checkin derives the user from auth.uid() (C10) — caller passes id + response.
export async function respondSafetyCheckin(
  client: After5Client, checkinId: string, response: 'ok' | 'alarm'
) {
  const { error } = await client.rpc('respond_safety_checkin', {
    p_id: checkinId, p_response: response,
  });
  if (error) throw error;
}

// safety_center is pinned to auth.uid() (C10/R-3) — no user param.
export async function getSafetyCenter(client: After5Client): Promise<unknown> {
  const { data, error } = await client.rpc('safety_center', {});
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

- [ ] **Step 1: Full reset** Run: `supabase db reset` — all cumulative migrations (S1 schema spine → S2 async/notify/gate spine → … → P7 band `128xxx`) apply in filename order with no error. (P7 sorts after S1/S2/P5 so the spine it reads — `standing_state`/`jobs`/`enqueue_job`/`dispatch_notification`/`admin_alerts`/`file_report`/`match_cancel_lock`/`_fixtures.sql` — already exists.)

- [ ] **Step 2: Run every P7 SQL test** (each `\i`'s `_fixtures.sql`)

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
Expected: `packages/types/src/database.ts` gains the **P7-owned** objects only — `disputes`, `attendance_checkins`, `safety_checkins`, `user_sanctions` tables, the `safety_checkin_status` enum, the `profiles.standing_until`/`match_ratings.revealed_at|disputed|weight` columns, and the P7 functions. It does **NOT** add `jobs`, `enqueue_job`, `standing_state`, `report_status`, `file_report`, or `can_enter_lock_flow` (those regenerate from S1/S2's migrations, not P7's).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P7: regenerate database types for trust/safety/ratings schema"
```

---

## Self-Review (conformed to INTEGRATION-CONTRACT v2 + RECONCILED-MASTER-PLAN)

**Spec coverage (vs roadmap P7 'Delivers' + 'Closes'):**
- Structured ratings into `match_ratings` (4 booleans) → Task 2 `submit_rating` (actor = `auth.uid()`). ✅
- Blind-until-both reveal (or window close) → Task 1 columns + Task 2 reveal logic + Task 12 `close_rating_window` (C1 `rating_window` job handler). ✅
- Reliability score: recency-weighting + min-volume-before-it-counts, written to `profiles.reliability_score`, formula defined concretely → D1 + Task 3 (TS oracle) + Task 4 (SQL parity). ✅
- Enforcement ladder writing `profiles.standing` (C3) → D4 + Task 7 (math) + Task 8 (`user_sanctions`, `evaluate_standing`). The gate `can_enter_lock_flow` is **S2's** and **P5 already calls it** (C3) — P7 does not define or wire it. ✅
- Proof of attendance + disputed-no-show adjudication writing a `disputes` row (C11.6) → D3 + Task 5 (`attendance_checkins`) + Task 6 (`disputes` + `adjudicate_no_show`) + Task 13 (geofence Edge Function). No-show shield fixed (A1); bidirectional loop via P8 callback (B6). ✅
- Report/block flows with full propagation → D5 + Task 9 (`block_user` via C2 `match_pass_offer`/`match_cancel_lock`, `can_rematch`) + Task 10 (conform to canonical `file_report`, C5). ✅
- Emergency contact + safety check-in escalation via `dispatch_notification` + `admin_alerts` (C11.8) → D6 + Task 11 + Task 14. ✅
- User-facing safety center (pinned to `auth.uid()`) → Task 11 `safety_center()` + Task 15 `getSafetyCenter`. ✅
- Closes "no-show has no proof" / "ratings retaliation" / "fake safety UI" / "dead block/report" → Tasks 5/6/13, 1/2/6/12, 11/13/14, 9/10. ✅

**Builds on the shared spine (no re-creation, one-definition rule honored):** `alter table` adds to `match_ratings`/`profiles` only; calls (never defines) `enqueue_job`/`cancel_jobs`/`dispatch_notification`/`admin_alerts`/`file_report`/`match_cancel_lock`/`match_pass_offer`/`can_enter_lock_flow`; reads `profiles.standing standing_state`/`account_state`; uses `standing_state` (C3) and `report_status`/`report_reason_category` (C5) without redefining them; uses `_fixtures.sql` `mk_*` (C8). **P7-owned new tables:** `disputes` (C11.6 frozen DDL), `attendance_checkins`, `safety_checkins`, `user_sanctions`. **P7 creates NO** `jobs` table, `enqueue_job`, `can_enter_lock_flow`, `standing_state`/`report_status` enum, `file_report`, `rollover_frozen` column, `browse_feed`, or vitest config.

**Dependency hand-offs documented, not duplicated (Depends on):** S1 (`match_ratings`/`standing_state`/`disputes`/`reports`/fixtures); S2 (`jobs`/`enqueue_job`/`dispatch_notification`/`admin_alerts`/`can_enter_lock_flow`); S6/P5 (`match_cancel_lock`/`match_pass_offer`; P5 already calls `can_enter_lock_flow`; P5 reads `standing` for throttle/reconfirm); S9/P8 (upholds reports → `status='actioned'` feeds ladder; **P8 dispute-resolution calls back `recompute_reliability` + clears `match_ratings.disputed`**, C11.6); S7/P6 (`chat_threads.revoked_at` per C9).

**Conventions honored:** migrations in the **`128xxx` band (C6)**, RLS on every new table, idempotent policies, all writes via `SECURITY DEFINER` RPCs deriving the actor from `auth.uid()` (C10) with internal helpers `revoke … from public, authenticated`, `set_updated_at()` on `safety_checkins`, psql `DO`-block tests via `mk_*` fixtures, single root vitest (C10).

**Parity guard:** reliability formula + ladder exist twice (TS oracle + SQL); Task 4's parity test pins SQL to 87.50; standing thresholds matched Task 7 (TS) ↔ Task 8 (SQL) + behavior test.

**Forward-reference handling:** `submit_rating` (Task 2) / `recompute_reliability` (Task 4) P7-internal forward refs resolved by no-op stubs superseded by later P7 migrations; cross-stage refs (`file_report`, `enqueue_job`, `match_cancel_lock`, `standing_state`, `dispatch_notification`, `admin_alerts`) are present from S1/S2/S6 before P7's band — referenced, never stubbed/recreated.

**Placeholder scan:** none — every step has runnable SQL/TS/Deno and exact commands. No dead UI (this slice is backend + thin api-client; UI states are wired in S12 over these RPCs).

**Risk notes:**
- Geofence radius (150 m) / accuracy ceiling (200 m) are tunable in one module; urban multipath may need per-venue overrides (future).
- Venueless/at-home/live-event instances without coords: `within_geofence` defaults false → no-show stays *unverified* (0.5 weight), never wrongly *disproven*. Safe-by-default.
- Safety-report ladder rungs fire only after P8 upholds a report (`status='actioned'`); until S9 ships the console only the auto no-show/reliability arms fire — correct conservative behavior.
- Native GPS attestation (Play Integrity / App Attest) for geofence forgery (audit A2) is a launch-blocking native-platform concern carried by the verification/native stack — flagged, not solved in this SQL slice.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-p7-trust-safety-ratings.md`. This is the S8 slice; execute only after its dependencies land. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.

**2. Inline Execution** — execute tasks in this session via executing-plans with checkpoints.

**Prerequisite before executing (reconciled order, Build Rule 2 — shared before dependent):** **S1** (schema spine: `standing_state`/`account_lifecycle`, `reports`/`disputes`/`report_status`, `match_ratings`, `_fixtures.sql`) and **S2** (`jobs`/`enqueue_job`/`cancel_jobs` runner, `dispatch_notification`/`devices`/`admin_alerts`, `can_enter_lock_flow`), plus **S6** (`match_cancel_lock`/`match_pass_offer`; P5 already calls `can_enter_lock_flow`) must be applied first. **S7** (P6 chat `revoked_at`) and **S9** (P8 dispute-resolution callback) complete the bidirectional loops; the `to_regclass` guard keeps Task 9 safe if chat tables land in a later applied migration during development.
