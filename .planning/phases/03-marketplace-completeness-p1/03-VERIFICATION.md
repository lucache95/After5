---
phase: 03-marketplace-completeness-p1
verified: 2026-06-04T00:00:00Z
status: human_needed
score: 4/4
overrides_applied: 0
deferred:
  - truth: "per-stop regenerate proposes one new venue leaving the rest unchanged (ROADMAP SC-1 sub-item)"
    addressed_in: "Phase 7"
    evidence: "03-CONTEXT.md D-11: 'Per-stop regenerate has NO seam in generate-plan → DEFER to P3 (drop D-02)'. Phase 7 goal covers venues-into-loop + E20-adjacent items."
  - truth: "reach preview shows '~N people match this in <city>' (ROADMAP SC-1 sub-item)"
    addressed_in: "Phase 4"
    evidence: "03-CONTEXT.md D-11: 'Reach preview → DEFER to Phase 4 (depends on the targeting/filter data layer)'. 03-UI-SPEC §E11: 'If deferred to Phase 4, omit entirely — do not render an empty/loading placeholder.' Phase 4 SC-1 covers host targeting + searcher boost hint."
human_verification:
  - test: "E11 creator controls — visual pass against 03-UI-SPEC §E11 six-pillar bars at 420px"
    expected: "who-pays sticker chips, gender multi-select, age/radius inputs, the-why textarea all render with correct Barbiecore tokens (rounded-3xl/2xl, shell.* semantic only, font-heading/font-body, 44px+ tap targets, fieldset/legend grouping, lowercase copy, inclusive framing); cover uploader shows thumbnail on selection; Door-2 publish bar is sticky with backdrop-blur; no pink flood on the creator form"
    why_human: "Visual taste, Barbiecore design-system adherence, and mobile layout (font sizes, spacing rhythm, sticker rotation angles) cannot be asserted by grep or RTL"
  - test: "E12 host triage — visual pass against 03-UI-SPEC §E12 six-pillar bars at 420px"
    expected: "decline confirm sheet (vaul) renders 'pass on {name}?' / 'they drop off your list. they won't be told — no awkwardness.' / pass / keep them; withdraw confirm sheet renders correctly; outcome pills (accepted/they passed/expired/offer out) render lowercase with correct token colors; optimistic row disappears on decline; no candidate-facing rejection copy visible"
    why_human: "Vaul sheet layout, motion, and copy silence to candidate cannot be asserted without a real browser render"
  - test: "E13 plan-on-match — visual pass against 03-UI-SPEC §E13 at 420px"
    expected: "OfferDetail 'the night' section shows numbered stop timeline (photo thumb + dashed connector + name + neighborhood/type/time + $pp + map link) above ExpiryCountdown; photo-led reveal ordering unchanged; LockDetail 'the night' section sits between message block and cancel/rate actions with same timeline; degrade copy renders when stops empty"
    why_human: "Timeline layout (numbered thumbs, dashed connectors, spacing, tabular cost figures) and section ordering require a visual render; reveal ordering (blind-safe) must be confirmed by sight"
  - test: "E14 RESEND_API_KEY present in Vercel server runtime (prod deploy gate)"
    expected: "RESEND_API_KEY is set in Vercel server runtime (Production env) so sendOfferReceivedEmail fires on offer creation; in-app offer_received notification always delivers regardless"
    why_human: "Prod deploy is intentionally gated; Vercel env secrets are not readable from repo; must be confirmed by the developer at prod-apply time"
---

# Phase 3: Marketplace Completeness (P1) — Verification Report

