# Decisions Intel

> Synthesized 2026-06-03 by gsd-doc-synthesizer from the 4-doc ingest set.
> No ADR-typed docs were ingested, so there are no formal locked ADRs. The
> decisions below are extracted from the "Locked decisions" block of the
> date-settings SPEC (owner-approved in brainstorm) and the orchestrator's
> authoritative corrections. They are treated as binding design decisions but
> are NOT formal LOCKED ADRs — none can hard-block another. Precedence applies
> normally (SPEC > PRD > DOC, with LIVE-NAV-VERIFY at precedence 0 overriding
> on the specific prod-vs-local points it covers).

---

## D1 — Per-date targeting is the source of truth
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md (SPEC, owner-approved)
- status: approved (not formally locked-ADR)
- decision: Each date carries its own target (gender, age, logistics). Profile prefs (`gender`, `gender_preferences`, `age_pref`) become defaults that pre-fill the per-date form; they stop being the matching gate.
- scope: matching model, data model (date_instances targeting columns)

## D2 — Searcher-filters-only feed
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md (SPEC)
- status: approved
- decision: A date's target never hard-hides it from the feed. The target is (a) a card label, (b) the host's interested-list curation tool, (c) a soft-boost signal. The searcher's own filters gate/sort the feed.
- scope: feed query (browse_feed_for_viewer), discovery

## D3 — Hybrid filter strictness
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md (SPEC)
- status: approved
- decision: Hard filters (HIDE) = host gender, max price, max distance. Soft filters (SORT, never hide) = vibe, who-pays, time-of-day. Principle: "filters remove dealbreakers, then get out of the way."
- scope: filter semantics, browse_feed_for_viewer WHERE vs ORDER BY

## D4 — Tiered placement of creator controls
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md (SPEC)
- status: approved
- decision: `/create` (anon free-try funnel) gains only radius + who-pays on top of vibe/budget/time/city. The full set (target gender/age, exact schedule, the why) lives in the in-app host post/customize flow.
- scope: creator UX (E11), /create vs in-app post

## D5 — Date-customization canvas paradigm (itinerary canvas, option A)
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §2A (SPEC, owner decision 2026-06-03)
- status: approved
- decision: After AI generates a night, the host customizes it on a mobile-native "itinerary canvas" (option A) over swipe-stack (B) / studio-rail (C). Reuses M3 `ItineraryEditor`/`EditableStopCard`; the only NEW build is per-stop regenerate/swap (additive single-slot `generate-plan` capability, gated edge change).
- scope: creator UX (E11), canvas, generate-plan edge

## D6 — API-first / mobile-fast architecture (load-bearing constraint)
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §6 (SPEC)
- status: approved
- decision: All business-critical logic in Postgres RPC + edge functions (nothing business-critical in React server components). Lean blind-safe payloads, cursor (keyset) pagination, indexed hard filters (GIST/btree/GIN) sub-100ms, server-side filter state (`feed_filters` jsonb), CDN-sized images. The native app must reuse the same backend with no rework.
- scope: cross-cutting architecture; see constraints.md CON-* for the testable form

## D7 — Roadmap sequenced by the audit's P0→P3 E-queue (E1–E25)
- source: .planning/PROJECT.md Key Decisions; docs/superpowers/reports/2026-06-03-MVP-AUDIT.md Section E
- status: authoritative (existing PROJECT.md)
- decision: The roadmap is the audit's already-ordered P0→P3 E-queue, not re-derived from scratch. Each item is independently shippable with deps noted. Re-prioritizing risks re-queuing shipped work.
- scope: roadmap structure (downstream roadmapper consumes requirements.md ordering)

## D8 — Door 2 + create_blank_itinerary + typed-city are LIVE ON PROD (re-check, do not rebuild)
- source: orchestrator authoritative correction #1; .planning/PROJECT.md Key Decisions
- status: authoritative correction — OVERRIDES LIVE-NAV-VERIFY C12/D2 and the anon /create typed-city finding
- decision: `create_blank_itinerary` (migration 20260603120100) + the generate-plan edge were applied/deployed to PROD. The live-verify "Door 2 hard dead-end" (C12/D2) and "anon /create ignores typed city" findings are LOCAL-ONLY artifacts. On prod these WORK and must be RE-CHECKED against prod, NOT rebuilt.
- scope: E11 sequencing, Door 2, CreateFlow
- rationale: LIVE-NAV-VERIFY ran against the LOCAL stack where 20260603120100 was unapplied; prod state differs. See INGEST-CONFLICTS.md auto-resolved.

## D9 — Genuinely-missing marketplace RPCs (absent on prod too)
- source: orchestrator correction #2; LIVE-NAV-VERIFY new-issue #4; MVP-AUDIT B#11/13/12
- status: authoritative
- decision: `reject_candidate`, `update_night`, `cancel_night` are absent on prod as well as local — these are real build work (E12/E7/E6). (`create_blank_itinerary` is NOT in this list — see D8.)
- scope: E6, E7, E12

## D10 — Already shipped & live this cycle — do NOT queue as work
- source: orchestrator correction #3; .planning/PROJECT.md Validated; MVP-AUDIT Synthesis notes
- status: authoritative
- decision: Shipped/live this cycle (do not re-queue): brand sweep, image pipeline, unified inbox + nav, create chooser, the 4 mobile-UX redesigns, audio + ownership fixes, SEO assets, open-city. The feed "dark title / missing tags / poor audio" issues are genuinely FIXED.
- scope: out-of-scope guard for the roadmapper

## D11 — Gated/parked work stays gated (not active blockers)
- source: orchestrator correction #4; .planning/PROJECT.md Key Decisions
- status: authoritative
- decision: Keep gated, not active: inbox notification-type DISPATCH wiring (interest_received/identity_revealed enums applied, dispatch sites not wired); #77 real venue photos; #78 per-vibe ambient loops; #86 cover-consistency. Parked: native mobile apps.
- scope: E8/E16 dispatch wiring is in-scope work; the enum migrations are already applied

## D12 — ISSUE #15 / E3 is cheap (nav-repoint, not a rebuild)
- source: orchestrator correction #5; LIVE-NAV-VERIFY new-issue #3; MVP-AUDIT E3 + corrections
- status: authoritative
- decision: `/account` is already a real, well-built host hub — just nav-orphaned. E3 = repoint the profile tab + add a profile view, NOT a from-scratch build.
- scope: E3

## D13 — Distance origin: city-centroid v1, geolocation fast-follow
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §5 (SPEC, open question resolved for v1)
- status: approved (v1)
- decision: Distance filtering uses the searcher's city centroid for v1 (coarse, no permission prompt). Precise browser/native geolocation is a fast-follow behind a permission prompt.
- scope: E10 distance filter, E23 proximity
