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

**Granularity:** standard · **Coverage:** 22/22 v2.0 requirements mapped (10 AI-planner + 12 Launch Hardening, added 2026-06-13).

### Phases

- [x] **Phase 8: Compliant Any-City Venue Corpus** - Foursquare becomes the stored/LLM-fed corpus (Google demoted to display-only), cities pre-seed on profile-location-set, and proximity/hours guards fail loud on missing data. *(Prod cutover applied 2026-06-08. Known debt: cold-city quality floor writes 0 rows -> permanent city_warming; see pending todo.)*
- [x] **Phase 9: Trustworthy Generation + Eval Harness** - One-tap any-city generate + swap-a-stop/NL-tweak improve loop, vibe-matched ambient sound, proven by a deterministic + Opus-4.8-judge eval over a golden set that includes a cold city. *(Live on prod via the Phase-8 cutover deploys. SOUND-01 ambient audio still deferred on ELEVENLABS_API_KEY.)*
- [x] **Phase 10: Generation as the Primary Night Path** - Generating a date becomes THE way to create a night (publishes to the feed); the legacy manual `/create` funnel and orphaned `/plan`/catalog surfaces are retired or replaced.
- [ ] **Phase 11: Page-by-Page UX & Nav Audit + Remediation** - A browser-driven audit of every route against the design system + a nav/flow rubric, then prioritized remediation so no page is a trap and the whole app reads as one branded product.

#### Launch Hardening (added 2026-06-13, from the four-object lifecycle audit)

- [ ] **Phase 12: Account Deletion & Data Lifecycle** - A user can delete their account end-to-end (request → confirm → cascade/anonymize → cleanup of active commitments). The one true remaining launch gate after Persona (legal/GDPR).
- [ ] **Phase 13: Lifecycle Correctness** - Fix states that look live but are dead: cancelled-lock leaves a live chat, the safety flag is a silent no-op, standby candidates are invisible, the conflict cascade may not fire.
- [ ] **Phase 14: Lifecycle Wiring & UX** - Close reverse/terminal-edge dead-ends: cancelled-night re-post, dead-thread tombstones, matched→chat link, notification routing, photo-primary + draft delete.
- [ ] **Phase 15: Moderation & Safety Operations** *(post-launch — tracked, not launch-gating)* - Make the scaffolded-but-inert moderation half real: standing writers + admin actions + appeals, a report review queue with cleanup, working chat retention/purge.

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
- [x] 08-06-PLAN.md — phase gate: local suite/migrations/advisor green + key-gated live smoke + gated prod-apply (EXECUTED 2026-06-08 once FOURSQUARE_API_KEY landed; see 08-06-SUMMARY update)

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
- [x] 09-06-PLAN.md — phase gate: local-green suite + eval + visual-verify @420px + gated prod-apply (prod-bound steps shipped with the 2026-06-08 Phase-8 cutover deploy; SOUND-01 audio assets deferred on ELEVENLABS_API_KEY)
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
- [x] 10-01-PLAN.md — FLOW-01: make generation the primary path (+ tab/CTA → funnel) + demote the manual door (kept working) + verify no /places creation CTA
- [x] 10-02-PLAN.md — FLOW-01: city selector in the funnel → self-RLS primary_city_id write + fire-and-forget enqueueSeedCity (unblocks Phase-8 pre-seed) + prefill, never block on cold city
- [x] 10-03-PLAN.md — phase gate: OFFLINE FLOW-01 wiring spec (city→generate→improve→publish, mock generation) + local-green; @420px visual-verify DEFERRED to Phase 11's interactive route audit; no prod-bound DDL (ships on push)
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

### Phase 12: Account Deletion & Data Lifecycle
**Goal**: A user can delete their account end-to-end, and no active commitment is left dangling. (The one true launch gate remaining after Persona was verified live 2026-06-13.)
**Depends on**: Nothing (independent of the AI-planner track)
**Requirements**: ACCT-01
**Success Criteria** (what must be TRUE):
  1. A user can request account deletion from settings, confirm it, and the request is recorded — no raw-SQL-only path.
  2. The `deletion_process` job runs (an implemented RPC, not a missing one): it anonymizes/removes the profile, photos, and `profiles_private` PII, and cancels/cleans the user's active offers/locks/chats so a counterparty is never left locked to a deleted user.
  3. After deletion completes, the auth user is removed and the account cannot sign back in.
