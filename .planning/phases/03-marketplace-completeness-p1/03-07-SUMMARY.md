---
phase: 03-marketplace-completeness-p1
plan: 07
subsystem: host-triage-ui
tags: [interested-list, silent-decline, withdraw, outcome-pills, vaul, optimistic, rtl, axe]
requires:
  - "rejectCandidate(instance,candidate) wrapper + match-reject-candidate edge fn (03-02)"
  - "passed_by_host queue_status enum value + regenerated HostCandidate union (03-01)"
  - "withdraw(instance) wrapper — existing match-withdraw (5b)"
provides:
  - "silent host decline on the interested list (vaul confirm → rejectCandidate, optimistic + rollback, no candidate notification)"
  - "withdraw control on the frozen offer_active row (vaul confirm → withdraw)"
  - "lowercase offer-outcome pills: accepted / they passed / expired / offer out"
  - "passed_by_host filtered out of both list sections (silent removal)"
affects:
  - "REQ-E12 UI half COMPLETE — backend (03-02) + UI (03-07) now both shipped"
tech-stack:
  added: []
  patterns: [optimistic-mutate-rollback-toast, vaul-confirm-sheet, silent-mutation, outcome-pill]
key-files:
  created: []
  modified:
    - apps/web/app/dates/[slug]/interested/InterestedList.tsx
    - apps/web/app/dates/[slug]/interested/__tests__/InterestedList.test.tsx
decisions:
  - "Terminal-outcome rows (locked / offer_passed / offer_expired) are kept in the shortlist section memo (SHORTLIST_STATUSES) so their outcome pill stays visible; passed_by_host is the ONLY status excluded from both sections"
  - "Decline optimism = flip status to passed_by_host (which the section memos already drop) then call the silent RPC; rollback restores prior rows on failure"
  - "accepted pill uses bg-shell-pink + text-shell-accent + Check icon (no un-tokenized sage hex), per UI-SPEC color note"
  - "page.tsx needed NO change — its queue_entries select already projects the full status union incl. all outcome values"
  - "New-interest row restructured from a single full-row button to a flex <li> with a shortlist button + a sibling UserMinus decline button (no button-in-button)"
metrics:
  duration: ~20m
  completed: 2026-06-03
  tasks: 2
  files: 2
---

# Phase 3 Plan 07: Host triage UI (silent decline + withdraw + outcome pills) Summary

The UI half of REQ-E12. The interested list is no longer append-only: a host can quietly pass on a candidate (silent, no notification — D-04), pull back an outstanding offer (D-05), and see what happened to each offer as a lowercase outcome pill. The silent reject routes through the `rejectCandidate` wrapper shipped in 03-02; withdraw reuses the existing `match-withdraw`.

## What was built

- **Silent decline** — each new-interest row gets a quiet `UserMinus` icon button (`h-11 w-11 rounded-full text-shell-ink/40`, accent on focus, `aria-label="pass on {name}"`). Tapping opens a `vaul` confirm sheet (copied from the `NightCardActions` confirm structure): title `pass on {name}?`, body `they drop off your list. they won't be told — no awkwardness.`, confirm `pass`, cancel `keep them`. Confirm runs optimistic-mutate-with-rollback: flip the row to `passed_by_host` (which the section memos exclude, so it vanishes) → `await rejectCandidate(instanceId, candidate_id)` → success toast `passed. off your list.`; on failure, restore prior rows + `couldn't pass on them. try again?`. **No candidate-facing rejection or notification copy exists anywhere** (T-03-20 mitigation; the only `rejected`/`notif` strings in the file are comments asserting the silence).
- **Withdraw** — under the `offer out` badge on the frozen `offer_active` rank-1 row, a text button (`font-body text-sm lowercase text-shell-ink/55`, `aria-label="pull the offer back from {name}"`) opens a `vaul` confirm: title `pull this offer back?`, body `they lose the offer. you can send a new one.`, confirm `pull it`, cancel `leave it` → `withdraw(instanceId)` → toast `offer pulled.`.
- **Outcome pills** (`OutcomePill`) — off the existing `status` union: `offer_active` keeps the inline pink `offer out` badge; `locked` → `accepted` pill (`bg-shell-pink` + `text-shell-accent` + `Check`); `offer_passed` → `they passed` neutral pill (`bg-shell-ink/5 text-shell-ink/55`); `offer_expired` → `expired` neutral pill. No harsh language.
- **Filtering** — `passed_by_host` is dropped from both sections. Terminal-outcome rows stay in the shortlist section (via `SHORTLIST_STATUSES`) so the pill renders on the right row.
- **Tests** — extended `InterestedList.test.tsx` (RTL + jest-axe), stubbing `vaul` to an inline portal like the `NightCardActions` test: decline confirm calls `rejectCandidate` + removes row silently; decline failure rolls back + error toast; withdraw confirm calls `withdraw('inst-1')`; `passed_by_host` never renders; each outcome status renders its correct pill; axe clean with the triage UI mounted.

