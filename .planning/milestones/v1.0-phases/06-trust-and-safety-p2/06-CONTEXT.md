# Phase 06: Trust & Safety (P2) - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning
**Mode:** mvp — vertical slices (UI→API→DB per capability)

<domain>
## Phase Boundary

Deliver REQ-E17 + REQ-E18 + REQ-E19 — the back half of the loop that builds trust. This phase WIRES existing infrastructure; it does not rebuild plumbing. Three capabilities:

1. **Reliability (E17):** compute a `reliability_score` from `match_ratings` and surface it on the badge; make `no_show` a reachable lock outcome that feeds the score.
2. **Chat ↔ profile ↔ night (E18):** wire the 4 expected nav edges so a conversation connects to the counterpart's profile and the night/plan, and Profile↔Night↔Chat all navigate. Add the missing chat RLS read policies (chat_threads currently default-deny).
3. **Safety flows (E19):** implement + enqueue `day_of_reconfirm` and `safety_checkin` (RPCs + producers at accept time); handlers run without poison-looping (reuse the existing dead-letter-at-5 retry posture).

**In scope:** reliability formula RPC + badge display; no_show → reliability feed; the 4 nav edges + chat RLS read policies; the day_of_reconfirm + safety_checkin job handlers + their accept-time producers + the notification copy. Reuse the existing jobs system, dispatch_notification safety gate, flag_no_show RPC, public_profile_card view, and badgeFor().

**Out of scope (own phases / deferred):** map/route/ranking/proximity/standby/polish + legacy-planner cleanup (E20–E25 / Phase 7). Recency-decay reliability weighting (P3). No-show enforcement/bans/cooldowns (explicitly deferred — D-02). Safety-checkin enforced gating + no-ack auto-escalation (deferred — D-03). Reconfirm auto-cancel-on-timeout (deferred — D-04).

**Mode: mvp** — each capability is a vertical slice (UI→API→DB).
</domain>

<decisions>
## Implementation Decisions

Locked product-taste calls (each the lightest defensible MVP option). The infrastructure (jobs, enums, dispatch safety-gate, no_show enum + flag_no_show, match_ratings, reliability_score column, public_profile_card view) ALREADY EXISTS — this phase wires it.

### Reliability score (E17)
- **D-01: Simple weighted % + "new" until ≥3 rated dates.** `reliability_score` = a weighted percentage of positive outcomes from `match_ratings` for the ratee — `showed_up` weighted heaviest; `on_time` and `cancelled_with_notice` contribute; `unsafe_or_disrespectful` penalizes hard. A profile stays "new" (badge_is_new, score shown as a new-member treatment not a number) until it has ≥3 rated dates, so a single rating can't define someone. Surface it as a small label/score on the badge via the existing `public_profile_card` view + `badgeFor()`. Recency/exponential decay is DEFERRED to P3. The score is (re)computed when the rating window closes (`close_rating_window` handler aggregates the ratee's match_ratings).

### No-show consequence (E17)
- **D-02: Reliability hit only.** A `no_show` flag feeds the reliability score (counts as a missed/negative date) and nothing more — NO automatic ban, NO cooldown, NO mod alert in this phase. `no_show` is already reachable via `flag_no_show`; this phase ensures the no_show outcome is reflected in the score computation. Enforcement (bans/cooldowns/alerts) is explicitly deferred.

### Safety check-in (E19)
- **D-03: Soft ping (notify-only).** After the date window, a `safety_checkin` job fires a `safety_checkin` notification ("all good?" — lowercase/dry/Barbiecore copy). The user can acknowledge in-app; an optional "something's wrong" path dispatches a `safety_alert` (which routes to mod/admin via the existing fail-loud safety chain). NO blocking, NO auto-escalation on no-ack. Safety notifications already bypass consent/quiet-hours/rate-limit in `dispatch_notification`.

### Day-of reconfirm (E19)
- **D-04: Morning-of, soft warning.** Accepting a date enqueues a `day_of_reconfirm` job anchored to the morning of the date; it dispatches a `date_reconfirm` notification ("still on?"). No response = a soft warning surfaced to both parties (e.g. a state/flag the UI can show); NO auto-cancel of the lock. (`reconfirm_timeout` auto-cancel is deferred — D-04 out-of-scope.)

