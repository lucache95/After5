# Roadmap: After5 — Experience-First Dating Marketplace

## Overview

After5 is an existing, mostly-built Next.js 15 / Supabase dating marketplace
whose happy-path machinery (browse → swipe → interest → shortlist → offer →
accept → lock) is real and well-built, but which was built feature-first, not
experience-first — a collection of strong screens, not a complete marketplace.
The v1.0 milestone closed that gap by walking the 2026-06-03 MVP audit's P0→P3
E-queue (E1–E25) in order: make the loop never trap the user, complete the
marketplace, build the headline mechanic (progressive reveal + trust + safety),
then polish. Each E-item shipped as an independently-shippable vertical slice.

v2.0 revives the AI date-planner — the product's moat. The planner engine
already exists and is live on prod (`supabase/functions/generate-plan/`, a
constraint-first hybrid where code picks venues and Claude only writes copy).
v2.0 is **refactor, not replace**: make it legal (Foursquare replaces the
Google→LLM path that violates Google's 2026 Maps ToS), make it work in any city
(async per-city pre-seed + fail-loud guards), prove it's good (an eval harness
over a golden set that includes a cold on-the-fly city), and wire it as THE way
to create a dating night. A late page-by-page browser-driven UX/nav audit closes
the milestone by making the whole app read as one coherent branded product with
no navigation traps.

## Shipped Milestones

- **v1.0 — MVP (P0→P3, E1–E25)** — completed 2026-06-05. 7 phases, 39 plans,
  25/25 requirements. The full blind dating loop closes end-to-end and is proven
  on prod: browse (blind) → swipe → offer (plan-on-match) → lock → reveal
  ceremony → chat → date → rating → archive, with progressive reveal, trust &
  safety (reliability + safety check-ins), discoverability (targeting + filters +
  ranking), and venues-into-the-loop (maps + post-match `/places` + standby).
  Audit: **PASSED** (integration clean, blind contract intact).
  → Full detail: [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md) ·
  [`milestones/v1.0-REQUIREMENTS.md`](milestones/v1.0-REQUIREMENTS.md) ·
  [`v1.0-MILESTONE-AUDIT.md`](v1.0-MILESTONE-AUDIT.md)

---

## Milestone v2.0 — AI Date-Planner (revive + harden + make-compliant)

**Core value:** A user can generate a real, coherent multi-stop date for their
own city in one tap — from legally-sourced venues — then make it better with
simple tweaks, and publish it into the dating feed. The generated date is one a
real person actually wants to go on (proven by an eval harness), and its ambient
sound fits its cover.

**Granularity:** standard · **Coverage:** 10/10 v2.0 requirements mapped.

### Phases

- [ ] **Phase 8: Compliant Any-City Venue Corpus** - Foursquare becomes the stored/LLM-fed corpus (Google demoted to display-only), cities pre-seed on profile-location-set, and proximity/hours guards fail loud on missing data.
- [ ] **Phase 9: Trustworthy Generation + Eval Harness** - One-tap any-city generate + swap-a-stop/NL-tweak improve loop, vibe-matched ambient sound, proven by a deterministic + Opus-4.8-judge eval over a golden set that includes a cold city.
- [ ] **Phase 10: Generation as the Primary Night Path** - Generating a date becomes THE way to create a night (publishes to the feed); the legacy manual `/create` funnel and orphaned `/plan`/catalog surfaces are retired or replaced.
- [ ] **Phase 11: Page-by-Page UX & Nav Audit + Remediation** - A browser-driven audit of every route against the design system + a nav/flow rubric, then prioritized remediation so no page is a trap and the whole app reads as one branded product.

### Phase Details

### Phase 8: Compliant Any-City Venue Corpus
**Goal**: The `places` corpus is legally sourced from Foursquare and trustworthy in any city — generation can no longer silently pass on missing data.
**Depends on**: Nothing (foundation; first v2.0 phase)
**Requirements**: DATA-01, DATA-02, DATA-03
**Success Criteria** (what must be TRUE):
  1. Venues stored in `places` and fed to the planner come from Foursquare; the Google→LLM path is gone and Google appears only as a live display-only details/photo/map layer keyed by `google_place_id`.
  2. When a user sets their profile location, their city's venues ingest into `places` in the background, and a still-cold city shows a graceful "warming up" state instead of a broken or empty result.
  3. A generation attempt in a city with missing coordinates or hours fails loud (no silent pass) rather than producing a date that reads valid but isn't.
  4. A previously Google-warmed `places` row is no longer fed to the model (re-warmed from Foursquare or relabeled and excluded from the LLM input path).
**Plans**: 6 plans in 3 waves
- [x] 08-01-PLAN.md — DATA-01: foursquare.ts drop-in corpus source (mappers + pickHours + searchPlaces), TDD, fixture-mocked
- [x] 08-02-PLAN.md — DATA-03: fail-loud guards (withinRadius/isOpenAt) + unverified marker + unverified_rate
- [x] 08-03-PLAN.md — DATA-01/02: migration (source check + fsq_place_id full unique index + cities.seeded_at + google_legacy relabel) + SQL test
- [x] 08-04-PLAN.md — DATA-01/02: re-source cold-start to Foursquare + google_legacy pool exclusion + city_warming fallback
- [x] 08-05-PLAN.md — DATA-02: seed_city job type + handler + server-side dedup'd enqueue on profile-location-set
- [ ] 08-06-PLAN.md — phase gate: local suite/migrations/advisor green, then key-gated live smoke + gated prod-apply (blocked on FOURSQUARE_API_KEY)

