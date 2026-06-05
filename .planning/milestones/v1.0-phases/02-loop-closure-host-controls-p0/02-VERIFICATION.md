---
phase: 02-loop-closure-host-controls-p0
verified: 2026-06-04T00:00:00Z
status: passed
score: 5/5
overrides_applied: 0
re_verification: true
resolution:
  - test: "Visual-verify venue/ambient pickers render when lists are supplied"
    result: "RESOLVED 2026-06-03 (commit 5a17164). page.tsx now fetches live/active places + listAmbientSounds when a seeking night exists and passes them to NightCardActions. Forced-local Playwright (420px) confirmed the edit sheet renders 'where?' (venue) + 'soundtrack?' (ambient) selects alongside time + duration, defaulting to 'leave as is'. typecheck 6/6 green, NightCardActions tests 7/7. SC3 now MET."
---

# Phase 2: Loop Closure & Host Controls Verification Report

**Phase Goal:** A successful date reaches a terminal `completed` state, stale nights expire, the job queue is safe, and a host can correct or take down a night and learn when someone is interested.
**Verified:** 2026-06-04 (SC3 re-verified after fix 5a17164)
**Status:** passed — all 5 SCs VERIFIED (SC3 venue/ambient pickers wired + visual-verified post-fix)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | SC | Truth | Status | Evidence |
|---|----|----|--------|----------|
| 1 | SC1 | Past-dated active lock transitions to `completed`; past-dated `seeking` night swept to `expired`; loop terminates | VERIFIED | `sweep_loop_terminus()` in `20260604121000_e5_loop_completion.sql`: CTE flips `locks.status='active'` → `'completed'` + `date_instances` → `'completed'` with 3h grace; second UPDATE sets `status='expired'` for unmatched `seeking` nights. `/api/cron/close-loop` (GET, CRON_SECRET-gated) calls `admin.rpc('sweep_loop_terminus')` on `*/15` schedule (confirmed in `vercel.json`). `flag_no_show` reaches `locks.status='no_show'` (previously unreachable). |
| 2 | SC2 | Host can cancel/unpublish a `seeking` night they created before any match | VERIFIED | `cancel_night` DEFINER RPC (`20260604122000_e6_cancel_night.sql`): creator-only check (`cre <> p_actor` → 42501), pre-match gate (`st <> 'seeking'` → P0001 'not_cancellable'), soft-flip to `'cancelled'`, notifies interested candidates via `night_cancelled`. `NightCardActions` cancel button (vaul confirm) → `cancelNight` wrapper → `rpc('cancel_night')`. Wired in `my-nights/page.tsx` for `status === 'seeking'` only. |
| 3 | SC3 | Host can edit a posted night's time, venue, duration, and ambient sound | PARTIAL | `update_night` RPC fully supports all four fields (p_starts_at, p_duration_min, p_venue, p_ambient_sound_id). Edit UI (`NightCardActions`) wires **time + duration** fully (always visible). **Venue and ambient `<select>` pickers render only when `venues`/`ambientSounds` props are non-empty** (lines 240, 259 of NightCardActions.tsx). `page.tsx` passes neither prop (no server-side fetch for these lists). The pickers are correctly coded but invisible today — see SC3 assessment below. |
| 4 | SC4 | Right-swipe dispatches `interest_received` notification to host, deep-linked to interested list | VERIFIED | `20260604124000_e8_interest_dispatch.sql`: `match_ingest_interest` dispatches `interest_received` to `cre` when `n > 0`, with `payload.date_instance_id`. `record_swipe` (20260527126700) calls `match_ingest_interest` on right-swipe. `notif-map.ts` maps `interest_received` → `interestedHref` = `/dates/${id}/interested`. Test asserts: `hrefForNotification('interest_received', { date_instance_id: 'di1' })` === `'/dates/di1/interested'`. |
| 5 | SC5 | No enqueueable job handler references a missing RPC; job queue cannot poison-loop | VERIFIED | `handlers.ts` contains exactly 7 handlers: `offer_expiry`, `standby_roll`, `bulk_withdraw`, `chat_purge`, `rating_window`, `analytics_relay`, `notify`. The 6 dead handlers (`stale_date_close`, `pending_expiry`, `day_of_reconfirm`, `safety_checkin`, `reconfirm_timeout`, `deletion_process`) and `notifyLockParties` helper are absent (grep returns nothing). No migration or app code enqueues any of the removed types (only `p2_jobs_rpcs.sql` uses `safety_checkin` as an arbitrary dedup-test label — not a live producer). `handlers_rpc_fail_closed_test.ts` retains reject cases only for `chat_purge` and `analytics_relay` (the intentionally-kept missing-RPC handlers). Sequenced before E5 per D-08. |