### Claude's Discretion (implementation — planner/researcher decide)
- The exact reliability weighting numbers (e.g. showed_up=primary, unsafe penalty magnitude) and the score's numeric range (0–100 vs 0–5) + its on-badge visual treatment, per DESIGN-SYSTEM.md and the existing badge surfaces.
- Whether reliability is recomputed in `close_rating_window` directly or via a dedicated `recompute_reliability(ratee)` DEFINER RPC it calls (prefer a small dedicated RPC for testability).
- The precise "morning-of" anchor (local tz of the date's city; reuse the quiet-hours tz-resolution pattern) and the dedup keys for the two new jobs (mirror `rating:`||lock_id).
- The exact 4-edge nav implementation (Chat→Profile, Chat→Night, Profile→Night, Night→Profile/Chat — Night→Chat already exists) reusing DeepRouteHeader + the existing reveal-gated ProfileCard. Post-lock the counterpart identity is already revealed (Phase 5), so the chat header may link to the (revealed) profile and the night.
- The chat RLS read policies (`chat_threads` party-read + `messages` party-read) — secure-by-default: party-scoped USING, no USING(true), pin search_path on any new DEFINER, run the advisor after DDL.
- The soft-warning + checkin-ack surfaces (where the "still on?" / "all good?" states render): reuse LockDetail / matches surfaces; keep them light.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — REQ-E17 (lines ~171–175), REQ-E18 (~177–181), REQ-E19 (~183–187).
- `.planning/ROADMAP.md` §"Phase 6: Trust & Safety (P2)" — goal + 3 success criteria + Mode:mvp + deps.

### Reliability / ratings / badge (E17) — REUSE
- `supabase/migrations/20260525120800_p0_match_ratings.sql` — match_ratings (showed_up/on_time/cancelled_with_notice/unsafe_or_disrespectful, unique (lock_id,rater_id)).
- `supabase/migrations/20260525120100_p0_profiles_dating.sql:35` — `profiles.reliability_score numeric(4,2)` (nullable).
- `supabase/migrations/20260525122700_p1_badge_view.sql` — `public_profile_card` view (reliability_score, badge_verified, badge_is_new).
- `packages/business/src/eligibility.ts:14` — `badgeFor()`.
- `supabase/migrations/20260604121000_e5_loop_completion.sql:118` — `flag_no_show` RPC (no_show reachable; consequence path MISSING).
- `supabase/migrations/20260525120700_p0_locks.sql:3` — `lock_status` enum incl. `no_show`.
- `supabase/migrations/20260527127200_p5_job_rpcs_backfill.sql:79` — `close_rating_window` (window-close hook; aggregation MISSING).
- `apps/web/components/ProfileCard.tsx` — post-reveal profile card (does NOT yet render reliability).

### Chat ↔ profile ↔ night (E18) — REUSE + WIRE
- `apps/web/app/messages/[threadId]/page.tsx` + `Conversation.tsx` — chat thread (header shows name only; loads counterpart via offer; no profile/night links).
- `supabase/migrations/20260525124500_p2_chat_core.sql` — chat_threads (offer_id, lock_id) + `promote_chat_thread_to_lock`. **NOTE: chat_threads has NO RLS read policies yet (default-deny) — add party-read.**
- `supabase/migrations/20260601100000_p7_messages_table.sql` (+ p7 chat RLS migrations) — messages table + existing party-read patterns to mirror.
- `apps/web/app/matches/[lockId]/LockDetail.tsx:115` — existing Night→Chat link (the one working edge).

### Safety flows / jobs (E19) — REUSE + WIRE
- `supabase/migrations/20260525123000_p2_jobs.sql:9` — job_type enum (day_of_reconfirm, safety_checkin already present).
- `supabase/migrations/20260525123100_p2_jobs_rpcs.sql` — enqueue_job / claim_due_jobs / fail_job (backoff + dead-letter@5).
- `supabase/migrations/20260525123400_p2_notifications.sql:9` — notification_type enum (date_reconfirm, safety_checkin, safety_alert present).
- `supabase/migrations/20260525123600_p2_dispatch_notification.sql` — dispatch_notification safety-gate (safety bypasses consent/quiet/rate; fail-loud to admin_alert).
- `supabase/functions/process-jobs/handlers.ts:58` — HANDLERS dispatch table (day_of_reconfirm/safety_checkin handlers MISSING).
- `supabase/migrations/20260527126400_p5_accept_lock.sql:115` — match_accept_offer enqueue site (rating_window/standby_roll). Mirror at `match_resolve_reciprocal` (reciprocal path — Pitfall: wire BOTH lock RPCs, per Phase 5 E16 precedent).
- `apps/web/app/api/cron/process-jobs/route.ts` — the Vercel cron consumer.

### Prior-phase decisions that constrain this phase
- Phase 5 (just shipped) — post-lock identity is revealed; chat is post-lock so the chat header CAN link to the revealed profile. The gated-prod-apply rule + secure-by-default DB rules carry forward.
- `docs/superpowers/DESIGN-SYSTEM.md` — Barbiecore tokens + stop-slop copy for all new surfaces.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- match_ratings + reliability_score column + public_profile_card view + badgeFor() — reliability plumbing exists; build the aggregation + badge UI only.
- flag_no_show RPC + no_show enum — reachable; just feed the score.
- jobs system (enqueue_job/claim_due_jobs/fail_job, dead-letter@5, requeue_stuck_jobs) — robust; add 2 handlers + 2 producers.
- dispatch_notification safety-gate + the date_reconfirm/safety_checkin/safety_alert notification types — exist; just dispatch with the right payloads + copy.
- The Phase-7 chat (messages table + party-read RLS pattern) — mirror for chat_threads party-read.

### Established Patterns
- **Secure-by-default + gated prod-apply:** any new RLS/RPC pins search_path + party-scoped USING (no USING(true)) + revoke anon / grant authenticated; run the advisor after DDL; local-green → gated prod-apply (NOT auto-pushed; prod ref ufufmcpnysvwtutpbian).
- **Wire BOTH lock RPCs:** producers (job enqueues) go in match_accept_offer AND match_resolve_reciprocal (the reciprocal path), per the Phase-5 E16 dispatch precedent.
- **Job handler pattern:** add to the HANDLERS table in process-jobs/handlers.ts → call a DEFINER RPC; stale-tolerant, never raise on already-resolved input (poison-loop avoidance — mirror close_rating_window).
- **Visual-verify** @420px any new/changed UI surface against DESIGN-SYSTEM.md.

### Integration Points
- close_rating_window → recompute reliability for the ratee → public_profile_card → ProfileCard badge.
- match_accept_offer + match_resolve_reciprocal → enqueue day_of_reconfirm + safety_checkin (morning-of + post-window anchors).
- process-jobs/handlers.ts → day_of_reconfirm handler (dispatch date_reconfirm) + safety_checkin handler (dispatch safety_checkin).
- chat thread page → DeepRouteHeader/links → revealed ProfileCard + /matches/[lockId] (the night).
</code_context>

<specifics>
## Specific Ideas
- All new copy lowercase, dry, Barbiecore, stop-slop (no em-dashes): reconfirm = "still on?"; safety check-in = "all good?"; keep warm, not alarmist.
- Reliability "new" treatment should feel encouraging, not punitive (a new member isn't "unreliable", just unrated).
- Safety is the one area to fail loud, not silent (the existing dispatch_notification admin_alert fail-loud already encodes this) — but the MVP user-facing flow stays soft (D-03).
</specifics>

<deferred>
## Deferred Ideas
- **Recency-weighted / decaying reliability** (P3) — recent dates weighted higher. D-01 ships flat weighting first.
- **No-show enforcement** — bans/cooldowns/mod alerts on repeat no_show (D-02 ships reliability-feed only).
- **Enforced safety check-in + no-ack auto-escalation** (D-03 ships soft ping only).
- **Reconfirm auto-cancel on timeout** (`reconfirm_timeout` job; D-04 ships soft warning only).
- **WR-04 (from Phase 5):** clear photo revealable after a cancelled lock — tracked in `.planning/todos/pending/wr04-cancelled-lock-reveal.md`, not this phase.
</deferred>

---

*Phase: 06-trust-and-safety-p2*
*Context gathered: 2026-06-04*
