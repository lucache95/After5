# After5 — Live-Nav Verification of MVP-AUDIT Dead-Ends & Broken Journeys

Date: 2026-06-03
Verifies: `docs/superpowers/reports/2026-06-03-MVP-AUDIT.md` (Sections C & D)
Method: live Playwright walk of three roles against the local Supabase stack + `pnpm dev`. Read-only — no source committed; temp specs removed after each run.

## Reachability per role (the verification is only as strong as what was walked)

| Role | Reached app? | How / caveats |
|---|---|---|
| Anonymous (not logged in) | YES | Repo Playwright/Chromium harness (no Playwright MCP bound) against local dev + local Supabase. All public routes, the /create funnel, blur gate, and email capture walked. |
| Logged-in swiper (demand) | YES | Could NOT auth as prod `lucache95+r2cand@gmail.com` (does not exist locally). Seeded an equivalent demand-side user via the repo service-role seed; drove the REAL UI for all 8 checkpoints (feed→detail→swipe→offer→accept→match→reveal→chat→inbox). |
| Logged-in host (supply) | YES | Could NOT auth as prod `lucache95+r2host@gmail.com` (does not exist locally). Seeded an equivalent verified dating host (6 nights + 1 interested candidate) on the local stack; drove all checkpoints live on a dev server on :3001. |

All three roles reached and drove the real app. The only role-level caveat: the prod r2host/r2cand accounts could not be used (harness is hard-wired to the local stack), so demand/supply state was faithfully re-seeded rather than replayed from prod. The local env also has a **blank RESEND key**, which surfaces below as an email/offer-delivery caveat, not a navigation break.

---

## Section C — Dead-end routes (verdicts)

| # | Audit dead-end | Verdict | Screenshot | Evidence (one line) |
|---|---|---|---|---|
| C1 | `/messages/[threadId]` (+ `/inbox/[threadId]` re-export): no back, no nav, no outbound links | CONFIRMED | /tmp/nav-swiper-7.png | Header is plain text (not a link); navs=0, profileLinks=0, nightLinks=0; only browser-back. |
| C2 | Conversation closed-thread state (no composer/back/link) | UNREACHED | — | Thread never reached a closed state in the walk (no completed/closed lock); not exercised. |
| C3 | `/messages/[threadId]` "not your conversation" error terminal | UNREACHED | — | Guard error not triggered in the walk. |
| C4 | `/matches/[lockId]` match detail: no bottom nav, no back | CONFIRMED | /tmp/nav-swiper-5.png | backBtns=0, navs=0; only forward (see profile / message / cancel). |
| C5 | `/matches/[lockId]/rate` "not yet" / "already rated" terminal | UNREACHED | — | Rate route not reached (lock never left `active`; no completed-date path). |
| C6 | `/account/notifications`: no inbound link, no nav/back | UNREACHED | — | Not directly probed this run. |
| C7 | `/dates/[slug]/interested` (host candidate list): no back, no bottom nav | CONFIRMED | /tmp/nav-host-2.png | Live probe: 0 back affordances, 0 bottom-nav links; host trapped except browser-back. |
| C8 | `/offers/[offerId]` (active): no neutral back; only accept/pass/withdraw | CONFIRMED | /tmp/nav-swiper-4.png | backAffordances=0; only the offer actions or browser-back. |
| C9 | Guard/error states ("not your match/date", "couldn't load", reciprocal) — link-less terminals | UNREACHED | — | Happy path only; guard terminals not triggered. |
| C10 | `/account` → `/plan/i/${id}` dead link (404) | NOT_REPRO | /tmp/nav-host-11.png | 0 `/plan/i/` anchors on /account for a host with no slug-less saved planner plans; link only manifests for that legacy data, absent here. |
| C11 | Past-dated `seeking` night soft-trap (never transitions, no edit/delete) | CONFIRMED | /tmp/nav-host-4.png | Seeded a night 2 days in the past; renders identically to a live night, stays `seeking` forever, only action (make offer) is meaningless. |
| C12 | `ItineraryEditor` (`/plans/[id]/edit`) saves with no publish CTA — Door-2 host stranded on canvas | WORSE | /tmp/nav-host-6.png | Door 2 never reaches the canvas: "start from scratch" fires "couldn't start a blank one" toast because `create_blank_itinerary()` is MISSING (migration 20260603120100 gated/unapplied). Hard dead-end, not a CTA-less canvas. |
| C13 | Locked match after the date stays `active` forever; stale cancel button | CONFIRMED | /tmp/nav-swiper-5.png | Match shows persistent "cancel this date" with no completed transition; corroborated by C11 past-date soft-trap. |
| C14 | Detail-sheet "the route" block looks tappable, no real geography/interaction | CONFIRMED | /tmp/nav-swiper-2.png | Detail sheet renders a map-like stop block (venue, time, map) with no real interaction; matches the audit's static read. |