**Score:** 4/5 SCs fully verified (SC3 is PARTIAL — see assessment)

---

## SC3: Venue/Ambient Edit — Honest Assessment

**The RPC is complete.** `update_night` accepts `p_venue uuid` and `p_ambient_sound_id uuid`, validates them against `places.approval_status='live'` and `ambient_sounds.is_active`, and updates via coalesce. The `updateNight` api-client wrapper passes both fields. The edit form sends `null` (leave unchanged) when the picker lists are empty.

**The UI pickers are correctly coded but not exposed.** `NightCardActions.tsx` has the full venue `<select>` (lines 240–257) and ambient `<select>` (lines 259–276), conditional on `venues.length > 0` and `ambientSounds.length > 0`. `page.tsx` does not fetch venue or ambient lists and calls `<NightCardActions night={...} />` with no props — so the pickers are invisible.

**Verdict: PARTIAL.** Time and duration edit is fully functional and visually verified. Venue and ambient edit is backend-complete and UI-coded but requires one server-side fetch addition to `page.tsx` to become visible. SC3 as written ("edit time, venue, duration, and ambient") is not fully met at the UI layer. The deviation is intentional and documented (02-06-SUMMARY.md "Known Stubs" section).

**This is a WARNING, not a BLOCKER.** The core loop-closure goal does not depend on venue/ambient editing. The missing piece is a `page.tsx` data-fetch addition (small, low-risk). The human verification item captures what needs to happen.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `supabase/migrations/20260604120000_e2_loop_closure_enums.sql` | Additive enum migration | VERIFIED | 3 ADD VALUE IF NOT EXISTS: `date_match_status 'expired'`, `notification_type 'night_cancelled'`, `'night_changed'` |
| `supabase/migrations/20260604121000_e5_loop_completion.sql` | sweep_loop_terminus + flag_no_show | VERIFIED | Both RPCs present, SECURITY DEFINER, search_path=public, correct revoke/grant |
| `supabase/migrations/20260604122000_e6_cancel_night.sql` | cancel_night DEFINER RPC | VERIFIED | Creator-only, pre-match gate, soft-cancel, candidate notifications |
| `supabase/migrations/20260604123000_e7_update_night.sql` | update_night DEFINER RPC | VERIFIED | All four editable fields, never writes time_range (GENERATED), material-change notify |
| `supabase/migrations/20260604124000_e8_interest_dispatch.sql` | match_ingest_interest E8 dispatch | VERIFIED | n>0 guard, dispatch_notification call, dedup_key, grants unchanged |
| `supabase/functions/process-jobs/handlers.ts` | 6 dead handlers removed | VERIFIED | HANDLERS has 7 entries; dead 6 + notifyLockParties absent |
| `supabase/functions/process-jobs/handlers_test.ts` | Test pruned in lockstep | VERIFIED | ALL_TYPES lists only live handlers; dead types absent |
| `supabase/functions/process-jobs/handlers_rpc_fail_closed_test.ts` | Reject cases pruned | VERIFIED | 2 reject cases (chat_purge, analytics_relay); 0 dead-handler reject cases |
| `apps/web/app/api/cron/close-loop/route.ts` | CRON_SECRET-gated sweep route | VERIFIED | Bearer + ?secret auth, dry_run, admin.rpc('sweep_loop_terminus') |
| `apps/web/app/my-nights/NightCardActions.tsx` | Host cancel + edit affordances | VERIFIED | cancel (vaul confirm) + edit (vaul sheet, time + duration always visible; venue + ambient conditional on supplied lists) |
| `apps/web/lib/after5/notif-map.ts` | interest_received + night_cancelled + night_changed meta | VERIFIED | All three in NOTIF_META; interest_received → interestedHref (/dates/[id]/interested); night_cancelled/night_changed → instanceHref (/dates/[id]) |
| `packages/api-client/src/feed.ts` | cancelNight + updateNight wrappers | VERIFIED | Both export, read p_actor from auth, generate UUID idem_key, throw on error |

