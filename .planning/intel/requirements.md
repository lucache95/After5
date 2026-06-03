# Requirements Intel

> Synthesized 2026-06-03 by gsd-doc-synthesizer.
> Primary requirement source: MVP-AUDIT Section E (E1–E25, banded P0→P3) — the
> authoritative execution queue and intended phase structure. Per the scope
> note, the P0→P3 ordering and per-item dependencies are PRESERVED. The
> chatgpt-audit PRD supplies the product vision + ISSUE #15 acceptance shape;
> the date-settings SPEC backs E10 (filters) + E11 (creator controls). The
> LIVE-NAV-VERIFY DOC (precedence 0) supplies live verdicts that adjust scope
> on the points it covers.
>
> Verdict legend (from LIVE-NAV-VERIFY): CONFIRMED = live-reproduced;
> WORSE = worse than the audit framing; NOT_REPRO = did not reproduce;
> UNREACHED = guard/lifecycle/safety state a happy-path walk cannot trigger,
> remains an assertion to confirm in code before queuing the fix.

---

## P0 — MVP blockers (the loop must close and never trap the user)

### REQ-universal-nav-chrome (E1)
- source: MVP-AUDIT Section E E1; LIVE-NAV-VERIFY C1/C4/C7/C8/C13, D6/D7 (all CONFIRMED)
- description: Add back button + BottomTabShell (or a contextual header with back) to every deep route and guard/error terminal: `/matches/[lockId]`, `/messages|/inbox/[threadId]`, `/dates/[slug]/interested`, `/offers/[offerId]`, `/account/notifications`, `/matches/[lockId]/rate`, and all guard/error terminals.
- acceptance: every listed route exposes a back affordance + nav; no link-less terminal remains; kills most of Section C at once.
- deps: none
- verify-note: C2/C3/C5/C6/C9 (guard/error/closed-thread/rate terminals) are UNREACHED — confirm in code, but the fix is the same nav-chrome pass.

### REQ-bottom-nav-semantics (E2)
- source: MVP-AUDIT E2; LIVE-NAV-VERIFY D11/D12 CONFIRMED, C10 NOT_REPRO
- description: Repoint "profile" tab → real profile hub (E3); make "dates" tab reach the user's matched dates (`/matches`), not `/my-nights`. Fix `/account`→`/plan/i/` dead link.
- acceptance: profile tab lands on the profile hub; dates tab reaches matched dates; no `/plan/i/` 404 for dating users.
- deps: none (E3 depends on this for the tab target)
- verify-note: C10 (`/account`→`/plan/i/` dead link) is NOT_REPRO for the dating flow — re-scope to legacy-planner cleanup, NOT the P0/E2 nav fix.