**Phase Goal:** The creator and host surfaces are complete — a host can fully configure and publish a night, triage candidates, and every match/offer screen shows the actual plan, delivered reliably.
**Verified:** 2026-06-04
**Status:** human_needed — all four automated must-haves VERIFIED; 4 items require human/visual testing (3 UI six-pillar checks deferred to forced-local Playwright pass + 1 prod env check)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | In-app post/customize flow exposes who-pays, vibe tags, the why, per-night radius, exact schedule, target gender/age, and a working cover-image upload; Door-2 canvas has a publish CTA | VERIFIED | `PostNightForm.tsx` lines 37–512: who-pays radiogroup, gender multi-select, age/radius inputs, the-why textarea, all wired to `postNight`/`updateItineraryStops` on submit. `CoverUploader.tsx`: `client.storage.from('profile-photos').upload(...)` (line 50), public URL resolved, `updateItineraryStops(p_cover_image_url)` called. `ItineraryEditor.tsx`: sticky publish bar with `router.push('/nights/new?itinerary=' + itineraryId)` (line 236). |
| 2 | A host can reject/dismiss a candidate; interested list shows offer outcomes (accepted/passed/expired) plus a withdraw control | VERIFIED | `reject_candidate` DEFINER RPC (`20260605120300_e12_reject_candidate.sql`): sets `queue_entry → passed_by_host`, 0 `dispatch_notification` calls (only comments asserting silence). Edge fn `supabase/functions/match-reject-candidate/index.ts` routes to RPC via `callRpcAndRespond`. `InterestedList.tsx`: `rejectCandidate`/`withdraw` imported (line 20), optimistic row flip to `passed_by_host` (line 199), `OutcomePill` renders accepted/they passed/expired (lines 44–58), `SHORTLIST_STATUSES` excludes `passed_by_host` so it never appears (line 139). |
| 3 | Both `/matches/[lockId]` and `/offers/[offerId]` render the matched night's stops/venues — "every match has a real plan attached" | VERIFIED | `OfferDetail.tsx` line 112: `<PlanTimeline stops={stops} accent={accent} vibeTags={vibeTags} />`. `LockDetail.tsx` line 104: same. Both `page.tsx` loaders perform SSR two-step RLS read: embed `itinerary_id` from `date_instances`, then `.select('stops, vibe_tags').eq('id', instance.itinerary_id)`, then `normalizeNightDetailStops(it?.stops)` before passing to PlanTimeline. Degrade copy present (`the full plan unlocks here.` / `plan's being put together.`). |
| 4 | Every sent offer reaches the candidate via a reliable guaranteed in-app notification + server-runtime email best-effort | VERIFIED | `match_make_offer` RPC (`20260527126300_p5_make_offer.sql` lines 129–130): `dispatch_notification(p_candidate, 'offer_received', ...)` is inside the DEFINER body — same transaction as the offer INSERT. `notif-map.ts` line 34: `offer_received → offerHref → /offers/${offer_id}`. Route `/api/offers/notify-offered` has `runtime = 'nodejs'` (line 17) + ownership gate `creator_id = user.id` (line 40) + best-effort (never throws). `match.ts` fires it as fire-and-forget with `.catch`. |

**Score:** 4/4 truths verified

---

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases (per documented pre-execution deferrals in `03-CONTEXT.md D-11`).

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Per-stop regenerate proposes one new venue leaving the rest unchanged (ROADMAP SC-1 sub-item) | Phase 7 | 03-CONTEXT.md D-11: "Per-stop regenerate has NO seam in generate-plan → DEFER to P3 (drop D-02)". Phase 7 covers venues-into-loop (E20-adjacent). |
| 2 | Reach preview shows "~N people match this in &lt;city&gt;" (ROADMAP SC-1 sub-item) | Phase 4 | 03-CONTEXT.md D-11: "Reach preview → DEFER to Phase 4 (depends on the targeting/filter data layer)". 03-UI-SPEC §E11 says "If deferred to Phase 4, omit entirely — do not render an empty/loading placeholder." |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260605120000_e11_targeting_cols.sql` | target_genders / target_age_range / search_radius_km on date_instances | VERIFIED | Additive `ALTER TABLE date_instances ADD COLUMN IF NOT EXISTS` for all three cols; safe defaults; 17 lines |
| `supabase/migrations/20260605120100_e12_queue_status_passed_by_host.sql` | passed_by_host enum value in own migration | VERIFIED | `ALTER TYPE queue_status ADD VALUE IF NOT EXISTS 'passed_by_host'` — standalone migration sequenced before consumer |
| `supabase/migrations/20260605120200_e11_post_night_targeting.sql` | Extended post_night + update_itinerary_stops signatures | VERIFIED | `post_night` gains `p_target_genders`, `p_target_age_range`, `p_search_radius_km`; `update_itinerary_stops` gains `p_pay_setting`, `p_vibe_tags`; prior 5-arg overloads dropped; anon revoked |
| `supabase/migrations/20260605120300_e12_reject_candidate.sql` | reject_candidate DEFINER RPC | VERIFIED | SECURITY DEFINER, set search_path=public, advisory lock, passed_by_host mutation, no dispatch_notification, anon revoked |
| `supabase/functions/match-reject-candidate/index.ts` | Edge function for silent decline | VERIFIED | 27 lines; `callRpcAndRespond(client, 'reject_candidate', {p_actor, p_instance, p_candidate})`; 400 on missing args |
| `apps/web/components/PlanTimeline.tsx` | Shared blind-safe stop timeline | VERIFIED | 156 lines; StopRow + StopTime extracted verbatim from NightDetailSheet; `<ol>` of numbered rows; empty stops returns null (caller renders degrade copy); NO /places/[slug] links |
| `apps/web/app/offers/[offerId]/OfferDetail.tsx` | PlanTimeline rendered in "the night" section | VERIFIED | PlanTimeline imported (line 21); rendered at line 112 inside `stops.length > 0` guard; degrade copy at line 115 |
| `apps/web/app/matches/[lockId]/LockDetail.tsx` | PlanTimeline rendered in "the night" section | VERIFIED | PlanTimeline imported (line 14); rendered at line 104; degrade copy at line 107 |
| `apps/web/app/nights/new/PostNightForm.tsx` | Creator-control fieldsets | VERIFIED | who-pays radiogroup, gender multi-select, age/radius inputs, the-why textarea (lines 375–512); `target_genders`/`target_age_range`/`search_radius_km` passed to `postNight` (lines 267–269) |
| `apps/web/app/plans/[id]/edit/CoverUploader.tsx` | Storage-backed cover uploader | VERIFIED | `client.storage.from(BUCKET).upload(path, file, ...)` (line 50); public URL resolved; `updateItineraryStops` called; idle/uploading/error states; correct copy |
| `apps/web/app/dates/[slug]/interested/InterestedList.tsx` | decline + withdraw + outcome pills | VERIFIED | rejectCandidate (line 202), withdraw (line 219), OutcomePill (lines 44–58), passed_by_host excluded from both sections |
| `packages/api-client/src/feed.ts` | postNight wrapper with targeting params | VERIFIED | `target_genders`, `target_age_range`, `search_radius_km` as optional params (lines 25–35); passed to `rpc('post_night', ...)` |
| `supabase/tests/e11_targeting.sql` | SQL test — targeting + passed_by_host + anon revokes | VERIFIED | File exists; 6 assertions per SUMMARY |
| `supabase/tests/e12_reject_candidate.sql` | SQL test — reject_candidate RPC | VERIFIED | File exists; 6 assertions: happy path, SILENT, idempotent, 42501 non-creator, P5001 actor!=jwt, P0001 active-offer-holder, anon revoked |
| `supabase/tests/e13_plan_read.sql` | SQL test — E13 RLS two-step read | VERIFIED | File exists; recipient reads stops, stranger denied, post-lock case |
| `apps/web/app/api/offers/notify-offered/__tests__/route.test.ts` | notify-offered route unit test | VERIFIED | File exists; 6 tests covering 401, 400, ownership gate skip, owner path, best-effort 200 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `InterestedList.tsx` | `match-reject-candidate` edge fn | `rejectCandidate()` wrapper in match.ts | WIRED | Line 20 imports; line 202 calls; edge fn calls `reject_candidate` RPC |
| `reject_candidate` RPC | `passed_by_host` enum value | `UPDATE queue_entries SET status='passed_by_host'` | WIRED | Migration 120300 line 60 |
| `reject_candidate` RPC | no candidate notification | zero `dispatch_notification` calls | WIRED (SILENT) | Only comment lines 10 + 79 reference it; no actual call |
| `OfferDetail.tsx` loader | `itineraries.stops` | SSR two-step: `date_instances(itinerary_id)` → `.select('stops').eq('id', itinerary_id)` | WIRED | `page.tsx` lines 44/89–95 |
| `LockDetail.tsx` loader | `itineraries.stops` | same SSR two-step via `lock-view.ts` | WIRED | `page.tsx` lines 37/118–124 |
| `PlanTimeline` | `OfferDetail` + `LockDetail` + `NightDetailSheet` | import + render | WIRED | All three files import and render `<PlanTimeline>` |
| `CoverUploader.tsx` | `profile-photos` Supabase bucket | `client.storage.from(BUCKET).upload(...)` | WIRED | Line 50 |
| `PostNightForm.tsx` | `postNight` RPC | targeting params on submit | WIRED | Lines 267–269 pass `target_genders`/`target_age_range`/`search_radius_km` |
| `ItineraryEditor.tsx` | `/nights/new?itinerary=<id>` | `router.push(...)` publish CTA | WIRED | Line 236 |
| `match_make_offer` RPC | `offer_received` notification | `dispatch_notification(p_candidate, 'offer_received', ...)` in-transaction | WIRED | Migration 126300 lines 129–130 |
| `notif-map.ts` | `/offers/[offerId]` deep-link | `offerHref → /offers/${offer_id}` | WIRED | Line 34/44 |
| `match.ts` `makeOffer` | `/api/offers/notify-offered` | fire-and-forget fetch + `.catch` | WIRED | Lines 113/120–131 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `OfferDetail.tsx` | `stops: NightDetailStop[]` | `itineraries.stops` via SSR two-step RLS read in `page.tsx` | Yes — real DB select on `itineraries` table by `itinerary_id`; `normalizeNightDetailStops` applied | FLOWING |
| `LockDetail.tsx` | `stops?: NightDetailStop[]` | same SSR two-step in `page.tsx` | Yes — real DB select | FLOWING |
| `InterestedList.tsx` | `rows` (candidates) | SSR server component passes `queue_entries` via `page.tsx` select (from SUMMARY: "page.tsx needed NO change — its queue_entries select already projects the full status union") | Yes — real DB select projecting all statuses including outcome values | FLOWING |
| `PlanTimeline.tsx` | `stops: NightDetailStop[]` | Passed from caller (OfferDetail/LockDetail/NightDetailSheet) — all callers normalize from real DB | Yes — no hardcoded data; empty array renders null (caller shows degrade copy) | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — server must be running for API/RPC spot-checks; all behaviors verified via grep + SQL test suite + RTL tests at implementation level. The merged-tree gate (641/641 Vitest, 6/6 typecheck) was confirmed by the executor.

