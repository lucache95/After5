---
phase: 3
slug: marketplace-completeness-p1
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-03
---

# Phase 3 — Validation Strategy

> Mixed backend + UI. Net-new DB = 2 LOCAL-only migrations (targeting cols; reject_candidate + queue enum). E13 = no migration (RLS reuse). E14 = audit. Derived from 03-RESEARCH.md §Validation Architecture. PROD APPLY GATED.

## Test Infrastructure
| Property | Value |
|----------|-------|
| Frameworks | psql-assertion (`pnpm db:test`) for reject_candidate + targeting · Vitest/RTL for UI (PostNightForm, InterestedList, OfferDetail/LockDetail plan render) · jest-axe · forced-local Playwright visual-verify |
| Apply (local) | `pnpm db:reset` → `pnpm db:types` → `pnpm db:test` → `pnpm -w typecheck` |
| Quick / Full | `pnpm vitest run apps/web` / `pnpm db:test && pnpm vitest run && pnpm -w typecheck` |

## Per-Requirement Verification Map
| Requirement | E-item | Observable behavior | Test | Status |
|-------------|--------|---------------------|------|--------|
| REQ-E11 | E11 | Post/customize flow sets who-pays/vibe/why (itineraries) + targeting gender/age/radius (date_instances) + cover upload; Door-2 canvas has a publish CTA carrying the itinerary id | psql (targeting cols + update_itinerary_stops extension) + RTL (PostNightForm fields) + visual | ⬜ |
| REQ-E12 | E12 | reject_candidate DEFINER creator-only sets queue_entry→passed_by_host (silent, candidate not notified); InterestedList shows decline + withdraw + outcome pills | psql (non-creator rejected; passed_by_host set; no notification) + RTL | ⬜ |
| REQ-E13 | E13 | /matches/[lockId] + /offers/[offerId] render the matched night's full stops/venues/timing via shared PlanTimeline (RLS read, no new RPC); offer "the night" no longer empty; dead host.bio removed | RTL (stops render) + visual + grep (host.bio gone) | ⬜ |
| REQ-E14 | E14 | Offer creation → guaranteed in-app offer_received (transactional) + server-runtime email (/api/offers/notify-offered nodejs→Resend) + push if VAPID; /offers/[id] reachable via inbox deep-link | chain audit + unit (notify route) + execution-time RESEND_API_KEY verify | ⬜ |

## Wave 0 Requirements
- [ ] Additive enum migration (`queue_status` `passed_by_host`) SEPARATE from the reject_candidate RPC that uses it (PG ADD VALUE tx rule), sequenced first.
- [ ] Targeting-columns migration on date_instances.
- [ ] Confirm local supabase up; full migration chain applies clean from scratch.

## Manual-Only Verifications
| Behavior | Why Manual | How |
|----------|------------|-----|
| Crafted creator form / reject sheets / plan-on-match vs UI-SPEC 6-pillar bars | visual taste + Barbiecore | forced-local Playwright 420px render→screenshot→critique |
| RESEND_API_KEY present in Vercel server runtime (E14 A1) | live env, not in repo | confirm in Vercel env at execution; in-app guarantee covers email failure |
| Security advisor after DDL | live introspection | `mcp__supabase__get_advisors type=security` at gated prod-apply (local DDL audited via grep: DEFINER + search_path + revokes + no USING(true)) |

## Validation Sign-Off
- [ ] Every task has automated verify or Wave-0 dep
- [ ] No 3 consecutive tasks without automated verify
- [ ] Local migrations apply clean; prod apply GATED
- [ ] `nyquist_compliant: true` set after planner fills task IDs

**Approval:** pending
