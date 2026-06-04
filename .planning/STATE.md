---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 04 UI-SPEC approved
last_updated: "2026-06-04T19:10:24.442Z"
last_activity: 2026-06-04 -- Phase 04 execution started
progress:
  total_phases: 7
  completed_phases: 3
  total_plans: 21
  completed_plans: 17
  percent: 43
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-03)

**Core value:** A user can browse a real planned night, express interest, get matched, and end up on an actual date with a real plan attached — the full loop closes and never traps the user.
**Current focus:** Phase 04 — discoverability-feed-filters-targeting-p1

## Current Position

Phase: 04 (discoverability-feed-filters-targeting-p1) — EXECUTING
Plan: 1 of 4
Status: Executing Phase 04
Last activity: 2026-06-04 -- Phase 04 execution started
Prior: 2026-06-03 — 03-06 (E14 offer-delivery chain audit) + Wave 1+2 (03-01/02/03/04) green.

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

Progress: [████░░░░░░] 43% (Phase 3: 7/7 complete + verified + PROD-APPLIED; pushing to origin)

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 02 | 5 | ~43m | ~8.6m |
| 03 | (in progress) | — | — |

**03 plan log:** 03-04 PlanTimeline extraction — ~25m, 3 files, commit 74f88db (Wave 1). 03-02 reject_candidate DEFINER RPC (silent decline) — ~15m, 5 files, commits 550d8ca/c6a3fc1/99dbd64 (Wave 2); REQ-E12 backend half done, UI half pending.

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

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

Last session: 2026-06-04T18:21:55.293Z
Stopped at: Phase 04 UI-SPEC approved
Resume file: .planning/phases/04-discoverability-feed-filters-targeting-p1/04-UI-SPEC.md
