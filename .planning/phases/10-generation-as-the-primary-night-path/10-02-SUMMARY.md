---
phase: 10-generation-as-the-primary-night-path
plan: 02
subsystem: create-funnel / profile
tags: [city-selection, primary_city_id, enqueue-seed-city, FLOW-01, secure-by-default, tdd]
requires:
  - "enqueueSeedCity (08-05) — the admin-context fire-and-forget seed trigger"
  - "08-04 cold-start 'warming up' fallthrough — an unseeded city never blocks generation"
  - "profiles_owner_all RLS (id = auth.uid()) — permits the self-scoped primary_city_id update"
  - "cities table (id, slug, name, is_active); profiles.primary_city_id uuid FK → cities.id"
provides:
  - "POST /api/profile/city — self-scoped primary_city_id write + fire-and-forget enqueueSeedCity"
  - "KnownCity.id — curated picks resolve to cities.id"
  - "Generate-funnel city selector that posts the chosen curated id and prefills the saved city"
affects:
  - "the deferred Phase-8 background pre-seed now has its only caller (unblocked)"
tech-stack:
  added: []
  patterns:
    - "self-scoped RLS write mirroring EnableDatingButton (.update(...).eq('id', user.id))"
    - "fire-and-forget side effect (void Promise.resolve(...).catch) — save never blocks on the queue"
    - "additive type-widening (KnownCity.id) keeps the anon /create branch compiling"
key-files:
  created:
    - apps/web/app/api/profile/city/route.ts
    - apps/web/app/api/profile/city/__tests__/route.test.ts
    - apps/web/app/create/__tests__/city-select.test.tsx
  modified:
    - apps/web/lib/create/cities.ts
    - apps/web/app/create/generate/page.tsx
    - apps/web/app/create/page.tsx
    - apps/web/app/create/CreateFlow.tsx
decisions:
  - "No new migration — profiles_owner_all self-update is sufficient (advisor unaffected)."
  - "The write goes through a thin RLS server route (not the browser) because enqueue_job is REVOKED from authenticated; the route runs the admin-context enqueue server-side."
  - "Widened the anon /create cities select to id,slug,name (additive) so the `as KnownCity[]` cast still compiles after KnownCity gained a required id."
  - "Prefill reads the saved city name via the profiles_primary_city_id_fkey join, defensive to object-or-array shape."
metrics:
  duration_min: 2
  completed: 2026-06-05
---

# Phase 10 Plan 02: City Selection + Pre-Seed Wiring Summary

A curated city pick in the generate funnel now writes `profiles.primary_city_id` under self-update RLS and fires `enqueueSeedCity(cityId)` fire-and-forget — unblocking the deferred Phase-8 background pre-seed — while a cold/unseeded city still falls through the 08-04 warming path and never blocks generation.

## What Was Built

**Task 1 — `POST /api/profile/city` (TDD).** A thin RLS server route: zod-uuid validates `cityId`, verifies it references an active curated city (`cities` where `is_active`) before the write, then updates `primary_city_id` under the RLS-bound server client scoped `.eq('id', user.id)` (relies on `profiles_owner_all`; no admin client for the write). It then fires `enqueueSeedCity(cityId)` with a logged `.catch` and does not await it into the response path, so a slow/failing queue still returns `200 {ok:true}`. Anon → 401 (no write/enqueue); malformed or unknown/inactive id → 400 (no write/enqueue).

**Task 2 — Funnel city selector (TDD).** `KnownCity` gained a required `id` (cities.id). The generate page selects `id,slug,name`, reads the authed profile's `primary_city_id` + joined city name, and passes them as `prefillCityId`/`prefillCityName` into `CreateFlow`. In `CreateFlow`, tapping a curated chip seeds the city text always and — for a signed-in user only — POSTs `{cityId}` to `/api/profile/city` fire-and-forget (a failure shows a quiet sonner notice, never disables the "make my date" CTA). A returning user sees their saved city prefilled/selected. Free-text typing of a non-curated city leaves `primary_city_id` untouched and still generates. The anon `/create` select was widened to `id,slug,name` (additive) to keep its `as KnownCity[]` cast compiling.

## Tests

- `app/api/profile/city/__tests__/route.test.ts` — 5/5: 200 happy path writes self-scoped (`primary_city_id` patch + `.eq('id','u1')`) and enqueues; 401 anon no-write; 400 bad uuid no-write; 400 unknown/inactive city no-write; enqueue rejection still 200.
- `app/create/__tests__/city-select.test.tsx` — 5/5: curated chip (authed) POSTs the right cityId; anon chip does not POST; prefill renders the saved chip pressed + seeds the field; failed POST keeps the generate CTA enabled; free-typed city does not POST and still enables generate.
- Full `app/create/__tests__/` suite 17/17 (no regression in CreateChooser / ImproveControls / PublishToFeedButton).
- `tsc --noEmit` on `@after5/web` exits 0 — the FK-join hint and the widened anon cast both compile.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes (Rules 1–3) were required and no architectural decision (Rule 4) arose.

## Threat Surface

All threat-register dispositions held without new mitigations needed:
- T-10-03 (Spoofing): `auth.getUser()` → 401 on anon; the write is `.eq('id', user.id)` under `profiles_owner_all` — a user can only set their own city.
- T-10-04 (Tampering): zod uuid + active-curated-city existence check before the FK write; hostile/unknown id → 400.
- T-10-06 (EoP): the enqueue stays in the admin-context `enqueueSeedCity` helper, invoked server-side only; never exposed to the browser.

No new security surface beyond the plan's `<threat_model>`.

## Known Stubs

None. The city write + enqueue are real and wired; prefill reads live profile data.

## Self-Check: PASSED

- FOUND: apps/web/app/api/profile/city/route.ts
- FOUND: apps/web/app/api/profile/city/__tests__/route.test.ts
- FOUND: apps/web/app/create/__tests__/city-select.test.tsx
- FOUND modified: apps/web/lib/create/cities.ts, apps/web/app/create/generate/page.tsx, apps/web/app/create/page.tsx, apps/web/app/create/CreateFlow.tsx
- Commits present: 6868ae9 (test route), 0dd893e (feat route), 05d48c7 (test funnel), 0f10ee3 (feat funnel)

## TDD Gate Compliance

Both tasks followed RED → GREEN. Task 1: test 6868ae9 (RED, import-unresolved fail) → feat 0dd893e (GREEN, 5/5). Task 2: test 05d48c7 (RED, 2 failing on POST + prefill) → feat 0f10ee3 (GREEN, 5/5). No unexpected RED-phase passes. No refactor commit needed.
