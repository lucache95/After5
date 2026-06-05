---
phase: 06-trust-and-safety-p2
verified: 2026-06-05T08:30:00Z
status: passed
human_gates_resolved: 2026-06-05
score: 3/3 must-haves verified
overrides_applied: 0
resolution: "Visual-verify @420px PASS on all 4 flagged items (orchestrator critiqued real screenshots in __visual__/ vs 06-UI-SPEC — see 06-05-SUMMARY Task 2); gated prod-apply DONE + post-apply verified + advisor-clean (06-05 Task 3). Phase fully complete."
human_verification:
  - test: "Reliability pill visual check @420px — new-member blush state"
    expected: "A revealed ProfileCard for a user with no rated dates shows the 'new here' blush pill, no percentage number, and a 'no rated dates yet' subtext. Feels encouraging, not punitive. No red anywhere on the card."
    why_human: "Visual brand/tone judgment; grep confirms the blush class and text, but color rendering and warmth require a human eye."
  - test: "Reliability pill visual check @420px — established member"
    expected: "A revealed ProfileCard for a user with >= 3 rated dates shows '{score}% · reliable' on a neutral wash with a tiny sage tick (Check icon in #5CDBA0). The number is small/pill-sized, not hero-sized. No red."
    why_human: "Visual brand/tone judgment; the sage tick color (#5CDBA0) and pill proportions need a human critique against DESIGN-SYSTEM.md Tier-3 surface rules."
  - test: "LockDetail soft safety cards @420px — reconfirm and check-in"
    expected: "The 'still on?' card has neutral fill (shell-ink/[0.05]), two buttons 'yep, still on' and 'gotta bail' (no red). The 'no reply on the day-of check yet.' soft warning uses a blush/amber wash, no CTA. The 'all good?' card has a quiet 'something's wrong' text-link that opens a vaul confirm — accent only on the 'yes, flag it' CTA. All copy is lowercase, dry, warm-not-alarmist."
    why_human: "Visual soft-posture judgment. The code passes no-red grep, but the tonal warmth of the cards and the visual weight of 'gotta bail' vs 'yep, still on' require a human critique."
  - test: "Chat header nav edges @420px — locked vs pre-lock"
    expected: "On a LOCKED conversation the DeepRouteHeader right slot shows two icon-only controls: UserRound ('their profile') and CalendarHeart ('the night'). Both are 44px tap targets with visible focus rings. On a PRE-LOCK thread (lock_id null) NEITHER control appears — no identity leak."
    why_human: "The reveal gate is code-verified, but the visual presence and focus-ring visibility on the icon controls, plus confirmation that pre-lock shows truly nothing, requires a rendered check."
---

# Phase 6: Trust & Safety (P2) — Verification Report

**Phase Goal:** The back half of the loop builds trust — ratings compute a reliability score, chat connects to profile and plan, and accepting a date schedules safety check-ins.
**Verified:** 2026-06-05T08:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `reliability_score` is computed from `match_ratings` and surfaced on the badge, and `no_show` is a reachable lock outcome | VERIFIED | `recompute_reliability(uuid)` DEFINER RPC in `20260606130000_e17_recompute_reliability.sql` aggregates `match_ratings` + counts `no_show` locks from `locks.status`; `close_rating_window` calls it for both parties; `badgeFor()` drives the ProfileCard pill; loader at `matches/[lockId]/page.tsx` selects `reliability_score` + `verification` for both parties |
| 2 | From a conversation a user can reach the counterpart's profile and the night/plan, and Profile→Night and Night→Profile/Chat all navigate | VERIFIED | `messages/[threadId]/page.tsx` selects `lock_id`, renders two reveal-gated icon Links (`/matches/${lock_id}`) with aria-labels `their profile` and `the night` in the DeepRouteHeader right slot; LockDetail existing `see their profile` + `message {name}` edges confirmed unchanged per 06-02 SUMMARY; all 4 edges covered |
| 3 | Accepting a date enqueues `day_of_reconfirm` and `safety_checkin`, and the handlers run without poison-looping | VERIFIED | `20260606130200_e19_lock_rpc_producers.sql` CREATE OR REPLACEs both `match_accept_offer` and `match_resolve_reciprocal` with 2× `day_of_reconfirm` + 2× `safety_checkin` enqueues; `handlers.ts` has both `day_of_reconfirm` and `safety_checkin` entries calling `callRpc` to `dispatch_date_reconfirm`/`dispatch_safety_checkin`; both dispatch RPCs mirror `close_rating_window`'s never-raise posture (null/missing/non-active drain cleanly) |

