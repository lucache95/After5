---
phase: 03-marketplace-completeness-p1
plan: 06
subsystem: offer-delivery
tags: [E14, audit, notifications, email, deep-link, best-effort]
requires:
  - match_make_offer RPC (offer_received dispatch, transactional)
  - /api/offers/notify-offered route (runtime=nodejs)
  - notif-map.ts (inbox deep-link mapping)
provides:
  - notify-offered route unit test (ownership gate + best-effort skip)
  - verified offer-delivery chain audit (in-app guarantee + server-runtime email + push)
affects:
  - apps/web/app/api/offers/notify-offered/__tests__/route.test.ts
tech-stack:
  added: []
  patterns:
    - "route-test convention (mirror push-web/inbox-activity): mock @/lib/supabase/server createClient + the email dispatcher"
key-files:
  created:
    - apps/web/app/api/offers/notify-offered/__tests__/route.test.ts
  modified: []
decisions:
  - "AUDIT not rebuild (D-13): the chain already exists and is correct; the only real gap was the missing route unit test"
  - "No deep-link change needed: notif-map offer_received already routes to /offers/[offerId] via offerHref(payload.offer_id)"
  - "RESEND_API_KEY-in-Vercel is a live deploy-time concern → deferred to the gated prod deploy checkpoint (in-app guarantee covers email failure)"
metrics:
  duration: ~15m
  completed: 2026-06-03
  tasks: 1 of 2 (Task 2 = blocking human-verify checkpoint)
---

# Phase 3 Plan 06: E14 Offer-Delivery Chain Audit + /offers/[id] Deep-Link Guarantee Summary

Audited (not rebuilt) the offer-delivery chain (D-13): the in-app `offer_received` notification is the transactional reliability guarantee that deep-links to `/offers/[offerId]`, the server-runtime email is best-effort + ownership-gated, and added the missing route unit test. No code gaps found beyond the absent test; no DB touched.

## What Was Done

### Task 1 — Chain audit + deep-link guarantee + notify-offered route unit test (DONE, committed `bcb55bd`)

Audited the four links of the E14 chain by reading the live source + the offer RPC migration. Findings below. The only real gap was the missing route unit test, which was added; no deep-link fix was required.

**Created:** `apps/web/app/api/offers/notify-offered/__tests__/route.test.ts` — 6 tests, all green:
- 401 when unauthenticated (never sends)
- 400 on invalid JSON / blank `offerId`
- ownership gate: a non-owner caller is skipped (`{ sent:false, skipped:'not_offer_creator' }`), scoped to `creator_id = caller` — never sends, never leaks offer existence (mitigates T-03-17)
- owner path attempts the send and surfaces the dispatcher result
- best-effort: the owner path still 200s when Resend is unconfigured/skipped — the offer is never blocked (mitigates T-03-18)

### Task 2 — Verify RESEND_API_KEY in Vercel server runtime + the deep-link (BLOCKING human-verify checkpoint — NOT executed)

`checkpoint:human-verify` `gate="blocking"`. This is a live Vercel env / deploy-time concern (prod is gated). Per the execution constraint, prod/Vercel secrets were NOT read. Deferred to the gated prod deploy — see deferral note below.

## Audited Chain Findings

| Link | Finding | Evidence |
|------|---------|----------|
| **In-app `offer_received` (the guarantee)** | **TRANSACTIONAL — YES.** Dispatched inside the SECURITY DEFINER `match_make_offer` body, same transaction as the offer INSERT. If the offer commits, the notification row commits. | `supabase/migrations/20260527126300_p5_make_offer.sql` line 130: `dispatch_notification(p_candidate, 'offer_received', jsonb_build_object('instance', p_instance, 'offer_id', oid, 'expires_at', exp))` after the `insert into offers ... returning id into oid` (line 115-116). |
| **Deep-link to `/offers/[offerId]`** | **GUARANTEED — NO CHANGE NEEDED.** The `offer_received` notif maps to `offerHref`, which reads `payload.offer_id` and returns `/offers/${o}`. The RPC payload carries `offer_id: oid`. Inbox (`ActivityList.tsx`) consumes `metaFor()`. | `apps/web/lib/after5/notif-map.ts` line 34 (`offerHref`) + line 44 (`offer_received → offerHref`). |
| **Server-runtime email (best-effort, ownership-gated)** | **SERVER-RUNTIME — YES.** `runtime='nodejs'` (where RESEND key lives); ownership gate `creator_id = user.id`; best-effort 200 (`sendOfferReceivedEmail` never throws). | `apps/web/app/api/offers/notify-offered/route.ts` line 17 (`runtime`), lines 36-42 (ownership gate), line 44-45 (best-effort return). `sendOfferReceivedEmail` returns a `{ sent, skipped }` shape and never throws. |
| **`makeOffer` fires email best-effort, never blocks** | **CONFIRMED.** Fire-and-forget `notifyOfferReceived` on `kind==='offer'`; not awaited; wrapped in try/catch + `.catch`. A failed/blocked send never affects the offer (RPC result is the source of truth). | `apps/web/lib/after5/match.ts` lines 99-125. |
| **Web push** | Inert without VAPID (A2), acceptable this phase. Not in this plan's file scope; already covered by `push-web/route.test.ts`. | `apps/web/app/api/cron/push-web/route.ts` + its existing test. |
| **No parallel sender** | Confirmed — only a test was added. No second email path introduced (anti-pattern in RESEARCH). | — |

## RESEND-Verify Deferral Note

The `RESEND_API_KEY`-in-Vercel-server-runtime check (Task 2 / assumption A1) is a **live env / deploy-time concern**. Prod is gated and prod/Vercel secrets were not read per the execution constraint. **Deferred to the gated prod deploy:** confirm `RESEND_API_KEY` is present in the Vercel SERVER runtime (Production) at deploy time. If blank, the **in-app `offer_received` notification still guarantees delivery** (transactional, non-blocking) — email is an enhancement, not the floor. Optionally confirm VAPID (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`) state; if absent, push stays inert (A2), which is acceptable this phase.

## Deviations from Plan

None — plan executed as written. The audit confirmed the chain already satisfies the must-haves; no deep-link mapping fix or route change was required (only the missing unit test was added, per Task 1's "FIX only real gaps").

## Note on Working-Tree State

The working tree contains uncommitted changes from OTHER Phase-3 plans (E11/E13 wave work: `apps/web/app/feed/NightDetailSheet.tsx`, `apps/web/components/PlanTimeline.tsx` + test, `supabase/migrations/20260605120200_e11_post_night_targeting.sql`, plus `.mcp.json`/`CLAUDE.md` setup files). These are out of this plan's scope and were left untouched. Only `route.test.ts` was staged/committed (`bcb55bd`).

## Verification

- `pnpm --filter web test -- notify-offered` → 6/6 passed.
- `pnpm -w typecheck` → 6/6 packages green.
- Deep-link grep: `notif-map.ts` `offer_received → offerHref → /offers/${offer_id}` confirmed; RPC payload carries `offer_id`.
- No DB touched: no `db:reset`/`db:test` run; no migration created or modified by this plan.

## Self-Check: PASSED

- File `apps/web/app/api/offers/notify-offered/__tests__/route.test.ts` — FOUND.
- Commit `bcb55bd` — FOUND.
