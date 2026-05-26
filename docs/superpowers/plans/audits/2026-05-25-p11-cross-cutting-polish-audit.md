# P11 — Cross-Cutting Polish — Pre-Development Audit

**Auditor stance:** paranoid principal product engineer + systems architect. Question audited: *does executing THIS plan, against the sibling plans as actually written, yield working cross-cutting polish end-to-end?* Cross-referenced: spec §10/§13, roadmap, P0 data-model, P2 scheduler, P4 browse-feed, P5 matching, P6 chat.

**Verdict up front:** The plan is internally well-built (real TDD, runnable code, contrast-as-a-test is excellent). But as a *cross-cutting* deliverable it fails at the seams: roughly half its UI primitives are **orphans** that the host phases (P4/P6) already satisfied with their own components; its demand-hint and notification-storm work **duplicate and contradict** what P5/P2 already shipped; its "every transition" analytics guarantee is **only ~half true** on the server; and two of its server seams (offer-window flag, relay drain job) **have no matching contract** in P5/P2.

---

## 1. Dead UI / Orphaned Components / No Real Wiring

The plan's own model is "build the shared primitive, host phase wires it in one line later." That model is **broken for P11 specifically** because P11 is *finalized last* — the host phases (P4, P6) land BEFORE P11 and have already shipped their own UI without these primitives. There is no later phase to do the wire-up. Every primitive below is therefore born dead unless P11 adds explicit edit-tasks to the already-merged host screens (it does not).

- **`SwipeDeck` (Task 7) is a duplicate of P4's `SwipeDeck`.** P4 builds `apps/web/components/feed/SwipeDeck.tsx` (Task: `components/feed/SwipeDeck.tsx` "client deck: swipe right/left → /api/feed/swipe") and ships the real feed with it. P11 builds a *second* `apps/web/components/loop/SwipeDeck.tsx`. Same name, different directory, different contract (P11's takes `onSwipe(dir)`; P4's posts to `/api/feed/swipe`). Nothing in P4 imports P11's. P11's accessible Pass/Interested buttons — the whole point of the a11y task — **never reach the feed**. ORPHAN.
- **`AmbientSound` (Task 6) is a duplicate of P4's `AmbientPlayer`.** P4 ships `apps/web/components/feed/AmbientPlayer.tsx` ("native-first audio w/ explicit web fallback") and that is what the feed renders. P11's `AmbientSound` (the caption-equivalent a11y version) is consumed by nothing. The deaf/HoH caption channel the audit demanded is built and then left on the shelf. ORPHAN.
- **`AsyncBoundary` / `LoadState` / `loopCopy` (Task 2) — pattern defined, never adopted.** The Goal claims "consistent LOADING/ERROR/EMPTY on **every** loop screen." But P4 already ships its own `EmptyFeedState.tsx` (cold-start copy, create-a-night CTA) and P6 explicitly *defers* "a11y/loading states" to P11 (P6 line 1536) yet builds its chat UI without them. P11 defines `loopCopy.feedEmpty`/`chatEmpty`/`offersEmpty` but **no task edits the P4 feed page, P5 offer/lock screens, or P6 chat thread to use `AsyncBoundary`.** The "pattern is adopted" claim in the self-review is aspirational; the tasks don't adopt it anywhere. ORPHAN PATTERN.
- **`OfferCountdown` (Task 8), `LoopActionButton` (Task 4), `useAsyncAction` (Task 3), `feed-a11y` (Task 9)** — none are imported by any screen this plan or a sibling plan builds. P5's offer/lock UI is not in P5 (P5 is RPC + Edge Function only; "No business logic in TypeScript", no React). So there is **no offer/lock screen anywhere** for `OfferCountdown`/`LoopActionButton` to live on. These primitives target a UI that no phase builds. ORPHANS pointing at a missing surface.
- **`feed-a11y.feedItemLabel` consumes a `browse_feed` shape that doesn't match P0.** It expects `venue_neighborhood`, `vibe_tags`, `pay_setting`, `timezone` on the feed row. P0's `browse_feed` exposes `date_instance_id`, `time_window_start`, `status`, and (per P4) `neighborhood`, `vibe_tags`, `why_note`, `ambient_sound_url`, `pay_setting` — but **no `timezone` column and field named `neighborhood`, not `venue_neighborhood`.** The helper is wired to a row contract that does not exist; it would compile against a hand-written type and silently mislabel/throw in real use. DEAD on a contract mismatch.

