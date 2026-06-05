---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 06-04-PLAN.md (E19 producers — both lock RPCs enqueue safety jobs)
last_updated: "2026-06-05T17:24:40.607Z"
last_activity: 2026-06-05
progress:
  total_phases: 7
  completed_phases: 6
  total_plans: 39
  completed_plans: 32
  percent: 82
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-03)

**Core value:** A user can browse a real planned night, express interest, get matched, and end up on an actual date with a real plan attached — the full loop closes and never traps the user.
**Current focus:** Phase 07 — enhancements-and-polish-p3

## Current Position

Phase: 07 (enhancements-and-polish-p3) — EXECUTING
Plan: 3 of 9
Status: Ready to execute
Last activity: 2026-06-05
Prior: 2026-06-05 — 06-04 (E19 producers) green: both lock RPCs (match_accept_offer + match_resolve_reciprocal) re-CREATEd via CREATE OR REPLACE from the LIVE e16 body (20260606120100) adding day_of_reconfirm (morning-of 09:00 date-city-tz, permissive UTC degrade) + safety_checkin (post-window) enqueues beside rating_window — new_match + identity_revealed dispatches + authenticated grant PRESERVED. Migration 20260606130000 (timestamp strictly after e16 so db reset can't clobber). e19_producers.sql asserts both paths enqueue both jobs (Pitfall 2 reciprocal). Commits 954176d (migration), be5a124 (test). GATED: NOT applied local/prod — local apply + advisor + assertion run owned by 06-05.

PHASE-CLOSE GATES:
  ✓ Forced-local visual-verify @420px E13 (offer+lock PlanTimeline) + E12 (interested decline/withdraw/pills, passed_by_host filtered) — PASS. 1 LOW pre-existing note: offer_passed/offer_expired rows show "someone" (reveal policies cover only pre-offer stages; accepted row fine in prod via lock reveal). Harness: apps/web/e2e/route-03-visual.spec.ts.
  ✓ gsd-verifier goal-backward pass — 4/4 must-haves VERIFIED (03-VERIFICATION.md). Each load-bearing claim re-spot-checked against source (PlanTimeline@112/104, reject_candidate silent, 156-LOC component).
  ✓ E11 creator-controls visual-verify (PostNightForm @ /nights/new?itinerary= + Door-2 publish CTA + CoverUploader @ /plans/[id]/edit) — PASS. All fieldsets render on-brand (who-pays/open-to inclusive framing/age/radius/the-why/soundtrack); publish CTA + cover dropzone present. Harness: apps/web/e2e/route-03-e11-visual.spec.ts. Door-2 sticky-bar/cover "overlap" was a confirmed fullPage-screenshot artifact (publish bar is last DOM element, sticky bottom-0) — NOT a bug.
  → PHASE 3 IMPLEMENTATION + ALL AUTOMATED/VISUAL GATES COMPLETE.

LOW findings (non-blocking, optional cleanup):

  - PostNightForm.tsx:315 subtitle uses an em-dash ("they're in — you choose") — stop-slop violation (UI-SPEC §Copywriting); 1-line copy fix.
  - InterestedList offer_passed/offer_expired rows show "someone" (reveal policies cover only pre-offer stages); pre-existing, accepted row fine in prod via lock.
  - LockDetail H1 may clip very long real first names (seed name made it visible); verify with a long name.

  ✓ GATED PROD-APPLY DONE (2026-06-04): batched Phase 2 (E5-E8 + e2 enums) + Phase 3 (E11 targeting cols/post_night extend, E12 queue enum/reject_candidate) — 9 migrations applied to prod ufufmcpnysvwtutpbian via MCP apply_migration in dependency order. Verified on prod: 8-arg post_night + 7-arg update_itinerary_stops (old 5-arg dropped), reject_candidate/cancel_night/update_night/sweep_loop_terminus/flag_no_show present, queue_status+passed_by_host, date_match_status+expired, date_instances targeting cols. Security advisor: NO new findings (my fns pin search_path=public, no USING(true); DEFINER-executable warnings are the app's established accepted pattern shared by all match_* RPCs). match-reject-candidate edge fn deployed (CLI, verify_jwt=true, 401 unauthed). RESEND_API_KEY confirmed in Vercel prod. NOTE: prod migration ledger uses MCP-assigned versions (drift vs local filenames — pre-existing reconciliation pattern; local files remain source of truth).

Progress: [████████░░] 82%

## Performance Metrics

**Velocity:**

- Total plans completed: 9
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 02 | 5 | ~43m | ~8.6m |
| 03 | (in progress) | — | — |
| 05 | 4 | - | - |
| 06 | 5 | - | - |

**03 plan log:** 03-04 PlanTimeline extraction — ~25m, 3 files, commit 74f88db (Wave 1). 03-02 reject_candidate DEFINER RPC (silent decline) — ~15m, 5 files, commits 550d8ca/c6a3fc1/99dbd64 (Wave 2); REQ-E12 backend half done, UI half pending.

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 05 P01 | 9 | 4 tasks | 10 files |
| Phase 05 P02 | 14 | 2 tasks | 3 files |
| Phase 05 P03 | ~40 | 3 tasks | 5 files |
| Phase 06 P01 | 6 | 4 tasks | 10 files |
| Phase 06 P02 | 4 | 2 tasks | 3 files |
| Phase 06 P03 | 18 | 4 tasks | 5 files |
| Phase 06 P04 | 12 | 2 tasks | 2 files |
| Phase 07 P01 | 22 | 2 tasks | 3 files |
| Phase 07 P02 | 18 | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table (+ `.planning/intel/decisions.md` D1–D13).
Recent decisions affecting current work:

- Roadmap is the audit's P0→P3 E-queue (E1–E25), not re-derived — sequence never reorders across P-bands (D7).
- E3 / ISSUE #15 is a nav-repoint + profile-view of the existing `/account` hub, NOT a from-scratch build (D12).
- Door 2 + `create_blank_itinerary` + typed-city are LIVE ON PROD — re-check against prod before E11, do NOT rebuild (D8).
- `reject_candidate` / `update_night` / `cancel_night` are genuinely absent on prod = real build work (E12/E7/E6, D9).
- `interest_received` / `identity_revealed` enums are already applied — E8/E16 are dispatch-site wiring, not migrations (D11).
- E5 rating-window coordination: cron-completed locks MUST enqueue rating_window themselves — close_rating_window takes an explicit p_lock and does NOT self-discover; accept_lock enqueues it. sweep_loop_terminus now does the same (anchor upper(time_range)+2h, dedup rating:<lock>).
- no_show is LOCK-level only (date_match_status has no no_show value); date_instances terminal states are completed/expired. flag_no_show uses membership auth (either party), not creator-only.
- E6 cancel_night = SOFT unpublish (status->'cancelled', row + queue_entries KEPT/reversible), creator-only DEFINER, notifies interested via night_cancelled; pre-match only (non-seeking -> P0001).
- E7 update_night = creator-only DEFINER, coalesce-edit of starts_at/duration/venue/ambient, NEVER writes GENERATED time_range; dispatches night_changed ONLY on material change (time OR venue), not ambient/duration-only.
- E8 interest_received = match_ingest_interest CREATE OR REPLACE (body verbatim) dispatches to host ONLY on n>0 (new candidate enqueued), deep-link /dates/[instance]/interested via payload.date_instance_id; coarse per-instance dedup_key ('interest_received:'||instance) throttles email/push while grouped in-app row still surfaces; grants unchanged (revoked public+authenticated). notif-map already had the deep-link (folded in 02-02).
- E13/03-04 PlanTimeline (apps/web/components/PlanTimeline.tsx) = StopRow+StopTime extracted VERBATIM from feed/NightDetailSheet; accepts ALREADY-NORMALIZED NightDetailStop[] and does NOT re-normalize (re-running normalizeNightDetailStops on a NightDetailStop is lossy — reads source keys estimated_cost_pp/place_name). Callers reading raw itineraries.stops normalize first (03-05 loaders). Blind-safe: name-query map link, NO /places/[slug] StopCard.
- [Phase ?]: E15/05-01: signBlurredUrls no-reveal-gate; browse_feed widened +3 host cols LOCAL-applied advisor-clean; blurred path signed app-side in feed/page.tsx; REQ-E15 rung-1 only (offer tier 05-02).
- [Phase ?]: 05/05-02: rung-2 offer surface = candidate offers/[offerId] view (not InterestedList); avatar signed from blurred_photo_url + CSS blur(3px) over blur(8px), clear path never signed pre-lock (T-05-05/T-05-06); blurred avatar is a 48px circular thumb not a Polaroid
- [Phase 05]: 05/05-03 (E16/D-02/D-04): identity_revealed dispatched at BOTH match_accept_offer AND match_resolve_reciprocal to both parties; consent = it honors matches_enabled by gating the DELIVERY channel to 'suppressed' (sibling PARITY with new_match), NOT by withholding the in-app row — dispatch_notification ALWAYS writes the in-app row, prefs gate push/email (E8 precedent). Inverse-consent verified at runtime + through the real lock e2e. RevealModal ceremony = framer-motion blur(12px)->0 / 900ms expo-out + scale/opacity + one shell.accent glow flourish, gated on justLocked (?just=1); reduced-motion = immediate clear + opacity cross-fade, toast still fires; sage NOT promoted (flourish is pink, not a tick). e16 migration LOCAL-applied + advisor-clean, PROD UNTOUCHED (gated to 05-04 alongside the 05-01 e15 browse_feed widen).
- [Phase 06]: 06/06-01 (E17/REQ-E17/D-01/D-02): reliability_score = weighted % from match_ratings + no_show locks, recomputed on close_rating_window for BOTH parties. Weights LOCKED in packages/business/src/reliability.ts (SQL recompute_reliability mirrors 1:1): showed_up 80 + on_time 20 (clean attended date=100); cancelled_with_notice 50 RECOVERY credit ONLY on a no-show (not an additive bonus); unsafe_or_disrespectful -100 (floors the date to 0); each no_show lock=0. NULL until >=3 total (rated+no_show) dates -> badge_is_new "new here". no_show counted from locks.status='no_show' EXCLUDING any lock already rated for the ratee (no_show AUTHORITATIVE, one bucket per lock, no double-count). SOFT (D-02): recompute_reliability writes ONLY profiles.reliability_score — NO enforcement/status-change/bans. DEFINER pins search_path=public + revoke-all from public/anon/authenticated. ProfileCard pill (verified-gated via badgeFor): blush "new here" (+ "no rated dates yet", no number) / neutral "{score}% · reliable" + tiny sage Check tick, aria-label both states, NO red. Migration 20260605120000_e17 GATED: local apply + advisor + e17 SQL assertion-script run all DEFERRED to 06-05; prod (ufufmcpnysvwtutpbian) UNTOUCHED.
- [Phase 06]: 06/06-02 (E18/REQ-E18): chat→profile + chat→night wired into the existing DeepRouteHeader right slot, reveal-gated on chat_threads.lock_id (added to the conversation loader select). Pre-lock thread renders NEITHER control (no identity leak, T-06-05); both → /matches/[lockId] (lucide UserRound / CalendarHeart, 44px tap targets, quiet ink, aria-labels their profile / the night). Night→Profile + Night→Chat in LockDetail confirmed unchanged. chat_threads_party_read VERIFIED-not-recreated (deny-non-party SQL, NO create policy). E2E + SQL authored, EXECUTION deferred to 06-05. No DB applied, prod untouched.
- [Phase 06]: 06/06-04 (E19/REQ-E19 producers): both lock RPCs (match_accept_offer + match_resolve_reciprocal) re-CREATEd via CREATE OR REPLACE from the LIVE e16 body (20260606120100_e16) — NOT the superseded 127800/_p5_accept_lock/_p5_b_complete — adding day_of_reconfirm + safety_checkin enqueues beside rating_window. PRESERVED everything e16 added: new_match (2/RPC) + identity_revealed (2/RPC), SECURITY DEFINER SET search_path, inherited grant to authenticated (no DROP — T-06-12). Migration timestamp 20260606130000 sorts STRICTLY AFTER e16 (20260606120100) so a db reset can't let e16 re-apply and clobber the safety enqueues (the plan's stale 20260605120200 filename would have). day_of_reconfirm run_after = date_trunc('day', lower(rng) at time zone v_tz) at time zone v_tz + 9h, tz from date_instance.city_id→cities.timezone (NOT primary_city_id), permissive degrade lower(rng)-6h if tz null. safety_checkin run_after = upper(rng)+2h. Dedup reconfirm:||lid / checkin:||lid; payload {lock_id}. Reciprocal uses p_chosen_instance (no inst local, Pitfall 2). e19_producers.sql drives both RPCs to real locks (accept via a_accept_lock recipe, reciprocal via b_reciprocal recipe) and asserts rating:/reconfirm:/checkin: jobs for each lid. Commits 954176d (migration) + be5a124 (test). GATED: NOT applied local/prod — local apply + advisor + assertion run owned by 06-05.
- [Phase ?]: [Phase 07]: 07/07-01 (E20/E23/E24 contract): get_night_detail re-CREATEd (CREATE OR REPLACE, RETURNS TABLE byte-identical) merging per-stop lat/lng/place_slug via left join places on (s->>'place_id')::uuid INSIDE the DEFINER RPC (T-07-01: never a client-side places query). Non-catalog place_id degrades to null/no-row-error (D-01). reservation_url scrub + search_path pin + revoke-anon/grant-authenticated tail preserved. Migration 20260606140000 sorts after latest 20260606130200 (Phase-6 ordering lesson). feed.ts owns the WHOLE Phase-7 contract here to keep Wave-1 parallel: NightDetailStop.place_slug (+normalizer o.place_slug, feeds both LockDetail direct-itinerary loader AND feed RPC), FeedNight.city_name (E23), withdrawInterest wrapper (E24, forward-ref RPC-name cast until types regen). GATED: migration local-green only, prod UNTOUCHED — advisor+assertion owned by 07-09. REQ-E20/E23/E24 NOT marked complete: their user-facing acceptance lands in downstream Wave-2/3 frontend plans.
- [Phase 07]: 07/07-02 (E22/E23/D-03): browse_feed_for_viewer DROP+CREATE on the e15 body (return shape changed) +city_name (=cities.name, NightCard slot already wired) + finer distance (venue coords else city-centroid) + tuned soft-score (vibe overlap COUNT-weighted via cardinality(intersect) not boolean; +1 light mutual-compat nudge when both gender prefs align). Preserves all 14 e10 + 3 host-hint cols + every hard gate + the (starts_at,id) keyset tail byte-identical (Pitfall 3) + search_path pin + verbatim revoke-anon/public + grant-authenticated tail. e23_feed_contract.sql (the phase's most important regression) locks col set + anon/public-denied + city_name + keyset no-dup/no-skip; GREEN on a fresh db reset. — GATED: local-green only, prod ufufmcpnysvwtutpbian UNTOUCHED (advisor + prod-apply at 07-09). REQ-E22/E23 NOT marked complete — DB half only; NightCard render + relevance surface land downstream (mirrors 07-01).

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

- Investigate the possible lost-swipe race in the detail-sheet "i'm in" path (live-verify new-issue #2 — not yet an E-item).
- Residual legacy-Fraunces serif spots on `/create`, `/login`, `/about`, `/tell-us` — follow-up touch-up, not a brand-sweep re-queue.

### Blockers/Concerns

[Issues that affect future work]

- UNREACHED audit items (C2/C3/C5/C6/C9 nav terminals, D13 preferences-edit, D16 dead handlers/safety) are assertions from the static read — confirm in code before building the fix.
- Phase 3 (E11): re-check Door 2 against PROD first; reconcile §2A canvas work with the open-city `CreateFlow.tsx` scaffold AFTER the fleet lands (do not double-edit concurrently).
- All schema work is gated prod-apply: local-green → security advisor after DDL → batched prod apply. Watch local-vs-prod drift (prod ref `ufufmcpnysvwtutpbian`).

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-06-05T17:24:26.750Z
Stopped at: Completed 06-04-PLAN.md (E19 producers — both lock RPCs enqueue safety jobs)
Resume file: None