---

### Probe Execution

Step 7c: No probe scripts declared in PLAN files or found at `scripts/*/tests/probe-*.sh`. SKIPPED.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| REQ-E11 | 03-01, 03-03 | Creator controls: targeting cols, post_night extension, PostNightForm fieldsets, cover uploader, Door-2 publish CTA | SATISFIED | All artifacts verified; core fields wired to postNight/updateItineraryStops; deferred sub-items (reach preview, per-stop regen) documented in 03-CONTEXT D-11 |
| REQ-E12 | 03-01, 03-02, 03-07 | Host triage: reject_candidate DEFINER silent decline + InterestedList decline/withdraw/outcome pills + passed_by_host filter | SATISFIED | RPC verified SILENT (0 dispatch_notification calls); optimistic UI wired; outcome pills present; passed_by_host excluded from both list sections |
| REQ-E13 | 03-04, 03-05 | Plan on match/offer: PlanTimeline extracted + rendered on OfferDetail + LockDetail via RLS read | SATISFIED | Both screens render PlanTimeline; loaders perform two-step RLS read; host.bio removed; degrade copy present for empty stops |
| REQ-E14 | 03-06 | Offer delivery: transactional in-app offer_received + server-runtime email + deep-link to /offers/[offerId] | SATISFIED (partial prod check deferred) | In-app guarantee: transactional in match_make_offer RPC; deep-link: offerHref → /offers/${offer_id}; email: nodejs runtime, ownership-gated, best-effort; RESEND_API_KEY Vercel check deferred to prod deploy |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