## Verification

- `pnpm --filter web test -- InterestedList` — **13/13 green** (6 pre-existing + 7 new triage cases).
- Full interested-dir suite — **26/26 green** (InterestedList + page + a11y + MakeOfferModal + CancelWithReasonPicker), no regression.
- `pnpm -w typecheck` — **6/6 packages pass**.
- grep confirms `rejectCandidate` (2) + `withdraw` (8) wired in `InterestedList.tsx`; no candidate-facing rejection/notification copy (only silence-asserting comments).

TDD gate: `test(03-07)` RED commit `217a47c` (4 new cases failing) → `feat(03-07)` GREEN commit `b9547ec`. No refactor commit needed.

**Forced-local visual-verify against 03-UI-SPEC §E12 (6-pillar bars) remains pending** — owned by the orchestrator's visual-verify pass (Playwright 420px: decline + withdraw confirm sheets, silent copy, lowercase outcome pills + tokens).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved the "already booked" toast when restructuring the new-interest row**
- **Found during:** Task 1 (GREEN run)
- **Issue:** Restructuring the new-interest row to host a sibling decline button, I initially added `disabled={booked}` to the shortlist button, which killed the existing `addToShortlist` click that toasts `{name}'s already booked elsewhere.` — breaking the pre-existing "mutes a candidate who is already booked" test.
- **Fix:** Removed `disabled`; the row stays clickable and `addToShortlist` still guards + toasts the booked case (visual muting kept via the `<li>` opacity/cursor).
- **Files modified:** apps/web/app/dates/[slug]/interested/InterestedList.tsx
- **Commit:** b9547ec

### Notes (not deviations)

- **page.tsx unchanged** — Task 1 asked to "load whatever offer-outcome status the rows need". The loader's `queue_entries` select already projects the full `status` union (incl. `locked`/`offer_passed`/`offer_expired`/`passed_by_host` after the 03-01 regen), so no loader edit was required. Listed in `files_modified` in the plan frontmatter but correctly left untouched.

## Requirement progress

**REQ-E12 (UI half COMPLETE):** silent decline + withdraw + outcome pills + `passed_by_host` silent removal shipped and locally green. Combined with the 03-02 backend (`reject_candidate` RPC + edge fn + wrapper), REQ-E12 is now functionally complete pending the orchestrator's forced-local visual-verify.

## Known Stubs

None.

## Threat Flags

None — no new network surface, auth path, or schema change. `rejectCandidate`/`withdraw` route through existing server-authorized edge fns; the UI only calls wrappers (T-03-21). Optimistic-rollback restores on failure (T-03-22). Silence verified by RTL asserting removal-not-notification (T-03-20).

## Self-Check: PASSED

- Files: `InterestedList.tsx` (modified), `InterestedList.test.tsx` (modified), `03-07-SUMMARY.md` — FOUND.
- Commits: `217a47c` (test RED), `b9547ec` (feat GREEN) — present in git log.
- Tests: InterestedList 13/13, interested-dir 26/26, typecheck 6/6 — all green.
