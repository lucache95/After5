# Feature Gap Audit — Create / Evaluate / Manage

Date: 2026-06-01
Scope: READ-ONLY completeness audit of three flows on prod (`ufufmcpnysvwtutpbian`) + code.
Method: code in `apps/web`, `packages/*`, `supabase/functions`; prod schema + edge fns via MCP.

## Summary table — gaps by priority

| # | Blocks user from… | Area | Verdict | Single worst gap |
|---|---|---|---|---|
| P0 | **Evaluating a date before swiping** | B | **MISSING** | Feed card has NO tap-through / detail view. Candidate swipes on a coarse summary (title, why-note, vibe tags, hour bucket, neighborhood) with zero access to stops, venues, cost, story. The entire "match on the night" premise is unverifiable by the swiper. |
| P1 | **Managing profile + adding socials** | C | **PARTIAL → mostly MISSING** | After onboarding there is NO edit UI for any dating field (bio, vibe_tags, age, gender, prefs, photo). `instagram_handle` column exists but is written by NOTHING in the app. `/account` only edits planner fields (first_name/city/neighborhood). |
| P2 | **Creating + posting a date** | A | **EXISTS** (one gap) | Full path works end-to-end. Only gap: you can only post from an *existing saved/public itinerary*; there is no "set venue/time on this specific night" beyond a datetime picker (venue is inherited from the itinerary, `post_night` `p_venue` is never passed by the UI). |

---

## Area A — Date creation & AI generation → posting a night — **EXISTS**

The full host path is built and live.

**AI planner (works):**
- Route `apps/web/app/plan/page.tsx` — 5-step wizard (occasion/when/intent → time-of-day/duration → vibe → budget/effort/where/radius → must-haves/note), plus themes and "surprise me". Calls edge fn `generate-plan` via `supabase.functions.invoke('generate-plan', { body })` (line ~421).
- `generate-plan` is **deployed and ACTIVE on prod** (id `dc187589…`, version 41).
- Results render in `ResultsView` using `components/itinerary/ItineraryView` (gallery hero, map, stop cards, story).
- Anonymous users hit an email gate; logged-in users skip straight to results. Itineraries persist to `itineraries` (confirmed columns incl. `stops jsonb`, `title`, `hook`, `why_it_works`, `cover_image_url`, `vibe_tags`, `pay_setting`, `slug`).

**Itinerary → posted night (works):**
- Route `apps/web/app/nights/new/page.tsx` — gated on `dating_enabled && verification='verified'`, else redirect `/onboarding`. Loads up to 30 of the user's own + public itineraries.
- `apps/web/app/nights/new/PostNightForm.tsx` — pick a plan (radiogroup, a11y-correct) + `datetime-local` start, future-date validation, then `postNight(...)`.
- `packages/api-client/src/feed.ts` `postNight()` calls RPC `post_night(p_itinerary, p_starts_at, p_venue, p_duration_min)`.
- **Confirmed on prod:** `post_night(p_itinerary uuid, p_starts_at timestamptz, p_venue uuid, p_duration_min int)` exists; writes to `date_instances` (confirmed: `itinerary_id`, `creator_id`, `starts_at`, `duration_min`, `time_range tstzrange`, `status`, `is_seed`). On success → `toast` + `router.push('/home')`.

**Entry points (works):** the empty-feed "post your own night" link in `SwipeDeck.tsx` `EmptyDeck` → `/nights/new` (both `thin` and exhausted tiers). `/account` dating-loop nav also links `/nights/new`.

