---
phase: 05-progressive-reveal-p2
plan: 01
subsystem: ui
tags: [reveal-ladder, supabase, rls, security-definer, storage-signing, feed, next-image, playwright]

# Dependency graph
requires:
  - phase: 04-feed-filters-targeting
    provides: "browse_feed_for_viewer (e10 widen) — the DEFINER feed RPC this plan widens again with the host hint"
  - phase: 06-profile (M6)
    provides: "signClearUrls + profile_photos_blurred_read_v2 storage policy + generate-blur (<uid>/<id>_blurred.jpg)"
provides:
  - "signBlurredUrls() — signs blurred storage paths with no reveal gate (rung 1 + 2 foundation)"
  - "FeedNight host-hint contract: host_blurred_photo_url / host_first_name / host_age"
  - "browse_feed_for_viewer widened with exactly 3 host-hint columns (local-applied, advisor-clean)"
  - "server-side blurred-url signing in the feed loader (revealHostHints)"
  - "rung-1 blurred avatar + {name, age} render on NightCard + NightDetailSheet"
  - "05-reveal-feed.spec.ts + the shared privacy-invariant network helper"
affects: [05-02 rung-2 offer surface, 05-03 identity_revealed dispatch, 05-04 ceremony + prod-apply gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Signed-URL mirror with no reveal gate (signBlurredUrls mirrors signClearUrls; blurred reads are the privacy artifact)"
    - "DEFINER feed RPC widen: drop+recreate re-applies the verbatim revoke-public/anon + grant-authenticated tail"
    - "Resilient server-side signing in the SSR loader (signing failure degrades to a null avatar, never crashes the feed)"
    - "Privacy-invariant Playwright network helper: every pre-lock signed photo path must end in _blurred.jpg"

key-files:
  created:
    - "apps/web/lib/after5/photos.test.ts"
    - "supabase/migrations/20260606120000_e15_browse_feed_host_hint.sql"
    - "apps/web/e2e/05-reveal-feed.spec.ts"
  modified:
    - "apps/web/lib/after5/photos.ts"
    - "packages/api-client/src/feed.ts"
    - "packages/api-client/src/feed.test.ts"
    - "apps/web/app/feed/page.tsx"
    - "apps/web/app/feed/NightCard.tsx"
    - "apps/web/app/feed/NightDetailSheet.tsx"
    - "apps/web/playwright.config.ts"
    - "apps/web/next.config.mjs"
    - "packages/types/src/database.ts"

key-decisions:
  - "Blurred reads need NO reveal gate — signBlurredUrls mirrors signClearUrls but is authorized for any authenticated viewer by profile_photos_blurred_read_v2 (the blurred asset IS the privacy artifact)."
  - "Project EXACTLY 3 host-hint columns from the existing cr creator join (blurred_photo_url, first_name, age); never cr.id/email/clear_photo_url/instagram."
  - "Sign the host blurred path app-side in feed/page.tsx (RPCs cannot mint signed urls); a signing failure degrades to a null avatar rather than crashing the feed."
  - "Heavy CSS blur-[8px] over the already-downscaled blurred asset for rung 1; the name+age label is identity-led, the cover photo still leads."

patterns-established:
  - "Privacy-invariant network assertion (exported helper) reused by future rungs: capture storage/v1/object/sign requests, assert every photo path ends in _blurred.jpg."
  - "Local-only image host allow-list for forced-local e2e (127.0.0.1/localhost:54321) kept separate from the prod *.supabase.co host."

requirements-completed: [REQ-E15]

# Metrics
duration: 9min
completed: 2026-06-04
---

# Phase 5 Plan 1: Reveal Ladder Rung 1 (Pre-Match Host Hint) Summary

**Rung 1 of the reveal ladder is real: the feed card and detail sheet now show a heavily-blurred host avatar plus first name and age, signed server-side from a widened DEFINER feed RPC, with a privacy-invariant e2e proving no clear host photo is ever signed pre-lock.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-04T22:16:15Z
- **Completed:** 2026-06-04T22:26:00Z
- **Tasks:** 4 of 4
- **Files modified:** 10 (3 created, 7 modified)

## Accomplishments
- `signBlurredUrls()` added (byte-for-byte mirror of `signClearUrls`, no reveal gate) + Wave-0 unit cover.
- `browse_feed_for_viewer` widened with exactly 3 host-hint columns, applied to the LOCAL stack, types regenerated from the live local schema, advisor-clean (search_path pinned, anon NOT executable). Prod untouched.
- Feed loader signs the host blurred paths server-side and passes signed urls into SwipeDeck; rung-1 blurred avatar + `{name, age}` renders on both feed surfaces with the anonymity copy softened.
- The privacy-invariant network assertion is green against a REAL signed `_blurred.jpg` (the e2e seeds a real blurred storage object), so it has teeth rather than passing vacuously.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave-0 scaffolds + signBlurredUrls + FeedNight contract** - `8baabb1` (feat)
2. **Task 2: Widen browse_feed_for_viewer + LOCAL apply + advisor** - `f6692fd` (feat)
3. **Task 3: Sign host blurred url in the feed loader** - `190fd0a` (feat)
4. **Task 4: Render rung-1 blurred avatar + name/age + soften copy** - `8d65be9` (feat)

## Files Created/Modified
- `apps/web/lib/after5/photos.ts` - added `signBlurredUrls()` (no reveal gate; blurred reads authorized by `profile_photos_blurred_read_v2`).
- `apps/web/lib/after5/photos.test.ts` - new Wave-0 unit cover: empty short-circuit, signing happy path, null-drop, error throw.
- `packages/api-client/src/feed.ts` - `FeedNight` extended with `host_blurred_photo_url` / `host_first_name` / `host_age` (E15/D-01).
- `packages/api-client/src/feed.test.ts` - asserts the 3 host-hint fields map on a browseFeed row (+ null-host tolerance).
- `supabase/migrations/20260606120000_e15_browse_feed_host_hint.sql` - widens the feed RPC with the 3 host-hint columns from the `cr` join; verbatim revoke/grant tail re-applied.
- `packages/types/src/database.ts` - regenerated from the live local schema (3 insertions: the new return columns).
- `apps/web/app/feed/page.tsx` - `revealHostHints()` batch-signs the host blurred paths server-side; resilient to signing failure.
- `apps/web/app/feed/NightCard.tsx` - 48px blurred avatar (`blur-[8px]`) + `{first_name}, {age}` label, initial-chip fallback.
- `apps/web/app/feed/NightDetailSheet.tsx` - same hint; anonymity copy softened (no "stays anonymous"/"stays a secret").
- `apps/web/e2e/05-reveal-feed.spec.ts` - rung-1 visual + privacy-invariant network helper; seeds a real `_blurred.jpg` storage object.
- `apps/web/playwright.config.ts` - registered `05-*` in `testMatch`.
- `apps/web/next.config.mjs` - allow the local supabase storage host for `next/image` (forced-local e2e/local QA only).

## Database Changes (LOCAL only — prod gated to 05-04)
- `browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int)` dropped + re-created with `host_blurred_photo_url text, host_first_name text, host_age int` appended after `fit boolean`. SELECT projects `cr.blurred_photo_url, cr.first_name, cr.age` only.
- Verified on the live local db: return signature carries the 3 new columns; `anon`/`public` have NO execute privilege (only `authenticated` + owner); `search_path=public, extensions` pinned; `security definer` unchanged.
- Advisor (local equivalent): no new mutable-search-path DEFINER function introduced (only pre-existing PostGIS `st_estimatedextent` internals appear unpinned); `browse_feed_for_viewer` is clean. The DEFINER-executable warning is the app's established accepted pattern.
- **Prod ref `ufufmcpnysvwtutpbian` NOT touched. No `supabase db push`.** Prod apply is the gated human checkpoint in 05-04.

## Threat Register Disposition
- **T-05-01 (clear photo on feed/detail) — mitigated:** feed/page.tsx + NightCard + NightDetailSheet call only `signBlurredUrls`; `signClearUrls` count is 0 in feed/page.tsx; the privacy-invariant e2e asserts every signed photo path ends in `_blurred.jpg`.
- **T-05-02 (RPC over-projects identity) — mitigated:** exactly 3 hint columns projected; no `cr.id`/`email`/`clear_photo_url`/`instagram` in the SELECT (the only `cr.id` reference is the join predicate, structurally required and present in the e10 original).
- **T-05-03 (anon re-enabled on re-CREATE) — mitigated:** drop+recreate re-applies the verbatim revoke-public/revoke-anon/grant-authenticated tail; advisor confirms anon is not executable.
- **T-05-04 (CSS blur removed in devtools) — accepted (structural):** CSS blurs an already-downscaled blurred asset; removing it reveals only the blurred artifact.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Registered `05-*` in the Playwright `testMatch`**
- **Found during:** Task 1
- **Issue:** `playwright.config.ts` `testMatch` did not include `05-`, so the new reveal spec would never run.
- **Fix:** added `05-` to the alternation.
- **Files modified:** apps/web/playwright.config.ts
- **Commit:** 8baabb1

**2. [Rule 3 - Blocking] Allow the local supabase storage host for `next/image`**
- **Found during:** Task 4
- **Issue:** signed blurred urls come off `http://127.0.0.1:54321`, which was not in `next.config.mjs` remotePatterns — `next/image` would reject/404 the avatar in the forced-local e2e.
- **Fix:** added `127.0.0.1`/`localhost` port `54321` http patterns (dev/test only; prod still serves from `*.supabase.co`).
- **Files modified:** apps/web/next.config.mjs
- **Commit:** 8d65be9

**3. [Rule 2 - Missing critical test fidelity] Seed a real blurred storage object in the e2e**
- **Found during:** Task 4
- **Issue:** the shared seed sets `blurred_photo_url` to a LOCAL asset path (`/places/place-walk.jpg`), which is not a storage object — so the feed loader's signing would fail-soft to a null avatar and the privacy-invariant network assertion would pass vacuously (zero sign requests).
- **Fix:** the spec uploads a real `<hostId>/seed_blurred.jpg` to the `profile-photos` bucket and points `profiles.blurred_photo_url` at it (scoped to this spec; the shared seed is untouched so 5b/chat suites are unaffected). The signing path is now genuinely exercised and a real `_blurred.jpg` sign request fires.
- **Files modified:** apps/web/e2e/05-reveal-feed.spec.ts
- **Commit:** 8d65be9

## Verification
- `pnpm vitest run apps/web/lib/after5 packages/api-client` — 80 passed (15 files).
- `pnpm --filter web exec playwright test e2e/05-reveal-feed.spec.ts` — 1 passed (rung-1 visual + privacy-invariant network assertion green).
- `pnpm --filter web exec tsc --noEmit` — clean.
- Local migration applied + types regenerated from the live local schema; advisor clean; anon not executable.
- Visual-verify @420px (forced-local) of rung-1 card + detail is deferred to the phase gate (05-04) per the plan.

## Known Stubs
None. The host hint is fully wired: the RPC returns the path, the loader signs it, and both surfaces render the blurred avatar + name/age (with an initial-chip fallback for hosts without a photo).

## Notes for Downstream Plans
- 05-02 (rung 2, offer surface) consumes `signBlurredUrls` + the `FeedNight` shape and must switch `offers/[offerId]` from the clear photo (current latent leak) to the signed blurred path at `blur(3px)`, reusing the exported privacy-invariant network helper from `05-reveal-feed.spec.ts`.
- The widened `browse_feed_for_viewer` migration must be applied to prod at the 05-04 gated human checkpoint (drop+recreate; re-apply the verbatim grant tail; run the prod advisor).

## Self-Check: PASSED
- All created files verified on disk (photos.test.ts, e15 migration, 05-reveal-feed.spec.ts, this SUMMARY).
- All 4 task commits verified in git log (8baabb1, f6692fd, 190fd0a, 8d65be9).