Scan coverage: `PlanTimeline.tsx`, `OfferDetail.tsx`, `LockDetail.tsx`, `InterestedList.tsx`, `PostNightForm.tsx`, `CoverUploader.tsx`, `reject_candidate` migration, `match-reject-candidate/index.ts`. No TBD/FIXME/XXX/HACK/TODO markers found. `placeholder` attribute occurrences in `PostNightForm.tsx` are HTML `<input placeholder="...">` attributes, not code debt markers.

---

### Human Verification Required

#### 1. E11 Creator Controls — Six-Pillar Visual Pass

**Test:** Run forced-local Playwright at 420px and screenshot `/nights/new` (PostNightForm) and the Door-2 canvas (`/plans/[id]/edit`). Critique against 03-UI-SPEC §E11.
**Expected:** who-pays sticker chips with correct `stickerRotation` angles; gender multi-select with `everyone` highlighted by default; age/radius inputs styled `rounded-2xl border-shell-ink/15 bg-white/80`; the-why textarea matching input style; fieldset/legend grouping visible; cover uploader shows thumbnail on selection with correct copy; Door-2 sticky publish bar with `border-t border-shell-ink/10 bg-shell-base/95 backdrop-blur`; primary CTA `min-h-[48px] rounded-full bg-shell-accent`; no pink flood on form background; all copy lowercase.
**Why human:** Visual taste, Barbiecore design-system adherence (font sizes, sticker rotation angles, correct token usage), and mobile layout cannot be asserted by grep or RTL.