---

## 2. Broken Cross-Phase Seams (the core failure)

- **SEAM FAIL — offer-window flag is never read by P5.** Task 12 builds `feature_config('offer_window_hours')` + `offerWindowHours()` and the whole premise is "jobs/Edge Functions read the DB value to tune the window." But P5's `match_make_offer(p_actor, p_instance, p_candidate, p_window_hours int default 24)` takes a **hard-coded 24h default** and computes `exp := now() + make_interval(hours => p_window_hours)`. It never reads `feature_config`, never calls `offer_expires_at()`. So the tunable offer window is **decorative**: the experiment value can be set in PostHog and `feature_config`, and the actual offer expiry ignores it. The Open Question §11.1 the task claims to close stays open.
- **SEAM FAIL — `offer_expires_at()` (Task 14) is called by nobody.** P11 self-review: "P5 offer/lock RPCs call `offer_expires_at()`." They don't. P5's `match_make_offer` does its own `now() + make_interval(...)` inline (P5 line 671). The DST-safe shared rule exists but the one function that computes real expiries doesn't use it. Two sources of truth, one unused.
- **SEAM FAIL — analytics relay has no job to run it.** Task 13's `drainAnalyticsEvents` is "called from a P2 scheduled job (every minute)." But P2's `job_type` enum is a **closed enum of exactly 6 values** (`offer_expiry, standby_roll, pending_expiry, stale_date_close, day_of_reconfirm, safety_check_in`). There is no `analytics_relay`/`drain_analytics` type, and P11 never adds one (it would need `ALTER TYPE job_type ADD VALUE`, which P11 doesn't do, and which can't run inside the same txn as use). The process-jobs runner dispatches only those 6 handlers. **`analytics_events` is written but never drained** → the outbox fills forever and no server transition ever reaches PostHog. The "no transition is lost" guarantee is the opposite of true: every server transition is silently queued and dropped.
- **SEAM FAIL — `notification_batches`/`coalesce_notification` (Task 17) has no producer and no consumer.** P11 says "the P2 sender calls `coalesce_notification`" and "P2's sender drains `sent_at IS NULL`." But P2's actual anti-storm design is **rate-limiting** (`notification_rate_check` → `rate_limit_check`, which *suppresses* excess), and P2's `dispatchNotification()` writes to the `notifications` table — it never calls `coalesce_notification` and never reads `notification_batches`. Two unintegrated anti-storm mechanisms. P11's table is an island: nothing inserts into it (P2 sender doesn't call the fn) and nothing sends from it (no drain). ORPHAN TABLE + dead fn.
- **SEAM FAIL — `demand_hint` view (Task 16) duplicates and contradicts P5.** P5 Task 3 already ships `match_demand_hint(instance)` + `presence_heartbeats`, presence- AND verification-weighted, capped, buckets `none/a_few(1-3)/several(4-8)/lots(9+)`. P11 builds a *second* `demand_hint` **view** + `bucket_demand()` with **different thresholds** (`several` = 4-10, top bucket `many` = 11+, cap 50) and **no presence/trust weighting** — it counts raw right-swipes, directly violating spec §7.2 and P5's "honesty guard." P11's claim that "the P5 read layer passes a filtered swiper set" is fiction: `match_demand_hint(p_instance)` takes only the instance and does the join itself; it cannot consume P11's view. The candidate API calls P5's function. P11's view/fn is an orphan that, if ever wired, would emit a *contradictory* hint (different label `many` vs `lots`, different ceilings, and an *inflatable* raw count P5 specifically prevents).

---

## 3. Analytics: "Every Transition" Is Only Half True

The §13 guarantee is the plan's headline. It is not met.

