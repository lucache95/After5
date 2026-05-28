# 5b Master Roadmap Plan

> **For agentic workers:** This is a **roadmap-of-plans**, not a code-level plan. Each "task" below is one sub-project (weeks of work). Each sub-project itself requires a brainstorm → spec → plan → execute → merge cycle and **MUST use `superpowers:brainstorming` to produce its own spec** before any code is written, then `superpowers:writing-plans` to produce its own implementation plan, then `superpowers:subagent-driven-development` to execute. Steps use checkbox (`- [ ]`) syntax for tracking gates across multiple sessions.

**Goal:** Sequence 9 sub-projects (Z + A-H) defined in the 5b overview spec through their brainstorm → spec → plan → execute → merge cycles in dependency order, landing Phase 5b (Match & Lock) end-to-end on `main` and behind `feature_config.match_v2_enabled` for safe progressive rollout.

**Architecture:** Strict dependency-ordered execution. Z (chat-core primitives) → A (backend happy path) → {B, C, D, E, F, G in parallel} → H (E2E + CI). Each sub-project ships behind the feature flag (default off); flipping the flag on a per-cohort basis happens AFTER H lands. Phase 7 (chat messaging proper) follows immediately after 5b to close the no-rapport-gate window.

**Tech Stack:** Postgres 15 (Supabase) PL/pgSQL `SECURITY DEFINER` + `pg_advisory_xact_lock` + GiST exclusion + RLS; Deno Edge Functions; Supabase Realtime; Next.js 15 App Router + Tailwind 3.4.17 + framer-motion + sonner; Resend (email); Vitest + RTL + Playwright; GitHub Actions.

**Reference docs:**
- Overview spec: `docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md` (490 lines — the contract this roadmap executes)
- P5 design source: `docs/superpowers/plans/2026-05-25-p5-matching-state-machine.md` (2172 lines — SQL bodies and race tests)
- Integration contract: `docs/superpowers/plans/2026-05-25-INTEGRATION-CONTRACT.md` (IC v2 — C1-C11 contracts)
- Design system: `docs/superpowers/DESIGN-SYSTEM.md` (warm-filmic + pink accent + polaroid tokens)
- QA browser-login recipe: `~/.claude/projects/-Users-lucas-Projects/memory/reference_local-qa-browser-login.md` (Playwright PKCE auth)

---

## How to read this plan

- Each **Task N** below corresponds to **one sub-project from the overview spec** (or a prep gate).
- Each task has **gate checkboxes** marking transitions between brainstorm / spec / plan / execute / merge. These are session-level milestones, not code-level steps.
- **Before a sub-project's code is written**, its task says: invoke `superpowers:brainstorming` for THIS sub-project, save spec to `docs/superpowers/specs/YYYY-MM-DD-5b-<sub-project>-design.md`, invoke `superpowers:writing-plans` to produce `docs/superpowers/plans/YYYY-MM-DD-5b-<sub-project>.md`, then `superpowers:subagent-driven-development` for execution.
- **Sub-project completeness** is enforced by the acceptance criteria at the end of each task. Don't mark a sub-project task done until ALL acceptance criteria pass.
- **No code in this plan.** Code-level steps live in each sub-project's own plan.

---

## Task 0: Prerequisites + migration runbook

**Owner:** Master-roadmap level (not a sub-project; runs once before Task 1)

**Goal:** Verify prod schema preconditions exist + draft the migration-rollout runbook before any 5b schema lands in prod.

**Files:**
- Create: `docs/superpowers/plans/5b-prod-migration-rollout.md` (runbook — sequencing of every Z + A + B + C migration with verification SQL + rollback SQL per file)

- [x] **Step 1: Verify prod profiles schema.** ✓ GREEN — account_state (account_lifecycle), standing (standing_state), dating_enabled all present (see runbook verification log).

- [x] **Step 2: Verify S2 chat-core band is empty.** ✓ YELLOW — `20260525124500_p2_chat_core` already on prod; Z scope reduces to `chat_lock_ready` 5b-launch amendment + optional `promoted_at` column. Reconciled in runbook § Z.

- [x] **Step 3: Verify P5 band 126xxx is empty on prod.** ✓ GREEN — band empty.

- [x] **Step 4: Verify S2 prerequisites are on prod.** ✓ GREEN — all 6 tables + 5 functions + 2 enums present.

- [x] **Step 5: Inventory C1 enum gaps.** ✓ RED — 5 missing notification_type values (`reciprocal_detected, offer_passed, offer_expired, lock_cancelled_frozen, lock_cancelled_rolled`). Captured as PREREQ migration `20260527124550_s2_notification_type_5b_extend.sql` ahead of A.

- [x] **Step 6: Draft the migration runbook.** ✓ Created `docs/superpowers/plans/5b-prod-migration-rollout.md` (770 lines) with this structure:
  - Section per sub-project (Z, A, B, C) — each lists the migration filenames in apply-order
  - Per-migration block: pre-conditions (what must exist), the SQL file path, the verification SQL (post-apply check), the rollback SQL, the security-advisor checks to run, expected duration estimate
  - "Apply, verify, then commit to advancing to the next" discipline reminder per memory `feedback_schema-data-integrity-rigor.md`
  - Per-migration approval gate: never apply two migrations in one session without verifying the first

- [x] **Step 7: Commit the runbook + verification log.** ✓ Committed as `ac09782`.

```bash
git add docs/superpowers/plans/5b-prod-migration-rollout.md
git commit -m "docs(5b): prod migration runbook + prereq verification log"
```