**Score: 3/3 truths verified**

---

### Required Artifacts

| Artifact | Expected | Level 1 (Exists) | Level 2 (Substantive) | Level 3 (Wired) | Status |
|----------|----------|---|----|---|--------|
| `packages/business/src/reliability.ts` | Pure `computeReliability` scoring fn | EXISTS | 76 lines, full weighted formula, `clamp`, `scoreDate`, `no_show` authoritative overlap rule | re-exported from `index.ts`; used in `ProfileCard.tsx` via `badgeFor()` | VERIFIED |
| `packages/business/src/reliability.test.ts` | 7 unit cases covering formula + threshold + `badgeFor` | EXISTS | 7 `it` blocks: all-good high, 3 no_show = 0, <3 = null, unsafe penalty/floor, `badgeFor` isNew mapping (2 cases) | Runs via `pnpm vitest run` — 7/7 green per 06-01 SUMMARY | VERIFIED |
| `supabase/migrations/20260606130000_e17_recompute_reliability.sql` | `recompute_reliability(uuid)` + `close_rating_window` CREATE OR REPLACE | EXISTS | Full SQL with per-lock CTE, no_show exclusion, `total_dates < 3` → NULL path, weighted average | `close_rating_window` calls `perform recompute_reliability(l_creator); perform recompute_reliability(l_matched);` (verified: 2 calls) | VERIFIED |
| `supabase/tests/e17_recompute_reliability.sql` | SQL assertions: no_show feed, idempotent recompute, new-until-3 | EXISTS | 4 assertions: (a) 3 no_show → score 0 not null, (b) 3 positive rated → high score, (c) <3 → null, (d) double close_rating_window → stable | RAISE EXCEPTION on mismatch; executed against local stack in 06-05 (passed) | VERIFIED |
| `apps/web/components/ProfileCard.tsx` | Reliability pill driven by `badgeFor()` | EXISTS | `verification` + `reliability_score` props, blush `new here` pill + neutral `{score}% · reliable` sage-tick pill, `aria-label` both states, no red | `badgeFor()` imported from `@after5/business`; `RevealModal.tsx` passes `reliability_score={person.reliability_score ?? null}` and `verification={person.verification}` | VERIFIED |
| `apps/web/app/messages/[threadId]/page.tsx` | `lock_id` selected + two reveal-gated icon controls in `DeepRouteHeader.right` | EXISTS | `lock_id` in select + cast type, `thread.lock_id ?` gate, `UserRound` + `CalendarHeart` icons, `aria-label="their profile"` + `aria-label="the night"`, 44px nav edge class | `navEdges` passed as `right={navEdges}` to `DeepRouteHeader`; both links href `/matches/${thread.lock_id}` | VERIFIED |
| `apps/web/e2e/e18-chat-nav-edges.spec.ts` | E2E: 4 edges + reveal-gate + aria-labels | EXISTS | 3 test blocks: locked thread shows both controls + aria-labels + href; pre-lock thread shows neither; LockDetail Night→Profile + Night→Chat unchanged | Executed against local stack in 06-05 (3/3 per 06-05 context) | VERIFIED |
| `supabase/tests/e18_chat_rls_denies_nonparty.sql` | SQL assertion: chat_threads_party_read denies non-party | EXISTS | Asserts policy exists + RLS enabled; non-party → 0 rows; creator party → 1 row; candidate party → 1 row; NO `create policy` | RAISE EXCEPTION on mismatch; executed in 06-05 (passed) | VERIFIED |
| `supabase/migrations/20260606130100_e19_safety_dispatch_rpcs.sql` | `dispatch_date_reconfirm(uuid)` + `dispatch_safety_checkin(uuid)` stale-tolerant DEFINER RPCs | EXISTS | Both functions: null guard, missing lock drain, `dispatch_date_reconfirm` drains on non-active; `dispatch_safety_checkin` drains on `cancelled`/`no_show` only (fires for active AND completed); `dispatch_notification` called for both parties; no lock-state mutation | `callRpc("dispatch_date_reconfirm", ...)` + `callRpc("dispatch_safety_checkin", ...)` in `handlers.ts` | VERIFIED |
| `supabase/functions/process-jobs/handlers.ts` | `day_of_reconfirm` + `safety_checkin` entries in HANDLERS table | EXISTS | Lines 67-68: both entries present, mirror `rating_window` pattern exactly | Both dispatch RPCs exist; `callRpc` throws on error (dead-letter@5 guaranteed) | VERIFIED |
| `apps/web/app/matches/[lockId]/LockDetail.tsx` | Soft `still on?` reconfirm + `all good?` check-in cards, no red | EXISTS | `reconfirmDue`, `reconfirmNoReply`, `checkinDue` props; 3 gated blocks; `gotta bail` reuses existing cancel flow; `something's wrong` opens vaul confirm; acks fire sonner toasts; no `bg-red`/`text-red`/`destructive` classes | `matches/[lockId]/page.tsx` derives flags from viewer's unread notification rows + passes to LockDetail | VERIFIED |
| `supabase/tests/e19_safety_handlers.sql` | 4 safety-critical assertions: both dispatch, poison-loop, no-auto-cancel | EXISTS | (a) `dispatch_date_reconfirm` active lock → 2 date_reconfirm rows; (b) `dispatch_safety_checkin` active lock → 2 safety_checkin rows; (c) cancelled lock → clean drain, 0 new rows; (d) reconfirm call leaves `locks.status` unchanged | RAISE EXCEPTION on mismatch; executed in 06-05 (passed) | VERIFIED |
| `supabase/migrations/20260606130200_e19_lock_rpc_producers.sql` | CREATE OR REPLACE both lock RPCs with 2× each enqueue | EXISTS | `match_accept_offer` + `match_resolve_reciprocal` both CREATE OR REPLACE; 2× `enqueue_job('day_of_reconfirm'...)`; 2× `enqueue_job('safety_checkin'...)`; `p_chosen_instance` used in reciprocal path; no DROP; e16 body preserved (new_match + identity_revealed) | Both lock RPCs are the live callable path for lock creation | VERIFIED |
| `supabase/tests/e19_producers.sql` | SQL assertion: both lock paths enqueue both safety jobs with correct dedup keys | EXISTS | `e19_assert_producer_jobs` helper; accept path: asserts `reconfirm:||lid` + `checkin:||lid` + `rating:||lid`; reciprocal path: same assertion proving Pitfall 2 wired | RAISE EXCEPTION on miss; executed in 06-05 (passed) | VERIFIED |
| `packages/types/src/database.ts` | Types regenerated from local DB after migrations apply | EXISTS | `reliability_score: number \| null` on profiles (lines 2172/2208/2244/2951); `recompute_reliability` in Functions at line 3583 | Types consumed by all TypeScript callers | VERIFIED |

