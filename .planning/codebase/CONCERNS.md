# Codebase Concerns

**Analysis Date:** 2026-06-03

This audit consolidates findings from the MVP-AUDIT and LIVE-NAV-VERIFY reports, plus direct codebase inspection. The product vision — "swipe on the date, not the face" / marketplace-first dating with progressive reveal and a complete loop — is partially implemented; the core happy path is strong, but navigation, lifecycle, reveal mechanics, and marketplace completeness have significant gaps.

---

## Tech Debt

### Missing Critical RPCs (Marketplace Blockers)

**Issue:** Four marketplace RPCs referenced in handlers or required by MVP are completely missing from the database:

- `reject_candidate` — No way for hosts to decline a queued candidate; new-interest list append-only
- `update_night` — No way to fix typos/errors in a posted night; immutable posts
- `cancel_night` — No pre-match unpublish for `seeking` nights; host must wait for a match to cancel
- `create_blank_itinerary` — "Door 2" (scratch) cannot proceed; gated migration 20260603120100 unapplied to prod

**Files:** 
- Handler dispatch expecting these: `supabase/functions/process-jobs/handlers.ts:73-83`
- Gated but unapplied: `supabase/migrations/20260603120100_m85_create_blank_itinerary.sql`

**Impact:** 
- Hosts cannot edit/delete/reject on the supply side (breaks "complete marketplace" thesis)
- Door 2 hard dead-end on any env where migration 20260603120100 is unapplied (likely prod)
- Calls to missing RPCs would trigger `PGRST202 / 42883` errors (function not found) and fail jobs silently

**Fix approach:** 
1. Add `reject_candidate(p_actor, p_instance, p_queue_entry)` RPC — update queue entry status, return to `new_interest`
2. Add `update_night(p_actor, p_night, p_time?, p_venue?, p_duration?, p_ambient?)` RPC — owner-only edits of `seeking` nights
3. Add `cancel_night(p_actor, p_night, p_reason)` RPC — soft-delete `seeking` night, optional pre-match notification
4. Apply 20260603120100 to prod in a gated batch, verify via security advisor, test Door 2 end-to-end

### Dead/Missing RPCs Referenced in Job Handlers (Poison-Loop Risk)

**Issue:** Five RPCs are called by process-jobs handlers but never defined; enqueuing any of these job types crashes the job queue:

- `match_stale_date_close(p_instance)` — Line 73
- `match_expire_pending(p_queue_entry)` — Line 75
- `match_reconfirm_timeout(p_lock)` — Line 78
- `process_deletion(p_user)` — Line 83
- `analytics_relay_drain(p_batch)` — Line 84

**Files:** `supabase/functions/process-jobs/handlers.ts:69-86`

