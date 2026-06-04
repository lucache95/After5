# Roadmap: After5 — Experience-First Dating Marketplace

## Overview

After5 is an existing, mostly-built Next.js 15 / Supabase dating marketplace
whose happy-path machinery (browse → swipe → interest → shortlist → offer →
accept → lock) is real and well-built, but which was built feature-first, not
experience-first — a collection of strong screens, not a complete marketplace.
This roadmap closes that gap by walking the 2026-06-03 MVP audit's P0→P3 E-queue
in order: first make the loop never trap the user (navigation spine + profile +
loop-closure + host controls), then complete the marketplace (filters, creator
tools, host triage, plan-on-match), then build the headline mechanic
(progressive reveal + trust + safety), then polish. Each E-item is an
independently-shippable vertical slice; phases follow the audit banding and are
never reordered across P-bands.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Navigation & Profile Spine (P0)** - Never-trap nav chrome, correct tab semantics, real profile hub, editable preferences
- [x] **Phase 2: Loop Closure & Host Controls (P0)** - Lock-completed + sweep, cancel/edit night, interest notification, poison-loop cleanup
- [x] **Phase 3: Marketplace Completeness (P1)** - Creator controls, host reject, plan-on-match/offer, offer delivery (completed 2026-06-04)
- [x] **Phase 4: Discoverability — Feed Filters & Targeting (P1)** - Per-date targeting + searcher filters + soft-boost feed (completed 2026-06-04)
- [ ] **Phase 5: Progressive Reveal (P2)** - The "swipe on the date, not the face" ladder + reveal ceremony
- [ ] **Phase 6: Trust & Safety (P2)** - Reliability aggregation, chat↔profile↔night wiring, safety check-ins
- [ ] **Phase 7: Enhancements & Polish (P3)** - Map/route, venues-into-loop, ranking, proximity, standby UI, polish + legacy cleanup

## Phase Details

### Phase 1: Navigation & Profile Spine (P0)

**Goal**: Every deep route has a way back and the profile tab lands on a real, editable profile — the user is never trapped and can manage their dating identity.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: REQ-E1, REQ-E2, REQ-E3, REQ-E4
**Success Criteria** (what must be TRUE):

  1. From any deep route (`/matches/[lockId]`, `/offers/[offerId]`, an inbox thread, the interested list, notifications, the rate screen) and any guard/error terminal, the user can navigate back and reach bottom nav — no link-less dead-ends.
  2. The "profile" tab lands on a real profile hub, and the "dates" tab reaches the user's matched dates (`/matches`), not `/my-nights`.
  3. The profile hub shows the user's identity, dating profile, stats, an "as others see it" self-view, and links to edit/preferences/notifications — with no marketing/onboarding teaser content.
  4. A logged-in user can edit age range, distance, gender, dealbreakers, and toggle dating on/off from the profile hub after signup.

**Plans**: 4 plans
Plans:

- [ ] 01-01-PLAN.md — Fix bottom-nav semantics: dates tab to /matches, profile tab to /account (+ Wave-0 reconcile gate) (REQ-E2)
- [x] 01-02-PLAN.md — DeepRouteHeader primitive + mount on 6 deep routes + every guard/error terminal (REQ-E1)
- [x] 01-03-PLAN.md — Editable /account/preferences via extracted mode-aware PreferencesForm + relocated dating on/off (REQ-E4)
- [x] 01-04-PLAN.md — Enhance /account into an identity-forward profile hub with ProfileCard self-view (REQ-E3)

**UI hint**: yes

### Phase 2: Loop Closure & Host Controls (P0)

**Goal**: A successful date reaches a terminal `completed` state, stale nights expire, the job queue is safe, and a host can correct or take down a night and learn when someone is interested.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: REQ-E5, REQ-E6, REQ-E7, REQ-E8, REQ-E9
**Success Criteria** (what must be TRUE):

  1. A past-dated lock transitions active→completed and a past-dated `seeking` night is swept to completed/expired — the loop terminates instead of living forever as `active`.
  2. A host can cancel/unpublish a `seeking` night they created before any match.
  3. A host can edit a posted night's time, venue, duration, and ambient sound.
  4. A right-swipe dispatches an `interest_received` notification to the host, deep-linked to that night's interested list.
  5. No enqueueable job handler references a missing RPC; the job queue cannot poison-loop (sequenced before E5 schedules new jobs).

**Plans**: 6 plans
Plans:

- [x] 02-01-PLAN.md — Remove the 6 dead job handlers + lockstep test prune (poison-loop cleanup, sequenced first) (REQ-E9)
- [x] 02-02-PLAN.md — Additive enum migration (date_match_status 'expired' + notification_type night_cancelled/night_changed) + local apply gate (REQ-E5, REQ-E6, REQ-E7)
- [x] 02-03-PLAN.md — E5 loop terminus: sweep_loop_terminus + flag_no_show RPCs + close-loop cron route (REQ-E5)
- [x] 02-04-PLAN.md — E6/E7 cancel_night + update_night DEFINER RPCs with candidate notifications (REQ-E6, REQ-E7)
- [x] 02-05-PLAN.md — E8 interest_received dispatch from match_ingest_interest + notif-map deep-link/meta (REQ-E8)
- [x] 02-06-PLAN.md — Host cancel/edit UI on /my-nights + api-client wrappers (REQ-E6, REQ-E7) — code+RTL+typecheck green; live visual-verify pending orchestrator forced-local pass

**UI hint**: yes

### Phase 3: Marketplace Completeness (P1)

**Goal**: The creator and host surfaces are complete — a host can fully configure and publish a night, triage candidates, and every match/offer screen shows the actual plan, delivered reliably.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: REQ-E11, REQ-E12, REQ-E13, REQ-E14
**Success Criteria** (what must be TRUE):

  1. The in-app post/customize flow exposes who-pays, vibe tags, the why, per-night radius, exact schedule, target gender/age, and a working cover-image upload; the Door-2 canvas has a publish CTA and per-stop regenerate proposes one new venue leaving the rest unchanged; a reach preview shows "~N people match this in <city>".
  2. A host can reject/dismiss a candidate, and the interested list shows offer outcomes (accepted/passed/expired) plus a withdraw control.
  3. Both `/matches/[lockId]` and `/offers/[offerId]` render the matched night's stops/venues — "every match has a real plan attached" holds at the payoff moment.
  4. Every sent offer reaches the candidate via a reliable server-runtime email and/or a guaranteed in-app notification.

**Plans**: 7 plans
Plans:

- [x] 03-01-PLAN.md — Foundation migrations: targeting cols + passed_by_host enum + extend post_night/update_itinerary_stops (LOCAL apply gate) (REQ-E11, REQ-E12)
- [x] 03-02-PLAN.md — reject_candidate DEFINER RPC (silent decline) + edge fn + client wrapper (REQ-E12)
- [x] 03-03-PLAN.md — E11 creator controls: PostNightForm fields + cover uploader + Door-2 publish CTA (REQ-E11)
- [x] 03-04-PLAN.md — Extract shared PlanTimeline from NightDetailSheet (REQ-E13)
- [x] 03-05-PLAN.md — Render the plan on OfferDetail + LockDetail via RLS read; drop host.bio (REQ-E13)
- [x] 03-06-PLAN.md — E14 offer-delivery audit + deep-link guarantee + RESEND verify (REQ-E14)
- [x] 03-07-PLAN.md — E12 InterestedList decline + withdraw + outcome pills (REQ-E12)

**UI hint**: yes
**Verify-note**: Before building E11 creator controls, RE-CHECK Door 2 + `create_blank_itinerary` (migration 20260603120100) + typed-city against PROD — these work on prod (the live-verify "dead-end" was a LOCAL-only artifact). Do NOT rebuild the blank-itinerary RPC; the canvas-CTA / creator-control work remains in scope. Reconcile §2A canvas work with the open-city `CreateFlow.tsx` scaffold AFTER the fleet lands — do not double-edit concurrently.

### Phase 4: Discoverability — Feed Filters & Targeting (P1)

**Goal**: Hosts target their nights and searchers filter the feed — dealbreakers hide hard, preferences boost soft, and the feed stays liquid and serendipitous.
**Mode:** mvp
**Depends on**: Phase 3 (P1 band) and Phase 1 (E4 feed_filters persistence pattern)
**Requirements**: REQ-E10
**Success Criteria** (what must be TRUE):

  1. A host can post a date targeted by gender, age range, and radius; a searcher with matching filters sees it boosted with a "looking for someone like you" hint.
  2. A searcher's hard filters (host gender, max price, max distance) hide non-matching nights; soft filters (vibe, who-pays, time-of-day) only re-sort.
  3. When hard filters empty the feed, a friendly "loosen a filter" empty state lets the searcher recover.
  4. The filter state persists server-side across sessions (web + native) and hard-filtered feed queries stay sub-100ms via indexed, cursor-paginated, blind-safe RPC results.

**Plans**: 4 plans
Plans:

**Wave 1**

- [x] 04-01-PLAN.md — DB foundation: feed_filters column + browse_feed_for_viewer hard/soft/fit extension + reach_preview RPC + indexes + SQL suite + [BLOCKING] local-apply/typegen/advisor (REQ-E10)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02-PLAN.md — api-client: FeedNight.fit + reachPreview() + FeedFilters + saveFeedFilters() (REQ-E10)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-03-PLAN.md — searcher UI: real FilterSheet (persist+requery) + 3 quick chips + filtered-vs-genuine empty state + e2e (REQ-E10)
- [x] 04-04-PLAN.md — hint UI: fit pill on NightCard + live reach-preview line on PostNightForm (REQ-E10)