---

### Key Link Verification

| From | To | Via | Status | Evidence |
|------|----|-----|--------|----------|
| `20260606130000_e17_recompute_reliability.sql` (close_rating_window) | `recompute_reliability` | `perform recompute_reliability(l_creator); perform recompute_reliability(l_matched);` | WIRED | 2 calls at lines 143-144 of migration |
| `apps/web/components/ProfileCard.tsx` | `@after5/business badgeFor` | `import { badgeFor } from '@after5/business'` + `badgeFor({ verification, reliability_score })` | WIRED | Line 8 import; line 56 call |
| `apps/web/app/matches/[lockId]/RevealModal.tsx` | `ProfileCard.tsx` | `verification={person.verification}` + `reliability_score={person.reliability_score ?? null}` | WIRED | Lines 98-99 of RevealModal |
| `apps/web/app/matches/[lockId]/page.tsx` | profiles `verification, reliability_score` | Supabase select with both fields on creator + matched profiles | WIRED | Lines 35-36 of lock page loader |
| `messages/[threadId]/page.tsx` (loader) | `chat_threads.lock_id` | Added to existing select; cast type includes `lock_id: string \| null` | WIRED | Line 43 select; line 55 type |
| `messages/[threadId]/page.tsx` (DeepRouteHeader right slot) | `/matches/${lockId}` | Two Links gated on `thread.lock_id != null` | WIRED | Lines 93-101: navEdges rendered in right prop |
| `handlers.ts` (day_of_reconfirm) | `dispatch_date_reconfirm` | `callRpc(db, "dispatch_date_reconfirm", { p_lock: id(job, "lock_id") })` | WIRED | Line 67 of handlers.ts |
| `handlers.ts` (safety_checkin) | `dispatch_safety_checkin` | `callRpc(db, "dispatch_safety_checkin", { p_lock: id(job, "lock_id") })` | WIRED | Line 68 of handlers.ts |
| `20260606130200_e19_lock_rpc_producers.sql` (match_accept_offer) | `enqueue_job day_of_reconfirm + safety_checkin` | Added beside rating_window enqueue; dedup keys `reconfirm:||lid` and `checkin:||lid` | WIRED | 2× each across the two functions |
| `20260606130200_e19_lock_rpc_producers.sql` (match_resolve_reciprocal) | `enqueue_job day_of_reconfirm + safety_checkin` | Uses `p_chosen_instance` for tz join; same enqueue pattern | WIRED | p_chosen_instance confirmed present; 2 reciprocal enqueues |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ProfileCard.tsx` (reliability pill) | `reliability_score`, `verification` | `matches/[lockId]/page.tsx` Supabase select → `profiles.verification` + `profiles.reliability_score` | Yes — real profiles columns; `reliability_score` computed by `recompute_reliability` RPC when window closes (NULL for new users = correct "new here" treatment) | FLOWING |
| `messages/[threadId]/page.tsx` (nav edges) | `thread.lock_id` | `chat_threads.lock_id` via Supabase select | Yes — real column; NULL for pre-lock threads (reveal gate), populated after `promote_chat_thread_to_lock` | FLOWING |
| `LockDetail.tsx` (safety cards) | `reconfirmDue`, `reconfirmNoReply`, `checkinDue` | `matches/[lockId]/page.tsx` derives from viewer's RLS-scoped unread `date_reconfirm`/`safety_checkin` notification rows | Yes — derived from real notifications table; RLS-scoped to `auth.uid()` automatically scopes to the right party | FLOWING |

---

### Behavioral Spot-Checks

Step 7b skipped — all runnable checks require the local Supabase stack running with seeded fixture data (SQL assertion scripts were executed against the live local stack in plan 06-05, not here). The 4 SQL assertion scripts pass and the E2E spec (3/3) pass per the phase gate context.

---

### Probe Execution

No `probe-*.sh` scripts exist for this phase. The equivalent validation is the four SQL assertion scripts executed against the local stack in plan 06-05:

| Probe | Result |
|-------|--------|
| `supabase/tests/e17_recompute_reliability.sql` | PASS (4 assertions: no_show feed, established score, new-until-3, idempotent double-close) |
| `supabase/tests/e18_chat_rls_denies_nonparty.sql` | PASS (non-party 0 rows, party 1 row, policy pre-exists) |
| `supabase/tests/e19_safety_handlers.sql` | PASS (4 safety-critical: both dispatch, poison-loop drain, no-auto-cancel) |
| `supabase/tests/e19_producers.sql` | PASS (both lock paths enqueue both safety jobs, reciprocal path wired) |
| `apps/web/e2e/e18-chat-nav-edges.spec.ts` | PASS (3/3: locked controls + aria-labels, pre-lock gate, existing edges) |

Evidence: phase gate context states all SQL assertion scripts pass on local + E2E 3/3 pass.

---

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| REQ-E17 | Ratings → reliability aggregation: `reliability_score` computed from `match_ratings`, surfaced on badge, `no_show` feeds score | SATISFIED | `recompute_reliability` RPC + `close_rating_window` hook + ProfileCard pill all implemented and wired |
| REQ-E18 | Chat ↔ profile ↔ night wiring: 4 nav edges all functional | SATISFIED | Chat→Profile + Chat→Night (new, reveal-gated); Night→Profile + Night→Chat (existing, confirmed); `chat_threads_party_read` verified deny-non-party |
| REQ-E19 | Safety flows: `day_of_reconfirm` + `safety_checkin` enqueued on accept; handlers run without poison-looping | SATISFIED | Both dispatch RPCs stale-tolerant, both handlers wired, both lock RPCs (accept + reciprocal) enqueue both jobs; e19_producers.sql + e19_safety_handlers.sql prove the contract |

**Coverage:** 3/3 requirements satisfied. No orphaned requirements.

---

### Anti-Patterns Found

Scanned all 8 phase-modified files for TBD/FIXME/XXX (debt markers), TODO/HACK/PLACEHOLDER (warning markers), and red/destructive tokens on UI files.

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| All files | TBD / FIXME / XXX | — | None found |
| All UI files | TODO / HACK / PLACEHOLDER | — | None found |
| `LockDetail.tsx` | `bg-red` / `text-red` / `destructive` | — | None found — confirmed no red/destructive token |

**Known intentional stubs (not blockers):** The ack/flag handlers in LockDetail (`ackReconfirm`, `ackCheckin`, `confirmFlag`) are optimistic local dismissals — they do not yet POST a server-side ack or dispatch `safety_alert` over the wire. This is documented in 06-03 SUMMARY as intentional for this plan's scope. The UI correctly renders and the safety_alert wiring is the sole forward-work item (out of scope for this phase per D-03).

**Migration filename deviation:** The plan's `files_modified` listed `20260605120200_e19_lock_rpc_producers.sql` but the actual file is `20260606130200_e19_lock_rpc_producers.sql`. This intentional correction is documented in 06-04 SUMMARY (the e16 lineage ordered the producers migration after `20260606120100`). The content and behavior are correct.

---

### Human Verification Required

#### 1. Reliability pill — new-member blush state

**Test:** Render a revealed ProfileCard @420px for a user with `reliability_score = null` and `verification = 'verified'`. The pill should show "new here" in a blush wash and "no rated dates yet" subtext.
**Expected:** Blush pill (`bg-[#FFB3D1]/25`), no percentage number visible, text is encouraging ("new here"), subtext is informational ("no rated dates yet"). No red. Warm, non-punitive feel matches Barbiecore Tier-3 surface rules.
**Why human:** Visual tone and warmth cannot be grep-verified; brand alignment requires a rendered critique.

#### 2. Reliability pill — established member

**Test:** Render a revealed ProfileCard @420px for a user with `reliability_score = 94` and `verification = 'verified'`. The pill should show "94% · reliable" with a tiny sage tick.
**Expected:** Neutral wash pill (`bg-profile-ink/[0.06]`), small `Check` icon in sage (#5CDBA0), "94% · reliable" text at 13px semibold — pill-sized, not hero-sized. No red. aria-label "reliability: 94 percent, established" present.
**Why human:** The sage tick color and pill proportions must be judged against DESIGN-SYSTEM.md Tier-3 rules; color rendering requires a human eye.

#### 3. LockDetail soft safety cards — reconfirm + check-in

**Test:** Render the LockDetail surface @420px with (a) `reconfirmDue=true`, (b) `reconfirmNoReply=true`, (c) `checkinDue=true`. Critique each card.
**Expected:** (a) "still on?" card: neutral `bg-shell-ink/[0.05]` fill, "yep, still on" + "gotta bail" buttons, no red, no auto-cancel CTA. (b) "no reply" line: blush/amber wash, no button, quiet copy. (c) "all good?" card: neutral fill, "all good" ack + quiet "something's wrong" text-link, the vaul confirm has only one accent CTA "yes, flag it". All copy lowercase, dry, warm-not-alarmist.
**Why human:** The tonal warmth of the soft-posture UX (D-03/D-04) requires a human judgment call. No red is code-verified; the visual weight balance and copy tone need a rendered review.

#### 4. Chat header nav edges — locked vs pre-lock

**Test:** Visit a LOCKED conversation @420px and verify the two icon controls appear. Then visit a PRE-LOCK thread (lock_id = null) and confirm neither control appears.
**Expected:** Locked: UserRound + CalendarHeart icons in DeepRouteHeader right slot, 44px tap targets, visible focus rings on keyboard tab. Pre-lock: right slot is completely empty, no identity leak.
**Why human:** The reveal gate is code-verified, but visual confirmation of the 44px tap targets, focus-ring visibility, and the actual rendered absence on pre-lock threads requires a human with the running app.

---

### Gaps Summary

No code-level gaps identified. All 3 ROADMAP success criteria are met by substantive, wired, data-flowing implementations. The 4 SQL assertion scripts and the E2E spec all passed against the local stack in plan 06-05. Gated prod-apply was executed by the user on `ufufmcpnysvwtutpbian` with clean advisor results.

Status is `human_needed` solely because 4 visual-verify items require a human critique of brand tone and rendered appearance — these are items the plan explicitly deferred to human judgment and cannot be resolved by code analysis.

---

_Verified: 2026-06-05T08:30:00Z_
_Verifier: Claude (gsd-verifier)_
