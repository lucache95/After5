# Sub-project A — Backend Happy Path (5b) — Design

**Sub-project:** Phase 5b § A (overview spec `docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md` §1 A, §2.1-2.6, §3 A row, §4.1 errcodes P5000-P5005+P5007-P5008, §5.1 seams 2/3/4/8/9/13, §5.2 R10).

**Status:** Brainstorm autonomously executed per user direction. This spec is the contract A's plan executes against. **Brainstorm questions resolved with documented defaults** (§ 8). Z is shipped; A depends on Z + S2 jobs/notify/config/gate + S5 swipes.

**Date:** 2026-05-27.

---

## 1. Scope

A's deliverables (8 migrations + race harness + tests + S5 hook):

| ID | Type | File |
|---|---|---|
| **PREREQ** | Migration (owed by S2 to unblock A) | `supabase/migrations/20260527124550_s2_notification_type_5b_extend.sql` — adds 5 enum values: `reciprocal_detected, offer_passed, offer_expired, lock_cancelled_frozen, lock_cancelled_rolled` |
| **A.1** | Migration | `supabase/migrations/20260527126000_p5_lock_keys.sql` — `match_instance_lock_key`, `match_pair_lock_key` (IMMUTABLE bigint hashes) |
| **A.2** | Migration | `supabase/migrations/20260527126100_p5_idempotency.sql` — `transition_idempotency(actor, action, idem_key)` ledger + `match_idem_lookup`/`match_idem_store` helpers |
| **A.3** | Migration | `supabase/migrations/20260527126200_p5_shortlist.sql` — `match_shortlist(actor, instance, candidate, rank, idem_key)`, `match_ingest_interest(swiper, instance, swipe_dir)`, `queue_entries.offer_frozen_rank` column |
| **A.4** | Migration | `supabase/migrations/20260527126300_p5_make_offer.sql` — `match_make_offer(actor, instance, candidate, idem_key)` returning offer uuid |
| **A.5** | Migration | `supabase/migrations/20260527126400_p5_accept_lock.sql` — `match_accept_offer(actor, offer, idem_key)` returning lock uuid |
| **A.6** | Migration | `supabase/migrations/20260527126500_p5_reveal_predicate.sql` — `match_reveal_allowed(viewer, instance)` returning bool |
| **A.7** | Migration | `supabase/migrations/20260527126600_p5_profiles_revealed_policy.sql` — `profiles_select_revealed` RLS policy on `profiles` (HIGH-RISK: PII gate) |
| **A.8** | Migration | `supabase/migrations/20260527126700_p5_s5_swipe_hook.sql` — modifies S5's `record_swipe` to call `match_ingest_interest` on right-swipes |
| **A.race** | Bash harness | `supabase/tests/p5_concurrency_lib.sh` — two-session psql race library |
| **A.tests** | SQL tests | `supabase/tests/a_shortlist.sql`, `a_make_offer.sql`, `a_accept_lock.sql`, `a_reveal_predicate.sql`, `a_revealed_rls_negative.sql`, `a_idempotency_replay.sql`, `a_s5_swipe_hook.sql`, `a_race_concurrent_accept.sh` |

11 deliverables. Reuses existing P5 SQL bodies from `docs/superpowers/plans/2026-05-25-p5-matching-state-machine.md` (lines 189-1464) with adaptations noted below.

---

## 2. Open seam resolutions (defaults locked)

### 2.1 — Seam 2 (atomic ordering of reveal predicate vs RLS policy)