**UI hint**: yes

**Carry-forward notes** (from Phase-3 live browser QA, 2026-06-04 — verified against the running app + local DB):

  1. **`date_instances.target_genders` is written as `{everyone}` (a literal value), NOT `{}`** when a host leaves "open to everyone" selected on `/nights/new`. Confirmed live: `post_night` stored `{everyone}` for a posted night. The E10 feed filter MUST treat `everyone` (and an empty array) as "no gender restriction" — do NOT filter for a literal `'everyone'` row value, or every open night disappears. Normalize `everyone`→open at the filter boundary (or fix `post_night`/`PostNightForm` to write `{}` for the open case — decide during E10 design).
  2. **Editing "the why" (and pay/vibe) on `/nights/new` mutates the SOURCE itinerary, then forks.** Per D-10 those fields persist onto the underlying itinerary before `post_night` deep-copies it — so an already-posted night that references the same source plan retroactively picks up the edit (observed live: two posted nights sharing one plan showed the same edited `why_note`). When E10 lets a host re-post / re-target the same plan, this source-mutation coupling gets more consequential. Decide whether the post flow should fork-then-edit (isolate each posting) vs the current edit-source-then-fork.

### Phase 5: Progressive Reveal (P2)

**Goal**: "Swipe on the date, not the face" becomes real — the host is limited/blurred pre-match, partially revealed at the offer, and fully revealed at the threshold with a ceremony.
**Mode:** mvp
**Depends on**: Phase 4 (P2 band); the existing blur pipeline (`generate-blur`, `blurred_photo_url`)
**Requirements**: REQ-E15, REQ-E16
**Success Criteria** (what must be TRUE):

  1. The feed card and detail show a limited/blurred host tier; the interested/offer screens lead with the experience, not a clear photo.
  2. The offer stage shows a partial host reveal; crossing the post-lock/rapport threshold shows the full reveal.
  3. Crossing the reveal threshold dispatches an `identity_revealed` notification and renders a reveal-ceremony moment in the UI.

**Plans**: TBD
**UI hint**: yes

### Phase 6: Trust & Safety (P2)

**Goal**: The back half of the loop builds trust — ratings compute a reliability score, chat connects to profile and plan, and accepting a date schedules safety check-ins.
**Mode:** mvp
**Depends on**: Phase 5 (P2 band); Phase 2 (E5 jobs + E9 cleanup); Phase 3 (E13 plan-on-match); Phase 1 (E1 nav)
**Requirements**: REQ-E17, REQ-E18, REQ-E19
**Success Criteria** (what must be TRUE):

  1. A `reliability_score` is computed from `match_ratings` and surfaced on the badge, and `no_show` is a reachable lock outcome.
  2. From a conversation a user can reach the counterpart's profile and the night/plan, and Profile→Night and Night→Profile/Chat all navigate.
  3. Accepting a date enqueues `day_of_reconfirm` and `safety_checkin`, and the handlers run without poison-looping.

**Plans**: TBD
**UI hint**: yes

### Phase 7: Enhancements & Polish (P3)

**Goal**: Round out the experience — real maps, venues back in the loop, relevance ranking, finer proximity, standby UI, feed/detail polish, and legacy-planner cleanup.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: REQ-E20, REQ-E21, REQ-E22, REQ-E23, REQ-E24, REQ-E25
**Success Criteria** (what must be TRUE):

  1. The detail sheet renders a real static map from real coordinates with per-stop links that deep-link to the correct venue.
  2. Post-match, a matched night links to its venue business page, and a `/places` nav-vs-retire decision is made and applied.
  3. The feed reflects compatibility/vibe relevance (not just chronology), cards show a human city label with finer distance, and a standby candidate sees their queue position and can withdraw a pending interest.
  4. Feed/detail hero is consistent, skeletons match the new card, archive/draft states exist, typing/read receipts work, a business-ownership stub exists, and the legacy `/plan/i/` dead link is cleaned up.

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Navigation & Profile Spine | 4/4 | Complete | 2026-06-03 |
| 2. Loop Closure & Host Controls | 6/6 | Complete | 2026-06-03 |
| 3. Marketplace Completeness | 7/7 | Complete   | 2026-06-04 |
| 4. Feed Filters & Targeting | 4/4 | Complete   | 2026-06-04 |
| 5. Progressive Reveal | 0/TBD | Not started | - |
| 6. Trust & Safety | 0/TBD | Not started | - |
| 7. Enhancements & Polish | 0/TBD | Not started | - |
