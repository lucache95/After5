# P2 — Scheduler + Notifications — Pre-Build Audit

**Verdict up front:** This plan is internally clean and well-tested *in isolation*, but it is the load-bearing backbone for five other phases (P5, P6, P7, P9, and indirectly P11) and it **defines a `jobs`/notify/enqueue contract that matches none of its consumers.** Executed as written, P2 ships a runner that the matching state machine (P5), chat purge (P6), safety escalation (P7), and account teardown (P9) all call with the *wrong* function names, wrong argument shapes, and a job-type enum that rejects most of the kinds they enqueue. The "P5 hook" stubs P2 invents (`p5_promote_standby`, `p5_reap_pending`) **do not exist anywhere in P5** — P5 exposes `match_expire_offer` / `match_auto_roll` / `match_next_standby`. This is not a polish gap; it is a dead seam that makes the whole async loop inert the moment two phases are merged.

---

## CRITICAL MISSING SYSTEMS

1. **The P5 seam is fictional. P2 calls functions P5 never defines, and ignores the functions P5 does define.**
   - P2 Task 9/10 invent `p5_promote_standby(p_date_instance_id)` and `p5_reap_pending(p_queue_entry_id)` as no-op stubs and assert "P5 replaces the bodies."
   - **P5 defines no such functions.** P5's real surface (verified in `2026-05-25-p5-matching-state-machine.md`): `match_make_offer`, `match_accept_offer`, `match_pass_offer`, `match_expire_offer(p_offer_id)`, `match_auto_roll(instance)`, `match_next_standby(instance)`, `match_cancel_lock`, `match_reconfirm`, `match_resolve_reciprocal`.
   - P5 explicitly states (line 28): *"The `run_offer_expiry(p_offer_id)` worker P2 runs when an `offer_expiry` job fires **calls our `expire_offer(...)`**."* P5 expects P2's `offer_expiry` handler to call `match_expire_offer(offer_id)` — a single function that, under the instance advisory lock, marks the offer expired, transitions the queue entry, moves the candidate to standby, **and calls `match_auto_roll` inline.** There is **no separate "standby_roll" step** in P5's design, and there is no "reap pending" RPC at all (pending expiry is handled by `match_resolve_offer_negative` / queue status transitions).
   - When P5 lands, it will *not* fill in `p5_promote_standby`/`p5_reap_pending` (they aren't in its plan), so P2's `standby_roll` and `pending_expiry` handlers stay no-ops forever. Standby auto-roll — the literal reason this phase exists ("without this layer the mechanic is inert") — never fires. **The phase fails its own stated goal.**

2. **Three+ mutually incompatible `jobs` tables, all claiming to be canonical, at colliding migration timestamps.**
   - **P2** (`20260525130000_p2_jobs.sql`): `jobs(job_type job_type[enum, 6 values], run_after, dedup_key, attempts, max_attempts, locked_at, ...)`, `job_status` enum = `pending|running|done|failed|cancelled`.
   - **P5** (`20260525130000_p5_p2_shim.sql` — **identical timestamp**): `jobs(kind text, run_at, payload, dedupe_key, status text check(...))`. No enum.
   - **P9** (`20260525130100_p9_jobs_notifications_shim.sql`): `jobs(kind text, payload, status job_status[enum = queued|running|done|failed], run_after)`. **A `job_status` enum with different values than P2's.**
   - **P7** (Task 12): minimal `jobs` insert + stub `enqueue_job()` keyed on `kind`.
   - These are not reconcilable by `create ... if not exists`: whichever lands first wins the table shape, and the others silently no-op — leaving the column names (`run_at` vs `run_after`, `dedupe_key` vs `dedup_key`, `kind` vs `job_type`) and the `job_status` enum values mismatched. `create type job_status as enum (...)` in P2 is **not** guarded (`if not exists`) and will **hard-fail with "type already exists"** if P9's shim (different values) merged first — and vice-versa. The migration order is undefined because timestamps collide.

3. **`enqueue` vs `enqueue_job`, `notify` vs `dispatch_notification` — every consumer calls the wrong name with the wrong signature.**
   - P5 calls `enqueue('offer_expiry', exp, jsonb, 'dedupe_key')` (positional, text kind) and `cancel_jobs('offer_expiry', dedupe_key)`. P2 ships `enqueue_job(p_job_type job_type, p_run_after, ...named...)` and **no `cancel_jobs` at all.** P5's offer-resolve path does `cancel_jobs('offer_expiry', ...)` so a resolved offer's timer no-ops — **P2 never provides `cancel_jobs`, so accepted offers will still fire `offer_expiry` and P2's handler will blindly `update offers set status='expired' where status='active'`** (harmless only because P5 already flipped it off `active`, but the wasted notification still logs).
   - P5/P6/P7/P9 all call `notify(user_id, kind, payload)` (3 args, free-text kind). P2 ships `dispatch_notification(user_id, type[enum], title, body, data, dedup_key)`. **No `notify()` wrapper exists in P2.** Worse, P5's kinds — `offer_received`, `locked`, `offer_passed`, `candidate_withdrawn`, `reciprocal_detected`, `lock_cancelled_frozen`, `reconfirm_requested` — mostly are **not** in P2's `notification_type` enum (`locked` ≠ `lock_confirmed`; the last four have no enum value). P2's enum will reject them and every such `notify()` will throw.

4. **No `cancel_jobs` / job-cancellation primitive.** P5 depends on cancelling a pending `offer_expiry` when an offer resolves early. P6's chat-purge and P9's teardown will want the same. P2 has `complete_job`, `fail_job`, `requeue_stuck_jobs` but no cancel. Stale timers will fire and emit spurious notifications.

5. **No dispatch path for job kinds that invoke Edge Functions (P7's `safety-escalation`).** P7 §D6 states the **P2 runner re-polls and invokes the `safety-escalation` Edge Function** on a missed check-in. P2's runner only dispatches the 6 frozen handlers in `HANDLERS`; it has no mechanism to call an external Edge Function per job, no `rating_window_close` / `safety_checkin` / `purge_expired_chat` / `process_deletion_request` job types, and a **frozen** `job_type` enum that cannot represent them. P7/P6/P9's jobs are un-runnable on P2's runner.

6. **Quiet-hours is claimed but not implemented.** `notification_preferences` stores `quiet_hours_start/end`, the migration comment and Task 7 design say "quiet hours never defer safety," and the Self-Review claims a "quiet-hours gate." **The `dispatch_notification` RPC body contains no quiet-hours logic at all** — it checks consent + rate-limit, then picks a channel. Quiet hours are dead config. (And the harder problem — quiet hours are "local to the user's city tz" but there is no per-user timezone column read anywhere, and `time` comparison against `now()` would be in UTC.)

---

## DEAD UI / FAKE INTERACTIONS

P2 is backend-only, so "UI" findings are about user-facing surfaces the plan *implies exist* but provides no path for:

1. **Device-token registration has no enqueue/registration endpoint.** `devices` table + owner-RLS exist, but **nothing in P2 (or any sibling plan checked) writes a device row.** Mobile/web must POST its Expo token / Web Push subscription somewhere. There is no RPC, no Edge Function, no Next route. Until that ships, `devices` is always empty → `dispatch_notification` always falls through to `email` → which is `email_not_wired` → **every push silently logs as `delivered=false`.** The "load-bearing native push" path is non-functional on day one.

2. **In-app notification center is implied, not built.** `notifications` has recipient-read RLS + a `read_at` column + "backing store for an in-app notification center," but there is no list RPC, no `mark_read` RPC (only the raw UPDATE policy), and no pagination contract. P11/P5 UI will need it.

3. **Notification-preferences screen has no write contract.** Owner RLS lets a user UPDATE their own prefs row directly, but there's no validated RPC and no documented client surface; quiet-hours timezone semantics are undefined (see above), so any settings UI built on this will mislead users (toggles that "work" but quiet hours that don't).

---

## MISSING EDGE CASES

1. **Email fallback is a silent black hole.** `defaultSendEmail` returns `ok:false, 'email_not_wired'`. For `offer_received` and `day_of_reconfirm` (high-stakes, the plan itself names email the fallback "for high-stakes notifications when no push token exists"), a tokenless user gets **nothing** — the notification logs `delivered=false` and no one is told. The plan calls this "non-blocking for the mechanic," but day-of reconfirm and the offer window are exactly the mechanic. A locked user with no push token is never reminded → no-show.

2. **Expired / unregistered push tokens are never reaped.** Expo returns `DeviceNotRegistered` / `MessageRejected` receipts; APNs/FCM invalidate tokens. P2 fires one POST and treats `res.ok` as success — **it never reads the Expo ticket/receipt body**, so a 200 with a per-message error counts as delivered. Dead tokens accumulate, `is_active` is never flipped, and `dispatch_notification` keeps "succeeding" into the void. (Expo's API returns 200 with `data[].status='error'`; `res.ok` is the wrong success check.)

3. **Multi-device fan-out is broken.** `dispatch_notification` picks **one** channel (`push_ios` OR `push_android` OR `web_push`), but returns ALL active tokens. The Edge Function sends to every token of any platform via `sendExpo` regardless of the chosen channel string. A user with an iOS phone + a web subscription gets the web sub passed to Expo (which will reject it) or the native token dropped — channel selection and token list are inconsistent. Also: a single `channel` enum on the `notifications` row cannot represent "delivered to 2 of 3 devices."

4. **Offer-expiry double-write race with P5.** P2's `offerExpiry` handler does `update offers set status='expired'` **without** P5's instance advisory lock. If the timer fires at the same instant a user accepts, P2 races `match_accept_offer`. P5's design assumes the *only* writer of offer-expiry is `match_expire_offer` (lock-guarded). P2 bypassing it defeats the entire race-safety story P5 built, and skips the `audit_log` transition + queue-entry update + auto-roll.

5. **No poison-job / max-attempts alerting.** A job that hits `max_attempts` is set `status='failed'` and **sits silently forever.** No dead-letter notification, no metric, no T&S/ops alert. A failed `safety_check_in` (a safety-critical job!) dies quietly. There is no monitoring of the `failed` queue depth.

6. **`requeue_stuck_jobs` increments `attempts` on every crash-recovery, exhausting `max_attempts` for jobs that never actually ran.** `claim_due_jobs` does `attempts = attempts + 1` on claim. If the runner crashes after claim but before complete, `requeue_stuck_jobs` returns it to pending; the next claim increments again. A flapping runner burns all 5 attempts on a job that never executed its handler once, then dead-letters it. Attempts should count handler *executions*, not claims.

7. **Clock-hour rate-limit window is gameable / bursty at boundaries.** `rate_limit_check` uses `date_trunc('hour', now())` fixed windows. `new_interest` cap = 10/hr means a user can get 10 at 10:59 and 10 more at 11:00 — 20 in two minutes. For a storm guard this is weak; a sliding window or token bucket is the usual fix.

8. **Safety types bypass rate-limit AND consent, but there is no upper bound at all.** A bug or abuse vector that enqueues many `safety_check_in` jobs for one user (e.g., a loop in P5/P7 re-enqueuing) will push **unbounded** notifications — by design "safety is never throttled." There's no circuit breaker. Combined with no dedup on re-enqueue across job *attempts*, a retry storm of safety pushes is possible.

9. **Standby-roll dedup key uses `Date.now()` → never dedups.** P2's `offerExpiry` enqueues `standby_roll` with `dedup_key = 'standby_roll:${instanceId}:${Date.now()}'`. Because `Date.now()` changes every call, **the dedup key is unique every time** — two offer expiries on the same instance (or a retried handler) enqueue duplicate standby_roll jobs. The dedup index is defeated by the key design.

10. **`pending_expiry` 30-day timer is never enqueued by anyone.** P2 defines the handler and says "the 30-day `run_after` is set by P5 when it enqueues." But P5's plan (verified) does **not** enqueue a `pending_expiry` job anywhere — it has no such call. So pending entries never expire. The ~30-day cap (spec §7.3) is unimplemented across both phases. Same risk for `day_of_reconfirm` and `safety_check_in`: P2 asserts P5 enqueues them at lock time, but P5's `match_accept_offer`/lock path only calls `notify('locked', ...)` — **no `enqueue('day_of_reconfirm')` or `enqueue('safety_check_in')` is present in P5.** All three of these timers are orphaned: handler exists, enqueuer does not.

11. **DST / timezone correctness for `day_of_reconfirm` "morning-of" and check-in offsets is undefined.** "morning-of (`starts_at` − configurable lead)" and "+30 min" are computed in UTC with no city tz; "morning" in Kelowna is meaningless in UTC. Roadmap explicitly flags timezone/DST as a P11 + P0 concern but the timer math lives here.

---

## STATE & DATA FLOW PROBLEMS

1. **State ownership of "offer expired" is split between P2 and P5 with no contract.** P5 says it owns transition logic; P2's handler writes the same state directly. Two writers, no coordination, no shared lock. Pick one: P2's handler must call `match_expire_offer` and do nothing else.

2. **`notifications.channel` is a single enum on a per-event row, but delivery is per-device.** Cannot model partial delivery or multi-device. `delivered boolean` is similarly lossy.

3. **`dispatch_notification` dedup is global on `(type, dedup_key)` with no recipient.** For `safety_check_in:<lock_id>:<uid>` the uid is in the key so it's fine, but the unique index is `(type, dedup_key)` — if any two callers ever reuse a dedup_key shape without the uid, cross-user suppression occurs. Fragile by convention, not by schema.

4. **`jobs` has nullable FK targets (offer/lock/instance/queue) with `on delete cascade`.** If the underlying entity is deleted (P9 teardown, P5 cancellation), the pending job **vanishes** mid-flight — including a pending `safety_check_in` whose lock was cancelled. Probably desired for some, dangerous for safety jobs (a cancelled-then-uncancelled flow, or audit needs). No documented policy.

5. **No `tz` source for quiet hours.** `profiles` has `city text` (freeform) and P0 adds `primary_city_id`; `cities` has `timezone`. Nothing joins them in `dispatch_notification`. Quiet hours can't be evaluated correctly even if implemented.

6. **`notification_preferences` auto-create trigger fires `after insert on profiles`, but P0/P2 tests insert bare `profiles` rows that violate the `auth.users` FK** (see Backend gaps #2). When that's fixed, the trigger is fine — but the trigger is `security definer` inserting into a table the new user can later read; ensure the default row is created before any dispatch (race on first-ever notification for a brand-new user is avoided by the "missing prefs → permissive defaults" path, which is good).

---

## BACKEND / API GAPS

1. **`cancel_jobs(kind, dedupe_key)` — required by P5, absent in P2.** Add it (and reconcile the arg names).

2. **Test fixtures will fail the `auth.users` FK.** `profiles.id REFERENCES auth.users(id)` (confirmed in `20260522100000_capture_full_schema.sql`). P2's Task 7 (`insert into profiles (id, first_name) values (gen_random_uuid(),'u')`) and Task 13 e2e (`insert into profiles ... gen_random_uuid()`) **insert profiles with no matching `auth.users` row → FK violation → tests fail at "Step 4 expect PASS."** P5's fixtures correctly seed `auth.users` first; P2's do not. Either seed `auth.users` or the tests are dead on arrival. (Note: P0's own tests have the same pattern — verify P0's `db reset` actually passes before trusting this convention.)

3. **`notify()` wrapper missing.** Every other phase calls `notify(uid, kind, payload)`. P2 must ship a `notify()` shim that maps `kind`→`notification_type` + title/body and delegates to `dispatch_notification`, OR every sibling plan must be rewritten. The former is one function; the latter is five plans. P2 should own the `notify()` adapter and the full `notification_type` enum must be expanded to cover P5/P6/P7/P9 kinds (`offer_passed`, `candidate_withdrawn`, `reciprocal_detected`, `lock_cancelled_frozen`, `reconfirm_requested`, `lock_cancelled`, `rating_window_close` notices, `process_deletion_request` notices, new-message, etc.).

4. **`job_type` enum is frozen at 6 values but consumers need ≥ a dozen** (`rating_window_close`, `safety_checkin`/escalation re-poll, `purge_expired_chat`, `process_deletion_request`, `notify:*` if jobs model notifications as P5's shim does). Either make `kind` free-text (as P5/P7/P9 assume) or the enum blocks every other phase. **The free-text `kind` design the consumers chose is the right one; P2's enum is the outlier and should change.**

5. **No idempotency/`Idempotency-Key` story for the runner re-invoking handlers.** Handlers guard with status predicates (good for offer/instance) but `dispatchNotification` relies on `(type, dedup_key)` and `enqueue_job` on `(job_type, dedup_key)` — fine, but the `standby_roll` `Date.now()` key (above) breaks it.

6. **Expo receipt-checking flow absent.** Expo requires a **second** call to `/getReceipts` minutes later to learn true delivery + token invalidation. P2 does fire-and-forget only. No job type, no follow-up. Token hygiene is impossible without it.

7. **`config.toml` registration is correct** (mirrors `[functions.generate-plan] verify_jwt=false`) and the cron-route auth pattern correctly mirrors the existing `post-date-feedback` route — these two seams are *good*. **`rate_limit_check(text,text,int)` signature is verified to match** the existing `20260522110000_rate_limits.sql`. Credit where due.

8. **`requeue_stuck_jobs` grace = 5 min, but Edge wall-clock is 150s and `maxDuration=60` on the route.** A claim that takes >5 min to recover is impossible (the function can't run that long), so the grace is fine — but a job that legitimately runs ~60s near the route timeout could be killed mid-handler and re-run; handlers must be idempotent (mostly are, except the offer double-write).

---

## UX CONTRADICTIONS

1. **"Native push is load-bearing" vs "no token-registration path."** The plan's whole thesis (spec §10: push is load-bearing, web too weak) is undermined by shipping zero way to register a token. On launch, every user is effectively on the dead email fallback.

2. **"Safety notifications never suppressed/throttled" vs "channel can resolve to `suppressed` when no device and email not wired."** A tokenless user's `safety_check_in` resolves to `email` channel → `email_not_wired` → `delivered=false`. The safety guarantee ("a check-in must always go out") is **false** for anyone without a registered push token, which is everyone at launch. The strongest safety claim in the plan is the one most likely to be silently broken.

3. **Quiet hours marketed to users, silently inert.** A settings screen will show quiet-hours controls (the columns exist) that do nothing — a trust-eroding contradiction.

4. **`day_of_reconfirm`/`safety_check_in` notify "both parties" by reading `locks.creator_id, matched_user_id`** — correct columns (verified in P0). But the body copy ("Tap to reconfirm" / "Tap to confirm you're safe") implies an action/deep-link, while P2 ships no action target and P7's `safety_checkins` escalation state machine isn't invoked by P2's runner. The push says "tap to confirm safe" and nothing happens.

---

## WHAT ENGINEERS WILL REGRET LATER

1. **The frozen `job_type` enum.** Every new async behavior (and there are many across P6–P11) requires a migration to ALTER the enum. The consumers already chose free-text `kind`. P2 will be the bottleneck phase everyone files PRs against.

2. **Splitting "decision" (SQL RPC) from "delivery" (Edge `notify.ts`) means two network round-trips per notification and a delivery state that can desync** (RPC inserts the row, Edge crashes before `mark_notification_delivered` → row stuck `delivered=false` even if Expo actually sent). At loop scale (every swipe → `new_interest`, every expiry → notif) this is a lot of chatter and a lot of stuck rows.

3. **Fire-and-forget Expo with no receipt loop** guarantees a slow accumulation of dead tokens and a delivery metric that lies (`delivered=true` for messages Expo rejected). Debugging "why didn't I get my offer push" will be miserable.

4. **Per-minute Vercel-Pro cron as the single trigger.** If billing lapses, the plan is downgraded to Hobby, cron silently stops firing at 1-min cadence, and **every timer in the product stops** — offers never expire, check-ins never fire — with no alert. The documented `pg_cron` fallback is "swap later," but there's no health check that the cron is even running. A "heartbeat" job that alerts if no tick in N minutes is essential and absent.

5. **No observability.** No metric on queue depth, oldest-pending-age, failed-job count, or delivery success rate. The async backbone is invisible until it's broken.

6. **`attempts` counting claims not executions** will dead-letter healthy jobs during any runner instability — and dead-lettered jobs are silent.

---

## REQUIRED ADDITIONAL SCREENS / COMPONENTS

(Backend phase, so these are required *interfaces/endpoints*, not visual screens.)

1. **Device-registration endpoint** — RPC or Edge Function `register_device(platform, token)` (upsert into `devices`, flip stale tokens inactive). **Blocking** — without it, push never works.
2. **`notify(user_id, kind, payload)` adapter RPC** mapping free-text kinds → enum + title/body, so P5/P6/P7/P9 compile against P2. **Blocking.**
3. **`cancel_jobs(kind, dedupe_key)` RPC.** **Blocking** for P5.
4. **Reconciled single `jobs` schema + single `job_status` enum** with `kind text` (not a frozen enum), `run_after`, `dedupe_key` — agreed across P2/P5/P7/P9, at non-colliding timestamps. **Blocking.**
5. **Generic Edge-Function-dispatch job kind** (`invoke_edge_fn` with target in payload) so P7's `safety-escalation` and future per-job functions run on the runner.
6. **Expo receipt-check job** (`push_receipt_check`) + token-invalidation path.
7. **Notification-list + mark-read RPCs** for the in-app center.
8. **Quiet-hours evaluation** wired to `cities.timezone` via `profiles.primary_city_id` — or drop the columns and the claim.
9. **Cron heartbeat / queue-depth alert** (dead-letter + stalled-cron monitoring).
10. **Email fallback actually wired** (or the high-stakes-email claim removed from the plan).

---

## PRODUCTION READINESS SCORE

**3 / 10.**

Rationale: As an *isolated, testable* artifact the runner mechanics (SKIP-LOCKED claim, retry/backoff, stuck-job requeue, RLS posture, cron auth mirroring, rate-limit reuse) are genuinely well-built and the TDD discipline is real — that's worth the 3. But P2 exists to be a **seam**, and its seam is wrong in every dimension that matters: the function names, the argument shapes, the `jobs`/`job_status` schema, and the job-type vocabulary all diverge from the four phases that consume it; the invented `p5_*` hooks don't exist in P5; the three timers the phase is named for (`standby_roll`, `pending_expiry`, `day_of_reconfirm`/`safety_check_in`) have no real enqueuer and/or call into a void; push has no registration path so the load-bearing channel is dead at launch; and the strongest safety guarantee in the plan is silently false for tokenless users. Executed as written, the mechanic stays inert — the exact outcome the phase promises to prevent.

---

## PRIORITY FIX ORDER

1. **Converge the `jobs`/notify/enqueue contract across P2+P5+P6+P7+P9 BEFORE writing any of them.** One `jobs` table (`kind text`, `run_after`, `dedupe_key`, one `job_status` enum), one `enqueue(kind,run_at,payload,dedupe_key)`, one `cancel_jobs(kind,dedupe_key)`, one `notify(user_id, kind, payload)` adapter, one full notification-kind set. Assign non-colliding migration timestamps. This is the single highest-leverage fix; it unblocks or breaks four phases.
2. **Delete the fictional `p5_promote_standby`/`p5_reap_pending` hooks.** Make `offer_expiry`'s handler call P5's real `match_expire_offer(offer_id)` (which auto-rolls inline) and nothing else. Remove the separate `standby_roll` job, or redefine it against `match_auto_roll`. Stop P2 from writing offer state directly.
3. **Ship the device-registration endpoint + fix multi-device fan-out + Expo receipt/error checking.** Without registration, push is dead; without receipt checking, delivery metrics lie and dead tokens pile up. This is the gap between "load-bearing native push" and "every user on the dead email fallback."
4. **Make the safety guarantee true:** wire the email fallback (or another guaranteed channel) so a tokenless user's `safety_check_in`/`day_of_reconfirm` actually reaches them; ensure P2's runner can invoke P7's `safety-escalation` Edge Function (generic `invoke_edge_fn` job kind); add the missing enqueuers for `safety_check_in`/`day_of_reconfirm`/`pending_expiry` (decide whether P2 or P5 owns them — and put it in writing).
5. **Fix the `standby_roll` `Date.now()` dedup key, count `attempts` per execution not per claim, and add dead-letter + cron-heartbeat alerting** so failed safety jobs and a stalled cron are never silent.
6. **Implement quiet-hours (joined to `cities.timezone`) or remove the columns and the claim.** Fix the `auth.users` FK in the test fixtures (seed `auth.users` first) so the TDD steps actually pass.