---

## Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `record_swipe` (right-swipe) | `match_ingest_interest` | `perform match_ingest_interest(p_instance)` in 20260527126700 | WIRED | Confirmed in migration |
| `match_ingest_interest` | `dispatch_notification(cre, 'interest_received', ...)` | `if n > 0 and cre is not null` guard in 20260604124000 | WIRED | |
| `interest_received` notification | `/dates/[id]/interested` | `interestedHref` in `notif-map.ts` line 37 | WIRED | Test-asserted at notif-map.test.ts line 37 |
| `NightCardActions` cancel button | `cancel_night` RPC | `cancelNight(browserAfter5Client(), { instance_id })` → `rpc('cancel_night')` | WIRED | |
| `NightCardActions` edit form | `update_night` RPC (time + duration) | `updateNight(browserAfter5Client(), { starts_at, duration_min })` → `rpc('update_night')` | WIRED | |
| `NightCardActions` edit form | `update_night` RPC (venue + ambient) | Props `venues`/`ambientSounds` empty by default; pickers invisible | PARTIAL | page.tsx does not pass venue/ambient lists |
| `/api/cron/close-loop` | `sweep_loop_terminus` | `admin.rpc('sweep_loop_terminus')` | WIRED | Route confirmed; vercel.json cron `*/15 * * * *` |
| `sweep_loop_terminus` | `rating_window` job | `enqueue_job('rating_window', upper(rng)+2h, ...)` per completed lock | WIRED | Dedup key `'rating:'||lock_id` mirrors accept_lock |

---

## Security / Definer Audit

All 5 Phase 2 RPCs pass the secure-by-default requirements:

| RPC | SECURITY DEFINER | search_path pinned | auth.uid() re-check | No USING(true) | Revoke/grant |
|---|---|---|---|---|---|
| `sweep_loop_terminus` | Yes | `set search_path=public` | N/A (service-role batch, no caller input) | Yes | `revoke all from public, anon, authenticated` (service-role only) |
| `flag_no_show` | Yes | `set search_path=public` | Yes (`p_actor is distinct from auth.uid()`) | Yes | Revoke from public/anon; grant to authenticated |
| `cancel_night` | Yes | `set search_path=public` | Yes (P5001 auth_mismatch) | Yes | Revoke from public/anon; grant to authenticated |
| `update_night` | Yes | `set search_path=public` | Yes (P5001 auth_mismatch) | Yes | Revoke from public/anon; grant to authenticated |
| `match_ingest_interest` | Yes | `set search_path=public` | N/A (internal; called by record_swipe DEFINER) | Yes | Revoke from public AND authenticated (internal) |

---

## Requirements Coverage

| Requirement | Plan | Description | Status | Evidence |
|---|---|---|---|---|
| REQ-E9 | 02-01 | Remove poison-loop risk — dead handlers + lockstep test prune | SATISFIED | 6 handlers removed; ALL_TYPES lists 0 dead types; fail-closed net intact |
| REQ-E5 | 02-03 | Lock completed transition + expiry sweep | SATISFIED | sweep_loop_terminus covers both; close-loop cron route deployed; flag_no_show reachable |
| REQ-E6 | 02-04 + 02-06 | Host pre-match cancel night | SATISFIED | cancel_night RPC + NightCardActions cancel + vaul confirm |
| REQ-E7 | 02-04 + 02-06 | Host edit night (time/venue/duration/ambient) | PARTIAL | RPC complete for all four fields; UI exposes time + duration; venue + ambient picker not yet surfaced |
| REQ-E8 | 02-05 | interest_received notification dispatch | SATISFIED | match_ingest_interest dispatches on n>0; deep-link to /dates/[id]/interested confirmed |

---

## Anti-Patterns Scan