#### 2. E12 Host Triage — Six-Pillar Visual Pass

**Test:** Run forced-local Playwright at 420px on a date's interested list with candidates in various statuses. Trigger decline and withdraw flows.
**Expected:** Decline vaul sheet renders copy exactly as specified (`pass on {name}?` / silent body / `pass` / `keep them`); withdraw vaul sheet renders `pull this offer back?`; outcome pills lowercase with correct bg tokens (accepted: `bg-shell-pink text-shell-accent + Check`; they passed/expired: `bg-shell-ink/5 text-shell-ink/55`); no "rejected" or notification language visible to host or anywhere in rendered output; optimistic row disappears on confirm; toast renders.
**Why human:** Vaul sheet layout, motion, and visual confirmation that candidate-facing rejection copy is absent require a browser render.

#### 3. E13 Plan on Match/Offer — Six-Pillar Visual Pass

**Test:** Run forced-local Playwright at 420px on `/offers/[offerId]` and `/matches/[lockId]` for a night with real stops.
**Expected:** OfferDetail "the night" section shows numbered stop timeline with photo thumbs, dashed connectors, name, `neighborhood · type · time`, `$pp`, map links; photo-led reveal ordering unchanged (host reveal placement not moved); LockDetail "the night" section positioned between message block and cancel/rate actions; degrade copy (`the full plan unlocks here.` / `plan's being put together.`) renders when stops empty.
**Why human:** Timeline layout (numbered thumbs, dashed connectors, tabular cost), section ordering, and reveal tier compliance require a visual render.

#### 4. E14 RESEND_API_KEY Prod Deploy Gate

**Test:** At gated prod-apply time, confirm `RESEND_API_KEY` is present in Vercel server runtime (Production environment), not just the Edge/preview environments.
**Expected:** `RESEND_API_KEY` is set; `sendOfferReceivedEmail` fires on offer creation. If absent, in-app `offer_received` notification still guarantees delivery (transactional, non-blocking). Optionally confirm VAPID keys state.
**Why human:** Prod deploy is intentionally gated; Vercel env secrets are not readable from the repo; must be confirmed by the developer at prod-apply time.

---

### Known Accepted Items (Not Failures)

**LOW — Reveal names as "someone" on terminal-outcome rows:** In `InterestedList`, `offer_passed` and `offer_expired` rows show `someone` instead of a name because `profiles_select_revealed` and `profiles_select_host_queue` RLS policies only cover pre-offer queue stages. This is a pre-existing reveal policy scope gap, not a Phase-3 regression. The silent-decline design intentionally avoids name disclosure in the candidate direction; the host direction is a progressive-reveal feature (Phase 5 scope). Not a Phase-3 blocker.

**GATED — Prod apply not yet applied:** All four migrations (`20260605120000`–`20260605120300`) are LOCAL-only. This is the project's deliberate gating policy (consistent with Phases 1+2). The local chain applies clean, SQL tests pass, typecheck passes. Prod apply is batched by the orchestrator. Not a failure.

---

### Gaps Summary

No blocking gaps. All four observable truths are VERIFIED by codebase evidence.

The two deferred SC-1 sub-items (per-stop regenerate, reach preview) were formally excluded during the research phase (03-CONTEXT D-11) before any plan was written — they are tracked deferrals to Phase 4 and Phase 7, not implementation gaps.

Four human-verification items remain: three forced-local Playwright visual passes (E11/E12/E13 six-pillar bars) and one Vercel env check (E14 RESEND). These are the standing visual-verify standing rule and the gated-prod checkpoint — not new findings.

---

_Verified: 2026-06-04T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
