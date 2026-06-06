---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: AI Date-Planner
status: executing
stopped_at: Completed 10-02-PLAN.md (FLOW-01 part 2/3: city selection wired into the generate funnel — a curated chip tap by a signed-in user POSTs /api/profile/city, which validates the cityId as an active curated city then writes profiles.primary_city_id under self-update RLS [.eq id=auth.uid(), profiles_owner_all; no admin client] and fires enqueueSeedCity(cityId) fire-and-forget, unblocking the deferred Phase-8 background pre-seed; KnownCity gained id; the saved city prefills + re-posts on change; free-text + cold/unseeded city fall through 08-04 and never block generation; NO new migration). Next plan 10-03 (FLOW-01 e2e + visual gate).
last_updated: "2026-06-06T03:13:00.000Z"
last_activity: 2026-06-05 -- Phase 10 Plan 02 executed (TDD: thin RLS server route POST /api/profile/city does the self-scoped primary_city_id write + fire-and-forget enqueueSeedCity; funnel curated picks carry cities.id, post for authed users, prefill the saved city, and never block generation on a cold city. 10/10 new tests green [5 route + 5 funnel], app/create suite 17/17, web tsc clean. No deviations, no migration.)
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 9
  completed_plans: 8
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-03) · .planning/ROADMAP.md (v2.0 phases 8–11) · .planning/REQUIREMENTS.md (10 v2.0 reqs)

**Core value (v2.0):** A user can generate a real, coherent multi-stop date for their own city in one tap — from legally-sourced (Foursquare) venues — make it better with simple tweaks, and publish it into the dating feed. The generated date is provably good (eval harness incl. a cold city) and its ambient sound fits its cover.
**Current focus:** Phase 08 — compliant-any-city-venue-corpus (next: `/gsd:plan-phase 8`)

## Current Position