**Impact:** 
- If a job of type `stale_date_close`, `pending_expiry`, `reconfirm_timeout`, `deletion_process`, or `analytics_relay` ever enqueues, the handler loop will throw `RPC function not found` and FAIL the entire job batch
- No producer currently enqueues these (they're dead handlers), so risk is low TODAY but CRITICAL if lifecycle/safety features (P0 E5, E19) are later wired
- The audit flags P0 E9 "remove poison-loop risk" as blocking any new job scheduling

**Fix approach:** 
- **Option A (Preferred):** Implement the missing RPCs as stubs that succeed safely, then implement real logic (Lifecycle: E5 / Safety: E19)
- **Option B:** Remove the handler entries entirely; re-add only when the RPC exists and is ready to dispatch
- Do this BEFORE scheduling any new jobs (E5 lock-complete, E19 safety flows)

---

## Known Bugs

### Lock Status Never Reaches `completed` (Lifecycle Broken)

**Symptoms:** 
- After a successful date, lock remains `active` forever
- No mechanism transitions `locks.status` from `active` → `completed`
- The "mark date done → review → trust" journey is permanently broken
- Cancel button persists on past-dated locked dates with no completed fallback

**Files:** 
- Lock schema: `supabase/migrations/20250525120700_p0_locks.sql:3-18`
- Status enum defined with `completed` value but never set: `/Users/lucas/Projects/After5/supabase/migrations/20250525120700_p0_locks.sql`
- Match detail page: `apps/web/app/matches/[lockId]/page.tsx` (no transition to completed)
- Lifecycle handler (missing): No RPC `close_lock` or equivalent

**Impact:** 
- Locks stay `active` indefinitely; rating window (`close_rating_window`) is the only state change
- Cannot verify date actually happened or reach `no_show` state
- Reliability score computation (`E17`) blocked — no way to know which locks are completed vs. flaked
- Past-dated locks show stale UI (offer-screen "the night" label with no stops; persistent cancel button)

**Workaround:** None; this is the lifecycle terminus and must be designed.

**Fix approach:** 
- Add `close_lock_on_date_end(p_lock)` RPC that transitions `active` → `completed` and sets `completed_at`
- Enqueue a job at lock creation time: type `lock_complete_job`, run_after = `date_instance.starts_at + <buffer>`
- Handler dispatches the RPC; user can then rate the date
- See P0 E5 in the audit queue

### Poison-Loop Risk: Dead Job Handlers Can Crash the Entire Queue

**Symptoms:** 
- If any job of type `stale_date_close`, `pending_expiry`, `reconfirm_timeout`, `deletion_process`, or `analytics_relay` is ever enqueued, the process-jobs function throws on the missing RPC and fails the ENTIRE batch

**Files:** `supabase/functions/process-jobs/handlers.ts:69-86`, `supabase/functions/process-jobs/index.ts` (dispatch loop)

**Impact:** 
- Job queue poisoned; subsequent jobs in the batch do not run
- A single misconfigured producer enqueuing an invalid job_type halts all background work
- Currently low-risk (no producer for these types), but CRITICAL blocker for safety/lifecycle features

**Trigger:** Any code path that calls `enqueue_job('stale_date_close', ...)` or similar without a matching handler RPC

**Fix approach:** See "Dead/Missing RPCs" tech debt above; P0 E9

### Past-Dated `seeking` Nights Never Transition

**Symptoms:** 
- A night posted with `starts_at` in the past stays `seeking` forever
- No cron sweeps stale nights; no `cancel_night` path; host cannot edit/delete
- The night renders identically to a live night; only action (make offer) is meaningless
- Stale-night accumulation over time

**Files:** 
- Night status enum: `supabase/migrations/20260525120500_p2_date_instances.sql` (no auto-transition for past dates)
- MyNights view: `apps/web/app/my-nights/page.tsx` (no visibility into stale nights)
- Post-date sweep job: Does not exist (would need enqueue_job in a cron)

**Impact:** 
- Database bloats with unreachable historical nights
- Hosts see stale entries in `/my-nights` with no way to clean up
- Feed may serve stale nights if the sweep is not eventually added

**Fix approach:** 
- Add a cron endpoint `/api/cron/sweep-stale-nights` that daily marks nights `seeking` with `starts_at < now()` as `cancelled` with reason `expired`
- Link to E5 / E6 in the execution queue

### `ItineraryEditor` (Door 2 Canvas) Has No Publish CTA

**Symptoms:** 
- User clicks "start from scratch" → Door-2 canvas opens (IF migration 20260603120100 applied)
- Canvas loads, user builds a night, clicks save → night is silently saved
- Zero affordance to move to `/nights/new` or publish
- Door 2 user is stranded on the canvas with no forward path

**Files:** `apps/web/app/plans/[id]/edit/ItineraryEditor.tsx:209-216` (save button only, no publish CTA)

**Impact:** 
- Scratch builders cannot complete the flow; generated (Door 1) nights are the only entry
- Asymmetry: Door 1 has `PublishToFeedButton`, Door 2 has nothing
- The hidden journey: user must manually navigate to `/nights/new` and re-enter their plan

**Fix approach:** 
- Add a "ready to post" or "next: schedule & publish" button that either:
  - Redirects to `/nights/new?itinerary_id=${id}` with the blank night id pre-filled, OR
  - Renders `PostNightForm` inline on the canvas (less friction)
- See P1 E11 in the audit queue

### Offer Screen Shows "the night" But Only Date/Time (No Stops/Venues)

**Symptoms:** 
- `/offers/[offerId]` renders a "the night" section with only date and time (e.g., "Monday, Jun 8, 3:27 PM")
- No itinerary, stops, venues, or experience description visible
- The plan that was the entire basis of the match is invisible at the moment it should pay off
- Live-nav audit confirms this is actively misleading (labeled section with empty content)

**Files:** `apps/web/app/offers/[offerId]/page.tsx` or `OfferDetail.tsx`

**Impact:** 
- Candidate sees only a time, not the plan they're saying yes to
- Misalignment with "every match already has a real plan attached" thesis
- Acceptance is made on faith, not on the experience

**Fix approach:** 
- Fetch the full night/itinerary from the offer → date_instance → `stops` field
- Render the rich detail (venues, times, cost, hook, vibe) on `/offers/[offerId]` (P1 E13)

### `new_message` Notification Deep-Links to `/matches` (A List), Not the Actual Thread

**Symptoms:** 
- New message arrives → notification fires → `hrefFor()` returns `/matches` (a lock list)
- User taps → lands on the lock list, not the thread
- Must manually find and tap the lock, then the message thread
- For a pull-through notification, this breaks conversion

**Files:** `apps/web/lib/after5/notif-map.ts:48`

**Impact:** 
- Notification → actual message requires 2 taps instead of 1
- Reduces engagement; users may not complete the tap path

**Fix approach:** 
- Notification payload must carry `lock_id` or `thread_id`
- `hrefFor` for `new_message`: Extract `lock_id` from payload, return `/matches/${lock_id}` (then JS navigates to the thread tab)
- Ensure job enqueuing new_message notifications includes the lock_id in the payload (Chat's P6/S7)

---

## Architecture & Navigation Gaps

### Dead-End Routes (No Back Button, No Nav Chrome)

**Issue:** Multiple deep routes are completely orphaned from the primary navigation and have no back affordance. Users are trapped except via browser-back.

| Route | Problem | Files |
|-------|---------|-------|
| `/messages/[threadId]` (+ re-export `/inbox/[threadId]`) | No back, no bottom nav, no outbound links to profile/match/night; only browser-back | `apps/web/app/messages/[threadId]/Conversation.tsx:151-178` |
| `/matches/[lockId]` (match detail) | No bottom nav, no back; only forward (message/rate); nav-orphaned | `apps/web/app/matches/[lockId]/page.tsx`, `LockDetail.tsx` |
| `/matches/[lockId]/rate` terminal states | "not yet" / "already rated" — pure text, zero links/nav | `apps/web/app/matches/[lockId]/rate/page.tsx` |
| `/account/notifications` | No inbound link anywhere + no nav chrome/back; URL-only trap | `apps/web/app/account/notifications/page.tsx` |
| `/dates/[slug]/interested` (host candidate list) | No back, no bottom nav; host trapped except browser-back | `apps/web/app/dates/[slug]/interested/InterestedList.tsx` |
| `/offers/[offerId]` (active state) | No neutral back; only accept/pass/withdraw or browser-back | `apps/web/app/offers/[offerId]/page.tsx` |
| Guard/error states ("not your match", "couldn't load") | Link-less terminals with no recovery path | Various page.tsx files (see audit) |

**Impact:** 
- Users cannot navigate naturally back into the app; UX is degraded
- Mobile patterns violated (no back affordance)
- Dropped users at the end of a funnel

**Fix approach:** 
- **P0 E1 (MVP blocker):** Add `BottomTabShell` or contextual header with back button to all deep routes
- Special cases: `/matches/[lockId]` → add "back to dates" or "back to my matches" link; `/messages/[threadId]` → add thread-back + nav
- Audit Section C lists all 14 dead-ends

### `BottomTabShell` Points "Profile" Tab to Wrong Screen (ISSUE #15)

**Symptoms:** 
- Bottom nav "profile" tab (line 24 of BottomTabShell) points to `/home`
- `/home` is the `FirstSessionHome` marketing teaser (explainer, gallery, referral)
- Real profile editor lives at `/account/profile`, nav-orphaned
- Real host hub (browse / matches / my nights) exists at `/account` but is nav-orphaned

**Files:** 
- Nav definition: `apps/web/components/BottomTabShell.tsx:20-25`
- Wrong target: `apps/web/app/home/page.tsx` (marketing teaser)
- Orphaned hub: `apps/web/app/account/page.tsx` (rich, well-built)
- Real profile editor: `apps/web/app/account/profile/ProfileEditor.tsx`

**Impact:** 
- Tab mislabeled; primary action lands on onboarding content, not user's data
- The entire host hub (`/account`) is nav-invisible
- ISSUE #15 root cause

**Fix approach:** 
- **P0 E2 / E3 (nav + profile hub):** Repoint profile tab to `/account` (the existing hub)
- Or create a new profile destination that aggregates: identity card (photo/name/age/verification), profile editor link, edit-preferences link, account settings
- The live-nav audit notes that `/account` is mostly BUILT; E3 is cheaper than scoped (just add a profile-view card + repoint the tab)

### "Dates" Tab Points to `/my-nights` (Posted Nights), Not `/matches` (Matched Dates)

**Symptoms:** 
- User's actual locked dates live at `/matches`
- "Dates" tab in `BottomTabShell` points to `/my-nights` (host's posted nights, not locked dates)
- Users see their posts, not their matches; confusing labeling

**Files:** `apps/web/components/BottomTabShell.tsx:22`

**Impact:** 
- Tab is mislabeled or misrouted; primary discovery path to matched dates is hidden
- Matches list is nav-orphaned, only discoverable by URL or from push notifications

**Fix approach:** 
- **P0 E2:** Retarget the "dates" tab to `/matches`, OR
- Add a sub-navigation inside `/my-nights` to toggle between "posts" and "matches"
- Or rename the tab to "my posts" and add a separate "matches" entry (space-constrained on mobile)

### Feed Filters Are Placeholder (No Real Filtering)

**Issue:** `FilterSheet.tsx` is visually complete but has no actual filtering logic.

**Symptoms:** 
- Tap the gear button on `/feed` → FilterSheet opens
- Day-scope toggle (today/tomorrow/this-week) exists but only changes a heading; does not filter results
- Browse_feed_for_viewer accepts no filter params
- No price / distance / host-gender / vibe / who-pays filtering
- Audit flags this as HIGH severity (marketplace discovery is blocked)

**Files:** 
- Filter UI: `apps/web/app/feed/FilterSheet.tsx`
- Swipe deck: `apps/web/app/feed/SwipeDeck.tsx:33-53` (filter state defined but unused)
- RPC: `supabase/migrations/20260602120400_m4_browse_feed_ambient.sql` (no filter params)
- Missing schema: `profiles.feed_filters` and `date_instances.target_genders`, `target_age_range`, `search_radius_km` do not exist

**Impact:** 
- "Swipe on the date, not the face" requires narrowing by experience attributes (vibe, cost, who-pays, time)
- Without real filters, the deck is a random firehose; no way to find compatible nights

**Fix approach:** 
- **P1 E10 (largest P1 item, split into 3 slices):**
  1. Add schema: `profiles.feed_filters` (JSON array), `date_instances.target_genders/age_range/search_radius_km`
  2. Update `browse_feed_for_viewer` RPC to accept filter params and apply WHERE clauses
  3. Build real `FilterSheet` UI with max-price, max-distance, host-gender, vibe-tag, who-pays checkboxes
  4. Add keyset pagination (static 20-card deck hits empty prematurely)

### No Creator Controls: Who-Pays, Vibe-Tags, Radius, Cover Upload, Scheduling

**Issue:** Host posting a night has no control over critical marketplace signals.

**Symptoms:** 
- Post night flow (`PostNightForm`, `/nights/new`) shows only date/time and ambient sound
- No UI for: `pay_setting`, `vibe_tags`, `why_note`, per-night `search_radius_km`, cover-image upload
- All exist server-side (in schema) but are unreachable by creators
- Generated nights publish with hardcoded date (+2d 18:00) + `PublishToFeedButton` offers no controls
- Scratch nights ship imageless (no cover upload, limited to Google-Photos from stops)

**Files:** 
- Post form: `apps/web/app/nights/new/PostNightForm.tsx:1-100` (date/time/ambient only)
- Publish button: `apps/web/app/create/PublishToFeedButton.tsx` (hardcoded date, no controls)
- Missing controls: vibe-tags / who-pays picker, cover uploader, radius slider

**Impact:** 
- Nights lack vibe/experience signals; discovery is purely chronological
- Hosts cannot control who sees their night (all default to global)
- Cover images missing for scratch-built nights; feed dominance by generated itineraries
- No who-pays signal → candidate cannot filter by Dutch treat / host pays / split options

**Fix approach:** 
- **P1 E11 (split into 2 slices: settings + upload):**
  1. Add UI controls to `PostNightForm`: vibe-tag chips (multi-select), who-pays radio, search-radius slider, cover-image upload
  2. Converge `PublishToFeedButton` and `/nights/new`: carry generated itinerary id, same controls
  3. Implement storage bucket for cover images; sign URLs server-side
  4. Update `post_night` RPC to accept `pay_setting`, `vibe_tags`, `why_note`, `search_radius_km`, `cover_image_path`

### No Host Rejection of Candidates (Append-Only Interest List)

**Issue:** Hosts can only accept or ignore candidates; no formal reject/dismiss path.

**Symptoms:** 
- `/dates/[slug]/interested` shows new interests and a shortlist
- Host can tap "send offer" (accept) or ignore
- No decline/dismiss button; uninterested candidates stay in the new list forever
- Interest list grows unboundedly; no cleanup

**Files:** `apps/web/app/dates/[slug]/interested/InterestedList.tsx:1-50`

**Impact:** 
- New-interest list bloats over time
- Hosts cannot signal disinterest; the marketplace cannot learn preferences
- Asymmetry: candidates can pass offers; hosts cannot pass interests

**Fix approach:** 
- **P1 E12:**
  1. Add `reject_candidate(p_actor, p_instance, p_candidate)` RPC (see Tech Debt above)
  2. Update queue entry status to `rejected`; soft-delete from the new list
  3. Add decline button to `InterestedList` next to "send offer"

---

## Security & Privacy Concerns

### Progressive Reveal Not Implemented (Binary Gate Only)

**Issue:** The headline mechanic — progressive reveal of host identity — is a binary on/off gate, not a ladder.

**Symptoms:** 
- **Browse (pre-match):** Feed shows ZERO host identity (correct)
- **Offer received (match):** Instant full clear profile with name, age, city, photo (all-or-nothing)
- No "limited" tier showing, e.g., blurred photo + first name + city only
- The blur pipeline (`generate-blur`, `blurred_photo_url`, `blurred_path` fields) exists but is orphaned — no screen displays a blurred photo
- `signBlurredUrls()` helper does not exist (audit flagged this)

**Files:** 
- Binary gate: `supabase/migrations/20260527126500_p5_match_reveal.sql`, `20260527126600_p5_reveal.sql`
- Orphaned blur pipeline: `supabase/functions/generate-blur/index.ts` (fully implemented but unused)
- Schema fields (defined but unused): `profiles.blurred_photo_url`, `profile_photos.blurred_path`
- Feed contract: `apps/web/lib/after5/client.ts` (FeedNight carries no host info)
- Detail sheet: `apps/web/app/feed/NightDetailSheet.tsx:317` (states "host stays anonymous")

**Impact:** 
- "Swipe on the date, not the face" is not representable — the face does not appear until full reveal
- Privacy protection is all-or-nothing (safer, but less nuanced)
- Pre-built UI infrastructure (blur function, signed-URL helpers) is wasted

**Fix approach:** 
- **P2 E15 (highest-leverage vision item; split into 3 slices):**
  1. Define three tiers: pre-match blurred/limited, offer-stage partial (blurred photo + first name + city), post-lock full
  2. Feed card: Add `blurred_photo_url` field to `FeedNight` (computed at browse time), render as the hero
  3. Offer detail: Show partial profile (blurred photo, first name, city, vibe-tags only)
  4. Post-lock: Show full profile (current behavior)
  5. Implement `signBlurredUrls()` helper + RLS gating per tier
  6. See audit E15 for details

### Column-Level PII Projection at Reveal Gate Missing

**Issue:** Reveal relies on UI voluntarily selecting Tier-3 columns; no database-level redaction.

**Symptoms:** 
- The `match_reveal_allowed` RPC opens the full `profiles` row to the counterpart
- No RLS policy limits which columns are readable; full profile (including internal fields, if any) exposed
- Audit flags this as a LOW-severity structural gap

**Files:** `supabase/migrations/20260527126500_p5_match_reveal.sql`

**Impact:** 
- If a new internal/sensitive column is added to `profiles`, reveal automatically leaks it
- No defense-in-depth; depends on client-side restraint

**Fix approach:** 
- Add RLS policy: `CREATE POLICY reveal_pii_gated ...` that limits readable columns based on reveal tier
- Or use a `profiles_limited` view that projects only safe columns (name, age, city, photo_url, vibe_tags)
- Return the view from match_reveal_allowed's query instead of the full row
- Low-priority (backend-hardening, not a blocker)

---

## Marketplace & Journey Gaps

### Host Never Notified of Candidate Interest (Demand → Supply Signal Broken)

**Symptoms:** 
- Candidate swipes right → `match_ingest_interest` → `queue_entry` created
- Nothing else happens
- Host learns of interest only by manually opening `/my-nights`
- The "new interest" count renders, but no proactive notification

**Files:** 
- Interest ingestion: `supabase/migrations/20260527126200_p5_shortlist.sql`
- Notification type defined: `apps/web/lib/after5/notif-map.ts:77` (`interest_received`)
- But never dispatched: No `dispatch_notification(..., 'interest_received', ...)` call in the match_ingest_interest path

**Impact:** 
- Marketplace is invisible to supply; hosts are passive
- Demand → supply feedback loop broken
- The loop closes only if the host happens to check

**Fix approach:** 
- **P0 E8:**
  1. Update `match_ingest_interest` RPC to call `dispatch_notification('interest_received', payload: {date_instance_id})`
  2. Notification deep-links host to `/my-nights` (or the specific interested list)
  3. Mark the new interest in the list as "just arrived" (visual cue)

### Offer Delivery Depends on Blank RESEND Key + Best-Effort Email

**Symptoms:** 
- Candidate receives an offer
- The system tries to send an email via Resend (blank env var), fails silently
- Candidate's only discovery path is via `/inbox` notifications
- If notifications don't surface (edge function issue, user dismissal), offer is unreachable

**Files:** 
- Notification dispatch: `supabase/functions/_shared/notify.ts` (uses RESEND_API_KEY)
- Env var: `.env.local` or Vercel secrets (BLANK in many envs)
- Notification map: `apps/web/lib/after5/notif-map.ts:40` (`offer_received` type)

**Impact:** 
- Offer flow depends on in-app notification surfacing (not reliable on cold-start)
- Email is a fallback, not a primary delivery mechanism
- Candidate may miss the offer entirely if notifications aren't implemented

**Fix approach:** 
- **P1 E14 (offer delivery reliability):**
  1. Move email sending to a server runtime (not edge; edge can't guarantee cleanup)
  2. Set RESEND key in Vercel env (not in edge function deno.json)
  3. Verify notification dispatch is reliable (in-app + email as backup)
  4. Add `offer_received` deep-link test to smoke suite

### Ratings Compute Nothing (Trust Loop Dead-End)

**Symptoms:** 
- `match_ratings` table exists and captures post-date ratings
- `reliability_score` is read (displayed as badge) but never computed from `match_ratings`
- The entire trust loop is a write-only operation
- Badge shows a stale or default score with no basis in data

**Files:** 
- Ratings write: `apps/web/app/matches/[lockId]/rate/page.tsx` (captures the form)
- Score badge: `supabase/migrations/20260525122700_p1_badge_view.sql` (SELECT from profiles, no aggregation)
- Missing: RPC `aggregate_reliability_score(p_user)` that sums ratings, computes percentile, updates `profiles.reliability_score`

**Impact:** 
- Trust signal is non-functional; ratings are collected but not surfaced
- Candidates cannot see who is reliable (badge is a lie)
- No feedback loop; hosts don't see how ratings affect their profile

**Fix approach:** 
- **P2 E17:**
  1. Add `aggregate_reliability_score(p_user)` RPC that computes mean/median of recent `match_ratings.rating` values
  2. Update `profiles.reliability_score` with the result
  3. Enqueue a job to recompute after `rating_window` closes (on-demand, not continuous)
  4. Verify badge correctly reflects the computed score

### Safety Flows Never Fire (Handlers Exist, Producers Missing)

**Symptoms:** 
- Job handlers for `day_of_reconfirm` and `safety_checkin` exist in process-jobs (`handlers.ts:76-77`)
- But nothing enqueues these jobs; no producer calls `enqueue_job('day_of_reconfirm', ...)`
- Safety flows are designed but disabled; no safety signal to users

**Files:** 
- Handlers: `supabase/functions/process-jobs/handlers.ts:76-77`
- Missing producers: No code path calls `enqueue_job` with these job_types
- Missing RPCs: `match_reconfirm_timeout`, `match_stale_date_close` don't exist (poison-loop risk)

**Impact:** 
- Dates proceed without reconfirmation ("still on?") or check-in ("you good?")
- Safety is not operationalized; it's documentation-only
- Candidates are unaware the system has safety features

**Fix approach:** 
- **P2 E19:**
  1. Implement `match_reconfirm_timeout` and related safety RPCs
  2. At lock creation time, enqueue `day_of_reconfirm` job with run_after = start_at - 24h
  3. At start time, enqueue `safety_checkin` job with run_after = start_at + <buffer>
  4. Handlers dispatch notifications; users tap to confirm
  5. See audit E19 for details

### Dating Preferences Are Write-Once

**Symptoms:** 
- `/onboarding/preferences` captures age range, distance, gender, dealbreakers
- No link back from any account/settings surface; preferences are immutable post-signup
- User cannot adjust who they see without re-signing up

**Files:** `apps/web/app/onboarding/preferences/page.tsx` (only entry point)

**Impact:** 
- User is stuck with onboarding choices
- Marketplace cannot respond to changing preferences (seasonal, relocation, etc.)
- Minor but frustrating UX gap

**Fix approach:** 
- **P0 E4:**
  1. Add an editable preferences surface in the profile hub (age/distance/gender/dealbreakers)
  2. Link from `/account` or `/account/profile`
  3. Update `browse_feed_for_viewer` to filter by these live prefs (requires E10 schema changes)

---

## Orphaned Code & Legacy Cruft

### Blur Pipeline Orphaned (No Display Layer)

**Issue:** The `generate-blur` function is fully implemented and tested but never surfaces a blurred photo.

**Files:** `supabase/functions/generate-blur/index.ts` (complete, unit-tested)

**Impact:** 
- Bandwidth and complexity for zero UX benefit (until E15 progressive reveal is built)
- Code maintenance burden; if blur mechanics change, requires updates here

**Fix approach:** 
- Leave as-is (low cost) OR remove and re-add when E15 ships
- Audit Section F #10 suggests: "Delete if P2 E15 is descoped; prefer building E15"

### Legacy Planner Cluster Alongside Dating App (Brand Alignment)

**Symptoms:** 
- `/vote/[id]`, `/places`, `/neighborhoods`, `/types`, `/vibes`, `/dates` SEO pages use legacy serif font (Fraunces)
- `/roadmap`, `/tell-us`, `/insiders`, `/join` marketing pages exist alongside the dating app
- No clear rebrand-or-retire decision
- Live-nav audit confirms brand-serif regressions (`/create` PolaroidLoader, `/login` wordmark)

**Files:** 
- Legacy cluster: `apps/web/app/vote/`, `apps/web/app/places/`, `/neighborhoods`, `/types`, `/vibes`, `/dates`, `/roadmap`, `/tell-us`, `/insiders`, `/join`
- Branding: Font family still set to Fraunces in some components

**Impact:** 
- User confusion: are these the date planner or the dating app?
- Mixed brand signals; design-system adoption incomplete
- SEO/marketing URLs may conflict with dating loop

**Fix approach:** 
- Owned by a separate rebrand-or-retire decision (not a code-fix)
- Audit Section F #11 notes this for future cleanup
- Suggestion: Either fully migrate these routes to Barbiecore (shell.* tokens, Fira Sans / display font) or retire them

### Profile Tab Points to Marketing Teaser, Not User Profile

**Symptoms:** 
- `/home/page.tsx` is a `FirstSessionHome` explainer + gallery + referral
- Used as the "profile" tab target
- Should not be in the primary nav after onboarding

**Files:** `apps/web/app/home/page.tsx`

**Fix approach:** 
- Handled by P0 E2/E3 (repoint profile tab to real profile hub)

### Degenerate `PublishToFeedButton` (Hardcoded Date, No Controls)

**Symptoms:** 
- Door 1 generated nights use `PublishToFeedButton` which hardcodes date (+2d 18:00)
- No way to set who-pays, vibe-tags, radius, cover image
- Duplicates and under-delivers vs `/nights/new`

**Files:** `apps/web/app/create/PublishToFeedButton.tsx`

**Fix approach:** 
- **P1 E11:** Converge with `/nights/new` form; pass itinerary id; add same controls
- Or delete and require Door 1 users to finish on `/nights/new`

### Dead `host.bio` UI Branch (Always `null`)

**Symptoms:** 
- `OfferDetail.tsx` renders a `host.bio` prop
- Schema has no `bio` column on `profiles` for the offer response
- Always `null`; dead UI code

**Files:** `apps/web/app/offers/[offerId]/OfferDetail.tsx`

**Fix approach:** 
- Either add `bio` column to `profiles` or remove the UI branch (audit Section F #5)

### Speculative Dead Read: `reach_radius_km` Cast

**Symptoms:** 
- `NightCard.tsx:55` casts `reach_radius_km` from the backend
- Backend never returns this field; cast to undefined

**Files:** `apps/web/app/feed/NightCard.tsx:55`

**Fix approach:** 
- Ship the field (E10 E11) or remove the cast

### Orphaned `ThreadList` Full-Page Export

**Symptoms:** 
- `ThreadList.tsx` is exported as a full-page component
- Only `ThreadRow` is imported elsewhere
- `/messages` and `/inbox` are dual paths to the same data (unified inbox #84, but incomplete)

**Files:** `apps/web/app/messages/ThreadList.tsx`

**Fix approach:** 
- Collapse `/messages` → `/inbox`; retire dual paths
- Ensure thread deep-links point to `/inbox/[threadId]`

---

## Performance & Scalability

### Feed Pagination Is Static (No Keyset Pagination)

**Issue:** `browse_feed_for_viewer` returns a fixed static deck of ~20 nights; no cursor-based pagination.

**Symptoms:** 
- Users who swipe through 20 cards hit empty state
- Reload doesn't advance the cursor; same 20 nights re-render
- Heavy browsers can't deep-browse

**Files:** `supabase/migrations/20260602120400_m4_browse_feed_ambient.sql` (RPC, no offset/limit params)

**Impact:** 
- Incomplete feed experience; users assume they've seen everyone
- No infinite scroll; session feels short

**Fix approach:** 
- **P1 E10 (part of the filter/pagination slice):**
  1. Add keyset pagination to `browse_feed_for_viewer`: accept last_night_id, last_created_at
  2. Use a SEEK clause: WHERE (created_at, id) < (last_created_at, last_id) ORDER BY created_at DESC LIMIT 21
  3. Return a `hasMore` flag to client; autoload next page on scroll

### Stale-Night Accumulation (No Expiry Sweep)

**Issue:** Nights with `starts_at` in the past are never transitioned to `cancelled` or `expired`.

**Files:** No cron exists; schema has no auto-expiry mechanism

**Impact:** 
- Database bloats with unreachable historical nights
- Host list (`/my-nights`) grows indefinitely
- May pollute feeds if not filtered explicitly

**Fix approach:** 
- **P0 E5 / E6:** Add daily cron `/api/cron/sweep-stale-nights` that marks `seeking` nights with past dates as `cancelled`

---

## Test Coverage Gaps

**Areas without observed test coverage (from codebase walk):**

1. **Lock lifecycle transitions** — No tests for `active` → `completed` path (because RPC doesn't exist)
2. **Progressive reveal tiers** — No tests for blurred/limited/full reveal (feature not implemented)
3. **Job queue poison handling** — No tests for missing RPC handlers (would crash queue)
4. **Safety flows** — No tests for `day_of_reconfirm` or `safety_checkin` dispatch (handlers exist, producers missing)
5. **Offer delivery** — No tests for email fallback or notification deep-links (RESEND blank, untested)
6. **Host rejection** — No tests for `reject_candidate` (RPC missing)
7. **Night edit/delete** — No tests for `update_night` / `cancel_night` (RPCs missing)
8. **Filter + pagination** — No tests for browse_feed filtering (not implemented)

**Fix approach:** 
- Build tests in tandem with each feature (E1–E24 in the audit queue)
- Ensure critical paths (lock lifecycle, offer delivery, safety) have e2e coverage before prod

---

## Summary: Critical Path to MVP Closure

The audit identifies **19 CONFIRMED dead-ends and broken journeys** (from live-nav walk), of which **2 are WORSE** than scoped. The P0 execution queue (E1–E9) must precede P1/P2 to close the loop:

1. **P0 E1–E2:** Nav chrome + tab repointing (blocks user trapping)
2. **P0 E3–E4:** Profile hub + editable prefs (ISSUE #15)
3. **P0 E5:** Lock `completed` transition (lifecycle terminus)
4. **P0 E6–E7:** Host edit/cancel/delete paths (marketplace completeness)
5. **P0 E8:** Host demand notification (supply feedback)
6. **P0 E9:** Remove poison-loop risk (blocks new jobs)

Then P1 (E10–E14) marketplace completeness, then P2 (E15–E19) reveal + trust + safety.

---

*Concerns audit: 2026-06-03*