**Acceptance criteria:**
- All 4 verification steps (Steps 1-4) return GREEN.
- C1 enum gap list (Step 5) is documented; any gaps have a corresponding S2 amendment task created (separate plan, not 5b's responsibility — but flagged as a blocking prereq for the consuming sub-project).
- Runbook committed to `main`.
- No prod migration has been applied yet (the runbook is the apply plan, not the apply itself).

---

## Task 1: Sub-project Z — chat-core primitives

**Sub-project from overview spec:** §1 "Z — Chat-core primitives"

**Goal:** Ship the four thread-state functions (`open_chat_thread`, `chat_lock_ready`, `promote_chat_thread_to_lock`, `close_chat_thread`) and the `chat_threads` table they read/write, in S2 band 124500. At 5b launch `chat_lock_ready` returns true unconditionally; the predicate signature is forward-compatible with Phase 7's rapport gate.

**Depends on:** Task 0 GREEN.

**Files (target — Z's spec will finalize):**
- Create: `supabase/migrations/202605271245NN_s2_chat_threads_table.sql` (table + RLS + indexes)
- Create: `supabase/migrations/202605271245NN_s2_chat_thread_state_enum.sql` (enum DDL)
- Create: `supabase/migrations/202605271245NN_s2_open_chat_thread.sql` (function)
- Create: `supabase/migrations/202605271245NN_s2_chat_lock_ready.sql` (function, predicate returns true at 5b launch)
- Create: `supabase/migrations/202605271245NN_s2_promote_chat_thread_to_lock.sql` (function)
- Create: `supabase/migrations/202605271245NN_s2_close_chat_thread.sql` (function)
- Create: `supabase/migrations/202605271245NN_s2_chat_threads_grants.sql` (revoke/grant per C10)
- Create: `supabase/tests/_fixtures.sql` extensions (factory helpers for `mk_chat_thread`)
- Create: `supabase/tests/z_chat_threads_table.sql` (table + RLS tests)
- Create: `supabase/tests/z_chat_thread_transitions.sql` (state-machine happy-path tests)
- Create: `supabase/tests/z_chat_thread_races.sh` (two-session race harness for concurrent open/close)
- Create: `docs/superpowers/specs/2026-05-XX-5b-Z-chat-core-design.md` (Z's spec)
- Create: `docs/superpowers/plans/2026-05-XX-5b-Z-chat-core.md` (Z's plan)

- [x] **Step 1: Brainstorm Z.** ✓ Brainstormed against actual prod state; spec at `docs/superpowers/specs/2026-05-27-5b-Z-chat-core-design.md` (commit `791aefc`). Reconciled with prod reality: chat-core already shipped via `20260525124500_p2_chat_core`; Z scope reduced to amendments only.

- [x] **Step 2: Write Z's plan.** ✓ Plan at `docs/superpowers/plans/2026-05-27-5b-Z-chat-core.md` (commit `1aac1f3`). 10 tasks + pre-flight; TDD ordering throughout.

- [x] **Step 3: Execute Z's plan.** ✓ All 10 tasks executed via subagent-driven-development. Z.1 (`106e2a7`) + Z.2 (`a78c2db`) migrations committed + tests + race harness (`95be255`).

- [x] **Step 4: Run Z's run-all on local stack.** ✓ `psql -f supabase/tests/p2_chat_core.sql` GREEN (7 NOTICE lines: chat-core open/ready/promote+missing/close-guard + chat-core close-open + chat-core legal-hold delete + Z.2 promote state-filter closed→raise + Z.2 promote state-filter already-promoted→raise + Z negative-authz metadata + Z negative-RLS authenticated→0-rows). `bash supabase/tests/z_chat_thread_races.sh` GREEN (3 PASS lines + "All race tests passed").

- [x] **Step 5: Apply Z's migrations to prod per the runbook.** ✓ Z.1 applied (`20260527124551`, runbook log `42b97e9`); Z.2 applied (`20260527124552`, runbook log `f7b0359`). Both via Supabase MCP `apply_migration`; verified post-apply (function bodies + column + REVOKEs); advisors clean (zero new findings).

- [x] **Step 6: Merge Z to `main`.** ✓ Z's commits landed directly on `main` (no feature branch — Z is a small amendment surface; 5a precedent of `--no-ff` doesn't apply to single-author single-session work). Pre-merge gates green (psql tests + race harness). Doc amendments completed: overview spec § Z (`369484a`) + roadmap Task 1 acceptance criteria (`d4bf0a7`).

**Acceptance criteria:**
- See `docs/superpowers/specs/2026-05-27-5b-Z-chat-core-design.md` §5.2 — authoritative since Z brainstormed against the actual prod state (which the original roadmap acceptance criteria did not reflect; chat-core was already shipped via `20260525124500_p2_chat_core`).
- Summary: 10 criteria covering table shape + chat_lock_ready 4-combo semantics + idempotency + promote atomicity & fail-loud + close state guard + auth boundary (REVOKE confirmed via negative test) + RLS default-deny + race correctness + prod-applied via runbook + overview spec amended.
- The "auth.uid()=p_actor" line in the prior version of this acceptance list was **incorrect for Z** (invariant §2.5 #7 applies to public RPCs; Z's functions are not public — they are SECURITY DEFINER + REVOKE FROM public,authenticated). Auth enforcement happens one layer up at A's match_* RPCs.

---

## Task 2: Sub-project A — backend happy path

**Sub-project from overview spec:** §1 "A — Backend happy path"

**Goal:** Ship the matching RPCs that drive shortlist → offer → accept → lock, the reveal predicate, the supporting infrastructure (advisory-lock helpers + idempotency ledger + race harness), the `profiles_select_revealed` RLS policy, and `match_ingest_interest` (called from S5's swipe path).

**Depends on:** Task 1 (Z) merged.

**Files (target — A's spec will finalize):**
- Create: `supabase/migrations/202605271260NN_p5_lock_keys.sql` (advisory-lock key helpers — `match_instance_lock_key`, `match_pair_lock_key`)
- Create: `supabase/migrations/202605271261NN_p5_idempotency.sql` (`transition_idempotency` ledger + helpers)
- Create: `supabase/migrations/202605271262NN_p5_shortlist.sql` (`match_shortlist`, `match_ingest_interest`, `queue_entries.offer_frozen_rank` column)
- Create: `supabase/migrations/202605271263NN_p5_make_offer.sql` (`match_make_offer` — gate + thread open + expiry job + reciprocal detection + blocks check + dating_enabled check)
- Create: `supabase/migrations/202605271264NN_p5_accept_lock.sql` (`match_accept_offer` — gate + chat_lock_ready + promote + GiST exclusion + off-market cascade)
- Create: `supabase/migrations/202605271265NN_p5_reveal_predicate.sql` (`match_reveal_allowed`)
- Create: `supabase/migrations/202605271266NN_p5_profiles_revealed_policy.sql` (`profiles_select_revealed` RLS policy + cross-band ownership header note)
- Create: `supabase/migrations/202605271267NN_p5_s5_swipe_hook.sql` (modify S5's swipe path to call `match_ingest_interest`)
- Create: `supabase/tests/p5_concurrency_lib.sh` (two-session race harness — referenced by P5 Task 0 but not yet built)
- Create: `supabase/tests/a_shortlist.sql` through `a_reveal_negative_rls.sql` (per-RPC tests + race tests + idempotency replay + negative RLS for PII fields)
- Create: `docs/superpowers/specs/2026-05-XX-5b-A-happy-path-design.md`
- Create: `docs/superpowers/plans/2026-05-XX-5b-A-happy-path.md`

- [ ] **Step 1: Brainstorm A.** Invoke `superpowers:brainstorming` with input: "Sub-project A — backend happy path for 5b. See overview spec §1 A, §2.1-§2.5, §2.6 (reveal predicate derivation), §3 contract row for A, §4.1 errcodes P5000-P5005 + P5007-P5008, §5.1 seams 2,3,4,8,9,13 owned by A. Pin: rank collision policy (seam 8), profiles_select_revealed atomic ordering (seam 2), reciprocal detection inside make_offer transaction, blocks + dating_enabled checks." Skill produces A's spec.

- [ ] **Step 2: Write A's plan.** Invoke `superpowers:writing-plans` against A's spec.

- [ ] **Step 3: Execute A's plan.** Invoke `superpowers:subagent-driven-development`. The two-session race harness (Task 0 from P5) ships first; every subsequent race test uses it.

- [ ] **Step 4: Run A's run-all on local stack.** All A tests pass including negative RLS (un-revealed user CANNOT read `last_name`/`birthdate`/`phone`), idempotency replay (same idem_key twice → same uuid + one row), two-session race (concurrent accepts produce one lock + one `time_conflict`).

- [ ] **Step 5: Apply A's migrations to prod per the runbook.** Per-migration; security-advisor between each.

- [ ] **Step 6: Merge A to `main`.**

**Acceptance criteria:**
- `match_shortlist(actor, instance, candidate, rank)` works including rank collision (second call with same rank wins; first bumped to next rank — A's brainstorm decides exact policy; document the choice).
- `match_make_offer(actor, instance, candidate, idem_key) → uuid` checks `can_enter_lock_flow(candidate)`, `dating_enabled`, `blocks`; opens thread via Z; enqueues `offer_expiry`; detects reciprocal-pair and raises `P5008` if detected; emits `offer_received` + `reciprocal_detected` notifications.
- `match_accept_offer(actor, offer, idem_key) → uuid` checks `chat_lock_ready` + `can_enter_lock_flow(actor)`; advisory-locks instance; creates lock; off-market-cascades counterparties on overlapping instances via `standby_roll` jobs (job enqueue verified — B implements the consumer); promotes thread; cancels expiry job; emits `new_match`.
- `match_reveal_allowed(viewer, instance) → bool` matches §2.6 derivation exactly.
- `profiles_select_revealed` RLS policy denies un-revealed access; negative tests verify each PII field.
- All RPCs check `auth.uid()=p_actor` (P5001), feature_flag (P5000), idempotency replay (HTTP 200, same uuid).
- Race harness (`p5_concurrency_lib.sh`) ships and works.
- A's migrations applied to prod per runbook.
- A merged to `main`.

**After A merges to main, sub-projects B, C, D, E, F, G can be brainstormed and executed in parallel. The order below is suggested but not strict — any can start once A is merged.**

---

## Task 3: Sub-project B — backend resolution

**Sub-project from overview spec:** §1 "B — Backend resolution"

**Goal:** Ship every state-machine transition that isn't on the happy path: pass, expire, auto-roll, withdraw, reciprocal chooser, cancel-lock (with safe-roll + freeze + MD10 pre-lock).

**Depends on:** A merged.

**Files (target):**
- Create: `supabase/migrations/202605271268NN_p5_pass_expire_roll.sql` (`match_pass_offer`, `match_expire_offer`, `match_auto_roll`, `match_next_standby`, `match_withdraw`)
- Create: `supabase/migrations/202605271269NN_p5_reciprocal.sql` (`match_resolve_reciprocal`, reciprocal-pair tracking)
- Create: `supabase/migrations/202605271270NN_p5_cancel_safe_roll.sql` (`match_cancel_lock` with reason taxonomy, freeze atomicity, MD10 creator-cancel-pre-lock)
- Create: `supabase/migrations/202605271271NN_p5_rating_window_enqueue.sql` (modify `match_accept_offer` to enqueue `rating_window` job at lock creation)
- Create: `supabase/tests/b_pass_expire.sql`, `b_auto_roll_cascade.sql`, `b_withdraw.sql`, `b_reciprocal.sql`, `b_cancel_safe_roll.sql`, `b_cancel_freeze_atomic.sql`, `b_race_expiry_vs_accept.sh`
- Create: `docs/superpowers/specs/2026-05-XX-5b-B-resolution-design.md`
- Create: `docs/superpowers/plans/2026-05-XX-5b-B-resolution.md`

- [ ] **Step 1: Brainstorm B.** Input: "Sub-project B — backend resolution for 5b. See overview spec §1 B, §2.1 (auto-roll + cascade paths), §2.3 (lock status + cancel reasons), §3 contract row for B, §4.1 errcodes P5009, §5.1 seams 4,7 owned by B, §5.2 R9 cancel-storm cascade. Pin: lock-completion definition (seam 7), rating_window enqueue at accept time, cancel atomicity (safety reason atomically updates standing + admin_alerts + bulk_withdraw), reciprocal chooser flow."

- [ ] **Step 2: Write B's plan.** Invoke `superpowers:writing-plans`.

- [ ] **Step 3: Execute B's plan.** Invoke `superpowers:subagent-driven-development`.

- [ ] **Step 4: Run B's run-all on local stack.** Includes cascade test (accept on X triggers ASYNC `standby_roll` jobs on overlapping Y, NOT sync cascade — verify by inspecting `jobs` table) + cancel atomicity test (safety reason runs all four updates in one transaction; partial-failure rolls back all).

- [ ] **Step 5: Apply B's migrations to prod per the runbook.**

- [ ] **Step 6: Merge B to `main`.**

**Acceptance criteria:**
- All B RPCs work + emit their documented notifications (`offer_passed`, `offer_expired`, `standby_promoted`, `offer_withdrawn`, `lock_cancelled_frozen`, `lock_cancelled_rolled`).
- Auto-roll uses `enqueue_job('standby_roll', ...)` — sync cascade test verifies no inline cascade.
- Cancel with `reason='safety'` atomically: marks lock cancelled + updates `profiles.standing` + inserts `admin_alerts` + enqueues `bulk_withdraw`. Rolls back together on failure.
- Reciprocal chooser resolution updates both instances correctly.
- Withdraw works from any state (interested, shortlisted, offer_active).
- `rating_window` job enqueued at lock creation with `run_after = lock.time_range_end`.
- B's migrations applied to prod per runbook.
- B merged to `main`.

---

## Task 4: Sub-project C — backend extras + edge transport

**Sub-project from overview spec:** §1 "C — Backend extras + edge transport"

**Goal:** Ship `match_demand_hint` (stubbed), 8 public Deno Edge Functions with shared library, the `match_v2_enabled` feature flag, admin tooling, idempotency-ledger prune cron, centralized grants, regenerated TS types.

**Depends on:** A merged. (B not strictly required, but B's RPCs need their edge functions too — so C is most-useful after both A and B; can start in parallel as long as it's edge-function-ready when B lands.)

**Files (target):**
- Create: `supabase/migrations/202605271272NN_p5_feature_flag.sql` (insert `feature_config` row `match_v2_enabled=false`)
- Create: `supabase/migrations/202605271273NN_p5_demand_hint.sql` (`match_demand_hint` stub)
- Create: `supabase/migrations/202605271274NN_p5_admin_tooling.sql` (`admin_force_expire_offer`, `admin_force_cancel_lock`)
- Create: `supabase/migrations/202605271275NN_p5_idempotency_prune_cron.sql` (pg_cron schedule)
- Create: `supabase/migrations/202605271276NN_p5_grants.sql` (centralized revoke/grant)
- Create: `supabase/functions/_shared/jwt.ts`, `_shared/errcode.ts`, `_shared/idem.ts`, `_shared/logger.ts`
- Create: `supabase/functions/match-shortlist/index.ts` + `.test.ts`, same for `match-make-offer`, `match-accept-offer`, `match-pass-offer`, `match-withdraw`, `match-cancel-lock`, `match-resolve-reciprocal`, `match-demand-hint` (8 total)
- Create: `supabase/tests/c_demand_hint_heuristic.sql`, `c_admin_tooling_permissions.sql`
- Create: `packages/types/src/database.ts` (regenerated via `supabase gen types`)
- Create: `docs/superpowers/specs/2026-05-XX-5b-C-extras-edge-design.md`
- Create: `docs/superpowers/plans/2026-05-XX-5b-C-extras-edge.md`

- [ ] **Step 1: Brainstorm C.** Input: "Sub-project C — backend extras + edge transport for 5b. See overview spec §1 C, §3 contract row for C, §4.1 errcode P5000 (feature_disabled), §4.2 job failure + UI fallback, §5.2 R8 idempotency-ledger growth + R11 JWT bypass + R12 cold starts. Pin: 8 edge functions exact list (NOT match-reveal-allowed which RLS handles, NOT match-expire/auto-roll/next-standby which are internal), shared library shape (JWT verify + errcode mapper + idem-key generator), feature flag enforcement at every C2 RPC entry, admin tooling permissions (service_role only), prune cron cadence (monthly delete rows older than 30 days)."

- [ ] **Step 2: Write C's plan.** Invoke `superpowers:writing-plans`.

- [ ] **Step 3: Execute C's plan.** Invoke `superpowers:subagent-driven-development`.

- [ ] **Step 4: Run C's run-all on local stack.** Deno tests pass for all 8 edge functions; JWT-bypass attempts return 401; feature-flag-off requests return 503; admin tooling permission test verifies anon/auth user CANNOT call.

- [ ] **Step 5: Apply C's migrations to prod per the runbook.** Deploy edge functions via `supabase functions deploy match-*` per memory's per-function discipline.

- [ ] **Step 6: Merge C to `main`.**

**Acceptance criteria:**
- All 8 edge functions deployed + callable via HTTPS.
- Shared `_shared/` library is single source of JWT verification — A's RPCs reject any `p_actor` not matching JWT.sub.
- Feature flag `match_v2_enabled` set to `false` on prod by default; flipping it on enables all 8 edge functions.
- `admin_force_expire_offer` and `admin_force_cancel_lock` work for service_role only; auth users get 403.
- `match_demand_hint` returns one of `'quiet'|'warming_up'|'filling_up'|'almost_full'` based on swipe-count heuristic; heuristic test passes against seeded data.
- Prune cron scheduled; manual trigger test verifies it deletes only settled rows >30d old.
- Regenerated TS types committed.
- C merged to `main`.

---

## Task 5: Sub-project D — UI host surface

**Sub-project from overview spec:** §1 "D — UI host surface"

**Goal:** Ship every screen the host (date creator) sees: InterestedList drag-rank shortlist, make-offer flow, withdraw + cancel-with-reason, reciprocal chooser.

**Depends on:** A merged (for shortlist + make_offer); B merged for reciprocal-chooser sub-screen (D ships first without reciprocal-chooser, adds it once B is live); C merged for edge functions.

**Files (target):**
- Create: `apps/web/app/dates/[instanceId]/interested/page.tsx` (server component — auth + match_v2 flag check)
- Create: `apps/web/app/dates/[instanceId]/interested/InterestedList.tsx` (client component — drag-rank via `Reorder.Group`)
- Create: `apps/web/app/dates/[instanceId]/interested/MakeOfferModal.tsx`
- Create: `apps/web/app/dates/[instanceId]/interested/CancelWithReasonPicker.tsx`
- Create: `apps/web/app/reciprocal/[pairId]/page.tsx` (reciprocal chooser — gated on B)
- Create: `apps/web/lib/after5/match.ts` (client wrapper — calls 8 edge functions)
- Create: `apps/web/lib/after5/realtime.ts` (Realtime subscription helpers — user-id-scoped)
- Create: `apps/web/app/dates/[instanceId]/interested/InterestedList.test.tsx`, `MakeOfferModal.test.tsx`, etc.
- Create: `docs/superpowers/specs/2026-05-XX-5b-D-ui-host-design.md`
- Create: `docs/superpowers/plans/2026-05-XX-5b-D-ui-host.md`

- [ ] **Step 1: Brainstorm D.** Input: "Sub-project D — UI host surface for 5b. See overview spec §1 D, §3 D row, §5.1 seams 4 (locked-candidate visual mute) and 5 (Realtime user-id scope), §5.2 R3 (Realtime fan-out + pagination), §5.2 R4 (feature-flag-disabled rendering). Pin: InterestedList drag-rank UX with `framer-motion` `Reorder.Group` + polaroid avatars + stickerRotation chips; make-offer confirmation modal with expiry preview; cancel-with-reason picker for both pre-lock (withdraw) and post-lock (cancel_lock); reciprocal chooser as a separate route gated on B. Visual companion likely warranted for this one — UI mockup-heavy."

- [ ] **Step 2: Write D's plan.** Invoke `superpowers:writing-plans`.

- [ ] **Step 3: Execute D's plan.** Invoke `superpowers:subagent-driven-development`.

- [ ] **Step 4: Run D's UI tests.** Vitest + RTL + axe-core per 5a pattern. Interaction tests verify drag-rank fires `match_shortlist` with correct rank; make-offer confirmation modal flows correctly; cancel-with-reason validates reason selection.

- [ ] **Step 5: Merge D to `main`.** App-only deploy (no schema). Vercel-deployable.

**Acceptance criteria:**
- `/dates/[instanceId]/interested` renders InterestedList for the host; un-host users get 403.
- Drag-rank updates rank via `match_shortlist` with optimistic UI + rollback on error.
- Make-offer modal shows expiry preview (read from `offer_expires_at()` via a dry-run RPC or client-side calc using `feature_config.offer_window_hours`).
- Reciprocal chooser route works (depends on B's `match_resolve_reciprocal`).
- Realtime subscription receives new `queue_entries` inserts within 2s of swipe-right.
- Feature-flag-disabled state renders coming-soon banner.
- a11y audit GREEN (no Critical or Important findings from axe).
- D merged to `main`.

---

## Task 6: Sub-project E — UI candidate surface

**Sub-project from overview spec:** §1 "E — UI candidate surface"

**Goal:** Ship every screen the candidate (offer recipient) sees: offer-received with countdown, accept/pass, withdraw, account-gate fallback.

**Depends on:** A merged; C merged (for edge functions).

**Files (target):**
- Create: `apps/web/app/offers/[offerId]/page.tsx` (server component — auth + feature flag + offer-recipient check)
- Create: `apps/web/app/offers/[offerId]/OfferDetail.tsx`
- Create: `apps/web/app/offers/[offerId]/ExpiryCountdown.tsx`
- Create: `apps/web/app/offers/[offerId]/AccountGate.tsx` (renders `P5002` fallback states)
- Create: `apps/web/app/offers/[offerId]/OfferDetail.test.tsx`, `ExpiryCountdown.test.tsx`, `AccountGate.test.tsx`
- Create: `docs/superpowers/specs/2026-05-XX-5b-E-ui-candidate-design.md`
- Create: `docs/superpowers/plans/2026-05-XX-5b-E-ui-candidate.md`

- [ ] **Step 1: Brainstorm E.** Input: "Sub-project E — UI candidate surface for 5b. See overview spec §1 E, §3 E row, §4.1 errcodes P5002/P5007 (account_gated + offer_expired UI behavior), §5.1 seam 4 (in-lock receives new offer). Pin: expiry countdown with client-side timer + `offers.expires_at` source-of-truth; account-gate fallback rendering each reason (verify/cooldown/suspended/blocked); host's Tier-3 profile preview using S5's `swipes_visible` RLS. Visual companion warranted."

- [ ] **Step 2: Write E's plan.** Invoke `superpowers:writing-plans`.

- [ ] **Step 3: Execute E's plan.** Invoke `superpowers:subagent-driven-development`.

- [ ] **Step 4: Run E's UI tests + axe.**

- [ ] **Step 5: Merge E to `main`.**

**Acceptance criteria:**
- `/offers/[offerId]` renders for the offer recipient only.
- Countdown ticks every second; renders "expired" visual state when `expires_at < now`.
- Accept button calls `match_accept_offer` → on success navigates to `/matches/[lockId]` (F's route).
- Pass button calls `match_pass_offer` → on success navigates back to `/feed`.
- Account-gate fallback renders correct reason copy + link to remediate.
- a11y audit GREEN.
- E merged to `main`.

---

## Task 7: Sub-project F — UI locked + reveal + ratings

**Sub-project from overview spec:** §1 "F — UI locked + reveal + ratings"

**Goal:** Ship `/matches` list + `/matches/[lockId]` (Tier-3 reveal + Phase 7 placeholder + MatchConfirmation overlay) + post-date rating UI.

**Depends on:** A merged (for reveal predicate + RLS); Z merged (for thread record).

**Files (target):**
- Create: `apps/web/app/matches/page.tsx` (locked threads list)
- Create: `apps/web/app/matches/MatchesList.tsx`
- Create: `apps/web/app/matches/[lockId]/page.tsx` (server component)
- Create: `apps/web/app/matches/[lockId]/RevealModal.tsx` (Tier-3 neutral profile)
- Create: `apps/web/app/matches/[lockId]/Phase7Placeholder.tsx`
- Create: `apps/web/app/matches/[lockId]/MatchConfirmation.tsx` (confetti overlay)
- Create: `apps/web/app/matches/[lockId]/rate/page.tsx`
- Create: `apps/web/app/matches/[lockId]/rate/RatingForm.tsx`
- Create: `apps/web/app/matches/[lockId]/*.test.tsx` for each component
- Create: `docs/superpowers/specs/2026-05-XX-5b-F-ui-locked-reveal-design.md`
- Create: `docs/superpowers/plans/2026-05-XX-5b-F-ui-locked-reveal.md`

- [ ] **Step 1: Brainstorm F.** Input: "Sub-project F — UI locked + reveal + ratings for 5b. See overview spec §1 F, §2.6 reveal predicate derivation, §3 F row, §5.1 seam 10 (profile-change-between-shortlist-and-accept), §1 audit A10 (Phase 7 placeholder exact copy). Pin: Tier-3 neutral profile shape per Barbiecore §1 (warm cream + soft ink + polaroid avatar + no vibePalette intrusion), confetti animation respects reduced-motion, Phase 7 placeholder copy (Caprasimo headline + Fredoka body), rating UI enabled only after `rating_window` fires (read `rating_visible_at` derived from `date_instances.time_range_end + grace`). Visual companion warranted — reveal modal is a flagship UX moment."

- [ ] **Step 2: Write F's plan.** Invoke `superpowers:writing-plans`.

- [ ] **Step 3: Execute F's plan.** Invoke `superpowers:subagent-driven-development`.

- [ ] **Step 4: Run F's UI tests + axe.**

- [ ] **Step 5: Merge F to `main`.**

**Acceptance criteria:**
- `/matches` renders both active + completed locks for the viewer.
- `/matches/[lockId]` renders Tier-3 reveal modal with `first_name, age, photos[], bio, city, expectations[]` for the locked counterpart. Verify via DB inspection that RLS-denied users CANNOT load this page.
- MatchConfirmation overlay fires on Realtime `locks` insert; respects `useReducedMotion`.
- Phase 7 placeholder visible with exact copy from audit A10.
- Rating UI hidden until `rating_visible_at` is in the past; once visible, lets user submit `match_ratings` row.
- a11y audit GREEN — especially confirm reveal modal trap-focus + escape-to-close.
- F merged to `main`.

---

## Task 8: Sub-project G — notification surfaces

**Sub-project from overview spec:** §1 "G — Notification surfaces"

**Goal:** Ship the in-app notification center + Resend email transport + `notification_preferences` UI.

**Depends on:** A + B merged (event sources). Code can start in parallel with D/E/F.

**Files (target):**
- Create: `apps/web/components/notifications/NotificationBadge.tsx` (bottom-tab badge)
- Create: `apps/web/components/notifications/NotificationCenter.tsx` (dropdown list)
- Create: `apps/web/components/notifications/NotificationToast.tsx` (sonner toast)
- Create: `apps/web/app/api/notifications/route.ts` (GET paginated + POST mark-read)
- Create: `apps/web/lib/email/resend.ts` (Resend SDK wrapper)
- Create: `apps/web/lib/email/templates/offer_received.tsx`, `new_match.tsx`, `offer_expiring.tsx`, `lock_cancelled_frozen.tsx` (React Email components)
- Create: `apps/web/app/account/notifications/page.tsx` (preferences UI)
- Create: `apps/web/app/account/notifications/PreferencesForm.tsx`
- Create: `supabase/functions/notification-dispatcher/index.ts` (subscribes to `notifications` table inserts, fans out to in-app + email per `notification_preferences`)
- Create: `apps/web/components/notifications/*.test.tsx`
- Create: `docs/superpowers/specs/2026-05-XX-5b-G-notif-surfaces-design.md`
- Create: `docs/superpowers/plans/2026-05-XX-5b-G-notif-surfaces.md`

- [ ] **Step 1: Verify Resend domain.** BEFORE any coding (per §5.2 R6): set up DKIM + SPF + DMARC records for `tryafter5.app` in DNS; send a test email from Resend test mode; confirm inbox arrival + not spam. If domain isn't verified, STOP and resolve.

- [ ] **Step 2: Brainstorm G.** Input: "Sub-project G — notification surfaces for 5b. See overview spec §1 G, §3 G row, §5.2 R5 (chat_lock_ready=true permanence), §5.2 R6 (Resend domain — already done in Step 1). Pin: in-app center component with Realtime sub on `notifications` table user-id-scoped; 4 React Email templates; preferences UI respects `notification_preferences` shape from S2; quiet-hours enforcement; fail-loud admin_alerts on Resend API failure. Visual companion likely warranted for notification center + email template designs."

- [ ] **Step 3: Write G's plan.** Invoke `superpowers:writing-plans`.

- [ ] **Step 4: Execute G's plan.** Invoke `superpowers:subagent-driven-development`.

- [ ] **Step 5: Run G's tests.** Vitest for components; integration test against Resend test mode (no real sends); preferences round-trip test; Realtime subscription test.

- [ ] **Step 6: Merge G to `main`.**

**Acceptance criteria:**
- Resend domain verified + DKIM/SPF/DMARC passing.
- In-app badge increments on `notifications` insert (verify via Realtime test).
- Toast renders on receive with sonner per 5a token system.
- Notification center lists all notifications paginated.
- Preferences UI saves per-type-per-channel toggles + quiet-hours.
- 4 email templates render correctly in HTML + plaintext fallback.
- Resend send failure inserts to `admin_alerts`.
- G merged to `main`.

---

## Task 9: Sub-project H — E2E test track + CI integration

**Sub-project from overview spec:** §1 "H — E2E test track + CI integration"

**Goal:** Ship the master run-all script + Playwright happy-path E2E + GitHub Actions CI workflow gating every PR to main.

**Depends on:** A through G merged.

**Files (target):**
- Create: `supabase/tests/_all_5b.sh` (master runner with `set -euo pipefail`)
- Create: `apps/web/e2e/5b-happy-path.spec.ts` (Playwright: host + candidate two-context, swipe → shortlist → offer → accept → reveal)
- Create: `apps/web/e2e/5b-negatives.spec.ts` (expired offer, account-gated, concurrent accept)
- Create: `apps/web/e2e/_helpers/auth.ts` (PKCE login helper per memory `reference_local-qa-browser-login.md`)
- Create: `apps/web/e2e/_helpers/seed.ts` (seed two users + a posted night)
- Create: `.github/workflows/5b-tests.yml` (CI workflow)
- Create: `docs/superpowers/specs/2026-05-XX-5b-H-e2e-ci-design.md`
- Create: `docs/superpowers/plans/2026-05-XX-5b-H-e2e-ci.md`

- [ ] **Step 1: Brainstorm H.** Input: "Sub-project H — E2E + CI for 5b. See overview spec §1 H, §4.4 run-all gate ordering, §5.1 seams 11/12 (Resend deliverability + pre-flight prod check), §5.2 R1 (migration runbook already drafted in Task 0). Pin: two-context Playwright setup (host browser + candidate browser); CI workflow spins up Supabase stack in GitHub Actions runner; paths-filter skips on docs-only; negative-path E2E covers each P5 errcode."

- [ ] **Step 2: Write H's plan.** Invoke `superpowers:writing-plans`.

- [ ] **Step 3: Execute H's plan.** Invoke `superpowers:subagent-driven-development`.

- [ ] **Step 4: Run H's E2E locally.** `bash supabase/tests/_all_5b.sh` exits 0.

- [ ] **Step 5: Verify CI workflow.** Open a draft PR that triggers `.github/workflows/5b-tests.yml`. Workflow runs successfully.

- [ ] **Step 6: Merge H to `main`.**

**Acceptance criteria:**
- `_all_5b.sh` runs Z → A → B → C → (D, E, F, G parallel) → H in order; non-zero on any failure.
- Playwright happy-path E2E completes in <5 min.
- 3 negative-path E2E scenarios (expired offer, account-gated, concurrent accept) all pass.
- GitHub Actions workflow runs on every PR to main; paths-filter skips docs-only PRs.
- H merged to `main`.

---

## Task 10: Feature-flag rollout (per-cohort)

**Owner:** Master-roadmap level (runs after H lands)

**Goal:** Flip `match_v2_enabled` from `false` to `true` for progressively-wider cohorts. NOT a sub-project — operational rollout step.

- [ ] **Step 1: Internal-only cohort.** Update `feature_config` SQL: set a per-user override mechanism (e.g., add `feature_config_overrides(user_id, key, value)` table — TBD with B's spec if not already present). Flip `match_v2_enabled=true` for the QA account only (`lucache95@gmail.com`, UUID `5f387641-2ee9-443a-abb8-bb7f8e48a1a0`). Smoke-test the full loop end-to-end on prod with a second test account.

- [ ] **Step 2: Tester cohort (10-20 users).** Recruit testers per the `recruit real testers` line in the launch-readiness backlog. Enable the flag for their user_ids. Daily monitoring of `admin_alerts` + `analytics_events` for unexpected errors.

- [ ] **Step 3: Wider rollout (open).** Flip `match_v2_enabled=true` globally. Monitor for 48h. Document any incident in `docs/superpowers/overnight-decisions/`.

**Acceptance criteria:**
- Two paid (or otherwise-known-real) users complete a full swipe → match → reveal → rate cycle in production.
- Zero `admin_alerts` from `match_*` RPCs in 48h post-global-flip.

---

## Task 11: Phase 7 brainstorm kickoff

**Owner:** Master-roadmap level (runs after Task 10 succeeds — or in parallel with Step 2 if tester feedback demands messaging fast)

**Goal:** Start Phase 7 (chat messaging UX + rapport-gate redefinition of `chat_lock_ready`) immediately so the no-rapport-gate window from 5b launch is short.

- [ ] **Step 1: Invoke `superpowers:brainstorming`** with input: "Phase 7 — chat messaging UX + rapport-gate redefinition. Builds on Z's chat-core primitives (already shipped in 5b). Adds: message persistence, Realtime channels for messages, message composer + rendering UI in F's `/matches/[lockId]` route (replacing the Phase 7 placeholder), retention policy, off-platform contact detection, rapport-gate definition for `chat_lock_ready` (e.g., N messages + M minutes). See `RECONCILED-MASTER-PLAN.md` S7 for the canonical reference."

- [ ] **Step 2: Continue Phase 7's own brainstorm → spec → plan → execute cycle** in subsequent sessions. Phase 7 has its own master roadmap if it's similarly decomposed.

**Acceptance criteria:**
- Phase 7 spec exists and is committed to `docs/superpowers/specs/`.
- Phase 7 implementation has at least started.

---

## Self-review

### Spec coverage (overview spec § → roadmap task)

- §1 Z — chat-core primitives → Task 1 ✓
- §1 A — backend happy path → Task 2 ✓
- §1 B — backend resolution → Task 3 ✓
- §1 C — backend extras + edge → Task 4 ✓
- §1 D — UI host → Task 5 ✓
- §1 E — UI candidate → Task 6 ✓
- §1 F — UI locked + reveal + ratings → Task 7 ✓
- §1 G — notification surfaces → Task 8 ✓
- §1 H — E2E + CI → Task 9 ✓
- §2 state machines → consumed by reference in each sub-project's brainstorm input
- §3 contract surface → consumed by reference in each sub-project's brainstorm input
- §4 error handling + testing → consumed by reference + run-all gate in Task 9
- §5.1 open seams → each seam's owner sub-project's task input lists the seam explicitly
- §5.2 risks (R1-R12) → R1 mitigation in Task 0; R6 in Task 8 Step 1; R8 in Task 4; R10 in Task 2; R11 in Task 4; others surfaced in sub-project task inputs
- §5.3 out-of-scope → reinforced as "NOT in 5b" — no roadmap task; Phase 7 handoff in Task 11

### Placeholder scan

- No "TBD" / "implement later" / "add appropriate error handling" / vague references.
- Lock-completion mechanism (overview seam 7) is explicitly deferred to B's brainstorm — that's honest scoping, not a placeholder.
- Rank-collision policy (seam 8) explicitly deferred to A's brainstorm — same.

### Type consistency

- Sub-project names (Z, A-H) consistent throughout.
- RPC names (`match_shortlist`, `match_make_offer`, etc.) match overview spec §3 exactly.
- Errcode names (`P5000` etc.) match overview spec §4.1 exactly.
- Notification types match overview spec §3.
- Migration band numbers (S2 124500 for Z, P5 126xxx for A/B/C) consistent.

---

## Execution handoff

This roadmap-of-plans is its own thing: each task is a **session-spanning gate**, not a code step. The right execution model is:

**For each Task N (Z, A-H, in dependency order):**
1. Open a fresh session.
2. Mark the task's Step 1 (Brainstorm) checkbox in this roadmap.
3. Invoke `superpowers:brainstorming` with the task's documented brainstorm input.
4. Walk that brainstorm to a committed spec.
5. Invoke `superpowers:writing-plans` to produce that sub-project's plan.
6. Invoke `superpowers:subagent-driven-development` to execute it.
7. Run the sub-project's run-all locally; apply migrations to prod per the runbook; merge to main.
8. Mark all the task's checkboxes; move to the next task.

**Don't try to execute multiple sub-project tasks in the same session.** Each is too large; context will run out.

**Start with Task 0** (prereqs + runbook) before any sub-project work.
