# 5b Task 10 Step 1 — Backend Smoke-Test on Prod

**Date:** 2026-05-28
**Owner:** master-roadmap Task 10 Step 1
**Status:** Spec — ready for plan
**Predecessor:** `docs/superpowers/plans/2026-05-27-5b-master-roadmap.md` Task 10
**Successor:** implementation plan via `superpowers:writing-plans` → execution

---

## 1. Goal

Smoke-test the 5b match chain on production *once* with two synthesized identities. Confirm — at a low blast radius — that the backend wiring deployed during Tasks 2–4 actually works end-to-end on the live stack: edge functions deployed, JWTs accepted, RPCs called, RLS gates honored, side effects (notifications, jobs, analytics, locks, reveal) materialized.

**Not goals:** racing the match chain (Task 9 / H); testing onboarding flow (Twilio-dependent, separate); shipping anything to real users; staging a reciprocal collision.

## 2. Strategy decisions (made in brainstorm; locked here)

| Decision | Choice | Rationale |
|---|---|---|
| Per-user override mechanism? | **No.** Flip global `feature_config.match_v2_enabled` from `false` → `true` → smoke → `false`. | Match graph is empty on prod (0 swipes / offers / locks). YAGNI on override infra until Task 10 Step 2 (tester cohort) actually needs it. |
| Smoke scope | **Happy path only.** | Negatives + races covered by Task 9 (H). The point of this smoke is "does the live stack work at all," which one traversal answers. |
| Harness | **Curl edge functions with real JWTs.** Two authed sessions from real PKCE signups. | Exercises the real production path (JWT verify → edge function code → errcode mapper → RPC → RLS). Service-role SQL skips half the stack. |
| Account setup | **Real signup + service-role SQL fixup.** | Twilio verification is currently broken; real phone OTP not testable. Service-role SQL flips the residual fields (verification, dating_enabled, onboarding_step, photos) to satisfy match-chain preconditions. |
| Date seeding | **Service-role SQL** (one `date_instance` row anchored to an existing place). | Outside the match chain — testing `/nights/new` UI is a 5a concern, not 5b. |
| Swipe leg | **5a feed UI** (deployed). | Real `record_swipe` path is already shipped and worth exercising via UI rather than RPC shortcut. |
| Reveal verification | **Read `profiles_select_revealed` view with each JWT.** | The actual RLS surface for the post-reveal photo read. Reading `profiles` directly may hit a different policy and false-pass. |
| Reveal timing | **Immediately after accept.** | Per `match_reveal_allowed` migration body — predicate is lock-state-based, not date-time-based. Reveal fires the instant `match_accept_offer` writes the `locks` row. Seeded date can be 5 days out. |
| Rating leg | **Direct `INSERT` into `match_ratings` via PostgREST** with each JWT. | No `match_rate` RPC exists — rating is gated by the `match_ratings_rater_insert` RLS policy directly. |
| Twilio | **Not required for this smoke.** SQL fixup sets `verification='phone_verified'` directly. | Real phone verification is a Task 10 Step 2 pre-requisite. Twilio remains broken at the After5 account level as of this draft; out of scope here. |

## 3. State of prod at draft time

| Field | Value |
|---|---|
| Profiles total | 26 |
| Profiles `dating_enabled=true` | 0 |
| Profiles onboarded | 0 |
| Profiles verified | 0 |
| `date_instances` rows | 0 |
| `swipes` / `queue_entries` / `offers` / `locks` rows | 0 / 0 / 0 / 0 |
| `feature_config.match_v2_enabled` | `false` |
| `feature_config.offer_window_hours` | `24` |
| Edge functions deployed | 16 (incl. all 8 `match-*` + 4 S3) |
| Edge Function secrets | PERSONA_API_KEY, PERSONA_TEMPLATE_ID, PERSONA_WEBHOOK_SECRET, RESEND_API_KEY, RESEND_FROM_ADDRESS |
| pg_cron | not enabled — `jobs` rows enqueue but no worker processes them on prod |

## 4. Architecture (one-paragraph)