- **Server outbox covers 8 of 15 events.** The trigger's `loop_event_for` maps only `offers`(4) + `locks`(2) + `queue_entries`(2) = `offer_made/accepted/passed/expired`, `lock_confirmed/cancelled`, `shortlist_added`, `standby_filled`. The other 7 — `swipe_right`, `swipe_left`, `rank_changed`, `reciprocal_chooser_shown`, `withdraw`, `rate_submitted`, `feed_empty_shown` — are **client-only** via `track.loop`.
- **Several "client-only" events actually fire server-side and are therefore lost:**
  - `rank_changed`: happens in P5 `match_set_rank` (RPC, no browser). No outbox mapping (rank is not a `status` change). LOST.
  - `withdraw`: the cascade auto-withdrawal happens in P5 `match_autowithdraw_user_conflicts` (job/RPC). It sets the user's offer to `passed`/`expired`, which the trigger maps to `offer_passed`/`offer_expired` — i.e. the auto-withdraw is **mislabeled** as an expiry, and the distinct `withdraw` event is never emitted server-side. WRONG LABEL + LOST.
  - `reciprocal_chooser_shown`: resolved in P5 `resolve_reciprocal` (RPC). No table status maps to "shown." If the chooser is surfaced via notification/job rather than a live browser, the event is lost. UNDEFINED.
  - `rate_submitted`: a `match_ratings` INSERT (P0 table). No trigger on `match_ratings` in P11. If rating is ever submitted via an RPC/Edge path, LOST.
- **`standby_filled` mapping is dead.** P11 maps `queue_entries new_s='standby'` → `standby_filled`. But P5's standby model **does not set status to `standby`** for next-up selection: `match_next_standby` = lowest-rank `shortlisted` row; auto-roll re-offers a `shortlisted` candidate. The auto-withdraw path sets `status→standby` in one branch, but the "a standby got promoted/filled the slot" transition is a `shortlisted → offer_active` change, which maps to **`offer_made`**, not `standby_filled`. So `standby_filled` rarely/never fires from the real loop.
- **`distinct_id` semantics:** for `queue_entries` the subject is set to `candidate_id`, but `shortlist_added` is a *creator* action; attributing it to the candidate may skew funnels. Minor, but undocumented.
- **No de-dup between P0's `log_status_transition` and P11's `enqueue_analytics_event`.** They coexist (separate triggers, fine) but both fire on every offer/lock/queue write; the outbox is a near-copy of `audit_log` for the subset it covers. Acceptable, but the plan never says why two parallel transition logs exist.

---

## 4. Impossible / Undefined States & Edge Cases