### REQ-profile-hub (E3, ISSUE #15)
- source: MVP-AUDIT E3; chatgpt-audit ISSUE #15; LIVE-NAV-VERIFY new-issue #3 + corrections
- description: Make the profile tab land on a real profile destination aggregating identity (photo/name/age/city/verification), dating profile (bio/prompts/vibe), a self-VIEW ("as others see it" via ProfileCard), and links to edit (`/account/profile`), preferences, and notifications. Strip the marketing teaser from the profile destination.
- acceptance (chatgpt-audit ISSUE #15 expected contents): Identity (photo/name/age/city/verification); Dating profile (bio/prompts/interests/goals); Stats (nights hosted/matches/response rate/reviews); Settings (distance/age range/notifications/privacy); Content (active/draft/past nights). Marketing/onboarding content removed from the profile tab.
- deps: E2 (tab target); consumes existing `/account` hub + `/account/profile` + ProfileCard
- verify-note: AUTHORITATIVE de-scope — `/account` already a real hub; E3 = nav-repoint + profile-view, NOT a from-scratch build (D12).

### REQ-editable-dating-preferences (E4)
- source: MVP-AUDIT E4; LIVE-NAV-VERIFY D13 UNREACHED; date-settings SPEC (profile prefs as defaults)
- description: Add a settings surface (age/distance/gender/dealbreakers + dating on/off) reachable from the profile hub. Today these are write-once at `/onboarding/preferences` with no link back.
- acceptance: a logged-in user can edit age range, distance, gender, dealbreakers, and toggle dating on/off from the profile hub post-signup.
- deps: E3
- verify-note: D13 UNREACHED (preferences-edit entry not probed) — confirm the unlinked-onboarding state in code; SPEC D1 reframes these as per-date defaults (profile prefs pre-fill, no longer the matching gate).

### REQ-lock-completed-transition (E5)
- source: MVP-AUDIT E5, B#3; LIVE-NAV-VERIFY C11/C13/D14 CONFIRMED (lifecycle half)
- description: Add the RPC/job that moves `locks.status` active→completed (and `date_instances`→completed), plus a cron that closes past-dated `seeking` nights. Today a successful date lives forever as `active` and no cron sweeps stale seeking nights.
- acceptance: a past-dated lock transitions active→completed; a past-dated `seeking` night is swept to completed/expired; the loop terminates.
- deps: none. Unblocks E17 trust loop and the lifecycle terminus.

### REQ-host-cancel-night (E6)
- source: MVP-AUDIT E6, B#12; LIVE-NAV-VERIFY D15 CONFIRMED; orchestrator correction #2
- description: `cancel_night` RPC + UI action on `/my-nights` and the interested list for `seeking` nights (pre-match cancel/unpublish/delete).
- acceptance: a host can take down a `seeking` night they created before any match.
- deps: none; pairs with E7
- verify-note: `cancel_night` RPC is genuinely ABSENT on prod and local (D9) — real build work.

### REQ-host-edit-night (E7)
- source: MVP-AUDIT E7, B#11; LIVE-NAV-VERIFY D15 CONFIRMED
- description: `update_night` RPC + edit UI (time/venue/duration/ambient) so a typo'd time / wrong venue can be corrected.
- acceptance: a host can edit a posted night's time/venue/duration/ambient.
- deps: none; pairs with E6
- verify-note: `update_night` RPC genuinely ABSENT on prod and local (D9).

### REQ-interest-received-notification (E8)
- source: MVP-AUDIT E8, B#5; LIVE-NAV-VERIFY D3 CONFIRMED (indirect)
- description: Dispatch `interest_received` from `match_ingest_interest`, deep-linked to that night's interested list, so the host learns of demand without manually opening `/my-nights`.
- acceptance: a right-swipe dispatches an `interest_received` notification to the host, deep-linked to the interested list.
- deps: none
- verify-note: the `interest_received` enum is already APPLIED (D11); this is dispatch-site wiring, not a migration.

### REQ-remove-poison-loop (E9)
- source: MVP-AUDIT E9, B#19, F#7; LIVE-NAV-VERIFY D16 UNREACHED
- description: Either implement or remove the dead job handlers (`match_reconfirm_timeout`, `match_stale_date_close`, `match_expire_pending`, `process_deletion`) so the job queue cannot crash/poison-loop. Do before scheduling any new jobs in E5.
- acceptance: no enqueueable handler references a missing RPC; the job queue cannot poison-loop.
- deps: none; sequence before E5 job scheduling
- verify-note: D16 UNREACHED in the UI walk; confirm the dead-handler/missing-RPC pairing in `process-jobs/handlers.ts` before acting.

## P1 — Core marketplace (discoverability, creator completeness, host triage)

### REQ-feed-filters (E10)
- source: MVP-AUDIT E10, B#10; date-settings SPEC §1/§3/§6 (PRIMARY backing); LIVE-NAV-VERIFY D1 CONFIRMED
- description: Add `profiles.feed_filters jsonb` + per-date targeting columns on `date_instances` (`target_genders text[]`, `target_age_range int4range`, `search_radius_km numeric`); wire `browse_feed_for_viewer` to accept + apply HARD filters (host gender / max price / max distance) in WHERE and SOFT sort (vibe / who-pays / time-of-day) + soft-boost in ORDER BY; return cursor-paginated lean blind-safe rows + a per-card `fit` flag. Build the real FilterSheet (vaul bottom-sheet; 3 quick chips + "more" drawer). Wire or remove the day-scope toggle. Add keyset pagination.
- acceptance (from SPEC §8 E2E): host posts a targeted date → searcher with matching filters sees it boosted with the "looking for someone like you" hint → a non-matching hard filter hides it → "loosen a filter" friendly empty state recovers. Distance origin = city centroid v1 (D13). All logic in RPC/edge; payload blind-safe; hard-filtered queries sub-100ms via GIST/btree/GIN indexes.
- deps: E4 (persistence pattern for feed_filters). Largest P1 item — SPEC §7 phasing: (1) DB foundation migration slice, (2) RPC slice, (3) UI slice.
- backing-decisions: D1 (per-date targeting source of truth), D2 (searcher-filters-only), D3 (hybrid strictness), D6 (API-first), D13 (city-centroid).

### REQ-creator-controls (E11)
- source: MVP-AUDIT E11, B#21/22, D2; date-settings SPEC §2/§2A/§4 (PRIMARY backing); LIVE-NAV-VERIFY C12/D2 WORSE (LOCAL-ONLY — see correction)
- description: Add UI for `pay_setting`, `vibe_tags`, `why_note`, per-night radius, and a real cover-image uploader; add a publish CTA on the Door-2 canvas; converge `PublishToFeedButton` and `/nights/new` (carry the generated itinerary id). Tiered: `/create` adds only radius + who-pays (D4); the in-app post/customize flow gets the full "who's this for?" set pre-filled from profile. Implement the §2A itinerary canvas (option A, D5) incl. the one NEW build: per-stop regenerate/swap (additive single-slot `generate-plan` capability, gated edge change). Add `reach_preview` RPC + pre-post nudge; "post again" one-tap repost; interested-list sorted by fit + card target label.
- acceptance: anon `/create` renders radius + who-pays; in-app post exposes target gender/age, who-pays, radius, exact schedule, the why (pre-filled, overridable); cover-image upload works; Door-2 canvas has a publish CTA; per-stop regenerate proposes one new venue leaving the rest unchanged; reach preview shows "~N people match this in <city>".
- deps: cover-upload needs storage wiring; SPEC §7 step 2 OVERLAPS the open-city scaffold the fleet is building into `CreateFlow.tsx` — reconcile AFTER the fleet lands, do not double-edit concurrently.
- verify-note: AUTHORITATIVE correction — C12/D2 "Door 2 hard dead-end" is LOCAL-ONLY; `create_blank_itinerary` (20260603120100) IS applied on prod (D8). RE-CHECK Door 2 against prod; do NOT rebuild the blank-itinerary RPC. The canvas-CTA / creator-control work remains in scope.
- backing-decisions: D4 (tiered placement), D5 (canvas paradigm), D8 (Door 2 live on prod).

### REQ-host-reject-candidate (E12)
- source: MVP-AUDIT E12, B#13, D4/D5; LIVE-NAV-VERIFY D4 CONFIRMED; orchestrator correction #2
- description: `reject_candidate` RPC + decline action in `InterestedList`; surface offer outcome (accepted/passed/expired) + withdraw control on the interested list.
- acceptance: a host can reject/dismiss a candidate; the interested list shows offer outcomes and a withdraw control; the new-interest list is no longer append-only.
- deps: none
- verify-note: `reject_candidate` RPC genuinely ABSENT on prod and local (D9) — real build work.

### REQ-plan-on-match-and-offer (E13)
- source: MVP-AUDIT E13, B#4; LIVE-NAV-VERIFY D10 CONFIRMED + new-issue #1 (offer "the night" empty-but-labelled)
- description: Render the attached itinerary/stops on `/matches/[lockId]` and `/offers/[offerId]`. Today `/matches/[lockId]` shows the person but not the plan, and `/offers/[offerId]` renders a "the night" section showing ONLY date/time (actively misleading).
- acceptance: both screens render the matched night's stops/venues; "every match has a real plan attached" holds at the moment it should pay off.
- deps: E1 (nav)

### REQ-offer-delivery-reliability (E14)
- source: MVP-AUDIT E14, B#18; LIVE-NAV-VERIFY env caveat (blank local RESEND key)
- description: Fix the offer email path (RESEND from a server runtime, not edge) and/or guarantee the in-app notification surfaces, so candidates always reach `/offers/[id]`.
- acceptance: every sent offer reaches the candidate via a reliable server-runtime email AND/OR a guaranteed in-app notification.
- deps: none
- verify-note: local stack has a blank RESEND key (a delivery caveat, not a nav break); PROJECT.md notes RESEND is set in the Vercel server runtime but blank on edge/local.

## P2 — Trust & reveal (the headline mechanic)

### REQ-progressive-reveal-ladder (E15)
- source: MVP-AUDIT E15, B#1/2/15, D1; chatgpt-audit category 3; LIVE-NAV-VERIFY D1 CONFIRMED
- description: Implement three reveal tiers: pre-match limited/blurred host on the feed card + detail (consume `blurred_photo_url`, add `signBlurredUrls()`, project a limited host hint into `FeedNight`), match-partial at the offer stage, threshold-full post-lock/rapport. Make `InterestedList`/`OfferDetail` experience-led, not photo-led.
- acceptance: feed + detail show a limited/blurred host tier; the offer stage shows a partial reveal; post-lock/threshold shows the full reveal; offer/interested screens lead with the experience, not the clear photo.
- deps: the blur pipeline already exists (`generate-blur`, `blurred_photo_url`/`blurred_path`) — it is orphaned today. Single highest-leverage vision item (PROJECT.md Key Decisions).

### REQ-identity-revealed-moment (E16)
- source: MVP-AUDIT E16; chatgpt-audit category 3; orchestrator correction #4
- description: Dispatch the gated `identity_revealed` notification at the reveal threshold; add a reveal ceremony in the UI.
- acceptance: crossing the reveal threshold dispatches `identity_revealed` and renders a reveal ceremony.
- deps: E15
- verify-note: the `identity_revealed` enum is already APPLIED (D11); this is dispatch-site wiring + ceremony UI, not a migration.

### REQ-ratings-reliability-aggregation (E17)
- source: MVP-AUDIT E17, B#14, D14; LIVE-NAV-VERIFY D14 CONFIRMED (lifecycle half)
- description: Aggregation RPC/job computing `reliability_score` from `match_ratings` and feeding the badge; reachable `no_show` lock outcome with consequences.
- acceptance: `reliability_score` is computed from `match_ratings` and surfaced on the badge; `no_show` is a reachable lock outcome.
- deps: E5 (completed transition + rating window)

### REQ-chat-profile-night-wiring (E18)
- source: MVP-AUDIT E18, B#7, D7/D8/D9/D10; chatgpt-audit category 10; LIVE-NAV-VERIFY D7/D8/D9/D10 CONFIRMED
- description: Link the conversation header to the counterpart profile, link to the night/plan, and wire Profile→Night / Night→Profile/Chat (the four expected nav edges).
- acceptance: from a conversation a user can reach the counterpart profile and the night/plan; Profile→Night and Night→Profile/Chat all navigate.
- deps: E1 (nav) + E13 (plan-on-match)

### REQ-safety-flows (E19)
- source: MVP-AUDIT E19, B#19, D16; LIVE-NAV-VERIFY D16 UNREACHED
- description: Implement + enqueue `day_of_reconfirm` and `safety_checkin` (RPCs + producers at accept time).
- acceptance: accepting a date enqueues `day_of_reconfirm` and `safety_checkin`; the handlers run without poison-looping.
- deps: E9 (cleanup) + E5 (jobs)
- verify-note: D16 UNREACHED — assertion from the static read; confirm missing RPCs/producers in code first.

## P3 — Enhancements

### REQ-real-map-route (E20)
- source: MVP-AUDIT E20, B#25, F#3; LIVE-NAV-VERIFY C14 CONFIRMED
- description: Real static map + route in the detail sheet (consume the discarded lat/lng); fix per-stop links to use coordinates instead of name text-searches. Replaces the fake hardcoded-pin "the route" block.
- acceptance: the detail sheet renders a real static map from real coordinates; per-stop links deep-link to the correct venue.
- deps: none

### REQ-venues-into-loop (E21)
- source: MVP-AUDIT E21, B#28, D17, F#11; chatgpt-audit category 4; LIVE-NAV-VERIFY D17 CONFIRMED (indirect)
- description: Bring venue pages into the dating loop (post-match venue identity + links); decide `/places` nav vs retire. Today `/places/[slug]` is walled off (blind contract strips `place_slug`, never restored post-match) and funnels to the legacy `/create` planner.
- acceptance: post-match, a matched night links to its venue business page; a `/places` nav-vs-retire decision is made.
- deps: none

### REQ-relevance-ranking (E22)
- source: MVP-AUDIT E22, B#29
- description: Relevance ranking (compatibility/vibe) over the current purely chronological feed order.
- acceptance: feed order reflects compatibility/vibe relevance, not just chronology.
- deps: none (SPEC §9 notes ML ranking is out of scope for v1; soft-sort is deterministic SQL score)

### REQ-city-label-proximity (E23)
- source: MVP-AUDIT E23, B#30; date-settings SPEC §5
- description: Return a human city/area label (`city_name`) to the card and finer distance; today the RPC returns `city_id` only and distance is city-centroid coarse.
- acceptance: cards show a human city label; distance is finer than city-centroid.
- deps: relates to D13 (geolocation fast-follow)

### REQ-standby-waitlist-ui (E24)
- source: MVP-AUDIT E24, B#32
- description: Standby/waitlist UI for candidates ("you're next in line") + withdraw-pending-interest (a list of the user's pending interests with a withdraw action).
- acceptance: a standby candidate sees their queue position; a user can withdraw a plain `interested` interest.
- deps: none

### REQ-feed-detail-polish-and-misc (E25)
- source: MVP-AUDIT E25, B#26/34/40/44/27
- description: Feed/detail hero consistency, skeleton refresh, archive view, draft state, typing indicators/read receipts, business-ownership/claim model.
- acceptance: hero image is consistent feed↔detail; skeleton matches the new card; archive/draft states exist; typing/read receipts work; a stub business-ownership model exists.
- deps: none. Business-ownership beyond a stub is OUT OF SCOPE (PROJECT.md).

---

## What-to-delete / decouple (MVP-AUDIT Section F) — folded into the relevant E-items
- source: MVP-AUDIT Section F
- F1 strip marketing content from the profile tab → folds into E3.
- F2 delete orphaned `apps/web/app/account/ProfileForm.tsx` (zero importers).
- F3 delete fake "the route" mini-map → E20.
- F4 collapse degenerate `PublishToFeedButton` into the real form → E11.
- F5 remove dead `host.bio` branch in `OfferDetail.tsx`.
- F6 ship or remove the `reach_radius_km` cast in `NightCard.tsx:55`.
- F7 implement-or-remove dead job handlers → E9.
- F8 remove/repurpose dead `date_match_status` value `none`.
- F9 collapse the dual `/messages` + `/inbox` thread trees to one canonical path (retarget `LockDetail` to `/inbox/${threadId}`, retire `/messages`).
- F10 remove the orphaned blur pipeline ONLY IF E15 is descoped — prefer building E15.
- F11 rebrand-or-retire the legacy planner/marketing cluster (`/vote`, `/places` catalog, `/neighborhoods`, `/types`, `/vibes`, `/dates` SEO, `/roadmap`, `/tell-us`, `/insiders`, `/join`). Corroborates the brand-alignment audit. NOTE: C10 NOT_REPRO re-scopes the `/plan/i/` dead link into THIS legacy cleanup, not E2.