Two synthesized users (Host, Candidate) onboard for real via Supabase Auth PKCE (JWTs captured from each browser's localStorage). Service-role SQL flips the residual onboarding fields to satisfy match-chain preconditions and uploads stub photos to the `profile-photos` bucket. Service-role SQL seeds one `date_instance` owned by Host. Service-role SQL flips `match_v2_enabled=true`. Candidate swipes interested through the deployed 5a feed UI. Host curls `match-shortlist` → `match-make-offer` against the prod edge functions with the host JWT. Candidate curls `match-accept-offer` with the candidate JWT. Both call PostgREST to read `profiles_select_revealed` and insert a `match_ratings` row. Service-role SQL flips `match_v2_enabled=false`. A final verification SQL block asserts every expected side effect (queue entry, offer, lock + participants, reveal visibility for both, ratings, notifications, jobs, analytics) is present and that no `admin_alerts` fired. Cleanup deletes all smoke-scoped rows, leaving prod at the same baseline as before. The whole pass is one runbook folder with seven small files; the executor runs each step through the Supabase MCP `execute_sql` tool (for SQL) or `curl` (for edge functions) so every statement is read before it runs.

## 5. The match chain

Six chain steps + two flag-flips + a discovery probe. JWTs are extracted post-signup; flag flips run as service_role.

| # | Actor | Call | Body | Captures |
|---|---|---|---|---|
| 0 | service_role | `UPDATE feature_config SET value='true', updated_at=now() WHERE key='match_v2_enabled'` | — | flag flipped |
| 1 | Candidate | **5a feed UI** → tap "interested" on Host's seeded date | (UI-driven) | `queue_entries` row visible via SQL probe |
| 2 | Host | `GET /rest/v1/queue_entries?date_instance_id=eq.<inst>&status=eq.interested&select=*` w/ host JWT | — | RLS-as-host returns the candidate row (discovery probe) |
| 3 | Host | `POST /functions/v1/match-shortlist` w/ host JWT | `{ instance, candidate, rank: 1 }` | `ok: true` |
| 4 | Host | `POST /functions/v1/match-make-offer` w/ host JWT | `{ instance, candidate }` | `offer_id` |
| 5 | Candidate | `POST /functions/v1/match-accept-offer` w/ cand JWT | `{ offer: offer_id }` | `lock_id` |
| 6 | Both | `GET /rest/v1/profiles_select_revealed?id=eq.<other_uid>&select=id,clear_photo_url,first_name` w/ each JWT | — | each side reads opposite's `clear_photo_url`, `first_name` |
| 7 | Both | `POST /rest/v1/match_ratings` w/ each JWT | (column shape verified at execution time — see §10) | rating row id per direction |
| 8 | service_role | `UPDATE feature_config SET value='false', updated_at=now() WHERE key='match_v2_enabled'` | — | flag back off |
| 9 | service_role | `POST /functions/v1/match-shortlist` w/ host JWT | `{ instance, candidate, rank: 1 }` | expects `{ ok: false, code: 'feature_disabled' }` (P5000) — confirms flag enforcement |

**Halt conditions (stop, dump diff, DO NOT flip flag back to false; leave it on so debugging queries can simulate retry — there are no real users to harm):**

- Any edge function returns `ok: false` with an unexpected code (other than the expected P5000 in step 9).
- Any `admin_alerts` row created at any point during the run.
- `lock_participants` row count ≠ 2 after step 5.
- `profiles_select_revealed` returns 0 rows for either side after step 5.

## 6. Final-state verification

Run as service_role after step 8. Returns one row; executor pastes the result into the runbook log.

```sql
with expected_notifications(t) as (values
    ('offer_received'::notification_type),
    ('new_match'::notification_type)),
expected_events(e) as (values
    'match_shortlisted'::text,                          -- emitted by match_shortlist (verify event_type at execution; see §10)
    'match_offer_made'::text,
    'match_lock_created'::text)
select
  (select count(*) from public.queue_entries
    where date_instance_id = :inst)                                                              as queue_entries_count,
  (select status::text from public.queue_entries
    where date_instance_id = :inst limit 1)                                                      as queue_status,
  (select rank from public.queue_entries
    where date_instance_id = :inst limit 1)                                                      as queue_rank,
  (select count(*) from public.offers
    where date_instance_id = :inst)                                                              as offers_count,
  (select status::text from public.offers
    where date_instance_id = :inst limit 1)                                                      as offer_status,
  (select count(*) from public.locks
    where date_instance_id = :inst)                                                              as locks_count,
  (select count(*) from public.lock_participants lp
    join public.locks l on l.id = lp.lock_id
    where l.date_instance_id = :inst)                                                            as lock_participants_count,
  (select count(*) from public.match_ratings mr
    join public.locks l on l.id = mr.lock_id
    where l.date_instance_id = :inst)                                                            as ratings_count,
  (select count(*) from public.profiles_select_revealed
    where id in (:host_uid, :cand_uid))                                                          as reveal_visible_count,
  (select array_agg(distinct type) from public.notifications
    where user_id in (:host_uid, :cand_uid)
      and created_at > :smoke_started_at)                                                        as notification_types,
  (select array_agg(distinct event_type) from public.analytics_events
    where actor_id in (:host_uid, :cand_uid)
      and created_at > :smoke_started_at)                                                        as analytics_event_types,
  (select count(*) from public.jobs
    where created_at > :smoke_started_at
      and (payload->>'instance' = :inst::text
        or payload->>'lock_id' in (select id::text from public.locks where date_instance_id = :inst)))
                                                                                                 as jobs_enqueued,
  (select count(*) from public.admin_alerts
    where created_at > :smoke_started_at)                                                        as admin_alerts_count,
  (select (value)::boolean from public.feature_config
    where key='match_v2_enabled')                                                                as flag_state;
```

### Expected values (PASS criteria)

| Column | Expect |
|---|---|
| `queue_entries_count` | `1` |
| `queue_status` | `'interested'` |
| `queue_rank` | `1` |
| `offers_count` | `1` |
| `offer_status` | `'accepted'` |
| `locks_count` | `1` |
| `lock_participants_count` | `2` |
| `ratings_count` | `2` |
| `reveal_visible_count` | `2` |
| `notification_types` | superset of `{'offer_received','new_match'}` — set theory, not count |
| `analytics_event_types` | superset of `{'match_offer_made','match_lock_created'}` + the shortlist event_type once verified at execution (§10) |
| `jobs_enqueued` | `>= 1` (at minimum a `rating_window` job; B-complete cascades may add more) |
| `admin_alerts_count` | `0` — **HARD FAIL if non-zero** |
| `flag_state` | `false` |

Set-theory checks (`@>` / superset) are deliberate: the chain may legitimately emit *more* notification or analytics types than these, but missing one of the named values is a real bug.

## 7. Cleanup

Run only if §6 PASSES and `flag_state = false`. Order matters: child rows first.

```sql
-- 1. ratings + locks (child rows of locks/date_instance)
delete from public.match_ratings
  where lock_id in (select id from public.locks where date_instance_id = :inst);
delete from public.lock_participants
  where lock_id in (select id from public.locks where date_instance_id = :inst);
delete from public.locks
  where date_instance_id = :inst;

-- 2. offers + queue_entries (child rows of date_instance)
delete from public.offers
  where date_instance_id = :inst;
delete from public.queue_entries
  where date_instance_id = :inst;

-- 3. jobs created during the smoke targeting the smoke instance/lock/offer
delete from public.jobs
  where created_at > :smoke_started_at
    and (
      payload->>'instance' = :inst::text
      or payload->>'lock_id' in (select id::text from public.locks where date_instance_id = :inst)
      or payload->>'offer_id' in (select id::text from public.offers where date_instance_id = :inst)
    );

-- 4. notifications + analytics for the two smoke users, scoped to the smoke window
delete from public.notifications
  where user_id in (:host_uid, :cand_uid)
    and created_at > :smoke_started_at;
delete from public.analytics_events
  where actor_id in (:host_uid, :cand_uid)
    and created_at > :smoke_started_at;

-- 5. the seeded date itself
delete from public.date_instances
  where id = :inst;

-- 6. smoke profile rows + private + verifications
delete from public.verifications
  where user_id in (:host_uid, :cand_uid);
delete from public.profiles_private
  where user_id in (:host_uid, :cand_uid);
delete from public.profiles
  where id in (:host_uid, :cand_uid);

-- 7. auth.users — leave dormant; tagged via the `lucas+smoke-…` email pattern
--    for later sweep. Re-runs of the smoke MUST use a fresh `+suffix-N`
--    (e.g., +smoke-host-2) because Supabase Auth blocks re-signup
--    on an email that already has an auth.users row.
```

**Post-cleanup probe:** re-run the §3 baseline snapshot. Counts must match within ±1 (cleanup may itself emit a single analytics_events row if a trigger logs the deletions — verify or accept).

## 8. Failure modes & manual rollback

| Failure point | What it means | Manual fix |
|---|---|---|
| Edge function returns `ok: false, code: 'feature_disabled'` at step 3+ | Flag flip in step 0 didn't take, or `feature_config` row was rolled back | Re-run step 0 SQL; verify with `select value from feature_config where key='match_v2_enabled'`; re-run from step 3. The match RPCs are idempotent per-actor via the idempotency-ledger (`idem_key` minted by edge function). |
| `match-shortlist` returns `ok: false, code: 'P5xxx'` other than P5000 | Real RPC bug or RLS issue on `queue_entries` | **Halt.** Dump `queue_entries`, `offers`, `analytics_events`, `admin_alerts` since `:smoke_started_at`. Investigate before flipping flag back. |
| `match-accept-offer` succeeds but `lock_participants` count ≠ 2 | B-complete cascade bug or trigger failure | **Halt.** Inspect `locks`, `lock_participants`, `jobs` rows. Likely a code fix, not a manual cleanup. |
| `profiles_select_revealed` returns 0 rows after step 5 | `match_reveal_allowed_pair` or A.7 RLS policy broken on prod | **Halt.** Compare the predicate on prod against the migration body. Likely a missed migration. |
| Any `admin_alerts` row created | Match RPCs surfaced an internal alert | **Halt.** Inspect `admin_alerts` to see what fired. Highest-priority signal. |
| Notifications never appear despite chain succeeding | `dispatch_notification` wiring or the type ENUM extension didn't apply | **Halt.** Verify `notification_type` enum contains `offer_received`, `new_match` (per migration `20260527124550`). |
| Smoke completes but you discover a bug after | The chain ran but produced incorrect state | The cleanup block in §7 is safe to re-run on partial state — deletes are scoped by `:inst` + smoke uids. |

**Halt protocol:** *do not flip `match_v2_enabled` back to false on halt.* Leave it on so debugging queries can simulate retry mid-chain. There are no real users to harm. Flip it back manually only after the bug is understood.

## 9. Runbook layout

One folder with seven small files. All checked into git so the smoke is reproducible. Each `.sql` file is reference text — the executor pastes the resolved SQL into the Supabase MCP `execute_sql` tool to keep the "read before run" pattern.

```
scripts/5b-smoke-prod/
├── README.md              — overview, env-var contract, JWT extraction, expected values
├── 0-baseline.sql         — pre-smoke row-count snapshot
├── 1-seed-profiles.sql    — birthdate + verification + dating_enabled + onboarding fixup + photo upload
├── 2-seed-date.sql        — date_instance row anchored to an existing place_id
├── 3-flag-on.sql          — UPDATE feature_config match_v2_enabled=true
├── 4-chain.sh             — curl sequence with HOST_JWT / CAND_JWT / HOST_UID / CAND_UID / INST_ID env vars
├── 5-verify.sql           — final-state verification query (§6)
├── 6-flag-off.sql         — UPDATE feature_config match_v2_enabled=false
└── 7-cleanup.sql          — the cleanup block (§7)
```

### Env-var contract (README.md)

```bash
export SUPABASE_PROJECT_REF=ufufmcpnysvwtutpbian
export SUPABASE_URL=https://${SUPABASE_PROJECT_REF}.supabase.co
export SUPABASE_PUBLISHABLE_KEY=sb_publishable_obo6g7Epe5ciN99pzwvWVQ_Os479GOp

# Smoke identities — must be fresh-suffix on each smoke (auth.users left dormant)
export HOST_EMAIL=lucas+smoke-host-1@breathefum.com
export CAND_EMAIL=lucas+smoke-cand-1@breathefum.com

# Captured after step 1 (real signup completes):
export HOST_UID=...
export CAND_UID=...
export HOST_JWT=...
export CAND_JWT=...

# Captured from step 2 (seed date INSERT … RETURNING id):
export INST_ID=...

# Captured at the very top of step 0 (just before flag flip):
export SMOKE_STARTED_AT=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
```

### JWT extraction protocol (in README.md, exact)

After Host signs up via the deployed `/login` page and lands on `/feed`, open browser DevTools → Console:

```js
JSON.parse(
  localStorage.getItem('sb-ufufmcpnysvwtutpbian-auth-token')
).access_token
```

Copy the resulting string into `HOST_JWT`. Repeat in a separate browser profile (or incognito) for Candidate → `CAND_JWT`. JWTs expire after 1h by default — complete chain within that window or re-extract.

### Twilio call-out (README.md)

> **Twilio is not required for this smoke.** Step 1 sets `verification='phone_verified'` via service-role SQL. The real phone-OTP flow is a Task 10 Step 2 (tester cohort) pre-requisite and is currently blocked by the After5 Twilio account's verification process. Do not attempt to drive onboarding step 5 (phone verification) as part of this smoke.

## 10. Things to verify at execution time (not baked into the spec)

These are values I confirmed exist but did not pin a literal for in the spec, to avoid invented strings. The executor verifies and quotes verbatim while implementing:

- **`match_ratings` insert body shape.** Read `supabase/migrations/20260525120800_p0_match_ratings.sql` and the RLS policy `match_ratings_rater_insert` to enumerate required columns + acceptable score range.
- **`match_shortlist` analytics `event_type` string.** Migration `20260527126200_p5_shortlist.sql` line 89 has the insert; verify the literal (`match_shortlisted` per inference, but confirm before pinning the §6 expected set).
- **Stub photo upload path.** Storage bucket `profile-photos` exists per `20260525122600_p1_profile_photos_bucket.sql`. Convention is `<uid>/blurred.jpg` for blur output. For the smoke seed: service-role uploads a 1×1 PNG to `<uid>/clear.jpg` and `<uid>/blurred.jpg` for each smoke user; sets `profiles.{clear_photo_url, blurred_photo_url}` to the resulting public URL. Confirm the bucket's RLS allows service-role unauthenticated `INSERT` (it should — service-role bypasses RLS by default).
- **City row for `primary_city_id`.** `qa-feed-seed.sql` references the Kelowna city UUID `cde497ea-c50e-481c-8b56-4bc98a61388c` (local). Verify the same UUID exists on prod (or pick whatever Kelowna row is on prod) before seeding.
- **B-complete cascade jobs after accept.** §6's `jobs_enqueued` count is `>= 1` (rating_window guaranteed). Confirm at execution which additional cascades fire on the *first* accept (B-complete code emits `standby_roll` only when there are competing candidates; the smoke has only one) and adjust expectations if zero cascades fire.

## 11. Out of scope, explicitly

- **Idempotency replay** — re-sending the same RPC with the same `idem_key`. Task 9 (H).
- **Reciprocal collision** — needs two hosts simultaneously offering each other. Task 9 (H).
- **Concurrent accept race** — needs `p5_concurrency_lib.sh`. Task 9 (H).
- **Resend email/push transport** — `dispatch_notification` writes rows into `notifications`. Without `pg_cron` enabled on prod, no `process-jobs` worker fires. Smoke verifies the *enqueue*, not the *delivery*. Real delivery is a Task 10 Step 2 pre-requisite.
- **Real phone verification** — Twilio side-quest, separate. SQL fixup substitutes here.
- **Real photo upload via UI** — service-role stub upload substitutes. Photo upload UI is exercised by the 5a smoke separately.
- **5a `/nights/new` host UI** — date_instance is SQL-seeded. The 5a host UI has its own coverage.
- **Negative match paths** (pass, withdraw, expire). Task 9 (H).

## 12. Acceptance criteria

This smoke is considered successful when, in one continuous session:

1. The 7 runbook files exist under `scripts/5b-smoke-prod/` and are committed to git.
2. The chain in §5 runs end-to-end without any halt condition firing.
3. The §6 verification query returns all "Expect" values with no `admin_alerts`.
4. The §7 cleanup leaves prod with the same row counts as §3.
5. `feature_config.match_v2_enabled` ends at `false`.
6. The runbook log (markdown commentary alongside the SQL/curl) is committed alongside the scripts, documenting actual observed values and any divergences from the spec.

When (1)–(6) all hold, Task 10 Step 1 is complete and the master roadmap can advance to Task 10 Step 2 (tester cohort) — gated separately by the Twilio side-quest landing.

## 13. Self-review notes

**Placeholder scan:** §10 lists four values verified-to-exist but not literal-pinned, called out explicitly so the executor doesn't silently invent them. No `TBD` / `implement later` / vague-error-handling phrasing elsewhere.

**Internal consistency:** §2's "reveal verification reads `profiles_select_revealed`" matches §5 step 6, §6's `reveal_visible_count`, and §8's reveal-failure row. §2's "Twilio not required" matches §9's README call-out and §11's out-of-scope item.

**Scope check:** single sub-project (one smoke run, one runbook folder, six acceptance criteria). Not decomposable.

**Ambiguity check:** §5's "halt condition" + §8's failure-modes table are explicit about what to do on partial failure (do not flip flag back). The set-theory expectations in §6 are explicit about superset semantics. The "5a feed UI for swipe" choice is explicit in §2 — no ambiguity vs. RPC shortcut.
