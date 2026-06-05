# Phase 6: Trust & Safety (P2) - Research

**Researched:** 2026-06-04
**Domain:** Reliability scoring, chat RLS + navigation wiring, safety job handlers (Supabase Postgres 17 RPCs + Deno job handlers + Next.js 15 surfaces)
**Confidence:** HIGH (all citations verified against working-tree migrations and components this session)

## Summary

This is a WIRING phase. Every piece of plumbing already exists: `match_ratings` with the four boolean signals, a nullable `profiles.reliability_score`, the `public_profile_card` view, `badgeFor()`, the jobs system (enqueue/claim/fail + dead-letter@5), the `dispatch_notification` safety-gate, the `date_reconfirm`/`safety_checkin`/`safety_alert` notification types, the `day_of_reconfirm`/`safety_checkin` job_type enum values, `flag_no_show` (sets `locks.status='no_show'`), and a `chat_thread_party()` membership helper with a working `chat_threads_party_read` policy. The work is aggregation logic, two job handlers, two producer enqueues, one loader column, and four nav edges (two of which already exist).

Three findings drive the plan. **(1)** `flag_no_show` writes NO `match_ratings` row [VERIFIED: 20260604121000_e5_loop_completion.sql:155-157] — it only stamps `locks.status='no_show'`. So the reliability formula must count `no_show` locks separately as missed dates, not read them from `match_ratings`. **(2)** The LIVE definitions of `match_accept_offer` and `match_resolve_reciprocal` are in the LATEST migration band `20260527127800_p5_match_cohort_allowlist.sql` (lines 252 and 438) [VERIFIED: grep], NOT the older `_p5_accept_lock.sql`/`_p5_b_complete.sql` files which were superseded by `CREATE OR REPLACE`. The two new producer enqueues must be added at the rating_window enqueue sites in 127800 (lines 353-354 and 525-526), or the change will be silently overwritten. **(3)** The `chat_threads_party_read` RLS policy ALREADY EXISTS [VERIFIED: 20260601100100_p7_chat_rls_party_read.sql:21-23] via the `chat_thread_party()` helper — CONTEXT's "default-deny, add party-read" is stale; chat_threads is already party-readable. The only chat-loader change needed is selecting `lock_id`.