| File | Pattern | Severity | Assessment |
|---|---|---|---|
| `apps/web/app/my-nights/page.tsx` line 59 | `// Guarantee a tasteful, on-theme banner — never a flat pink placeholder.` | Info | Comment about image fallback, not a code stub. No action needed. |
| `NightCardActions.tsx` venue/ambient pickers | `{venues.length > 0 && ...}` renders nothing when `venues=[]` | Warning | Intentional, documented stub (02-06 Known Stubs). Not a blocker for the loop-closure goal. |

No `TBD`, `FIXME`, or `XXX` markers found in any Phase 2 file.

---

## Behavioral Spot-Checks

| Behavior | Evidence | Status |
|---|---|---|
| Dead handlers absent from HANDLERS | `grep -n "stale_date_close\|pending_expiry\|day_of_reconfirm\|safety_checkin\|reconfirm_timeout\|deletion_process" handlers.ts` → no output | PASS |
| Enum values present in migration | `grep "add value if not exists" 20260604120000` → 3 statements | PASS |
| sweep_loop_terminus covers both completion + expiry | Two UPDATE statements in migration (lines 62-96); `status='completed'` and `status='expired'` | PASS |
| cancel_night pre-match only | `if st <> 'seeking' then raise exception 'not_cancellable'` | PASS |
| update_night never writes time_range | No `time_range` in UPDATE statement; column is GENERATED | PASS |
| interest_received dispatched on n>0 only | `if n > 0 and cre is not null then perform dispatch_notification(...)` | PASS |
| Close-loop cron entry | `vercel.json` line 25: path `/api/cron/close-loop`, schedule `*/15 * * * *` | PASS |

Note: Behavioral spot-checks that require running the app (e.g., actual cron invocation, RPC execution against a live DB) are skipped per the verification protocol. The migration tests (`pnpm db:test`, `pnpm vitest run`) were reported green by the executor (602+ vitest; db:test exit 0) and are corroborated by the tight code evidence above.

---

## Prod Apply Status

All Phase 2 migrations are **LOCAL-ONLY** (applied to local Supabase at 127.0.0.1). No `db:push` to prod ref `ufufmcpnysvwtutpbian` has been performed. This is correct per the project's gated prod-apply protocol:

- Prod apply is owner-approved and batched separately.
- The code is prod-ready; the apply step is an operational gate, not a code gap.
- This is **not treated as a failure** for verification purposes.

---

## Human Verification Required

### 1. Venue and Ambient Edit Pickers

**Test:** Add a server-side fetch for venue and ambient sound lists in `apps/web/app/my-nights/page.tsx`. Pass the results as `venues` and `ambientSounds` to `<NightCardActions>`. Run the app at 375px as a host with a `seeking` night. Open the edit sheet and confirm the venue `<select>` and ambient `<select>` appear. Submit a change and confirm `update_night` is called with the correct `p_venue` / `p_ambient_sound_id`.

**Expected:** Both pickers render; a venue change triggers a `night_changed` notification to interested candidates (dispatched server-side by the RPC); toast success appears.

**Why human:** The pickers are correctly coded in `NightCardActions.tsx` but invisible today because `page.tsx` does not pass the lists. Completing this requires a small code change (fetch `places` and `ambient_sounds`, pass to the component) plus visual and behavioral confirmation. The RPC side is already complete and tested.

---

## Gaps Summary

No gaps block the phase goal. The only open item is **SC3 venue/ambient edit pickers**, which is PARTIAL:

- The `update_night` RPC fully supports venue and ambient editing (built, locally applied, tested in e7_update_night.sql).
- The `updateNight` api-client wrapper passes both fields.
- `NightCardActions.tsx` has the complete picker UI, guarded on non-empty lists.
- `page.tsx` does not yet fetch venue/ambient lists and passes empty defaults, so the pickers are invisible.

**What is needed:** A fetch of `places` (live, active) and `ambient_sounds` (active) in `page.tsx`, passed as `venues` and `ambientSounds` to `<NightCardActions>`. This is 1 server-side query addition and a prop passthrough — low risk, no schema change.

The cancel and time/duration edit affordances are **fully functional and visually verified**. SC2 (cancel) is MET. SC3 is PARTIAL for venue/ambient only.

---

_Verified: 2026-06-04_
_Verifier: Claude (gsd-verifier)_
