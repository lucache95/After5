---
phase: 03-marketplace-completeness-p1
plan: 03
subsystem: creator-controls
tags: [E11, post-night-form, cover-uploader, door-2, publish-cta]
requires: [03-01]
provides:
  - PostNightForm creator-control fieldsets (who-pays / targeting / the why)
  - Storage-backed cover uploader on the Door-2 canvas
  - Door-2 sticky publish CTA carrying the itinerary id to /nights/new
  - PublishToFeedButton convergence (F#4 — single publish path)
affects:
  - apps/web/app/nights/new
  - apps/web/app/plans/[id]/edit
  - apps/web/app/create
tech-stack:
  added: []
  patterns: [photos.ts storage-upload, fieldset/legend + roving-tabindex radiogroup, NightDetailSheet sticky footer]
key-files:
  created:
    - apps/web/app/plans/[id]/edit/CoverUploader.tsx
    - apps/web/app/plans/[id]/edit/__tests__/CoverUploader.test.tsx
  modified:
    - apps/web/app/nights/new/PostNightForm.tsx
    - apps/web/app/nights/new/page.tsx
    - apps/web/app/nights/new/__tests__/PostNightForm.test.tsx
    - apps/web/app/plans/[id]/edit/ItineraryEditor.tsx
    - apps/web/app/create/PublishToFeedButton.tsx
    - apps/web/app/create/__tests__/PublishToFeedButton.test.tsx
    - apps/web/lib/after5/client.ts
decisions:
  - "Reused the existing profile-photos bucket for cover uploads (D-01 discretion) — NO new bucket/migration this wave (parallel 03-02 owns the DB)"
  - "Cover uploader lives on the Door-2 canvas (it needs the itinerary stops to avoid clobbering them on persist); PostNightForm hosts the targeting/why/pay fieldsets"
  - "PublishToFeedButton kept startsAt as an optional/ignored prop so CreateFlow.tsx stays untouched (D-03) and still compiles"
metrics:
  duration: ~30m
  completed: 2026-06-03
---

# Phase 3 Plan 03: E11 Creator Controls Summary

PostNightForm now exposes the full E11 creator-control set (who-pays, target gender/age, radius, the why) with inclusive-by-default targeting, a real storage-backed cover uploader landed on the Door-2 canvas, and the Door-2 dead-end now has a sticky `publish this night` CTA that carries the forked itinerary id into the one real post form (PublishToFeedButton converged onto the same path, F#4).

## What Was Built

### Task 1 — Cover uploader + Door-2 publish CTA + PublishToFeedButton convergence (`ff1737d`)
- **`CoverUploader.tsx`** (new): RLS-scoped `<uid>/<id>.jpg` upload to the `profile-photos` bucket via the `photos.ts` storage shape, resolves the public URL, persists it via `updateItineraryStops(p_cover_image_url)`, and renders a tappable thumbnail. States: empty (`no cover yet. add a photo that sells the night.`), `uploading…`, and failure (`couldn't upload that. try a different photo?` — and does NOT persist a URL on failure). Tap targets ≥44px, semantic tokens only.
- **`ItineraryEditor.tsx`**: mounts the uploader alongside the existing stop-photo `CoverPicker`, and adds a sticky bottom publish bar (NightDetailSheet footer classes) → `router.push('/nights/new?itinerary=' + itineraryId)`.
- **`PublishToFeedButton.tsx`**: dropped the hardcoded-date `postNight` call; now routes to `/nights/new?itinerary=<id>` so there is ONE publish path with full creator controls.

### Task 2 — PostNightForm creator-control fieldsets + `?itinerary=` param (`a423089`)
- **`PostNightForm.tsx`**: new `who's this for?` fieldset — who-pays sticker-chip radiogroup (`i pay`/`they pay`/`split`, roving-tabindex), target-gender multi-select chips (`women`/`men`/`nonbinary`/`everyone`, default `everyone`, inclusive helper `open to everyone unless you narrow it.`), age min/max number inputs (unbounded placeholders 18/100, tabular-nums), radius input; plus a `the why?` textarea. On submit: `target_genders`/`target_age_range` (`[min,max]` int4range literal)/`search_radius_km` → `postNight`; `pay_setting`/`why_note`/`vibe_tags` → `updateItineraryStops` (best-effort, reads current stops first so they aren't clobbered).
- **`page.tsx`**: reads `?itinerary=` and pre-selects that plan.
- **`client.ts`**: re-exports `updateItineraryStops` for the form.

## Tests / Verification
- `pnpm --filter web test -- CoverUploader PublishToFeedButton PostNightForm` → all green (CoverUploader 3, PublishToFeedButton 2, PostNightForm 13, incl. jest-axe no-violations on the extended form).
- `pnpm -w typecheck` → 6/6 packages green.
- Grep gates: `storage.from` present in CoverUploader; `nights/new?itinerary` present in ItineraryEditor (verified).
- CreateFlow test still green (PublishToFeedButton prop change is back-compatible).

## Deviations from Plan
### Auto-fixed Issues
**1. [Rule 1 — Test] Scoped a pre-existing PostNightForm test to the plan radiogroup**
- **Found during:** Task 2
- **Issue:** The `plan cards are rendered with aria-checked=false` test used a global `getAllByRole('radio')` expecting 2; the new who-pays radiogroup adds 3 more radios.
- **Fix:** Scoped the query to `within(getByRole('radiogroup', { name: /pick a plan/i }))`.
- **Commit:** `a423089`

## Scope Confirmations
- **No DB / no migration touched.** Both commits are UI + client only (reused the existing `profile-photos` bucket per D-01 — no new bucket/migration). Parallel plan 03-02 owns the DB this wave; `db:reset`/`db:test` were NOT run.
- **Reach preview NOT built** — deferred to Phase 4 per D-11 (grep `reach` in PostNightForm = 0).
- **CreateFlow.tsx NOT edited** (open-city parallel surface, D-03).

## Live-render
Live-render / visual-verify is **pending orchestrator forced-local visual-verify** against 03-UI-SPEC §E11 (6-pillar bars). `pnpm dev` / Playwright NOT started by this executor per the wave-end deferral.

## Self-Check: PASSED
- `apps/web/app/plans/[id]/edit/CoverUploader.tsx` — FOUND
- `apps/web/app/plans/[id]/edit/__tests__/CoverUploader.test.tsx` — FOUND
- Commit `ff1737d` — FOUND
- Commit `a423089` — FOUND
