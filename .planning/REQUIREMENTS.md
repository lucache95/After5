# Requirements: After5 — Experience-First Dating Marketplace

> Source: 2026-06-03 MVP-AUDIT Section E (E1–E25), banded P0→P3, with per-item
> deps preserved. Backed by the date-settings SPEC (E10/E11), the chatgpt-audit
> PRD (vision + ISSUE #15), and the LIVE-NAV-VERIFY DOC (live verdicts).
> Authoritative project context: `.planning/PROJECT.md` (do not contradict).
>
> Every requirement maps 1:1 to an MVP-AUDIT E-item and to exactly one phase.
> REQ-IDs carry the E-number for traceability (e.g. `REQ-E1`).
>
> Verdict legend (LIVE-NAV-VERIFY): CONFIRMED = live-reproduced; WORSE = worse
> than the audit framing; NOT_REPRO = did not reproduce; UNREACHED = guard/
> lifecycle/safety state a happy-path walk cannot trigger (confirm in code
> before building).

---

## Core Value (from PROJECT.md)

A user can browse a real planned night, express interest, get matched, and end
up on an actual date with a real plan attached — the full loop closes and never
traps the user. The progressive identity reveal ("swipe on the date, not the
face") is the headline mechanic; the AI date-planner is the moat.

---

## P0 — MVP blockers (the loop must close and never trap the user)

### REQ-E1 — Universal nav chrome
Add a back affordance + bottom nav (or contextual header) to every deep route
and guard/error terminal: `/matches/[lockId]`, `/messages|/inbox/[threadId]`,
`/dates/[slug]/interested`, `/offers/[offerId]`, `/account/notifications`,
`/matches/[lockId]/rate`, plus all guard/error terminals.
- **Acceptance:** every listed route exposes a back affordance + nav; no link-less terminal remains.
- **Deps:** none
- **Verify-note:** C2/C3/C5/C6/C9 (guard/error/closed-thread/rate terminals) are UNREACHED — confirm in code, but the fix is the same nav-chrome pass.

### REQ-E2 — Bottom-nav semantics
Repoint the "profile" tab → real profile hub (E3); make the "dates" tab reach
the user's matched dates (`/matches`), not `/my-nights`.
- **Acceptance:** profile tab lands on the profile hub; dates tab reaches matched dates.
- **Deps:** none (E3 consumes this tab target)
- **Verify-note:** the C10 `/account`→`/plan/i/` dead link is NOT_REPRO for the dating flow — re-scoped OUT of E2 into legacy-planner cleanup (E25/F11), NOT this P0 fix.

### REQ-E3 — Profile hub (ISSUE #15)
Make the profile tab land on a real destination aggregating identity (photo/
name/age/city/verification), dating profile (bio/prompts/vibe), a self-VIEW
("as others see it" via ProfileCard), stats, and links to edit, preferences,
and notifications. Strip the marketing teaser from the profile destination.
- **Acceptance (ISSUE #15):** Identity; Dating profile; Stats (nights hosted/matches/response rate/reviews); Settings (distance/age range/notifications/privacy); Content (active/draft/past nights); marketing/onboarding content removed.
- **Deps:** E2 (tab target); consumes existing `/account` hub + `/account/profile` + ProfileCard
- **Verify-note:** AUTHORITATIVE de-scope (D12) — `/account` is already a real hub; E3 = nav-repoint + profile-view, NOT a from-scratch build.

### REQ-E4 — Editable dating preferences
Add a settings surface (age/distance/gender/dealbreakers + dating on/off)
reachable from the profile hub. Today these are write-once at
`/onboarding/preferences` with no link back.
- **Acceptance:** a logged-in user can edit age range, distance, gender, dealbreakers, and toggle dating on/off from the profile hub post-signup.
- **Deps:** E3
- **Verify-note:** D13 UNREACHED — confirm the unlinked-onboarding state in code. Per SPEC D1, profile prefs become per-date PRE-FILL DEFAULTS, no longer the matching gate.

### REQ-E5 — Lock `completed` transition + expiry sweep
Add the RPC/job that moves `locks.status` active→completed (and
`date_instances`→completed), plus a cron that closes past-dated `seeking`
nights.
- **Acceptance:** a past-dated lock transitions active→completed; a past-dated `seeking` night is swept to completed/expired; the loop terminates.
- **Deps:** none (sequence the job scheduling AFTER E9 poison-loop cleanup). Unblocks E17.

### REQ-E6 — Host pre-match cancel night
`cancel_night` RPC + UI action on `/my-nights` and the interested list for
`seeking` nights (pre-match cancel/unpublish/delete).
- **Acceptance:** a host can take down a `seeking` night they created before any match.
- **Deps:** none; pairs with E7
- **Verify-note:** `cancel_night` RPC is genuinely ABSENT on prod and local (D9) — real build work.

### REQ-E7 — Host edit night
`update_night` RPC + edit UI (time/venue/duration/ambient) so a typo'd time /
wrong venue can be corrected.
- **Acceptance:** a host can edit a posted night's time/venue/duration/ambient.
- **Deps:** none; pairs with E6
- **Verify-note:** `update_night` RPC genuinely ABSENT on prod and local (D9).

### REQ-E8 — `interest_received` notification
Dispatch `interest_received` from `match_ingest_interest`, deep-linked to that
night's interested list, so the host learns of demand without manually opening
`/my-nights`.
- **Acceptance:** a right-swipe dispatches an `interest_received` notification to the host, deep-linked to the interested list.
- **Deps:** none
- **Verify-note:** the `interest_received` enum is already APPLIED (D11) — this is dispatch-site wiring, not a migration.

### REQ-E9 — Remove poison-loop risk
Either implement or remove the dead job handlers (`match_reconfirm_timeout`,
`match_stale_date_close`, `match_expire_pending`, `process_deletion`) so the job
queue cannot crash/poison-loop. Do this before scheduling any new jobs (E5).
- **Acceptance:** no enqueueable handler references a missing RPC; the job queue cannot poison-loop.
- **Deps:** none; sequence BEFORE E5 job scheduling
- **Verify-note:** D16 UNREACHED — confirm the dead-handler/missing-RPC pairing in `process-jobs/handlers.ts` before acting.

---

## P1 — Core marketplace (discoverability, creator completeness, host triage)

### REQ-E10 — Real feed filters + targeting data
Add `profiles.feed_filters jsonb` + per-date targeting columns on
`date_instances` (`target_genders text[]`, `target_age_range int4range`,
`search_radius_km numeric`); wire `browse_feed_for_viewer` to apply HARD filters
(host gender / max price / max distance) in WHERE and SOFT sort (vibe / who-pays
/ time-of-day) in ORDER BY; return cursor-paginated lean blind-safe rows + a
per-card `fit` flag. Build the real FilterSheet (vaul bottom-sheet; 3 quick
chips + "more" drawer). Add keyset pagination.
- **Acceptance (SPEC §8 E2E):** host posts a targeted date → matching searcher sees it boosted with the "looking for someone like you" hint → a non-matching hard filter hides it → "loosen a filter" friendly empty state recovers. Distance origin = city centroid v1. Logic in RPC/edge; payload blind-safe; hard-filtered queries sub-100ms via GIST/btree/GIN indexes.
- **Deps:** E4 (persistence pattern for `feed_filters`). SPEC §7 phasing: (1) DB foundation, (2) RPC, (3) UI.
- **Backing decisions:** D1, D2, D3, D6, D13.

### REQ-E11 — Creator controls
Add UI for `pay_setting`, `vibe_tags`, `why_note`, per-night radius, and a real
cover-image uploader; add a publish CTA on the Door-2 canvas; converge
`PublishToFeedButton` and `/nights/new`. Tiered: `/create` adds only radius +
who-pays (D4); the in-app post/customize flow gets the full "who's this for?"
set pre-filled from profile. Implement the §2A itinerary canvas (option A, D5)
incl. the one NEW build: per-stop regenerate/swap (additive single-slot
`generate-plan` capability, gated edge change). Add `reach_preview` RPC +
pre-post nudge; "post again" one-tap repost.
- **Acceptance:** anon `/create` renders radius + who-pays; in-app post exposes target gender/age, who-pays, radius, exact schedule, the why (pre-filled, overridable); cover-image upload works; Door-2 canvas has a publish CTA; per-stop regenerate proposes one new venue leaving the rest unchanged; reach preview shows "~N people match this in <city>".
- **Deps:** cover-upload needs storage wiring; SPEC §7 step 2 OVERLAPS the open-city `CreateFlow.tsx` scaffold — reconcile AFTER the fleet lands, do not double-edit concurrently.
- **Verify-note:** AUTHORITATIVE correction (D8) — C12/D2 "Door 2 hard dead-end" is LOCAL-ONLY; `create_blank_itinerary` (20260603120100) IS applied on prod. RE-CHECK Door 2 + typed-city against prod; do NOT rebuild the blank-itinerary RPC. The canvas-CTA / creator-control work remains in scope.
- **Backing decisions:** D4, D5, D8.

### REQ-E12 — Host reject/dismiss candidate
`reject_candidate` RPC + decline action in `InterestedList`; surface offer
outcome (accepted/passed/expired) + withdraw control on the interested list.
- **Acceptance:** a host can reject/dismiss a candidate; the interested list shows offer outcomes and a withdraw control; the new-interest list is no longer append-only.
- **Deps:** none
- **Verify-note:** `reject_candidate` RPC genuinely ABSENT on prod and local (D9) — real build work.

### REQ-E13 — Plan on match + offer
Render the attached itinerary/stops on `/matches/[lockId]` and
`/offers/[offerId]`. Today the match screen shows the person but not the plan,
and the offer "the night" section shows ONLY date/time (actively misleading).
- **Acceptance:** both screens render the matched night's stops/venues; "every match has a real plan attached" holds at the moment it should pay off.
- **Deps:** E1 (nav)

### REQ-E14 — Offer delivery reliability
Fix the offer email path (RESEND from a server runtime, not edge) and/or
guarantee the in-app notification surfaces, so candidates always reach
`/offers/[id]`.
- **Acceptance:** every sent offer reaches the candidate via a reliable server-runtime email AND/OR a guaranteed in-app notification.
- **Deps:** none
- **Verify-note:** local stack has a blank RESEND key; PROJECT.md notes RESEND is set in the Vercel server runtime but blank on edge/local.

---

## P2 — Trust & reveal (the headline mechanic)

### REQ-E15 — Progressive reveal ladder
Implement three reveal tiers: pre-match limited/blurred host on the feed card +
detail (consume `blurred_photo_url`, add `signBlurredUrls()`, project a limited
host hint into `FeedNight`), match-partial at the offer stage, threshold-full
post-lock/rapport. Make `InterestedList`/`OfferDetail` experience-led, not
photo-led.
- **Acceptance:** feed + detail show a limited/blurred host tier; the offer stage shows a partial reveal; post-lock/threshold shows the full reveal; offer/interested screens lead with the experience, not the clear photo.
- **Deps:** the blur pipeline already exists (`generate-blur`, `blurred_photo_url`/`blurred_path`) but is orphaned. Single highest-leverage vision item.

### REQ-E16 — `identity_revealed` moment
Dispatch the gated `identity_revealed` notification at the reveal threshold; add
a reveal ceremony in the UI.
- **Acceptance:** crossing the reveal threshold dispatches `identity_revealed` and renders a reveal ceremony.
- **Deps:** E15
- **Verify-note:** the `identity_revealed` enum is already APPLIED (D11) — dispatch-site wiring + ceremony UI, not a migration.

### REQ-E17 — Ratings → reliability aggregation
Aggregation RPC/job computing `reliability_score` from `match_ratings` and
feeding the badge; reachable `no_show` lock outcome with consequences.
- **Acceptance:** `reliability_score` is computed from `match_ratings` and surfaced on the badge; `no_show` is a reachable lock outcome.
- **Deps:** E5 (completed transition + rating window)

### REQ-E18 — Chat ↔ profile ↔ night wiring
Link the conversation header to the counterpart profile, link to the night/plan,
and wire Profile→Night / Night→Profile/Chat (the four expected nav edges).
- **Acceptance:** from a conversation a user can reach the counterpart profile and the night/plan; Profile→Night and Night→Profile/Chat all navigate.
- **Deps:** E1 (nav) + E13 (plan-on-match)

### REQ-E19 — Safety flows
Implement + enqueue `day_of_reconfirm` and `safety_checkin` (RPCs + producers at
accept time).
- **Acceptance:** accepting a date enqueues `day_of_reconfirm` and `safety_checkin`; the handlers run without poison-looping.
- **Deps:** E9 (cleanup) + E5 (jobs)
- **Verify-note:** D16 UNREACHED — confirm missing RPCs/producers in code first.

---

## P3 — Enhancements

### REQ-E20 — Real map + route
Real static map + route in the detail sheet (consume the discarded lat/lng); fix
per-stop links to use coordinates instead of name text-searches.
- **Acceptance:** the detail sheet renders a real static map from real coordinates; per-stop links deep-link to the correct venue.
- **Deps:** none

### REQ-E21 — Venues into the loop
Bring venue pages into the dating loop (post-match venue identity + links);
decide `/places` nav vs retire. Today `/places/[slug]` is walled off by the
blind contract and funnels to the legacy `/create` planner.
- **Acceptance:** post-match, a matched night links to its venue business page; a `/places` nav-vs-retire decision is made.
- **Deps:** none

### REQ-E22 — Relevance ranking
Relevance ranking (compatibility/vibe) over the current purely chronological feed
order.
- **Acceptance:** feed order reflects compatibility/vibe relevance, not just chronology.
- **Deps:** none (ML ranking is out of scope for v1; soft-sort is deterministic SQL score)

### REQ-E23 — City label + proximity
Return a human city/area label (`city_name`) to the card and finer distance;
today the RPC returns `city_id` only and distance is city-centroid coarse.
- **Acceptance:** cards show a human city label; distance is finer than city-centroid.
- **Deps:** relates to D13 (geolocation fast-follow)

### REQ-E24 — Standby/waitlist UI
Standby/waitlist UI for candidates ("you're next in line") + withdraw-pending-
interest.
- **Acceptance:** a standby candidate sees their queue position; a user can withdraw a plain `interested` interest.
- **Deps:** none

### REQ-E25 — Feed/detail polish + misc
Feed/detail hero consistency, skeleton refresh, archive view, draft state,
typing indicators/read receipts, business-ownership/claim stub. Also folds in
the legacy-planner cleanup (F11) incl. the re-scoped C10 `/plan/i/` dead link.
- **Acceptance:** hero image is consistent feed↔detail; skeleton matches the new card; archive/draft states exist; typing/read receipts work; a stub business-ownership model exists; legacy `/plan/i/` dead link removed for affected users.
- **Deps:** none. Business-ownership beyond a stub is OUT OF SCOPE.

---

## Traceability (REQ → Phase)

| REQ | E-item | Priority | Phase | Status |
|-----|--------|----------|-------|--------|
| REQ-E1 | universal-nav-chrome | P0 | Phase 1 | Complete (01-02) |
| REQ-E2 | bottom-nav-semantics | P0 | Phase 1 | Complete (01-01) |
| REQ-E3 | profile-hub (ISSUE #15) | P0 | Phase 1 | Complete (01-04) |
| REQ-E4 | editable-dating-preferences | P0 | Phase 1 | Complete (01-03) |
| REQ-E5 | lock-completed-transition | P0 | Phase 2 | Complete (02-03) |
| REQ-E6 | host-cancel-night | P0 | Phase 2 | Complete (02-06) |
| REQ-E7 | host-edit-night | P0 | Phase 2 | Complete (02-06) |
| REQ-E8 | interest-received-notification | P0 | Phase 2 | Complete |
| REQ-E9 | remove-poison-loop | P0 | Phase 2 | Complete |
| REQ-E10 | feed-filters | P1 | Phase 4 | Pending |
| REQ-E11 | creator-controls | P1 | Phase 3 | Complete (03-01,03-03) |
| REQ-E12 | host-reject-candidate | P1 | Phase 3 | Pending |
| REQ-E13 | plan-on-match-and-offer | P1 | Phase 3 | Pending |
| REQ-E14 | offer-delivery-reliability | P1 | Phase 3 | Complete (03-06) |
| REQ-E15 | progressive-reveal-ladder | P2 | Phase 5 | Pending |
| REQ-E16 | identity-revealed-moment | P2 | Phase 5 | Pending |
| REQ-E17 | ratings-reliability-aggregation | P2 | Phase 6 | Built (06-01, migration gated to 06-05) |
| REQ-E18 | chat-profile-night-wiring | P2 | Phase 6 | Pending |
| REQ-E19 | safety-flows | P2 | Phase 6 | Pending |
| REQ-E20 | real-map-route | P3 | Phase 7 | Pending |
| REQ-E21 | venues-into-loop | P3 | Phase 7 | Pending |
| REQ-E22 | relevance-ranking | P3 | Phase 7 | Pending |
| REQ-E23 | city-label-proximity | P3 | Phase 7 | Pending |
| REQ-E24 | standby-waitlist-ui | P3 | Phase 7 | Pending |
| REQ-E25 | feed-detail-polish-and-misc | P3 | Phase 7 | Pending |

**Coverage:** 25/25 requirements mapped. No orphans, no duplicates.

---

## v2 / Out of Scope (from PROJECT.md)

- **Native mobile apps** — parked (web-first). Architecture is prepared (D6 / API-first), the app build is deferred.
- **Legacy AI-planner-as-standalone-product framing** — the planner is the moat/wedge inside the dating marketplace, not a separate product.
- **Re-fixing already-shipped feed issues** (dark title, missing tags, poor audio) — genuinely FIXED; do not re-queue.
- **Business-ownership / merchant claim model beyond a stub** — deferred to P3+ (E25 ships a stub only).
- **Full 8-state night lifecycle** — the 3-state machine (`seeking`↔`matched`→`cancelled`) is intentional; only the back half (completed → reviewed → reliability) is in scope (E5 + E17).
- **Already shipped & live this cycle** (do not queue): brand sweep, image pipeline, unified inbox + nav, create chooser, the 4 mobile-UX redesigns, audio + ownership fixes, SEO assets, open-city.
- **Gated/parked** (not active blockers): #77 real venue photos, #78 per-vibe ambient loops, #86 cover-consistency. (The E8/E16 dispatch wiring IS in scope; the enums are already applied.)
- **SPEC §9 YAGNI for v1:** precise geolocation (city-centroid v1), paid/boosted placement, advanced ML ranking (soft-sort is deterministic SQL v1).