Phase: 10 — Generation as the Primary Night Path (in progress)
Plan: 02 complete (FLOW-01 part 2/3: city selection + the deferred Phase-8 pre-seed wiring. NEW thin RLS server route POST /api/profile/city — zod-uuid validates cityId, verifies it is an active curated city, writes profiles.primary_city_id under profiles_owner_all self-RLS [.eq id=user.id, NO admin client], then fires enqueueSeedCity(cityId) fire-and-forget [logged .catch, not awaited into the response] so a slow/failing queue still returns 200; 401 anon / 400 bad-or-unknown city never write or enqueue. KnownCity widened to carry cities.id [additive; the anon /create select widened to id,slug,name so its `as KnownCity[]` cast still compiles]. generate/page.tsx selects id,slug,name + reads the authed profile's primary_city_id + joined city name [profiles_primary_city_id_fkey], passing prefillCityId/prefillCityName to CreateFlow. In CreateFlow a curated chip tap seeds the city text always and — for a signed-in user only — POSTs {cityId} fire-and-forget [failure → quiet sonner notice, never disables the "make my date" CTA]; the saved city prefills as selected; free-text non-curated cities leave primary_city_id untouched and still generate; a cold/unseeded curated city falls through 08-04 and never blocks. NO migration [profiles_owner_all self-update suffices; advisor unaffected]. TDD: route RED 6868ae9 → GREEN 0dd893e [5/5]; funnel RED 05d48c7 → GREEN 0f10ee3 [5/5]; app/create suite 17/17, web tsc clean) — next: 10-03 (FLOW-01 e2e + visual gate)
Status: Executing
Last activity: 2026-06-05 -- Phase 10 Plan 02 executed (the curated-city pick now writes the user's home city under self-RLS and warms it via enqueueSeedCity; saved city prefills + re-posts; cold city never blocks generation. FLOW-01 stays open until 10-03 lands the e2e/visual gate)

## v2.0 Roadmap (phases 8–11)

| Phase | Goal | Requirements |
|-------|------|--------------|
| 8 — Compliant Any-City Venue Corpus | Foursquare = stored/LLM-fed corpus (Google display-only); per-city async pre-seed; fail-loud proximity/hours guards | DATA-01, DATA-02, DATA-03 |
| 9 — Trustworthy Generation + Eval Harness | One-tap any-city generate + swap/NL-tweak improve loop + vibe-matched sound, proven by deterministic + Opus-4.8-judge eval over a golden set incl. a cold city | PLAN-01, PLAN-02, EVAL-01, SOUND-01 |
| 10 — Generation as the Primary Night Path | Generation is THE way to create a night (publishes to feed); legacy `/create`/`/plan`/catalog retired | FLOW-01 |
| 11 — Page-by-Page UX & Nav Audit + Remediation | Browser-driven audit of every route + prioritized remediation; no traps, one branded product | UX-01, UX-02 |

**Dependency spine:** 8 (corpus + guards = foundation, also the compliance unblocker) → 9 (generation + its eval, paired) → 10 (wire as primary, retire legacy) → 11 (audit runs last so it covers the new creation surfaces too).

## Performance Metrics

**Velocity:**

- Total plans completed: 10
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
| Phase 07 P03 | 12 | 2 tasks | 2 files |
| Phase 07 P08 | 12 | 2 tasks | 3 files |
| Phase 07 P04 | 12 | 3 tasks | 4 files |
| Phase 07 P07 | 8 | 3 tasks | 6 files |
| Phase 07 P05 | 12 | 3 tasks | 2 files |
| Phase 07 P06 | 12 | 3 tasks | 3 files |
| Phase 08 P01 | ~3 | 3 tasks | 3 files |
| Phase 08 P04 | ~5 | 3 tasks | 7 files |
| Phase 09 P02 | ~4 | 2 tasks | 3 files |
| Phase 09 P03 | ~20 | 2 tasks | 8 files |
| Phase 09 P04 | ~25 | 2 tasks | 10 files |
| Phase 10 P02 | ~2 | 2 tasks | 7 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table (+ `.planning/intel/decisions.md` D1–D13).

**v2.0 (from 2026-06-05 research — see SUMMARY.md / VENUE-DATA.md / GENERATION.md):**

- Verdict: **refactor, do not replace.** The generate-plan engine is a mature constraint-first hybrid (code picks venues, Claude only writes copy) live on prod (edge fn v46). ~half of v2.0 = hardening + compliance, not net-new.
- Venue model is two-layer: **Foursquare = canonical stored + LLM-fed `places` corpus** (the one license that permits fetch + store-forever + LLM-input + display; build on the NEW Places API, legacy V3 deprecates 2026-05-15); **Google demoted to live display-only** keyed by `google_place_id` (never persisted as content, never fed to model). Reject scraping; OSM/Overpass only as a free lat/lng+category backfill for thin cities.
- Schema impact small: add `fsq_place_id` (+ optional `google_place_id`), extend a `source` column, swap the fetcher. The trigger model (async pre-seed on profile-location-set + cold-start fallback at generation) stays intact. Cleanup debt: Google-warmed `places` rows must be re-warmed from Foursquare or relabeled + pulled out of the LLM input path.
- **BIGGEST RISK — silent quality collapse on cold cities:** the deterministic guards PASS on null input (`withinRadius` true on null coords, `isOpenAt` true on null hours). Curated Kelowna is hand-filled; Foursquare-warmed cold cities arrive partial → guards quietly no-op exactly where the corpus is weakest, and a Kelowna-only eval reads green. Mitigations are requirements: guards FAIL LOUD on missing data (DATA-03); the eval golden set MUST include a cold on-the-fly city + surface `unverified_rate` per city (EVAL-01).
- Generation hardening (Phase 9): replace `drive_cluster` string-label with PostGIS + haversine drive-time hop-gate; migrate copy pass from raw-JSON parsing to Anthropic tool-use; improve loop = single-stop re-pick + NL-tweak intent parsing → scoring knobs → re-run pipeline, persisted via existing `update_itinerary_stops` RPC.
- Model split: Sonnet 4.6 generate (~1¢, 2–4s) · Haiku 4.5 improve loop (<$0.001, <1s) · Opus 4.8 offline judge only.
- Cost is a non-issue (<$200/mo every option) — venue sourcing is purely a licensing decision.

- DATA-01/08-01: `foursquare.ts` mirrors `google-places.ts` key-for-key (drop-in); new-API auth (Bearer + `X-Places-Api-Version: 2025-06-17`), `searchPlaces` takes injectable `fetchImpl` (key-free request-shape tests); rating un-doubled (FSQ 0–10, floor ≥7.0); `pickHours` parses `hours.regular` HHMM per-day (Wed else first, malformed→null); rows carry `fsq_place_id` + `source:'foursquare'` + `approval_status:'auto'`. CROSS-PLAN: 08-04 read-path must admit `'auto'` on EVERY generation or seeded rows read cold.

*(v1.0 phase decisions E15–E25 retained below for continuity reference.)*

- E13/03-04 PlanTimeline = StopRow+StopTime extracted VERBATIM from feed/NightDetailSheet; accepts ALREADY-NORMALIZED NightDetailStop[]; blind-safe (name-query map link, NO /places/[slug] StopCard).
- E15/05-01: signBlurredUrls no-reveal-gate; browse_feed +3 host cols; rung-1 only (offer tier 05-02).
- E16/05-03: identity_revealed dispatched at match_accept_offer AND match_resolve_reciprocal to both parties; in-app row always written, prefs gate push/email; RevealModal ceremony gated on ?just=1; reduced-motion = immediate clear.
- E17/06-01: reliability_score = weighted % from match_ratings + no_show locks, recomputed on close_rating_window; SOFT (writes score only, NO enforcement); NULL until ≥3 dates → "new here" badge.
- E18/06-02: chat→profile + chat→night reveal-gated on chat_threads.lock_id; pre-lock thread renders NEITHER control (no identity leak).
- E19/06-04: both lock RPCs enqueue day_of_reconfirm + safety_checkin beside rating_window; SOFT notify-only, no enforcement.
- E20–E25/Phase 07: get_night_detail merges per-stop lat/lng/place_slug inside the DEFINER RPC; browse_feed +city_name + finer distance + tuned soft-score; RouteMap coords-only (no identity); /my-nights upcoming/archive segment toggle in memory; DetailSkeleton on null detail.

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

- Investigate the possible lost-swipe race in the detail-sheet "i'm in" path (live-verify new-issue #2 — not yet an E-item).
- Residual legacy-Fraunces serif spots on `/create`, `/login`, `/about`, `/tell-us` — likely folds into the UX-02 remediation (Phase 11).
- WR-04 cancelled-lock reveal (carried from v1.0 Phase 5) — deferred to v2.1+.

### Blockers/Concerns

[Issues that affect future work]

- All schema work is gated prod-apply: local-green → security advisor after DDL → batched prod apply against `ufufmcpnysvwtutpbian`. Watch local-vs-prod drift. New RPCs/migrations pin `search_path` + secure-by-default RLS.
- Foursquare API keys are server-side only (never `NEXT_PUBLIC_`, never edge-exposed as client content).
- Phase 8 must verify the LIVE prod state of generate-plan + `places` schema + `GOOGLE_PLACES_API_KEY` usage before refactoring — the SUMMARY describes the engine but prod is the source of truth.
- Confirm the Foursquare new Places API free-tier transition (legacy V3 deprecates 2026-05-15) before building DATA-01 on it.

## Deferred Items

Items acknowledged and carried forward:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Reveal | WR-04 cancelled-lock reveal | Deferred to v2.1+ | v1.0 Phase 5 |
| Chat polish | E25 typing indicators / read receipts / draft-state | Deferred to v2.1+ | v1.0 close |
| Marketplace | business-ownership/claim model | Deferred to v2.1+ | v1.0 close |

## Session Continuity

Last session: 2026-06-05 — Phase 10 Plan 02 executed: FLOW-01 part 2/3. The generate funnel now has a city selector — a curated chip tap by a signed-in user POSTs the new thin RLS route /api/profile/city, which validates the cityId as an active curated city, writes profiles.primary_city_id under profiles_owner_all self-update RLS (no admin client), then fires enqueueSeedCity(cityId) fire-and-forget (logged .catch, not awaited) so a queue hiccup still returns 200 — this is the only caller the deferred Phase-8 pre-seed was missing. KnownCity gained cities.id (additive; anon /create select widened to keep its cast compiling); the saved city prefills via the FK join + re-posts on change; free-text and cold/unseeded curated cities never block generation (08-04 fallthrough). NO migration. TDD both tasks (route 6868ae9→0dd893e, funnel 05d48c7→0f10ee3); 10/10 new + app/create 17/17 + web tsc clean. No deviations.
Stopped at: Completed 10-02-PLAN.md; next plan 10-03 in Phase 10 (FLOW-01 e2e + visual gate).
Resume file: None