- **Outbox unbounded growth (data-lifecycle).** `analytics_events` has no retention/TTL and (per §2) no working drain. Even with a drain, `forwarded_at IS NOT NULL` rows are never pruned. The partial index `where forwarded_at is null` helps query but the table grows forever. No retention policy defined (the prompt explicitly asks for `analytics_events` retention — MISSING).
- **Relay failure mode.** `drainAnalyticsEvents` marks rows forwarded *after* `ph.capture(...)`, but `posthog-node` `capture` is fire-and-forget (buffered); a process crash between capture-buffer and `flush` loses events yet they're marked forwarded. No `flush()` call, no at-least-once guarantee. The "never lost" claim fails under crash.
- **`OfferCountdown` re-announce spam.** Task description says "only re-announce at meaningful thresholds (per-minute under 1h, per-hour above)" but the code sets `setState` every 1000ms with `aria-live="polite"` + `aria-atomic="true"` on a `role="timer"`. That re-renders the live region every second; many SR/browser combos will queue an announcement each tick → **the exact spam the task says it prevents.** The threshold throttling is described but not implemented.
- **`useAsyncAction` error state never auto-clears.** On error, `status='error'` sticks until the next `run()`; a fresh `run()` clears it — fine — but `LoopActionButton` shows a persistent `role="alert"` with generic copy and the real error is discarded (`{error ? '' : ''}` is a no-op). For the *highest-stakes* flows (offer expired vs network error vs already-locked), the user gets one generic string. Distinct terminal states (offer already expired, someone else locked, you're double-booked — all real P5 exceptions) are collapsed to "Something went wrong." Impossible to act on.
- **`AmbientSound` `aria-hidden={false}` on the caption** is a no-op attribute and the play button uses literal `►`/`❚❚` glyphs as visible children with an `aria-label` — fine — but the `<audio>` has `loop` with `preload="none"`; toggling play un-mutes a not-yet-loaded source, and the `.catch(() => setPlaying(false))` swallows the iOS gesture-policy rejection silently with no user feedback. Undefined UX on the documented iOS-Safari case.

---

## 5. Missing APIs / Auth / Ownership

- **No owner for the integration wire-ups.** §1 establishes the primitives are orphaned because no phase wires them. The plan needs explicit edit-tasks (or P4/P6 re-open tasks) to consume `AsyncBoundary`, replace P4's `SwipeDeck`/`AmbientPlayer` with the a11y versions, mount `OfferCountdown`/`LoopActionButton` on the (nonexistent) offer/lock screen. Ownership is unassigned.
- **No offer/lock UI surface exists in any plan.** P5 is RPC/Edge-only. The countdown + accept/lock button presuppose a screen that no phase builds. Either P5 or P11 must own that screen; neither does. MISSING SURFACE.
- **`analytics_events` / `notification_batches` RLS = "no policies = deny," relayed via service role.** Correct for the relay (api-client service-role client bypasses RLS). But Task 13's `After5Client` type is the *anon/authenticated* client in most of the repo; the plan never states the relay must be constructed with the **service-role key**, and a job/Edge context must inject it. If the relay runs with the user JWT, `SELECT` returns 0 rows and the drain silently no-ops forever. Auth context unstated.
- **`feature_config` write path undefined.** "PostHog experiments overwrite the value" — *how?* No webhook/job writes the experiment result back to `feature_config`. The DB fallback is read-only in the plan; the value can only change by manual SQL. The "experiment tunes the window" loop is open at both ends (read side §2, write side here).

---

## 6. Loading / Error / Empty State Adoption

- Pattern is **defined** (Task 2) and **not adopted** anywhere (see §1). P4 uses its own `EmptyFeedState`; P6 builds chat without it; P5 has no UI. The audit finding "missing loading/error/empty states" is closed *in principle* and open *in product*.
- Error copy is **single-string generic** (`loopCopy.genericError`) for flows whose distinct failures matter most (offer expired, slot taken, double-booked). No mapping from P5's SQL exception codes (`OFFER_EXISTS`, `NOT_SHORTLISTED`, `exclusion_violation`, `RANK_FROZEN`) to user copy. Kind-by-design copy exists for empties but not for the irreversible-action errors.

---

## 7. Accessibility Completeness

- Contrast-as-a-test (Task 5) is genuinely strong; keeps `feed.*` from regressing. Good.
- But the dark-theme tokens live in **three hand-synced places** (`lib/contrast.ts`, `feed-theme.css`, `tailwind.config.ts`) with only `contrast.ts` tested. Nothing asserts the CSS/Tailwind copies match the tested source → they can drift and ship an untested (failing-AA) value. The "source of truth" is asserted in prose, not in a test.
- `OfferCountdown` SR spam (see §4) is an a11y *regression*, not a fix, as coded.
- `feed-a11y` label is wired to a nonexistent row shape (`timezone`, `venue_neighborhood`) (§1) → in practice it throws or mislabels, so the SR feed semantics are not actually delivered.
- SwipeDeck/AmbientSound a11y never ships (orphaned, §1), so the two headline a11y wins (button-equivalent swipe, caption-equivalent audio) **do not reach users**.

---

## 8. Mobile / Responsive / Scale

- **Mobile:** the plan leans on P2 native push as the backbone — correct delegation — but the scale primitive it contributes (notification batching) is unwired (§2). On web the lock mechanic's notification reliability is unchanged by P11.
- **Indexes (Task 15):** mostly fine, but:
  - `queue_standby_rank_idx ... where status='standby'` targets a status value P5's next-standby path **does not use** (next-standby = lowest-rank `shortlisted`). The index won't serve the auto-roll query it's justified by. Mismatch with P5's chosen ordering.
  - `swipes_creator_right_idx` and `match_ratings_ratee_*` partially duplicate P0's existing `swipes_instance_idx` (right-only) and `match_ratings_ratee_idx`. Net-additive but redundant; the test only checks existence, never that a plan *uses* them (the task claims "asserted via EXPLAIN" but the test does pure `pg_indexes` existence checks — the EXPLAIN claim is not implemented).
- **Presence fan-out (Task 16):** the actual presence fan-out (Supabase Realtime heartbeats) lives in P5 (`presence_heartbeats`). P11's view duplicates the bucketing with worse semantics (§2). P11 contributes no real fan-out scalability — it re-derives a count.
- **Scalability of the outbox:** unbounded, undrained (§4).

---

## 9. Timezone / DST Correctness

- The *instinct* is right (store `timestamptz`, display in city zone, add real-duration for expiry). `addOfferWindow`/`offer_expires_at` are correct DST-safe instant math.
- **But `offer_expires_at()` is unused** (§2) — the live expiry path in P5 does its own inline add, so the "shared rule" guarantee is unenforced. If P5 ever changed to calendar math, P11's helper wouldn't stop it.
- **Display seam broken:** `formatInZone` requires the row to carry `timezone`. P0's `browse_feed` and the loop tables don't expose `cities.timezone` on the rows P11 formats; `feed-a11y` invents a `timezone` field (§1). So city-zone display can't actually resolve without a join P11 never specifies. The roadmap also scopes "`scheduled_for`" TZ correctness here, but P11 only addresses offer expiry + feed label; there is no `scheduled_for` column audited (it's `date_instances.starts_at`), and reconfirm/check-in timers (P2) aren't covered.