**Decision:** Two separate migrations. A.6 ships the predicate function alone; A.7 ships the RLS policy that uses it. Rationale: if A.7 fails (it's the PII gate; advisor scrutiny is highest), we can apply A.6 and stop without leaving a half-formed RLS surface. A.7's migration includes a header note ("cross-band ownership: A modifies S1's profiles policies") because the table is owned by S1 but A's policy lives in P5 band.

### 2.2 — Seam 3 (blocks check in make_offer)

**Decision:** `match_make_offer` raises `P5002 account_gated` if `EXISTS (SELECT 1 FROM blocks WHERE (blocker_id, blocked_id) IN ((p_actor, p_candidate), (p_candidate, p_actor)))`. Symmetric — either direction blocks the offer. Same errcode as dating_enabled=false (both are "this user can't be matched"); UI shows generic "this person isn't available" without revealing block direction.

### 2.3 — Seam 4 (candidate already in-lock receives new offer)

**Decision:** `can_enter_lock_flow(p_candidate)` returns false if candidate has an active lock; A raises `P5002 account_gated` with the same UI behavior. D's UI separately mutes already-locked candidates in `InterestedList` (D's responsibility — flag in D's brainstorm input).

### 2.4 — Seam 8 (rank collision policy)

**Decision:** **Bump-and-cascade.** When `match_shortlist(actor, instance, candidate, rank=N)` is called:

1. If candidate already shortlisted on this instance: update their existing row to the new rank (treat as "drag candidate to position N").
2. If another candidate is already at rank N: shift that candidate to N+1; cascade if N+1 also occupied; continue until empty slot.
3. If the shifted-to slot would push beyond `max_shortlist_rank` (config — default 10): the lowest-ranked candidate gets un-shortlisted (back to `interested`).

Rationale: matches the host's mental model when dragging in `InterestedList` (Reorder.Group semantics). Implementation: single UPDATE with `WITH RECURSIVE` to compute new ranks atomically. Tested with: insert at occupied slot, drag-down-then-up sequence, cascade-overflow (un-shortlist tail).

### 2.5 — Seam 9 (`dating_enabled=false` enforcement)

**Decision:** Both `match_make_offer` and `match_accept_offer` check both parties have `dating_enabled=true`. Wired as: `IF NOT (SELECT dating_enabled FROM profiles WHERE id IN (p_actor, p_candidate) GROUP BY id HAVING bool_and(dating_enabled) = true) THEN RAISE P5002 ...`. Symmetric — `match_accept_offer` checks both the actor (the candidate accepting) and the offer's creator. If either has flipped to disabled between offer-made and accept, the accept fails P5002.

### 2.6 — Seam 13 (notification_type enum gap)

**Decision:** Apply PREREQ migration `20260527124550_s2_notification_type_5b_extend.sql` BEFORE A.4 (`match_make_offer` emits `reciprocal_detected`). The PREREQ adds all 5 missing values in one additive ALTER TYPE (safe to apply alone; downstream sub-projects don't break). Documented in the runbook § PREREQ.

### 2.7 — R10 advisory-lock hash strategy

**Decision:** `('x'||substr(md5(uuid::text),1,16))::bit(64)::bigint` — the documented pattern from P5 source. Deterministic per-uuid; collision probability astronomically low at 5b's scale (testers + early users <10K instances). Implemented in A.1 as `match_instance_lock_key(uuid)` and `match_pair_lock_key(uuid, uuid)`.

### 2.8 — Reciprocal-pair atomicity (invariant §2.5 #12)

**Decision:** A.4 (`match_make_offer`) checks for reciprocal inside the advisory-locked transaction, BEFORE inserting the new offer. If `EXISTS (SELECT 1 FROM offers WHERE creator_id=p_candidate AND candidate_id=p_actor AND status='active')`, A.4 raises `P5008 reciprocal_pending` with the existing offer's id as `pair_id`. No partial state: the new offer is never inserted. B owns the resolution flow (`match_resolve_reciprocal`); B's brainstorm decides whether to materialize a pair tracking table or just use the cross-pair of offer ids as a synthetic pair_id.

### 2.9 — `idem_key` parameter type

**Decision:** `uuid NOT NULL` (overrides P5 source's `text` type). All A/B/C RPCs accepting `idem_key` use `uuid` — clients pass `gen_random_uuid()` per call. `transition_idempotency` row stores `(actor uuid, action text, idem_key uuid)` as PK. Rationale: uuid is more compact and prevents accidental string collisions; aligns with idempotency-replay test pattern (insert random uuid, replay, expect same result).

### 2.10 — Cross-band ownership marker

**Decision:** A.7 (`profiles_select_revealed`) includes a header comment block explaining why a P5-band migration touches S1's `profiles` table policies:

```sql
-- A.7 migration (P5 band 126600) modifies S1's profiles RLS policies.
-- Cross-band ownership is intentional: the reveal predicate (A.6) is a P5
-- artifact (knows about offers/locks/queue_entries — all P5 surface), and
-- the policy that gates profile reads on this predicate is therefore
-- canonically a P5 deliverable. S1's pre-existing profiles policies (blind
-- feed + own-profile read) are unmodified; this migration ADDS a parallel
-- policy that opens additional fields when the predicate returns true.
```

---

## 3. SQL body sourcing (no code in this spec)

Every A migration's SQL body is derived from `docs/superpowers/plans/2026-05-25-p5-matching-state-machine.md` (P5 source). Adaptations per migration:

| Migration | P5 source lines | Adaptations |
|---|---|---|
| A.1 lock_keys | 189-200 | Direct copy. |
| A.2 idempotency | 257-280 | Change `p_key text` → `p_key uuid` per § 2.9. Adjust table PK. |
| A.3 shortlist | 376-435 | Direct copy of ingest_interest; rewrite `match_shortlist` per § 2.4 bump-and-cascade (P5 source's body uses a different policy — see source for original). Add `queue_entries.offer_frozen_rank int` column add. |
| A.4 make_offer | 647-705 | Direct copy + add feature_flag gate at entry (raise P5000 if `match_v2_enabled=false`), add blocks check per § 2.2, add dating_enabled check per § 2.5, ensure reciprocal detection (§2.8) emits `reciprocal_detected` notification via `dispatch_notification`. |
| A.5 accept_lock | 900-972 + 973-1066 (autoclose_creator_conflicts is B's territory; A enqueues `standby_roll` jobs only) | Direct copy of accept; strip out the inline cascade (replace with `enqueue_job('standby_roll', payload, run_after=now())`). Add feature_flag gate. Promote thread via Z. Cancel offer_expiry job. Enqueue `rating_window` job (B's hook from B.4 — but A includes it now to avoid an A.5 modification later). |
| A.6 reveal_predicate | 706-770 | Direct copy. Pinned to §2.6 derivation. |
| A.7 profiles_revealed_policy | (no P5 source — new) | New SQL: `CREATE POLICY profiles_select_revealed ON public.profiles FOR SELECT USING (public.match_reveal_allowed(auth.uid(), <instance-derived-via-request>))`. Plan task spells out the lateral-join trick for getting the instance from the request context. |
| A.8 s5_swipe_hook | (no P5 source — uses S5's record_swipe shape) | `CREATE OR REPLACE FUNCTION record_swipe` with body extended to PERFORM `match_ingest_interest(auth.uid(), p_instance, p_direction)` when `p_direction='right'`. Pre-A.8 body captured in the runbook for rollback. |

A's plan will include the actual SQL bodies in each task step (per writing-plans skill's "no placeholders" rule).

---

## 4. Tests

Per overview spec §4.3:

| Test file | Coverage |
|---|---|
| `supabase/tests/a_shortlist.sql` | bump-and-cascade rank collision + interested→shortlisted transition + un-shortlist on overflow |
| `supabase/tests/a_make_offer.sql` | happy path + each errcode (P5000 flag-off, P5001 auth-mismatch, P5002 dating-disabled/blocked, P5003 already-active, P5008 reciprocal-pending) + idempotency replay (same idem_key → same offer uuid) |
| `supabase/tests/a_accept_lock.sql` | happy path + P5004 time_conflict (GiST exclusion) + P5005 chat_not_ready (Z says yes at 5b launch, so this is a future-proof test against a manually-promoted thread) + P5007 offer_expired (set offer.expires_at < now, accept must raise) + idempotency replay |
| `supabase/tests/a_reveal_predicate.sql` | match_reveal_allowed returns true for: creator, offer candidate (status in active/accepted), lock participants. Returns false otherwise. All 4 cases enumerated. |
| `supabase/tests/a_revealed_rls_negative.sql` | **CRITICAL PII boundary.** Un-revealed user cannot SELECT `last_name`, `birthdate`, `phone`. Revealed user can SELECT `first_name`, `photos[]`, `bio`, `city`, `age (computed)`. Both negative + positive cases. Runs as `authenticated` role with explicit `auth.uid()` setting via `set_config('request.jwt.claims', ...)`. |
| `supabase/tests/a_idempotency_replay.sql` | Replay same `(actor, action, idem_key)` returns cached uuid; no side-effect. Cross-action key reuse is allowed (different `action` value). |
| `supabase/tests/a_s5_swipe_hook.sql` | Right-swipe inserts `queue_entries` row with `status='interested'`; left-swipe does NOT. |
| `supabase/tests/a_race_concurrent_accept.sh` | Two-session race: both call `match_accept_offer` on same offer simultaneously. Expected: one wins (returns lock uuid), other raises P5004 or P5003 deterministically. Final state: exactly one lock row. |

Plus the shared infrastructure: `supabase/tests/p5_concurrency_lib.sh` — a bash library of helpers (`spawn_session`, `wait_all`, `seed_pair`) the race scripts import. Built once for A; reused by B for expire-vs-accept race.

---

## 5. Error handling

Per overview spec §4.1, A raises these errcodes (verified in tests):

| Errcode | Raised by | Condition |
|---|---|---|
| `P5000 feature_disabled` | match_shortlist, match_make_offer, match_accept_offer | `feature_enabled('match_v2_enabled')=false` |
| `P5001 auth_mismatch` | all three | `auth.uid() != p_actor` |
| `P5002 account_gated` | make_offer, accept_offer | `can_enter_lock_flow=false` OR `dating_enabled=false` OR `blocks` exists |
| `P5003 offer_already_active` | make_offer | `offers_one_active_per_instance` partial unique violation |
| `P5004 time_conflict` | accept_offer | GiST exclusion violation on `lock_participants` |
| `P5005 chat_not_ready` | accept_offer | `chat_lock_ready=false` (5b: only reachable if thread state changed mid-transaction; Phase 7: real rapport gate) |
| `P5007 offer_expired` | accept_offer | `offers.expires_at < now()` |
| `P5008 reciprocal_pending` | make_offer | reciprocal-pair detected, must resolve first |

Translation to HTTP + UI string happens at C's Edge Function layer (not A's responsibility). A just RAISES with the errcode.

---

## 6. Auth boundary

A's RPCs are PUBLIC (callable via PostgREST `rpc/match_*`). They are `SECURITY DEFINER` but **NOT** REVOKE'd from authenticated/anon — they must be callable by clients via JWT. Auth enforcement is:

1. `auth.uid() = p_actor` check inside the function body (raise P5001 if mismatch).
2. C's Edge Function does first-line JWT verification + sets `p_actor` from JWT.sub.
3. PostgREST passes `auth.uid()` through to the function.

This contrasts with Z's auth model (REVOKE FROM all) because Z's functions are internal-only. A's are user-facing.

Negative tests for A's auth boundary:

- Pass `p_actor` not matching JWT.sub → P5001 raised.
- Call as `anon` role (no JWT) → `auth.uid()` is null → P5001 raised.

---

## 7. Acceptance criteria

1. **PREREQ enum extension applied to prod** before A.4 lands. Verified via `pg_enum` query.
2. **A.1** advisory-lock helpers present + idempotency-replay tests pass.
3. **A.2** transition_idempotency table + helpers present; PK enforces no duplicate replays.
4. **A.3** match_shortlist + match_ingest_interest work; bump-and-cascade rank collision verified with 3-scenario test.
5. **A.4** match_make_offer works end-to-end: feature flag gate (P5000), auth check (P5001), can_enter_lock_flow (P5002), blocks (P5002), dating_enabled (P5002), offers_one_active_per_instance (P5003), reciprocal detection (P5008), opens chat thread via Z, enqueues offer_expiry job, emits offer_received + reciprocal_detected notifications.
6. **A.5** match_accept_offer works: feature flag, auth, chat_lock_ready (Z says yes), can_enter_lock_flow on actor, advisory lock acquired, lock row inserted (GiST exclusion → P5004 on conflict), thread promoted via Z, offer_expiry job cancelled, standby_roll jobs enqueued for off-market counterparties, rating_window job enqueued, new_match notification emitted.
7. **A.6** match_reveal_allowed matches §2.6 derivation; 4-case test passes.
8. **A.7** profiles_select_revealed policy enforces PII boundary: negative tests verify un-revealed user CANNOT read last_name/birthdate/phone; positive tests verify revealed user CAN read first_name/photos/bio/city/age.
9. **A.8** S5 swipe hook invokes match_ingest_interest on right-swipes only.
10. **Race harness** (`p5_concurrency_lib.sh`) exists + race test `a_race_concurrent_accept.sh` exits 0.
11. **All A migrations applied to prod** per runbook; security advisor GREEN; runbook log updated per migration.
12. **A merged to main** via direct commits (same precedent as Z).

---

## 8. Brainstorm question resolutions (autonomous defaults)

| Q | Resolution | § |
|---|---|---|
| Reveal predicate + RLS atomic ordering | Two separate migrations (A.6 then A.7) | 2.1 |
| Blocks check shape | Symmetric `not exists` in make_offer; P5002 errcode | 2.2 |
| In-lock candidate receiving new offer | can_enter_lock_flow=false → P5002 (D handles UI mute) | 2.3 |
| Rank collision policy | Bump-and-cascade with overflow→unshortlist | 2.4 |
| dating_enabled enforcement | Symmetric `bool_and` check in both make_offer + accept_offer | 2.5 |
| Notification_type enum gap | Apply PREREQ migration before A.4 | 2.6 |
| Advisory-lock hash | md5-based bigint hash per P5 source | 2.7 |
| Reciprocal-pair detection | Inside advisory-locked txn, before insert; raise P5008 with existing offer's id | 2.8 |
| `idem_key` type | `uuid NOT NULL` (override P5 source's text) | 2.9 |
| Cross-band ownership note | Header comment in A.7 migration | 2.10 |

---

## 9. Out of scope (defer to B, C, or Phase 7)

- `match_pass_offer`, `match_expire_offer`, `match_auto_roll`, `match_next_standby` (internal helper called by auto_roll), `match_withdraw`, `match_resolve_reciprocal`, `match_cancel_lock` — **B's scope.**
- `match_demand_hint` stub — **C's scope.**
- 8 Edge Functions + `_shared/` library + feature flag config row + admin tooling + prune cron + grants migration + TS types regen — **C's scope.**
- Reciprocal-pair tracking table (if needed beyond using cross-pair of offer ids) — **B decides during its brainstorm.**
- Lock-completion mechanism (when does lock move to 'completed'?) — **B's scope.**
- Real rapport gate semantics in `chat_lock_ready` — **Phase 7.**