### Phase 9: Trustworthy Generation + Eval Harness
**Goal**: A user can generate a coherent multi-stop date for their own city in one tap, improve it with simple tweaks, and get a vibe-matched soundtrack — and the harness proves the result is genuinely good, including in a cold on-the-fly city.
**Depends on**: Phase 8
**Requirements**: PLAN-01, PLAN-02, EVAL-01, SOUND-01
**Success Criteria** (what must be TRUE):
  1. A user generates a coherent multi-stop date for their city in one tap from real venues, with stops that are actually close together (real haversine proximity hop-gate, not a string label — corpus already filtered with JS haversine, no PostGIS dependency in the pick loop).
  2. A user can swap a single stop and apply natural-language tweaks ("cheaper", "more romantic", "later") and the itinerary stays coherent and persisted.
  3. A generated date auto-receives an ambient sound that fits its cover (sound ↔ cover cohere via shared vibe tags), drawn from an expanded track library.
  4. The eval harness scores generated dates with deterministic hard checks (proximity, hours-open-at-time, schedule monotonicity, budget sum, no hallucinated venues) plus an Opus-4.8 judge rubric, over a golden set that includes a cold on-the-fly city, surfacing `unverified_rate` per city, and gates in CI.
**Plans**: 6 plans
Plans:
- [x] 09-01-PLAN.md — PLAN-01: tool-use copy pass + haversine hop-gate (one-tap any-city generate)
- [x] 09-02-PLAN.md — SOUND-01: expanded ambient library + vibe-match auto-pick (verified via existing lateral)
- [x] 09-03-PLAN.md — EVAL-01: scheduleMonotonic gate + cold-city fixtures + unverified_rate threshold
- [x] 09-04-PLAN.md — EVAL-01: per-fixture JUDGE_CITY + live no-hallucination + baseline regen + CI gate
- [x] 09-05-PLAN.md — PLAN-02: single-stop swap + NL tweaks (coherence-preserving) + improve UI in /create
- [ ] 09-06-PLAN.md — phase gate: local-green suite + eval + visual-verify @420px + gated prod-apply
**UI hint**: yes

### Phase 10: Generation as the Primary Night Path
**Goal**: Generating a date is the primary, obvious way to create a night in the dating app, and it lands cleanly in the feed; the legacy manual planner surfaces no longer compete or trap.
**Depends on**: Phase 9
**Requirements**: FLOW-01
**Success Criteria** (what must be TRUE):
  1. From the create entry point, generating a date is the primary path, and a generated date publishes into the dating feed end-to-end.
  2. The legacy manual `/create` funnel and its orphaned `/plan`/catalog surfaces are retired or replaced — a user can no longer fall into a dead or competing creation funnel.
  3. The improve loop (swap a stop, NL tweaks) is reachable in the create flow before publish, so what lands in the feed is the refined date.
**Plans**: 3 plans in 2 waves
Plans:
- [ ] 10-01-PLAN.md — FLOW-01: make generation the primary path (+ tab/CTA → funnel) + demote the manual door (kept working) + verify no /places creation CTA
- [ ] 10-02-PLAN.md — FLOW-01: city selector in the funnel → self-RLS primary_city_id write + fire-and-forget enqueueSeedCity (unblocks Phase-8 pre-seed) + prefill, never block on cold city
- [ ] 10-03-PLAN.md — phase gate: e2e primary-path (city→generate→improve→publish) + @420px visual-verify, local-green (no prod-bound DDL)
**UI hint**: yes

### Phase 11: Page-by-Page UX & Nav Audit + Remediation
**Goal**: Every route in the running app has been audited against the brand and a nav/flow rubric, and the high-severity findings are fixed — no page is a navigation trap and the whole app reads as one coherent branded product.
**Depends on**: Phase 10 (so the audit covers the new generation/creation surfaces, not just the pre-existing app)
**Requirements**: UX-01, UX-02
**Success Criteria** (what must be TRUE):
  1. A severity-scored findings inventory exists, produced by navigating every route in the running app (Playwright/Chromium @420px screenshots) and checking each against DESIGN-SYSTEM.md + a navigation/flow rubric, covering the whole app surface including the new and retired creation surfaces.
  2. Every deep route has a working back/up affordance with correct back-stack semantics — no dead-ends or traps remain among the audited routes.
  3. Brand-consistency violations (off-token color/type/chrome) flagged as high-severity are remediated so pages read as one product; purely-cosmetic nits are explicitly deferred, not silently dropped.
**Plans**: TBD
**UI hint**: yes

### Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 8. Compliant Any-City Venue Corpus | 5/6 | In progress | - |
| 9. Trustworthy Generation + Eval Harness | 4/6 | In progress | - |
| 10. Generation as the Primary Night Path | 0/3 | In progress | - |
| 11. Page-by-Page UX & Nav Audit + Remediation | 0/? | Not started | - |

### Conventions (carried from v1.0)

- Every new RPC/migration: pin `search_path`, secure-by-default RLS (never `USING(true)` on update/delete), run the Supabase security advisor after every DDL.
- Gated prod-apply: local-green → advisor → batched prod apply against `ufufmcpnysvwtutpbian`; watch local-vs-prod drift.
- Foursquare API keys are server-side only (never `NEXT_PUBLIC_`, never edge-exposed as client content).
- Every UI change is visually verified (render → @420px screenshot → critique against the rubric) before "done"; user-facing copy gets the stop-slop treatment.