---

## 10. Contradictions, Design-Intent-vs-Tasks Gaps, Top Fixes

**Contradictions / intent-vs-tasks:**
- "Every state transition gets an event" (intent) vs trigger covers 8/15 and mislabels auto-withdraw as expiry (tasks).
- "Demand hint is presence/trust-weighted, capped, no raw N" (spec §7.2, P5) vs P11's view counts raw right-swipes with different buckets (tasks).
- "No transition lost when it happens in the DB" (intent) vs outbox has no drain job in P2's closed enum (tasks).
- "Offer window is tunable via experiment" (intent) vs P5 hard-codes 24h and ignores `feature_config` (tasks).
- "Consistent states on every loop screen / accessible swipe + ambient" (intent) vs duplicate orphan components no screen imports (tasks).
- Task 1 "the repo has no test runner" vs P1/P2/P4 all establish/assume vitest in `apps/web` — since P11 is last, Task 1's FAIL step is false and re-bootstrapping risks clobbering P4's `vitest.config.ts include` globs.

**TOP 3 MUST-FIX (in order):**
1. **Close the analytics drain seam or the whole §13 deliverable is inert.** Add a `job_type` value (`analytics_relay`) via a standalone `ALTER TYPE` migration + a `process-jobs` handler that calls `drainAnalyticsEvents` with a **service-role** client and `posthog-node.flush()`; OR drain via Vercel cron route directly. Then expand `loop_event_for` (or add server emission in the P5 RPCs) to cover `rank_changed`, `withdraw` (distinct from expiry), `reciprocal_chooser_shown`, `rate_submitted`; fix the `standby_filled` mapping to the real `shortlisted→offer_active` promotion. Add outbox retention/TTL.
2. **De-orphan the primitives by adding explicit host-screen edit-tasks.** Because P11 is finalized last, it must own the wire-up: replace P4's `components/feed/SwipeDeck`+`AmbientPlayer` with the a11y `components/loop` versions (or merge them — do not ship two), make P4/P6 render `AsyncBoundary`, and decide who builds the offer/lock screen that `OfferCountdown`/`LoopActionButton` need (neither P5 nor P11 does today). Fix `feed-a11y` to consume the real `browse_feed` shape (`neighborhood`, plus an explicit `cities.timezone` join).
3. **Resolve the two duplications against P5/P2.** Delete/replace P11's `demand_hint` view + `bucket_demand()` and instead reuse/extend P5's `match_demand_hint` (single bucket scale, presence/trust-weighted) — or formally supersede P5's with a documented migration. Wire `coalesce_notification`/`notification_batches` into P2's `dispatchNotification` (and add a drain) or drop it in favor of P2's existing rate-limiter; do not ship two anti-storm systems. Make P5's `match_make_offer` read `feature_config.offer_window_hours` and call `offer_expires_at()` so the tunable window and DST helper are actually load-bearing.

**Score: 4/10.** Each task in isolation is real, tested, and well-crafted (would pass its own green bar). As a *cross-cutting* plan it does not deliver working polish: ~9 of its ~14 deliverable surfaces are orphaned, contradictory, or seam-broken against the sibling plans it depends on. It would compile, its tests would pass, and almost none of it would reach a user or function in the live loop.

**Counts:** Orphaned components/tables: 8 (`loop/SwipeDeck`, `loop/AmbientSound`, `OfferCountdown`, `LoopActionButton`, `AsyncBoundary` adoption, `feed-a11y` (broken shape), `demand_hint` view, `notification_batches`). Broken cross-phase seams: 5 (offer-window flag, `offer_expires_at` unused, relay drain job, notification batching, demand-hint duplication). Analytics coverage gaps: 7 of 15 events server-lost/mislabeled. Undefined data-lifecycle: 1 (outbox retention). A11y regressions introduced: 1 (countdown SR spam). Direct spec/sibling contradictions: 6.