**Plans**: TBD

### Phase 13: Lifecycle Correctness
**Goal**: No object sits in a state that looks live but is actually dead, and the safety/cascade machinery actually fires.
**Depends on**: Nothing (operates on the existing match/chat machinery)
**Requirements**: LIFE-01, LIFE-02, LIFE-03, LIFE-04
**Success Criteria** (what must be TRUE):
  1. Cancelling a lock closes its chat thread: the cancelled date's conversation becomes read-only ("this chat is closed"), not a messageable "you're locked in" thread.
  2. The lock-page "something's wrong" control persists a real report (verifiable row), and a no-show can be flagged from the UI through the existing `flag_no_show` RPC.
  3. A standby candidate sees their standby nights in their queue surfaces and is notified when bumped to standby or when an offer rolls to them.
  4. Accepting an offer that conflicts with the user's or host's other nights actually triggers the autoclose/autowithdraw cascade through the job runner (proven on prod, fixed if the handler keying is wrong).
**Plans**: TBD

### Phase 14: Lifecycle Wiring & UX
**Goal**: The reverse and terminal edges of every object have a clear next action — no silent dead-ends.
**Depends on**: Phase 13 (shares the match/chat surfaces)
**Requirements**: WIRE-01, WIRE-02, WIRE-03, WIRE-04
**Success Criteria** (what must be TRUE):
  1. A cancelled night has a working re-post path (or the cancel copy no longer promises one), and a matched night links to its match/chat from `/my-nights`.
  2. A closed/revoked chat thread is tombstoned or removed from the inbox list, and the interested-list page does not show live offer controls on a matched/expired/cancelled night.
  3. The `offer_passed` host nudge deep-links to the host's interested list, and an expired unmatched night notifies its host.
  4. Reordering profile photos keeps the feed "main" photo equal to the gallery's first tile, and a draft itinerary can be deleted.
**Plans**: TBD

### Phase 15: Moderation & Safety Operations
**Goal**: The moderation half of the app — scaffolded-but-inert today — becomes real. *(Post-launch: tracked here for completeness, not a launch gate.)*
**Depends on**: Phase 13 (standing transitions touch the match machinery)
**Requirements**: MOD-01, MOD-02, MOD-03
**Success Criteria** (what must be TRUE):
  1. An admin can suspend / cooldown / ban / reinstate an account (real `standing`/`account_state` writers), a gated user sees their status and a recourse (appeal), and there is a path back to good standing.
  2. User reports (chat messages + profiles) reach an admin review queue with actionable outcomes, and a suspended/banned user's active offers/locks/chats are cleaned up rather than left dangling.
  3. Closed chat threads + their messages purge on a defined retention schedule (the `chat_purge` job is implemented and enqueued).
**Plans**: TBD

### Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 8. Compliant Any-City Venue Corpus | 5/6 | In progress | - |
| 9. Trustworthy Generation + Eval Harness | 4/6 | In progress | - |
| 10. Generation as the Primary Night Path | 1/3 | In progress | - |
| 11. Page-by-Page UX & Nav Audit + Remediation | 0/? | Not started | - |
| 12. Account Deletion & Data Lifecycle | 0/? | Not started | - |
| 13. Lifecycle Correctness | 0/? | Not started | - |
| 14. Lifecycle Wiring & UX | 0/? | Not started | - |
| 15. Moderation & Safety Operations (post-launch) | 0/? | Not started | - |

### Conventions (carried from v1.0)

- Every new RPC/migration: pin `search_path`, secure-by-default RLS (never `USING(true)` on update/delete), run the Supabase security advisor after every DDL.
- Gated prod-apply: local-green → advisor → batched prod apply against `ufufmcpnysvwtutpbian`; watch local-vs-prod drift.
- Foursquare API keys are server-side only (never `NEXT_PUBLIC_`, never edge-exposed as client content).
- Every UI change is visually verified (render → @420px screenshot → critique against the rubric) before "done"; user-facing copy gets the stop-slop treatment.