**Section C: 7 CONFIRMED, 1 WORSE, 1 NOT_REPRO, 5 UNREACHED (of 14).**

---

## Section D — Broken user journeys (verdicts)

| # | Audit broken journey | Verdict | Screenshot | Evidence (one line) |
|---|---|---|---|---|
| D1 | Browse→Match: no blurred/limited host on the deck; "swipe on the date not the face" not representable; filters/day-scope don't narrow | CONFIRMED | /tmp/nav-swiper-1.png | Feed cards carry ZERO host id/name/photo; no representable host tier; binary full-reveal only (see D-reveal). |
| D2 | Host→Publish: Door 2 canvas has no publish CTA; Door 1 hardcoded date/no who-pays/venue/tags; scratch imageless | WORSE | /tmp/nav-host-6.png | Door 2 is a hard dead-end before any canvas (`create_blank_itinerary` missing) — worse than "canvas lacks publish CTA." |
| D3 | Swipe-right→Host notices: no `interest_received` dispatch; host learns only via /my-nights | CONFIRMED (indirect) | /tmp/nav-host-1.png | Host surfaces interest only by opening /my-nights ("N interested"); no demand→supply notification observed. |
| D4 | Host→Triage→Reject: no reject/dismiss; append-only list | CONFIRMED | /tmp/nav-host-2.png | 0 reject/decline/dismiss controls; only shortlist + "send it"; `reject_candidate` RPC MISSING from DB. |
| D5 | Offer sent→Host sees result: no accept/pass/expire reflection, no withdraw on interested list | CONFIRMED (interested-list half) | /tmp/nav-host-3.png | Make-offer works; no offer-outcome/withdraw surface on the interested list. |
| D6 | Match→back to browsing: pushed to `/matches/[lockId]` (no nav); resume feed only via browser-back | CONFIRMED | /tmp/nav-swiper-5.png | Match screen navs=0, backBtns=0; no path back to the feed. |
| D7 | Match→Chat→back to Match: tab-less, back-less conversation | CONFIRMED | /tmp/nav-swiper-7.png | Conversation navs=0, no back; round trip impossible in-UI. |
| D8 | Chat→Profile: impossible (conversation has no link to revealed profile) | CONFIRMED | /tmp/nav-swiper-7.png | profileLinks=0; header not tappable. |
| D9 | Chat→Night/plan: impossible from the conversation | CONFIRMED | /tmp/nav-swiper-7.png | nightLinks=0; plan unreachable from chat. |
| D10 | Profile→Night and Night→Profile/Chat: LockDetail/offer don't link to night plan or conversation | CONFIRMED | /tmp/nav-swiper-4.png | Match has no link to the matched night; offer "the night" renders only date/time (no stops/venues). |
| D11 | "Dates" tab→matched dates: lands on `/my-nights`, never `/matches` | CONFIRMED | /tmp/nav-host-1.png | Bottom-nav "dates" resolves to /my-nights (posted nights), tab highlighted there. |
| D12 | "Profile" tab→profile (ISSUE #15): lands on `/home` marketing teaser | CONFIRMED | /tmp/nav-host-9.png | /profile 404s; profile tab points to /home onboarding/teaser content; no profile hub. |
| D13 | Edit matching preferences post-signup: impossible (`/onboarding/preferences` unlinked) | UNREACHED | — | Preferences-edit entry not probed this run. |
| D14 | Go on date→mark done→review→reliability: nothing marks date completed; lock can't leave `active`; ratings feed nothing | CONFIRMED (lifecycle half) | /tmp/nav-swiper-5.png | Lock stuck `active`, persistent cancel; no completed/rate path reachable (see C5/C13). |
| D15 | Post a night→fix typo/cancel pre-match: no edit/unpublish/delete | CONFIRMED | /tmp/nav-host-1.png | /my-nights has 0 edit/unpublish/archive/delete controls; `update_night` + `cancel_night` RPCs MISSING from DB. |
| D16 | Safety: day-of reconfirm + post-date check-in never fire (RPCs missing) | UNREACHED | — | No producers to trigger; not observable in a UI walk. |
| D17 | Feed night→venue business page: `/places/[slug]` walled off (blind contract strips `place_slug`) | CONFIRMED (indirect) | /tmp/nav-anon-cat-_places.png | /places funnels to the legacy /create planner, walled off from the dating loop, never restored post-match. |

**Section D: 13 CONFIRMED (2 of which WORSE), 2 UNREACHED (of 17).** Note D2 is logged as WORSE; the table above counts it once as WORSE.

Tally restated cleanly — Section D: 12 CONFIRMED, 1 WORSE (D2), 2 UNREACHED (D13, D16), 2 INDIRECT-CONFIRMED counted within CONFIRMED (D3, D17).

---

## New issues found live (not in the static audit)

1. **Offer screen "the night" is labelled-but-empty (actively misleading).** `/offers/[offerId]` renders a "the night" section that shows ONLY the date/time (e.g. "Monday, Jun 8, 3:27 PM") with no stops, venues, or itinerary — worse than omitting the section. The plan that was the entire basis of the match is invisible at the moment it should pay off. (/tmp/nav-swiper-4.png)
2. **Possible lost-swipe race in the detail-sheet "i'm in" path.** Swiping interest from inside the NightDetailSheet sometimes did NOT create a `queue_entry` for the night being displayed (first run: detail showed The Train Station Pub, no queue row landed for that instance, deck fell through). `recordSwipe` may fire against the wrong/advancing card. Worth a closer look; not in the static audit.
3. **`/account` is a real, well-built host hub but is nav-orphaned.** "Your dating home" (browse nights / your matches / your nights / post a night) already exists at `/account`, reachable only by URL — nothing in the primary nav points to it, and the profile tab goes to the /home teaser instead. The hub the audit's E3 asks to be BUILT largely exists; repointing the profile tab to `/account` (plus a profile-view) would resolve most of ISSUE #15 cheaply. (/tmp/nav-host-11.png)
4. **Four marketplace RPCs are ABSENT from the running DB**, not merely UI-incomplete: `create_blank_itinerary` (migration 20260603120100 marked "GATED — NOT YET APPLIED"), `reject_candidate`, `update_night`, `cancel_night`. On any env in this state, Door 2 is dead on arrival and host edit/cancel/reject cannot be wired even if UI is added. Verify migration application before relying on these.
5. **Brand-serif regressions (not dead-ends).** `/create` PolaroidLoader heading, `/login` wordmark + "let's get you in." heading, and `/about` + `/tell-us` headings all render in the LEGACY Fraunces serif. Corroborates the 2026-06-02 brand-alignment audit.
6. **Anon /create ignores the typed city (minor UX, not a trap).** Typed "New York, NY" but the generated itinerary returned "kelowna" — the city input is overridden by the generator. `apps/web/app/create/CreateFlow.tsx` → `/api/create-plan`.

---

## Corrections to MVP-AUDIT (items that did NOT reproduce — trim the queue)

- **C10 `/account` → `/plan/i/${id}` dead link — NOT_REPRO for the dating flow.** No `/plan/i/` anchor exists on `/account` for a dating host. The dead link manifests only for slug-less saved *planner* plans (legacy data); it is not a hazard for the dating loop. Re-scope this item to the legacy-planner cleanup, not the P0/E2 nav fix.
- **C12 / D2 (Door 2) should be RE-CLASSIFIED from "canvas lacks publish CTA" to "Door 2 hard dead-end / `create_blank_itinerary` unapplied."** The audit's framing (stranded on the canvas) is too mild — the host never reaches a canvas. E11's "add a publish CTA on the Door-2 canvas" is moot until the blank-itinerary RPC is applied; sequence the RPC migration before any canvas-CTA work.
- **ISSUE #15 / E3 is cheaper than scoped.** A complete host hub already exists at `/account`; E3 can largely become a nav-repoint + profile-view rather than a build-from-scratch.

No Section C/D item that was actually *walked* came back NOT_REPRO except C10. Everything reachable in the happy-path scope CONFIRMED (two items WORSE). The UNREACHED items (C2, C3, C5, C6, C9, D13, D16) are guard/error/lifecycle/safety states that a happy-path walk cannot trigger — they remain assertions from the static read, NOT live-verified, and should stay flagged as such in the queue.

---

## Verdict tally

- **Section C (14):** 7 CONFIRMED · 1 WORSE (C12) · 1 NOT_REPRO (C10) · 5 UNREACHED (C2, C3, C5, C6, C9).
- **Section D (17):** 12 CONFIRMED + 2 INDIRECT (D3, D17, counted in CONFIRMED) · 1 WORSE (D2) · 2 UNREACHED (D13, D16).
- **Combined:** 19 CONFIRMED · 2 WORSE · 1 NOT_REPRO · 7 UNREACHED.
- **6 new issues** surfaced live (offer "the night" empty-but-labelled; possible detail-sheet lost-swipe race; nav-orphaned `/account` hub; 4 missing marketplace RPCs; brand-serif regressions; anon /create city-ignored).
