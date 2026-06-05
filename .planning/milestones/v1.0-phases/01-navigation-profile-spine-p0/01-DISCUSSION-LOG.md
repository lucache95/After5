# Phase 1: Navigation & Profile Spine (P0) — Discussion Log

**Date:** 2026-06-03
**Mode:** discuss (batched, recommendations-first; config = YOLO)

> Human-reference record of the discussion. Not consumed by downstream agents (they read CONTEXT.md).

## Scouting before discussion
Confirmed in code: `/account` is already a real dating hub (LOOP → feed/matches/my-nights) → E3 is enhance-not-build. No canonical back-chrome component exists (scattered `router.back()`) → E1 needs a new shared primitive. `BottomTabShell.tsx:21–24` holds the tab targets (`dates→/my-nights`, `profile→/home`). All deep routes present as audited.

## Decisions

### Area 1 — Profile hub destination (E3 / ISSUE #15)
- Options: Enhance `/account` (rec) | New `/profile` route | Point at `/account/profile` editor
- **Chosen:** Enhance `/account`. → CONTEXT D-01/D-02/D-03.

### Area 2 — "Dates" tab semantics (E2)
- Options: Retarget → `/matches` (rec) | Combined `/my-nights` hub | Split into two nav entries
- **Chosen:** Retarget → `/matches`. → CONTEXT D-04.

### Area 3 — Deep-route nav chrome (E1)
- Options: Contextual back-header (rec) | Add `BottomTabShell` everywhere | Both
- **Chosen:** Contextual back-header (new `<DeepRouteHeader>`); bottom nav stays on 5 tab roots. → CONTEXT D-07-nav/D-08.

### Area 4 — Editable preferences placement (E4)
- Options: Dedicated `/account/preferences` settings page (rec) | Inline on hub
- **Chosen:** Dedicated `/account/preferences`, reuse `/onboarding/preferences` form, include dating on/off toggle. → CONTEXT D-09.

## Claude's discretion (captured, not asked)
`<DeepRouteHeader>` API + back-target resolution; preferences-form extraction; hub layout; keep `/home` as pre-dating landing (decouple from profile tab, don't delete in P0).

## Deferred (redirected from scope)
Chat↔profile↔night cross-links → E18/Phase 6. Computed profile stats (response rate/reviews) → after E17/Phase 6. `/plan/i/` dead link + legacy cleanup → Phase 7. Deleting `/home` → not P0.

## Re-scope recorded
`/account`→`/plan/i/` dead link moved OUT of P0/E2 → Phase 7 (live-verify C10 NOT_REPRO for the dating flow).
