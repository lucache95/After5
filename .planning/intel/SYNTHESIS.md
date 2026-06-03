# Ingest Synthesis — 2026-06-03

> Single entry point for `gsd-roadmapper`. Produced by gsd-doc-synthesizer over
> the 4-doc ingest set (MODE: merge). PROJECT.md is hand-authored and
> authoritative — this intel BACKS its Validated/Active/Out-of-Scope structure,
> it does not contradict it.

## Doc counts by type
- Total ingested: 4
- SPEC: 2 — `docs/superpowers/reports/2026-06-03-MVP-AUDIT.md` (precedence 1), `docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md` (precedence 1)
- PRD: 1 — `.planning/inbox/2026-06-03-chatgpt-mvp-reconciliation-audit.md` (precedence 2; audit brief / vision + ISSUE #15)
- DOC: 1 — `docs/superpowers/reports/2026-06-03-LIVE-NAV-VERIFY.md` (precedence 0, overrides on walked points)
- ADR: 0

## Cycle detection
Ran clean. Only doc-to-doc cross-ref among the ingest set is LIVE-NAV-VERIFY → MVP-AUDIT (single edge, no cycle). All other cross_refs point at code paths/migrations, not ingest docs. Traversal depth 1 (well under the 50 cap).

## Decisions (intel/decisions.md)
- 13 binding design decisions extracted (D1–D13). NONE are formal LOCKED ADRs — no ADR-typed docs were ingested, so nothing can hard-block.
- 6 from the date-settings SPEC "Locked decisions" block (owner-approved 2026-06-03): per-date targeting source of truth, searcher-filters-only feed, hybrid filter strictness, tiered creator-control placement, itinerary-canvas paradigm (option A), API-first/mobile-fast architecture.
- 6 authoritative orchestrator/PROJECT.md corrections: roadmap = P0→P3 E-queue; Door 2 + typed-city LIVE ON PROD (re-check, don't rebuild); genuinely-missing RPCs are reject/update/cancel only; already-shipped-this-cycle do-not-queue list; gated/parked items; ISSUE #15/E3 is cheap (nav-repoint).
- 1 v1 resolution: distance origin = city-centroid, geolocation fast-follow.

## Requirements (intel/requirements.md)
- 25 requirements (REQ-* mapped 1:1 to MVP-AUDIT E1–E25), P0→P3 ordering and per-item deps PRESERVED per the scope note.
- P0 (9): E1 universal-nav-chrome, E2 bottom-nav-semantics, E3 profile-hub (ISSUE #15), E4 editable-dating-preferences, E5 lock-completed-transition, E6 host-cancel-night, E7 host-edit-night, E8 interest-received-notification, E9 remove-poison-loop.
- P1 (5): E10 feed-filters, E11 creator-controls, E12 host-reject-candidate, E13 plan-on-match-and-offer, E14 offer-delivery-reliability.
- P2 (5): E15 progressive-reveal-ladder, E16 identity-revealed-moment, E17 ratings-reliability-aggregation, E18 chat-profile-night-wiring, E19 safety-flows.
- P3 (6): E20 real-map-route, E21 venues-into-loop, E22 relevance-ranking, E23 city-label-proximity, E24 standby-waitlist-ui, E25 feed-detail-polish-and-misc.
- date-settings SPEC backs E10 (filters) + E11 (creator controls) with concrete api-contracts.
- MVP-AUDIT Section F (delete/decouple) folded into the relevant E-items, with one re-scope: C10 `/plan/i/` dead link moved OUT of E2 INTO legacy-planner cleanup (live-verify NOT_REPRO).

## Constraints (intel/constraints.md)
- 16 constraints. Type breakdown: api-contract 5 (post_night signature, update_itinerary_stops setters, browse_feed contract, reach_preview RPC, per-stop regenerate edge); schema 2 (date_instances targeting columns, profiles.feed_filters jsonb); protocol 5 (blind contract, distance origin, secure-by-default RLS, gated prod-apply, integrations, design-system+visual-verify); nfr 4 (indexes sub-100ms, API-first/mobile, tech stack, testing matrix). (One protocol entry doubles as the design-system/visual-verify gate.)

## Context (intel/context.md)
- 13 topic notes: product thesis; live-verify method + caveats; UNREACHED-as-assertions; the 6 new live issues; top-3 critical gaps; what already works (Section A); resolved contradictions; ISSUE #15 expected contents; 12 audit categories; date-settings north star + upgrades; date-settings phasing + CreateFlow fleet-overlap hazard; out-of-scope guardrails.
- One open investigation flagged (not yet an E-item): the possible lost-swipe race in the detail-sheet "i'm in" path (live-verify new-issue #2).

## Conflicts (see .planning/INGEST-CONFLICTS.md)
- BLOCKERS: 0
- WARNINGS (competing-variants): 1 — Door 2 prod-vs-local (live-verify "hard dead-end" on LOCAL vs orchestrator "live on prod"); rebuild-stakes, so surfaced for user eyes. Resolution: re-check prod, do NOT rebuild.
- INFO (auto-resolved): 4 — DOC precedence-0 override of MVP-AUDIT on walked points; missing-RPC reconciliation (4→3 on prod); C10 NOT_REPRO re-scope; brand-serif residuals vs shipped sweep.

## Pointers
- Detail report: `.planning/INGEST-CONFLICTS.md`
- Per-type intel: `.planning/intel/decisions.md`, `requirements.md`, `constraints.md`, `context.md`
- Authoritative existing context (do not contradict): `.planning/PROJECT.md`; codebase map under `.planning/codebase/`

## Status
READY with one WARNING. No blockers gate the workflow. The single WARNING (Door 2
prod-vs-local) needs a prod re-check before E11 build but does not block routing —
its resolution is already recorded (re-check, do not rebuild) per the orchestrator's
authoritative correction.