**Primary recommendation:** One migration adds `recompute_reliability(p_ratee uuid)` (DEFINER) + hooks it into `close_rating_window`; one migration re-creates `match_accept_offer` + `match_resolve_reciprocal` (in band 127800's lineage) adding the two producer enqueues; one migration adds two safety RPCs. Two job handlers extend the HANDLERS table. One chat-loader line selects `lock_id`. Verify the existing chat RLS rather than re-adding it. All gated-prod-apply, never auto-pushed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Reliability aggregation (E17) | Database (DEFINER RPC) | — | Aggregates `match_ratings` + `no_show` locks; writes `profiles.reliability_score`; only the DB has the rows and the security boundary |
| Reliability badge display (E17) | Frontend (ProfileCard) | Database (view) | `public_profile_card` already projects `reliability_score`/`badge_is_new`; `badgeFor()` derives the label; ProfileCard renders the pill |
| Chat RLS read (E18) | Database (RLS policy) | — | Already exists (`chat_threads_party_read`); verify only |
| Nav edges (E18) | Frontend (DeepRouteHeader + LockDetail) | Database (loader selects `lock_id`) | Reveal-gating depends on `lock_id` presence; identity already revealed post-lock (Phase 5) |
| Safety job dispatch (E19) | Edge Function (handlers.ts) | Database (DEFINER RPCs) | Handler calls a DEFINER RPC which calls `dispatch_notification`; mirrors `rating_window`→`close_rating_window` |
| Safety job producers (E19) | Database (lock RPCs) | — | Enqueues live inside `match_accept_offer` / `match_resolve_reciprocal` transactions, atomic with the lock |
| Reconfirm/check-in surfaces (E19) | Frontend (LockDetail) | Database (loader flags) | Conditional blocks gated by loader-provided state, mirroring existing `ratingOpen` |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 (Reliability score):** Simple weighted % of positive outcomes from `match_ratings` for the ratee — `showed_up` weighted heaviest; `on_time` and `cancelled_with_notice` contribute; `unsafe_or_disrespectful` penalizes hard. Profile stays "new" (badge_is_new, no number) until ≥3 rated dates. Surface via `public_profile_card` + `badgeFor()`. Recency/decay DEFERRED to P3. (Re)computed when the rating window closes (`close_rating_window`).
- **D-02 (No-show consequence):** Reliability hit ONLY. `no_show` feeds the score as a missed/negative date. NO ban, NO cooldown, NO mod alert. Enforcement deferred.
- **D-03 (Safety check-in):** Soft ping, notify-only. `safety_checkin` job fires a `safety_checkin` notification ("all good?"). Optional "something's wrong" dispatches `safety_alert` (routes to mod/admin via existing fail-loud chain). NO blocking, NO auto-escalation on no-ack.
- **D-04 (Day-of reconfirm):** Morning-of, soft warning. Accept enqueues `day_of_reconfirm` anchored to the morning of the date; dispatches `date_reconfirm` ("still on?"). No response = soft warning surfaced to both parties. NO auto-cancel.

### Claude's Discretion
- Reliability weighting numbers + numeric range (0–100 vs 0–5) + on-badge visual. **UI-SPEC locked these: 0–100 integer percent, `blush` new-member pill, `sage` tick for established.**
- `close_rating_window` direct vs dedicated `recompute_reliability(ratee)` RPC — **prefer the small dedicated RPC for testability** (CONTEXT explicit preference).
- "Morning-of" anchor (date city local tz; reuse quiet-hours tz-resolution) + dedup keys (mirror `rating:`||lock_id).
- The 4-edge nav implementation (Chat→Profile, Chat→Night, Profile→Night, Night→Profile/Chat) reusing DeepRouteHeader + reveal-gated ProfileCard.
- Chat RLS read policies — secure-by-default, no USING(true), pin search_path, run advisor after DDL.
- Soft-warning + checkin-ack render surfaces (reuse LockDetail / matches; keep light).

### Deferred Ideas (OUT OF SCOPE)
- Recency-weighted / decaying reliability (P3) — ship flat weighting first.
- No-show enforcement (bans/cooldowns/mod alerts).
- Enforced safety check-in + no-ack auto-escalation.
- Reconfirm auto-cancel on timeout (`reconfirm_timeout` job).
- WR-04 (clear photo revealable after cancelled lock) — tracked separately.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-E17 | Compute `reliability_score` from `match_ratings`; surface on badge; make `no_show` feed the score | `recompute_reliability` formula below; `flag_no_show` writes `locks.status='no_show'` only (must be counted separately); badge picks up via existing view + `badgeFor()` with zero UI-data change |
| REQ-E18 | Wire 4 chat↔profile↔night nav edges + chat RLS read policies | chat RLS already exists (verify only); Night→Profile + Night→Chat already exist in LockDetail; add Chat→Profile + Chat→Night in DeepRouteHeader (needs loader `lock_id`); Profile→Night is a Link/scroll |
| REQ-E19 | Implement + enqueue `day_of_reconfirm` + `safety_checkin`; handlers run without poison-looping | Two stale-tolerant DEFINER RPCs mirroring `close_rating_window`'s never-raise pattern; producers at the two LIVE lock-RPC enqueue sites; tz anchor via `cities.timezone`; dedup keys `reconfirm:`/`checkin:`||lock_id |
</phase_requirements>

## Standard Stack

No new dependencies. This phase uses only what is installed and the existing DB primitives.

| Asset | Location | Role this phase |
|-------|----------|-----------------|
| `match_ratings` | `20260525120800_p0_match_ratings.sql:1-15` | Source rows for the formula (`showed_up`/`on_time`/`cancelled_with_notice`/`unsafe_or_disrespectful`, indexed `match_ratings_ratee_idx` on `ratee_id`) |
| `profiles.reliability_score numeric(4,2)` | `20260525120100_p0_profiles_dating.sql:35` [CITED: CONTEXT] | Write target; nullable = "new" |
| `public_profile_card` view | `20260525122700_p1_badge_view.sql` [CITED: CONTEXT] | Projects `reliability_score`, `badge_is_new` — no view change needed |
| `badgeFor()` | `packages/business/src/eligibility.ts:14` [CITED: CONTEXT] | Derives badge label from `{ verification, reliability_score }` |
| `flag_no_show` | `20260604121000_e5_loop_completion.sql:118` | Sets `locks.status='no_show'` ONLY (line 155-157); writes NO match_ratings row |
| `lock_status` enum incl. `no_show` | `20260525120700_p0_locks.sql:3` [CITED: CONTEXT] | The `no_show` outcome the formula counts |
| `close_rating_window(p_lock)` | `20260527127200_p5_job_rpcs_backfill.sql:79` | The recompute hook (currently only stamps `rating_closed_at`) |
| jobs RPCs (`enqueue_job`/`claim_due_jobs`/`fail_job`) | `20260525123100_p2_jobs_rpcs.sql` [CITED: CONTEXT] | Backoff + dead-letter@5 |
| `job_type` enum (`day_of_reconfirm`,`safety_checkin` present) | `20260525123000_p2_jobs.sql:9` [CITED: CONTEXT] | Enum values already exist |
| `notification_type` enum (`date_reconfirm`,`safety_checkin`,`safety_alert`) | `20260525123400_p2_notifications.sql:9` [CITED: CONTEXT] | Notification types already exist |
| `dispatch_notification` safety-gate | `20260525123600_p2_dispatch_notification.sql` | Safety bypasses consent/quiet/rate; tz via `cities.timezone` join (lines 67-72) |
| `HANDLERS` table | `supabase/functions/process-jobs/handlers.ts:58` | Extend with two handlers; `callRpc` throws on RPC error (line 26-34) |
| `chat_thread_party(p_thread, p_uid)` | `20260601100100_p7_chat_rls_party_read.sql:10-18` | Reusable DEFINER membership helper (parties = offer.creator_id/candidate_id) |
| `chat_threads_party_read` policy | `20260601100100_p7_chat_rls_party_read.sql:21-23` | ALREADY EXISTS — verify, do not re-add |
| `DeepRouteHeader` | `apps/web/components/DeepRouteHeader.tsx` (imported `messages/[threadId]/page.tsx:12`) | Has a `right` slot for the two Chat-edge controls |
| `LockDetail` | `apps/web/app/matches/[lockId]/LockDetail.tsx` | Night→Profile (line 103) + Night→Chat (line 116-120) already exist; reconfirm/check-in blocks added here |

**Installation:** none. `npm install` not run this phase.

## Package Legitimacy Audit

Not applicable — this phase installs zero external packages. All work uses installed dependencies (verified in CLAUDE.md STACK section: Supabase JS 2.45.0, lucide-react 0.460, framer-motion, vaul, sonner) and existing DB primitives.

## Architecture Patterns

### System Architecture Diagram

```
                          E17 RELIABILITY
  rating window closes (job)
        │
        ▼
  rating_window handler ──► close_rating_window(p_lock)
                                  │ (after stamping rating_closed_at)
                                  ▼
                          recompute_reliability(p_ratee)   ◄── DEDICATED DEFINER RPC
                                  │   reads:
                                  │     • match_ratings WHERE ratee_id = p_ratee
                                  │     • locks WHERE status='no_show' AND p_ratee was a party
                                  ▼
                          UPDATE profiles.reliability_score (or leave NULL if <3 dates)
                                  │
                          public_profile_card view (no change) ──► badgeFor() ──► ProfileCard pill


                          E18 NAV EDGES
  messages/[threadId]/page.tsx loader ──(add lock_id to SELECT)──► DeepRouteHeader.right
        │                                                              ├─ Chat→Profile  (gated on lock_id)
        │                                                              └─ Chat→Night    (gated on lock_id)
        ▼
  LockDetail.tsx ──► Night→Profile (exists) + Night→Chat (exists) + Profile→Night (Link/scroll)


                          E19 SAFETY JOBS
  match_accept_offer / match_resolve_reciprocal  (LIVE in band 127800)
        │ at the rating_window enqueue site, ALSO:
        ├─ enqueue_job('day_of_reconfirm', <morning-of, city tz>, {lock_id}, 'reconfirm:'||lid)
        └─ enqueue_job('safety_checkin',   <post-window>,        {lock_id}, 'checkin:'||lid)
                                  │
                          claim_due_jobs (cron) ──► handlers.ts HANDLERS
                                  ├─ day_of_reconfirm ──► dispatch_date_reconfirm(p_lock) ──► dispatch_notification('date_reconfirm')
                                  └─ safety_checkin    ──► dispatch_safety_checkin(p_lock) ──► dispatch_notification('safety_checkin')
                                  (both stale-tolerant: never raise on resolved/cancelled lock)
```

### Pattern 1: Dedicated DEFINER aggregation RPC called from the window-close handler
**What:** `close_rating_window` calls `recompute_reliability(p_ratee)` for each party after stamping `rating_closed_at`. The aggregation lives in its own RPC so it is independently unit-testable (CONTEXT preference D-01/Discretion).
**When to use:** the recompute hook.
**Example (shape — author the exact weights in the plan):**
```sql
-- Source: pattern mirrors close_rating_window (20260527127200_p5_job_rpcs_backfill.sql:79-94)
create or replace function recompute_reliability(p_ratee uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare
  n_rated  int;      -- count of distinct rated dates for this ratee
  n_noshow int;      -- no_show locks where ratee was a party (NOT in match_ratings)
  raw      numeric;
begin
  if p_ratee is null then return; end if;

  -- rated dates: one match_ratings row per (lock, rater); count distinct locks rated about p_ratee
  select count(distinct lock_id) into n_rated
    from match_ratings where ratee_id = p_ratee;

  -- no_show locks counted as missed dates (flag_no_show sets locks.status, NOT a rating row)
  select count(*) into n_noshow
    from locks l
    where l.status = 'no_show'
      and (l.creator_id = p_ratee or l.matched_user_id = p_ratee);

  -- "new" until >= 3 rated dates: leave score NULL so badge_is_new stays true
  if (n_rated + n_noshow) < 3 then
    update profiles set reliability_score = null where id = p_ratee;
    return;
  end if;

  -- weighted % over the ratee's match_ratings + no_show penalty.
  -- showed_up heaviest; on_time + cancelled_with_notice positive;
  -- unsafe_or_disrespectful penalizes hard; each no_show lock counts as a missed date.
  -- Range 0-100 integer (UI-SPEC Discretion #1). EXACT weights = plan decision.
  select round( /* weighted formula over match_ratings WHERE ratee_id=p_ratee + n_noshow */ )
    into raw;

  update profiles set reliability_score = greatest(0, least(100, raw)) where id = p_ratee;
end $fn$;

revoke all on function recompute_reliability(uuid) from public, anon, authenticated;
```
**Recommended weighting (Claude's Discretion — plan should confirm):** treat each rated date as a 0–100 contribution: base from `showed_up` (e.g. showed_up=true → +100 of the showed-up component, weighted ~0.6 of the score), `on_time` and `cancelled_with_notice` as positive modifiers (~0.2 each), and `unsafe_or_disrespectful=true` applies a hard fixed penalty (e.g. −40 to that date's contribution, floored at 0). Each `no_show` lock enters as a 0-score missed date. Average across (rated dates + no_show dates), clamp 0–100, round to integer.

### Pattern 2: `no_show` is a lock status, not a rating row
**What:** `flag_no_show` [VERIFIED: 20260604121000_e5_loop_completion.sql:155-157] runs `update locks set status='no_show'` and writes ZERO match_ratings rows. A no_show date therefore never appears in `match_ratings`.
**Consequence:** the formula MUST `count(*) from locks where status='no_show' and (creator_id=p_ratee or matched_user_id=p_ratee)` and fold those in as missed dates. They also count toward the ≥3-dates "new" threshold (a serial no-show should not stay "new"). Do not try to read no_show from `match_ratings` — it isn't there.

### Pattern 3: Producers enqueue at the LIVE lock-RPC definitions, mirroring rating_window
**What:** the `rating_window` job is enqueued inside the lock RPCs at a `run_after = lock_end + 2h` with dedup key `rating:`||lid [VERIFIED: 20260527127800:353-354 (accept), :525-526 (reciprocal)]. The two safety jobs mirror this exactly, side-by-side.
**CRITICAL — correct enqueue sites:** the LIVE definitions are in `20260527127800_p5_match_cohort_allowlist.sql`:
- `match_accept_offer` (function at line 252) → enqueue site at **353-354**
- `match_resolve_reciprocal` (function at line 438) → enqueue site at **525-526**

The older `20260527126400_p5_accept_lock.sql:129` and `20260527126900_p5_b_complete.sql:354` are SUPERSEDED by the 127800 `CREATE OR REPLACE` and are NOT executed at runtime. Editing them does nothing. The new producer migration must re-create both functions in a band ABOVE 127800 (e.g. a fresh `2026060x_e6_*` migration) carrying the full current body PLUS the two new enqueues.
**Example (added beside the existing rating_window enqueue):**
```sql
-- Source: mirrors the rating_window enqueue at 20260527127800:353-354
-- day_of_reconfirm: morning-of the date in the date city's tz (reuse dispatch quiet-hours tz pattern)
perform enqueue_job('day_of_reconfirm', date_trunc('day', lower(rng) at time zone <city_tz>) at time zone <city_tz> + interval '9 hours',
  jsonb_build_object('lock_id', lid), 'reconfirm:'||lid::text);
-- safety_checkin: after the date window ends
perform enqueue_job('safety_checkin', upper(rng) + interval '2 hours',
  jsonb_build_object('lock_id', lid), 'checkin:'||lid::text);
```
**Morning-of tz anchor:** reuse the `dispatch_notification` pattern [VERIFIED: 20260525123600:67-72] — `select c.timezone from profiles pr join cities c on c.id = pr.primary_city_id`. For the date, resolve the city from the `date_instance` (the lock's instance) and compute `date_trunc('day', start at time zone tz) at time zone tz + interval '9 hours'` (morning-of in local time). Degrade permissive (e.g. fall back to `lower(rng) - interval '6 hours'` UTC) if tz is unknown, matching dispatch's permissive degrade.

### Pattern 4: Stale-tolerant safety handler RPCs (poison-loop avoidance)
**What:** each handler calls a DEFINER RPC that NEVER raises on an already-resolved/cancelled/missing lock — the `close_rating_window` posture [VERIFIED: 20260527127200:83-88: `if p_lock is null then return`, `if not found_lock then return`, idempotent no-op when already stamped].
**Why:** `handlers.ts` `callRpc` THROWS on RPC error (line 26-34), which fails the job and triggers backoff → dead-letter@5. A handler that raises on a normally-cancelled lock would poison-loop until dead-lettered. The RPC must treat "lock cancelled / no longer active / already dispatched" as a clean drain (return void, no raise).
**Example:**
```sql
-- Source: never-raise pattern from close_rating_window (20260527127200:79-94)
create or replace function dispatch_date_reconfirm(p_lock uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare cre uuid; matched uuid; inst uuid; lst lock_status;
begin
  if p_lock is null then return; end if;
  select creator_id, matched_user_id, date_instance_id, status
    into cre, matched, inst, lst from locks where id=p_lock;
  if cre is null then return; end if;             -- stale: drain cleanly
  if lst <> 'active' then return; end if;          -- cancelled/no_show/completed: no reconfirm, drain
  perform dispatch_notification(cre,     'date_reconfirm', jsonb_build_object('lock_id', p_lock, 'instance', inst));
  perform dispatch_notification(matched, 'date_reconfirm', jsonb_build_object('lock_id', p_lock, 'instance', inst));
end $fn$;
revoke all on function dispatch_date_reconfirm(uuid) from public, anon, authenticated;
```
`dispatch_safety_checkin(p_lock)` mirrors this, dispatching `'safety_checkin'`. Note safety notifications bypass consent/quiet/rate-limit in `dispatch_notification` (D-03).

### Pattern 5: Reveal-gated chat nav (select `lock_id`)
**What:** the messages loader [VERIFIED: messages/[threadId]/page.tsx:38-49] currently selects `id, state, both_ready, revoked_at` + the offer FK, but NOT `lock_id`. Add `lock_id` to the `chat_threads` select. Pass it to `DeepRouteHeader`'s `right` slot. Render the Chat→Profile + Chat→Night controls ONLY when `lock_id` is non-null (pre-lock = no identity leak; reveal-gated). Each icon-only control carries an `aria-label` (`their profile`, `the night`) per UI-SPEC.

### Anti-Patterns to Avoid
- **Editing superseded migrations:** changing the enqueue in `_p5_accept_lock.sql` or `_p5_b_complete.sql` is a no-op (overwritten by 127800). Re-create the LIVE functions in a new band.
- **Reading no_show from match_ratings:** it isn't there; count it from `locks.status`.
- **Re-adding chat RLS:** `chat_threads_party_read` already exists; a duplicate `create policy` without `drop policy if exists` throws. Verify, don't recreate (and if recreating defensively, use `drop policy if exists` first as 100100 does).
- **DROP+CREATE on the lock RPCs:** drops the `grant ... to authenticated` (match_accept_offer is a PUBLIC C2 RPC, must keep authenticated grant — see 20260527126400:151). Use `CREATE OR REPLACE` (grants survive). Only the two NEW safety RPCs + `recompute_reliability` are revoke-from-all DEFINER internals.
- **Rendering a red/destructive safety surface:** D-03/D-04 are soft; UI-SPEC forbids new red. Reconfirm "gotta bail" reuses the existing cancel flow.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Chat membership check | A new join-in-policy | `chat_thread_party(thread, uid)` DEFINER helper (already exists) | Avoids RLS recursion into chat_threads; already tested in Phase 7 |
| Quiet-hours / tz resolution | A new tz lookup | `dispatch_notification`'s `cities.timezone` join pattern (123600:67-72) | Consistent permissive-degrade behavior already encoded |
| Job retry / dead-letter | Custom retry loop | `enqueue_job`/`fail_job` backoff + dead-letter@5 | Robust, already powering rating_window |
| Reliability surface in view | Modifying `public_profile_card` | It already projects `reliability_score`/`badge_is_new` | Zero UI-data change; only `recompute_reliability` writes the column |
| Idempotent window-close | New guard logic | `close_rating_window`'s null-check + found-check + already-done no-op | Proven poison-loop-safe template |
| Notification dispatch + safety bypass | New send path | `dispatch_notification` (safety types bypass consent/quiet/rate, fail-loud to admin_alert) | Safety chain already fail-loud |

**Key insight:** every "hard" part of this phase already has a battle-tested primitive in the codebase. The phase is wiring + one aggregation formula, not new infrastructure.

## Runtime State Inventory

This phase is additive (new RPCs/handlers/UI), not a rename/migration. The relevant runtime-state question is "what live state must existing locks carry for the new flows":

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `profiles.reliability_score` is currently all-NULL (no aggregation ever ran). After deploy, only NEW window-closes recompute it. | Optional one-time backfill: call `recompute_reliability` for all ratees with ≥3 rated dates. Plan should decide backfill-now vs lazy-on-next-close. Not required for correctness (NULL = new, which is acceptable). |
| Live service config | Vercel Cron (`apps/web/vercel.json`) already drives `process-jobs`; new job_types route through the same consumer. | None — handlers.ts addition is picked up automatically. |
| OS-registered state | None. | None — verified: jobs run via Vercel Cron, not OS scheduler. |
| Secrets/env vars | None new. Uses existing `CRON_SECRET`/`JOBS_RUNNER_SECRET`/`SUPABASE_SECRET_KEY`. | None. |
| Build artifacts | Deno edge function `process-jobs` redeploys on handlers.ts change; `@after5/business` (badgeFor) may need rebuild if touched (likely NOT — badge logic unchanged). | Redeploy `process-jobs` edge function after handlers.ts edit. |
| In-flight locks | Locks already `active` at deploy time will NOT have the two safety jobs enqueued (producers only fire at accept-time). | Acceptable for MVP (forward-only). If retroactive coverage wanted, that is a separate backfill — flag as Open Question. |

## Common Pitfalls

### Pitfall 1: Wiring the producer into a superseded migration
**What goes wrong:** the enqueue is added to `_p5_accept_lock.sql`/`_p5_b_complete.sql`; nothing happens at runtime.
**Why it happens:** both functions are `CREATE OR REPLACE`'d again in the later `20260527127800` band, which holds the live body.
**How to avoid:** re-create `match_accept_offer` (127800:252) and `match_resolve_reciprocal` (127800:438) in a NEW migration band > 127800, copying the current full body and adding the two enqueues beside the `rating_window` enqueue.
**Warning signs:** `select prosrc from pg_proc where proname='match_accept_offer'` after local apply does not contain `day_of_reconfirm`.

### Pitfall 2: Forgetting BOTH lock paths
**What goes wrong:** reciprocal-matched dates never get a reconfirm/check-in.
**Why it happens:** the accept path is obvious; the reciprocal path (`match_resolve_reciprocal`) is a separate function with its own enqueue site (127800:525-526).
**How to avoid:** mirror the producer in BOTH (Phase 5 E16 precedent, CONTEXT established pattern).
**Warning signs:** a reciprocal lock has a `rating:` job but no `reconfirm:`/`checkin:` job.

### Pitfall 3: Safety handler raising on a cancelled lock → poison loop
**What goes wrong:** a date is cancelled before morning-of; the reconfirm handler raises; job backs off then dead-letters at 5.
**Why it happens:** `callRpc` throws on any RPC error.
**How to avoid:** the dispatch RPCs return cleanly (no raise) for any non-`active` lock or missing lock — the `close_rating_window` posture.
**Warning signs:** `jobs` rows for `day_of_reconfirm` stuck retrying / hitting dead-letter.

### Pitfall 4: Counting no_show twice or not at all
**What goes wrong:** the formula either ignores no_show (so serial no-shows keep a perfect score) or double-counts (a date both rated AND flagged no_show).
**Why it happens:** no_show lives in `locks.status`, separate from `match_ratings`.
**How to avoid:** count no_show from `locks`; decide the rated∩no_show overlap rule explicitly (recommend: a no_show lock should not also have a `showed_up=true` rating — if both somehow exist, the no_show is authoritative as a missed date). Document the chosen rule in the migration comment.
**Warning signs:** a test profile with 3 no-shows still shows `new here` or a high score.

### Pitfall 5: Re-adding the chat RLS policy
**What goes wrong:** `create policy chat_threads_party_read` throws `duplicate_object` (policy already exists from 100100).
**Why it happens:** CONTEXT says "default-deny, add party-read" — but Phase 7 already added it.
**How to avoid:** verify with `select polname from pg_policies where tablename='chat_threads'`; the RLS task is a VERIFICATION task (and a denies-non-party test), not a create task. If any defensive recreate is wanted, `drop policy if exists` first.
**Warning signs:** local apply fails on the chat RLS migration.

## Code Examples

### E18 — add `lock_id` to the chat loader (the only loader change)
```typescript
// Source: apps/web/app/messages/[threadId]/page.tsx:38-49 (add lock_id to the existing select)
const { data: row } = await supabase
  .from('chat_threads')
  .select(`
    id, state, both_ready, revoked_at, lock_id,   // <-- ADD lock_id
    offer:offers!chat_threads_offer_id_fkey (
      creator_id, candidate_id,
      creator:profiles!offers_creator_id_fkey ( id, first_name, clear_photo_url ),
      candidate:profiles!offers_candidate_id_fkey ( id, first_name, clear_photo_url )
    )
  `)
  .eq('id', threadId)
  .maybeSingle();
// then: pass thread.lock_id into DeepRouteHeader's right slot; render Chat->Profile
// (/matches/${lock_id} reveal) and Chat->Night (/matches/${lock_id}) ONLY when lock_id != null.
```

### E18 — confirmed existing edges in LockDetail (no change)
```tsx
// Source: apps/web/app/matches/[lockId]/LockDetail.tsx
// Night -> Profile (line ~103): "see their profile"  -- SATISFIES the contract, unchanged
// Night -> Chat (line ~116-120): <Link href={`/messages/${threadId}`}>message {name}</Link> -- unchanged
```

### E19 — handlers.ts additions (extend the HANDLERS table)
```typescript
// Source: supabase/functions/process-jobs/handlers.ts:58 (mirror the rating_window entry at :64)
export const HANDLERS: Record<string, Handler> = {
  // ...existing...
  rating_window: async (db, job) => { await callRpc(db, "close_rating_window", { p_lock: id(job, "lock_id") }); },
  day_of_reconfirm: async (db, job) => { await callRpc(db, "dispatch_date_reconfirm", { p_lock: id(job, "lock_id") }); },
  safety_checkin:   async (db, job) => { await callRpc(db, "dispatch_safety_checkin",  { p_lock: id(job, "lock_id") }); },
};
```

## Migrations List

All migrations are GATED-PROD-APPLY: local `supabase db reset`/apply + Supabase security advisor, NOT applied to prod ref `ufufmcpnysvwtutpbian` in this phase. New DEFINER functions pin `set search_path=public` and revoke from public/anon/authenticated (internal) — except the two PUBLIC lock RPCs which keep their `grant to authenticated`.

| # | File (new band) | Contents | CREATE strategy | Grant note |
|---|------|----------|-----------------|------------|
| (a) | `2026060x_e17_recompute_reliability.sql` | `recompute_reliability(p_ratee uuid)` DEFINER + `CREATE OR REPLACE close_rating_window` calling it for BOTH parties after stamping `rating_closed_at` | CREATE OR REPLACE (close_rating_window grants survive); new fn is revoke-all-internal | `recompute_reliability`: revoke from public/anon/authenticated |
| (b) | `2026060x_e19_safety_dispatch_rpcs.sql` | `dispatch_date_reconfirm(p_lock)` + `dispatch_safety_checkin(p_lock)` DEFINER, stale-tolerant | CREATE OR REPLACE | revoke from public/anon/authenticated (service-role/handler only) |
| (c) | `2026060x_e19_lock_rpc_producers.sql` | Re-CREATE `match_accept_offer` + `match_resolve_reciprocal` (full current body from 127800:252 / :438) ADDING the two enqueues beside the rating_window enqueue | **CREATE OR REPLACE** (grants survive — match_accept_offer keeps `grant to authenticated`) | preserve existing grants; do NOT DROP |
| (d) | (none — verify only) | Confirm `chat_threads_party_read` exists; add a denies-non-party test | n/a | n/a |

**CREATE OR REPLACE vs DROP+CREATE:** use `CREATE OR REPLACE` everywhere here. The lock RPCs MUST keep their `grant to authenticated` (DROP would strip it and require a re-grant tail — avoidable). The new internal RPCs are revoke-all regardless. After every DDL migration run the Supabase advisor (CLAUDE.md secure-by-default rule).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.8 (Node for `packages/*`, jsdom for `apps/web` via `vitest.workspace.ts`); Playwright 1.49.0 for E2E |
| Config file | `vitest.config.ts` + `vitest.workspace.ts`; Playwright in `apps/web` |
| SQL/RLS checks | local Supabase apply + SQL assertions (no pgTAP harness detected in tree — use SQL test scripts run against the local stack, the established pattern) |
| Quick run command | `pnpm vitest run <file>` (per-file) |
| Full suite command | `pnpm test` / `pnpm turbo test` + `pnpm --filter web exec playwright test` for E2E |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-E17 | weighted % math (showed_up heaviest; unsafe penalizes; on_time/cancelled positive) | unit (pure fn) | `pnpm vitest run packages/business/src/reliability.test.ts` | ❌ Wave 0 |
| REQ-E17 | `<3` rated dates → score NULL → `badge_is_new` | unit | same file (badgeFor + threshold) | ❌ Wave 0 |
| REQ-E17 | `no_show` locks counted as missed dates (NOT from match_ratings) | SQL/local-apply | `supabase/tests/e17_recompute_reliability.sql` (seed ratings + no_show lock, assert score) | ❌ Wave 0 |
| REQ-E17 | `close_rating_window` triggers recompute for both parties, idempotent | SQL/local-apply | same SQL file (double-call no-op assertion) | ❌ Wave 0 |
| REQ-E17 | ProfileCard renders pill from `reliability_score`/`badge_is_new` | component (jsdom) | `pnpm vitest run apps/web/components/ProfileCard.test.tsx` | ❓ extend existing |
| REQ-E18 | `chat_threads_party_read` DENIES a non-party | SQL/local-apply | `supabase/tests/e18_chat_rls_denies_nonparty.sql` (set role / auth.uid swap, assert 0 rows) | ❌ Wave 0 |
| REQ-E18 | Chat→Profile + Chat→Night render only when `lock_id` present; aria-labels set | E2E (Playwright) | `apps/web/e2e/e18-chat-nav-edges.spec.ts` | ❌ Wave 0 |
| REQ-E18 | Night→Profile + Night→Chat still navigate | E2E | same spec (LockDetail edges) | ❌ Wave 0 |
| REQ-E19 | `day_of_reconfirm` handler dispatches `date_reconfirm` | SQL/local-apply | `supabase/tests/e19_safety_handlers.sql` (enqueue→call RPC→assert notification row) | ❌ Wave 0 |
| REQ-E19 | `safety_checkin` handler dispatches `safety_checkin` | SQL/local-apply | same SQL file | ❌ Wave 0 |
| REQ-E19 | handler is idempotent / NEVER raises on cancelled/resolved lock (poison-loop safety) | SQL/local-apply | same SQL file: cancel the lock, call RPC, assert returns void + 0 new notifications + job drains | ❌ Wave 0 |
| REQ-E19 | a no-ack reconfirm does NOT auto-cancel the lock | SQL/local-apply | same SQL file: enqueue+dispatch reconfirm, advance time, assert `locks.status` UNCHANGED (D-04) | ❌ Wave 0 |
| REQ-E19 | BOTH `match_accept_offer` AND `match_resolve_reciprocal` enqueue both safety jobs | SQL/local-apply | `supabase/tests/e19_producers.sql` (run each lock RPC, assert `reconfirm:`/`checkin:` jobs exist) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run <touched test file>` (formula/api-client/component) + the relevant `supabase/tests/*.sql` against local stack.
- **Per wave merge:** `pnpm test` (full vitest) + the full `supabase/tests/e1*.sql` set after `supabase db reset`.
- **Phase gate:** full vitest + Playwright E2E green; Supabase advisor clean after migrations; visual-verify @420px on the reliability pill + reconfirm/check-in cards; then `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `packages/business/src/reliability.test.ts` — covers REQ-E17 formula + ≥3 threshold + badgeFor mapping
- [ ] `supabase/tests/e17_recompute_reliability.sql` — no_show feed + idempotent recompute (seed fixtures: a ratee with mixed ratings + a no_show lock)
- [ ] `supabase/tests/e18_chat_rls_denies_nonparty.sql` — RLS denies non-party SELECT on chat_threads
- [ ] `apps/web/e2e/e18-chat-nav-edges.spec.ts` — the 4 edges (2 new gated on lock_id, 2 existing) + aria-labels
- [ ] `supabase/tests/e19_safety_handlers.sql` — both handlers dispatch; idempotent/never-raise; no-ack does NOT auto-cancel
- [ ] `supabase/tests/e19_producers.sql` — both lock RPCs enqueue both jobs with correct dedup keys
- [ ] Possibly extend `apps/web/components/ProfileCard.test.tsx` for the pill (new-member vs established)
- [ ] Shared SQL test seed/fixtures for a completed lock + two profiles (reuse existing match-loop fixtures if present)

*(SQL "tests" run against the local Supabase stack — this repo has no pgTAP harness in-tree, so these are SQL assertion scripts executed after `supabase db reset`, matching the project's existing local-apply verification posture.)*

## Security Domain

`security_enforcement` not set to false → enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth changes; RPCs re-check `auth.uid()` where they take an actor (none of the new ones do — they're service-role/handler-invoked) |
| V3 Session Management | no | Unchanged |
| V4 Access Control | yes | `chat_threads_party_read` RLS (party-scoped, `chat_thread_party` helper, no USING(true)); new DEFINER RPCs revoke from public/anon/authenticated; lock RPCs keep their existing authenticated grant + internal auth.uid() re-check |
| V5 Input Validation | yes | RPCs take only UUIDs; null-checked; `match_ratings` insert policy enforces rater participation (already exists); zod on any new API ack route |
| V6 Cryptography | no | None hand-rolled |
| V7/V9 Error/Comms | yes (safety) | `dispatch_notification` fails loud to `admin_alert` on safety dispatch failure (D-03 "fail loud, not silent") |

### Known Threat Patterns for Supabase RLS + DEFINER
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Rating stuffing against strangers | Tampering | `match_ratings_rater_insert` policy requires rater participation (already exists, 20260525120800:22-33) |
| Reliability tampering via direct UPDATE | Tampering | `reliability_score` written ONLY by `recompute_reliability` (revoke-all DEFINER); no client write path |
| Chat thread read by non-party | Info disclosure | `chat_threads_party_read` party-scoped policy (verify denies non-party) |
| Pre-lock identity leak via chat nav | Info disclosure | Chat→Profile/Night render gated on `lock_id != null` (reveal-gated; pre-lock = no control) |
| search_path hijack on new DEFINER | Elevation | All new functions `set search_path=public` (mirrors every existing RPC) |
| Safety job poison-loop / silent drop | DoS / Repudiation | stale-tolerant RPC (never raise on resolved lock) + dead-letter@5 + admin_alert fail-loud |

Run `mcp__supabase__get_advisors` (or `supabase db lint`) after each DDL migration on the local stack — CLAUDE.md mandate.

## State of the Art

| Old (CONTEXT assumption) | Current (verified this session) | Impact |
|--------------------------|----------------------------------|--------|
| "chat_threads has NO RLS read policies (default-deny) — add party-read" | `chat_threads_party_read` ALREADY EXISTS via `chat_thread_party()` (Phase 7, 20260601100100) | E18 RLS task becomes VERIFY + denies-non-party test, not a create — saves a migration |
| Live lock RPCs in `_p5_accept_lock.sql` / `_p5_b_complete.sql` | Both superseded by `20260527127800_p5_match_cohort_allowlist.sql` (accept@252, reciprocal@438) | Producers MUST target the 127800 lineage in a new band |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `profiles.reliability_score numeric(4,2)` at 20260525120100:35 (column exists, nullable) | Standard Stack | LOW — cited from CONTEXT canonical_refs (verified by prior scan); if range is numeric(4,2) it holds 0–100 to 2dp fine. Plan should confirm column precision allows integer 0–100. |
| A2 | `public_profile_card` projects `reliability_score` + `badge_is_new` with no change needed | Architecture | LOW — cited from CONTEXT; badge picks up automatically. Confirm view actually selects these columns before claiming "no UI-data change." |
| A3 | `badgeFor()` signature accepts `{ verification, reliability_score }` and derives `isNew` | Code Examples | MEDIUM — cited from CONTEXT line 62; not opened this session. Plan/executor must read `packages/business/src/eligibility.ts:14` to confirm the exact param shape before extending. |
| A4 | DeepRouteHeader exposes a `right` slot | E18 | LOW — UI-SPEC + import at messages page confirm usage; executor confirms the prop name when wiring. |
| A5 | `date_instance` carries a city FK resolvable to `cities.timezone` for the morning-of anchor | E19 tz | MEDIUM — dispatch uses `profiles.primary_city_id`; the DATE's city may live on `date_instances` differently. Executor must confirm the date→city→tz join before authoring the run_after. Fallback degrade (UTC offset) keeps it safe if unresolved. |
| A6 | Exact reliability weights (0.6/0.2/0.2, −40 unsafe penalty) | Pattern 1 | MEDIUM — Claude's Discretion; these are a recommended starting point, not locked. Plan should set final numbers and the rated∩no_show overlap rule. |

## Open Questions (RESOLVED)

> All resolved by discretion + encoded in the plans: backfill = forward-only (06-05); retroactive safety jobs = forward-only; rated∩no_show overlap = no_show authoritative (06-01 T1, one bucket per lock); date→city tz join = executor-confirm with safe degrade fallback.


1. **Backfill existing reliability_score?**
   - What we know: column is all-NULL; recompute only fires on future window-closes.
   - What's unclear: whether to backfill profiles with ≥3 historical rated dates now.
   - Recommendation: lazy (forward-only) for MVP; NULL renders as "new here" which is acceptable. Optional one-shot `recompute_reliability` loop if product wants existing reliable users badged immediately. Plan decision.

2. **Retroactive safety jobs for already-active locks?**
   - What we know: producers fire at accept-time only; locks active at deploy won't get reconfirm/check-in.
   - What's unclear: whether in-flight dates need coverage.
   - Recommendation: forward-only for MVP (consistent with rating_window behavior). Flag if product wants a backfill enqueue.

3. **rated ∩ no_show overlap rule.**
   - What we know: a lock could in theory have both a `showed_up` rating and `status='no_show'`.
   - Recommendation: no_show is authoritative (counts as missed), do not also credit a showed_up rating for the same lock. Encode the dedup in the formula's lock-level grouping. Plan confirms.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Local Supabase stack | SQL migration + RLS/RPC tests | assumed ✓ (project uses `supabase db reset`) | PG17 | none — required for gated-apply |
| Vitest | formula/component tests | ✓ | 2.1.8 | none |
| Playwright | nav-edge E2E | ✓ | 1.49.0 | manual visual-verify |
| Supabase advisor | post-DDL security check | ✓ (MCP `get_advisors` / `supabase db lint`) | — | none |

**Missing dependencies with no fallback:** none identified — all tooling is in-stack. (Local Supabase must be running to apply/test migrations; this is the standard project workflow.)

## Sources

### Primary (HIGH confidence — verified this session)
- `supabase/migrations/20260604121000_e5_loop_completion.sql:118-168` — `flag_no_show` sets `locks.status='no_show'` ONLY, no match_ratings write
- `supabase/migrations/20260527127200_p5_job_rpcs_backfill.sql:79-94` — `close_rating_window` stale-tolerant/idempotent template + revoke
- `supabase/migrations/20260527127800_p5_match_cohort_allowlist.sql:252,353-354,438,525-526` — LIVE `match_accept_offer`/`match_resolve_reciprocal` + rating_window enqueue sites (the producer targets)
- `supabase/migrations/20260601100100_p7_chat_rls_party_read.sql:10-28` — `chat_thread_party` helper + EXISTING `chat_threads_party_read`/`messages_party_read`
- `supabase/migrations/20260525124500_p2_chat_core.sql:10-23` — `chat_threads` schema (offer_id, lock_id, state)
- `supabase/migrations/20260525120800_p0_match_ratings.sql:1-39` — match_ratings columns + rater-participation insert policy
- `supabase/migrations/20260525123600_p2_dispatch_notification.sql:67-72` — city-tz quiet-hours resolution pattern (reuse for morning-of)
- `supabase/functions/process-jobs/handlers.ts:26-67` — HANDLERS table + `callRpc` throw-on-error
- `apps/web/app/messages/[threadId]/page.tsx:38-49` — chat loader select (lacks `lock_id`)
- `apps/web/app/matches/[lockId]/LockDetail.tsx:103,116-120` — existing Night→Profile + Night→Chat edges

### Secondary (CITED — from CONTEXT canonical_refs, prior verified scan)
- `20260525120100_p0_profiles_dating.sql:35` (reliability_score column), `20260525122700_p1_badge_view.sql` (view), `packages/business/src/eligibility.ts:14` (badgeFor), enum locations (jobs/notifications)

## Metadata

**Confidence breakdown:**
- Standard stack / asset inventory: HIGH — every primitive opened and line-cited this session
- Architecture (formula, producers, handlers): HIGH — patterns mirror verified existing RPCs; exact enqueue sites confirmed by grep
- Pitfalls: HIGH — Pitfall 1 (superseded migration) and Pitfall 5 (RLS already exists) caught by direct file reads, not assumed
- Reliability weights + date→city tz join: MEDIUM — discretion/unverified join (A5/A6), flagged for executor confirmation

**Research date:** 2026-06-04
**Valid until:** 2026-07-04 (stable; codebase-internal, low external-dependency churn)
