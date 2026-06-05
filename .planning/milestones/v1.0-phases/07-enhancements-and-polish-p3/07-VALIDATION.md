---
phase: 7
slug: enhancements-and-polish-p3
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-05
hydrated: 2026-06-05
source: 07-RESEARCH.md §Validation Architecture
---

# Phase 7 — Validation Strategy

> Per-phase validation contract. Source: 07-RESEARCH.md §Validation Architecture + each plan's `<verify>`.
> The single most load-bearing assertion is `supabase/tests/e23_feed_contract.sql` — it locks the
> feed-RPC re-CREATE privacy/host-hint/keyset contract so the E22/E23 DROP+CREATE cannot silently drop a
> host-hint column, re-grant anon, or destabilize the keyset.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.8 (unit, jsdom for `apps/web`) + Playwright 1.49.0 (E2E/visual, forced-local) + psql `.sql` assertion scripts (local Supabase stack) |
| **Quick run command** | `pnpm vitest run <file>` (scoped) |
| **Full suite command** | `pnpm test && pnpm typecheck` then the Phase-7 Playwright visual spec |
| **SQL run** | `psql "$DB_URL" -f supabase/tests/e2*.sql` against the LOCAL stack after `supabase db reset` |
| **Local DB URL** | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| **Type gate** | `pnpm typecheck` (or `pnpm --filter web exec tsc --noEmit`) |

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| feed.ts contract | 01 | 1 | E20/E23/E24 | typecheck/build | `pnpm --filter @after5/api-client build && pnpm typecheck` | ⬜ pending |
| get_night_detail re-CREATE | 01 | 1 | E20 | SQL | `psql "$DB_URL" -f supabase/tests/e20_night_detail_coords.sql` | ⬜ pending |
| browse_feed DROP+CREATE | 02 | 1 | E22/E23 | SQL (regression) | `psql "$DB_URL" -f supabase/tests/e23_feed_contract.sql` | ⬜ pending |
| withdraw_interest RPC | 03 | 1 | E24 | SQL | `psql "$DB_URL" -f supabase/tests/e24_withdraw_interest.sql` | ⬜ pending |
| RouteMap + PlanTimeline | 04 | 2 | E20/E21 | unit | `pnpm vitest run apps/web/components/itinerary/__tests__/RouteMap.test.tsx apps/web/components/__tests__/PlanTimeline.test.tsx` | ⬜ pending |
| StandbyCard + /inbox | 07 | 2 | E24 | unit | `pnpm vitest run apps/web/components/__tests__/StandbyCard.test.tsx` | ⬜ pending |
| my-nights archive | 08 | 1 | E25/E23 | unit | `pnpm vitest run apps/web/app/my-nights/__tests__/archive-bucket.test.tsx` | ⬜ pending |
| NightDetailSheet map+skeleton | 05 | 3 | E20/E25 | unit | `pnpm vitest run apps/web/app/feed/__tests__/NightDetailSheet.test.tsx` | ⬜ pending |
| LockDetail + places retire | 06 | 3 | E21 | unit + grep | `pnpm vitest run apps/web/app/matches` then `grep -c 'href="/create"' apps/web/app/places/[slug]/page.tsx` (expect 0) | ⬜ pending |
| phase gate | 09 | 4 | all | full + visual | `supabase db reset && pnpm test && pnpm typecheck` + advisor + 3 SQL tests + Playwright visual @420px | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Each plan creates its own test scaffold(s) BEFORE implementing. The KEY one is `e23_feed_contract.sql`.

- [ ] `supabase/tests/e20_night_detail_coords.sql` — per-stop `lat`/`lng`/`place_slug` present for a catalog stop; a non-catalog `place_id` degrades to null coords with NO row error. (Plan 01)
- [ ] `supabase/tests/e23_feed_contract.sql` — **REGRESSION**: column set = 14 e10 + 3 host-hint + `city_name`; anon EXECUTE denied; `(starts_at,id)` keyset pagination yields no dup/skip; `city_name` = `cities.name` for a seed. (Plan 02)
- [ ] `supabase/tests/e24_withdraw_interest.sql` — deletes ONLY the caller's own `interested` row; non-owner call → `P5001`; shortlisted/offer/locked rows untouched; candidate-read RLS denies non-owner. (Plan 03)
- [ ] `apps/web/components/itinerary/__tests__/RouteMap.test.tsx` — static-URL build from ≥1 coord; null/sentinel at 0 coords. (Plan 04)
- [ ] `apps/web/components/__tests__/PlanTimeline.test.tsx` — coord-href + name-fallback; `/places/[slug]` link ONLY when `linkSlugs===true` AND slug present; missing-slug → plain text (blind-contract guard). (Plan 04)
- [ ] `apps/web/app/feed/__tests__/NightDetailSheet.test.tsx` — skeleton renders while `detail===null && open`; real detail replaces it; `linkSlugs` never set on the blind sheet. (Plan 05)
- [ ] `apps/web/app/my-nights/__tests__/archive-bucket.test.tsx` — upcoming/archive bucket filter + empty-state copy. (Plan 08)
- [ ] `apps/web/components/__tests__/StandbyCard.test.tsx` — rank-position copy + neutral withdraw control. (Plan 07)
- [ ] Playwright visual-verify recipe @420px for the 6 surfaces (reuse the forced-local recipe from prior phases). (Plan 09)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual-verify @420px: real map in detail sheet, per-stop coord link, venue link (post-match LockDetail), city label on card, standby/queue card, detail skeleton, archive tab | E20/E21/E23/E24/E25 | aesthetic/contrast/map-pin-color judgment | render forced-local @420px, critique vs 07-UI-SPEC + DESIGN-SYSTEM.md |

---

## Validation Sign-Off

- [x] All tasks have an automated verify or a Wave 0 scaffold dependency
- [x] Feed-RPC contract regression present (`e23_feed_contract.sql`: column set + anon-non-exec + keyset + host-hint preserved)
- [x] Blind-contract guard: venue `/places` links do NOT render on the blind feed/offer surfaces (only post-match LockDetail) — asserted in `PlanTimeline.test.tsx` (`linkSlugs` off) + `NightDetailSheet.test.tsx`
- [x] `nyquist_compliant: true` set

**Approval:** approved