**Gaps / partial:**
- `mk_instance` is NOT a standalone public function on prod (only `post_night`, `browse_feed_for_viewer`, `record_swipe`, plus the match-* set). `post_night` is the single posting RPC; `mk_instance` either doesn't exist or is inlined — the contract in the audit brief is served by `post_night`.
- **Venue is not user-settable at post time.** `post_night` accepts `p_venue` but `PostNightForm` never passes it (`venue_id` is omitted; defaults to itinerary's venue/null). No UI to "set the venue/time/place" per night beyond start time + a fixed 150-min default duration.
- "At home tonight" location option in the planner is hard-disabled ("Coming soon").

**To complete (bite-sized):**
1. (Optional) add a venue picker / duration field to `PostNightForm`, pass `venue_id` + `duration_min` to `post_night`.
2. Surface a "post this night" CTA directly from `/plan` results and `/dates/[slug]` so the create→post handoff isn't only reachable via `/nights/new`.

---

## Area B — Pre-swipe date DETAIL view — **MISSING**

This is the biggest gap. The premise is "swipe on the date," but the swiper cannot see the date.

**What the feed actually shows** (`apps/web/app/feed/NightCard.tsx`, type `FeedNight` in `packages/api-client/src/feed.ts`):
- cover image, `title`, `why_note`, up to 4 `vibe_tags`, a **coarse** time (`weekday · hour` bucket — deliberately blind, no minute), `venue_neighborhood` (neighborhood only, not the venue), `distance_m`, `pay_setting`.
- `FeedNight` carries NO stops, NO venue names, NO cost, NO itinerary id, NO full story. By design `browse_feed_for_viewer` returns only this thin, blind projection.

**No way to drill in:**
- `apps/web/app/feed/SwipeDeck.tsx` — the `ActiveCard` is a draggable `motion.div` with `onDragEnd` only. **No `onClick`, no tap handler, no modal, no expand, no link.** `NightCard` renders a plain `<article>` with no interactive affordance.
- There is **no `/feed/[id]` or per-`date_instance` detail route.** `apps/web/app/dates/[slug]/page.tsx` exists but is the **public SEO page for a generated itinerary** (gated `is_public=true`, keyed by slug not `date_instance_id`, shows full venue names/addresses/map) — it is NOT blind, NOT linked from the feed, and not tied to the night being swiped. `apps/web/app/plan/i/[id]` is the legacy UUID version of the same public page.

**What COULD be shown but isn't:** `components/itinerary/ItineraryView` already renders the full rich detail (gallery hero, map, per-stop `StopCard` with `place_name`/`photo_url`/`estimated_cost_pp`/`duration_min`/`neighborhood`, "things to know", story). The underlying `itineraries.stops jsonb` + `Stop` type (`itinerary-types.ts`) contain everything a swiper would want. None of it reaches the feed.

**Verdict:** A user CANNOT meaningfully evaluate a date before swiping. They see a title, a one-line note, vibe stickers, and a fuzzy time/neighborhood — then must commit left/right. The product's core promise is not deliverable in the current UI.

**To complete (bite-sized):**
1. Decide the blind contract: which itinerary fields are safe to reveal pre-match (stops, cost, story, full vibe) vs. kept blind (creator identity, exact venue address, precise time). Identity is already firewalled out of `FeedNight`.
2. Add a `date_instance`-scoped detail read (new RPC e.g. `get_night_detail(p_instance)` returning the joined itinerary `stops`/`total_cost_pp`/`hook`/`why_it_works`/full vibe, minus creator identity) — RLS-safe, blind-respecting.
3. Add tap-to-open on the `ActiveCard` (a bottom-sheet/modal using existing `ItineraryView` building blocks, or a `/feed/[instanceId]` route) so the swiper reads the full plan, then swipes from inside the detail.
4. Wire swipe (`record_swipe`) actions into the detail view so a user can decide after reading.

---

## Area C — Profile editing (post-onboarding) — **PARTIAL (mostly MISSING for dating)**

Onboarding collects the data; nothing lets the user edit it afterward, and socials are collected nowhere.

**Schema reality (prod-confirmed):**
- `profiles`: `first_name`, `city`, `neighborhood`, `age`, `vibe_tags[]`, `gender`, `gender_preferences[]`, `age_pref int4range`, `distance_pref_km`, `dealbreakers[]`, `prompt_answers jsonb`, `blurred_photo_url`, `clear_photo_url`, `verification`, `dating_enabled`, etc.
- `profiles_private`: `full_name`, `phone`, `birthdate`, `bio`, **`instagram_handle`**, `emergency_contact jsonb`.
- Photos storage: bucket `profile-photos` (private). **One photo per user** — `<uid>/clear.jpg` + generated `<uid>/blurred.jpg`. No multi-photo table, no gallery, no ordering. (`place_vibe_images` is unrelated — venue art.)

**Onboarding writes (one-time only):**
- `BasicsStep.tsx`: `first_name`, `bio` (→ `profiles_private`), `vibe_tags`.
- `PreferencesStep.tsx`: `gender`, `gender_preferences`, `age_min/max`, `distance_pref_km`, `dealbreakers`.
- `PhotoStep.tsx`: single photo upload → `profile-photos/<uid>/clear.jpg` → `generate-blur` edge fn.

**Post-onboarding edit UI — per field:**

| Field | Exists in schema | Editable after onboarding? |
|---|---|---|
| first_name | yes | **YES** — `apps/web/app/account/ProfileForm.tsx` |
| city | yes | **YES** — ProfileForm |
| neighborhood | yes | **YES** — ProfileForm |
| bio | yes (`profiles_private`) | **NO edit UI** (set once in onboarding) |
| vibe_tags | yes | **NO edit UI** |
| age / birthdate | yes | **NO edit UI** (birthdate is intentionally non-self-settable; age derived) |
| gender / gender_preferences | yes | **NO edit UI** |
| age_pref / distance_pref / dealbreakers | yes | **NO edit UI** |
| photo (replace) | yes (single) | **NO edit UI** — re-upload only reachable by replaying onboarding |
| photos (add/remove/reorder/multiple) | **NO** — single-photo model | **MISSING entirely** |
| **instagram / socials** | column exists (`instagram_handle`) | **NO input anywhere** — grep shows `instagram_handle` only in generated types (`packages/types/src/database.ts`); zero reads/writes in `apps/web`, onboarding, or any edge fn. |

`apps/web/app/account/page.tsx` "Profile / How we know you" section renders only `ProfileForm` (first_name/city/neighborhood) — explicitly the planner profile, not the dating profile. There is no `/profile` route at all.

**Verdict:** A user can edit planner basics but CANNOT edit their dating profile (bio, vibe, prefs, gender), CANNOT replace/add/reorder photos, and CANNOT add Instagram or any social — the field exists in the DB but has no UI surface.

**To complete (bite-sized):**
1. Build a dating-profile editor (new `/account/profile` or `/profile/edit`) reusing the onboarding step components (`BasicsStep`, `PreferencesStep`, `PhotoStep`) in an "edit" mode that hydrates current values and updates instead of advancing onboarding.
2. Add `instagram_handle` (and any other socials) as a field — input in onboarding `BasicsStep` and/or the new editor; write to `profiles_private`. Decide reveal timing (likely post-match, alongside `clear_photo_url`).
3. Add photo replace in the editor (re-run upload + `generate-blur`). If multiple photos are desired, that needs a schema change (new `profile_photos` table with order + a multi-upload UI) — currently a single-photo model.
4. Confirm column-level RLS grants allow self-update of `bio`/`instagram_handle` on `profiles_private` (BasicsStep already writes `bio`, so the grant pattern exists).

---

## Notes / caveats
- All three core RPCs (`post_night`, `browse_feed_for_viewer`, `record_swipe`) and `generate-plan` are live on prod; Area A is genuinely functional, not stubbed.
- `match_v2_enabled` global flag state was NOT checked here (out of scope; see prior memory note that it was left ON).
- Audit did not click-test live; verdicts are from code + schema + deployed-function state.
