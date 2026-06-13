---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: — AI Date-Planner
status: "v2.0 EXTENDED with Launch Hardening (phases 12-15, added 2026-06-13 from the four-object lifecycle audit). Phase 11 (UX audit) still open. Launch gates: Phase 12 account deletion (Persona blocker #1 RESOLVED 2026-06-13 — prod edge secrets set+verified live). Then Phase 13 correctness, 14 wiring, 15 moderation (post-launch). Carried debt outside phases: cold-city quality-floor (DATA-02 gap → city_warming; relates to Foursquare credits), SOUND-01 ambient audio (needs ELEVENLABS_API_KEY), Database types regen, scoring tune."
stopped_at: milestone roadmap extended (2026-06-13)
last_updated: "2026-06-13T00:00:00.000Z"
last_activity: 2026-06-13 -- Phase 12 (ACCT-01 account deletion) BUILT local-green (5 commits 171d685..3d5a1df, UNPUSHED) + acct02 salt-from-vault (new local migration + test fix, uncommitted unless committed since). PROD: migration acct01_account_deletion APPLIED (advisor clean: +1 INFO reputation_ledger RLS-no-policy [intentional] + 3 WARN auth'd SECURITY DEFINER RPCs [accepted pattern]; no new ERROR). SALT RESOLVED VIA API — switched from the superuser-only GUC (ALTER DATABASE → 42501) to Supabase Vault: secret 'reputation_salt' created (vault.create_secret, 64-hex) + acct02 migration repointed acct_identity_hash to vault.decrypted_secrets; verified live on prod (acct_identity_hash deterministic 64-hex, null/blank→null, fail-loud P5002 if secret missing). REMAINING (off critical path, both founder-gated): (1) `supabase functions deploy process-jobs --project-ref ufufmcpnysvwtutpbian` (manual — wires deletion_process handler; won't fire <7d after first request AND UI unpushed, so not urgent; do NOT piecemeal-deploy via MCP — live cron); (2) push the commits to make delete-account UI live. Phases 13-15 queued. Resume: /gsd:autonomous --from 13.
progress:
  total_phases: 8
  completed_phases: 3
  total_plans: 15
  completed_plans: 15
  percent: 38
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-03) · .planning/ROADMAP.md (v2.0 phases 8–11) · .planning/REQUIREMENTS.md (10 v2.0 reqs)

**Core value (v2.0):** A user can generate a real, coherent multi-stop date for their own city in one tap — from legally-sourced (Foursquare) venues — make it better with simple tweaks, and publish it into the dating feed. The generated date is provably good (eval harness incl. a cold city) and its ambient sound fits its cover.
**Current focus:** Phase 11 — page-by-page UX & nav audit + remediation (pass 1 of the audit done: 17/60 routes, F1/F2 fixed; next: remaining ~43 routes + remediation, then `/gsd:audit-milestone`)

## Current Position

Phase: 11 — Page-by-Page UX & Nav Audit + Remediation (AUDIT DONE 59/60 routes + HIGHs/MEDIUMs remediated; remaining = P2-F13 user decision + small backlog, then milestone audit)
Plan: no formal PLANs yet — pass 1 of the UX-01 audit ran ad-hoc (scripted-Playwright collector, 17/60 routes @420px, evidence in phases/11-.../__audit__/): F1 /places/[slug] nav trap FIXED (PlaceBackButton), F2 /create/generate disabled-CTA contrast FIXED, F3 missing-h1 deferred. Remaining: ~43 routes (admin/legal/marketing/secondary) via the same collector (re-run with SERVICE_ROLE_KEY exported), then prioritized remediation. Known UX items already queued for remediation: save+publish twin stacked primaries on /plans/[id]/edit; the "first 100 members" banner off-voice on dating surfaces; residual legacy-Fraunces serif spots.
Status: Phase 11 is the last open v2.0 phase. Carried debt outside it: cold-city quality-floor fix (DATA-02 gap — passesQualityFloor rating>=7.0 writes 0 rows on sparse-rating cold cities -> permanent city_warming), SOUND-01 ambient audio (needs ELEVENLABS_API_KEY), Database types regen (seed_city enum + fsq cols), post-activation scoring tune (a "romantic" request returned climb+escape-room; run the EVAL-01 harness against the 184-venue pool).
Last activity: 2026-06-09 -- merged + pushed the canvas convergence; reconciled state.

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
| 10 | 3 | ~24m | ~8m |
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

Last session: 2026-06-12T00:10:26.439Z
Stopped at: context exhaustion at 75% (2026-06-12)
Resume file: None
