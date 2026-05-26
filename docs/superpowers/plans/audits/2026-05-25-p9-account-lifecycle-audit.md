# P9 — Account Lifecycle & Compliance — Pre-Build Audit

Auditor stance: paranoid principal engineer. Verdict first, then evidence. Cross-referenced against the real text of `2026-05-25-p5-matching-state-machine.md`, `2026-05-25-p0-data-model.md`, `2026-05-25-p2-scheduler-notifications.md`, `2026-05-25-p6-chat.md`, `2026-05-25-p7-trust-safety-ratings.md`, and the roadmap. **This plan will not run as written.** It calls P5 functions that do not exist under those names/signatures, enqueues into a P2 `jobs` table whose real columns it does not match, and treats `account_closed` as a benign cancel reason when P5 will treat it as a FREEZE — silently corrupting the very orphan-handling it exists to fix.

---

## 1. Verdict & Score

**Score: 38 / 100 — DO NOT EXECUTE. Requires re-plan of the P5/P2 seams and the auth-identity lifecycle.**

The skeleton is thoughtful (grace window, legal-hold-aware anonymize-vs-delete, sentinel re-point, idempotent orchestrator). But the load-bearing premise — "P9 *drives* the P5 state machine so invariants stay authoritative" — is **factually false against the P5 plan that exists in this repo.** Every P5 call in Task 7 has the wrong name, wrong arity, and wrong argument order, and the one reason code it passes (`account_closed`) triggers the opposite behavior (freeze, not safe-roll). The thin "stand-in" P5 functions in the tests have signatures that match *neither* the real P5 *nor* what would be needed, so the tests will pass against fiction and the production path will throw at the first real call. Separately, the P2 `jobs` shim conflicts with the real P2 schema (`kind` vs `job_type`, `queued` vs `pending`), so enqueue will fail once P2 lands. And `auth.users` is never deleted — a "deleted" user can still authenticate into a profile-less app. These are not polish items; they break the end-to-end flow.

Counts below.

---

## 2. Issue Counts by Severity

| Severity | Count |
|---|---|
| **BLOCKER** (plan cannot achieve its goal; will error or corrupt at runtime) | 9 |
| **HIGH** (correctness/compliance hole that ships a broken or unlawful state) | 11 |
| **MEDIUM** (real defect, recoverable in-phase) | 9 |
| **LOW** (hygiene / clarity) | 6 |
| **Total** | 35 |

---

## 3. BLOCKERS (must fix before any execution)

### B1 — P5 function NAMES do not match. (`cancel_lock`/`expire_offer`/`withdraw_from_queue` do not exist.)
P9 Task 7, the orchestrator (Task 9), and the Architecture/Dependency sections all call:
- `cancel_lock(lock_id, 'account_closed', p_user)`
- `expire_offer(offer_id, 'account_closed')`
- `withdraw_from_queue(entry_id, 'account_closed')`

The P5 plan (`2026-05-25-p5-matching-state-machine.md`) defines **`match_cancel_lock`** (line 1468), **`match_expire_offer`** (line 1100), **`match_resolve_offer_negative`** (1062), **`match_pass_offer`** (1087), **`match_auto_roll`** (1107), **`match_autowithdraw_user_conflicts`** (1137). There is **no `cancel_lock`, no `expire_offer`, and no `withdraw_from_queue` of any kind** in P5. The prompt's suspicion is correct and worse than stated: it is not just a prefix mismatch, the queue-withdraw function P9 invents **does not exist at all**.

### B2 — P5 SIGNATURES do not match (arity + argument order + idempotency key).
- Real: `match_cancel_lock(p_actor uuid, p_lock_id uuid, p_reason cancel_reason, p_idem_key text)` — **4 args, actor FIRST, requires an idempotency key.** P9 passes `(lock_id, reason, actor)` — wrong order, missing `p_idem_key`. Without the idem key, P5's `match_idem_lookup` path is undefined for this caller; P9 supplies no dedupe strategy for the worker's retries either.
- Real: `match_expire_offer(p_offer_id uuid)` — **1 arg, returns `int`, no reason parameter.** P9 passes a `reason` it cannot accept.
- There is no per-entry queue withdrawal at all; P5 only offers **window-scoped** `match_autowithdraw_user_conflicts(user, rng, keep_instance)`. P9 needs to withdraw a departing user from *every* queue regardless of time window — P5 gives no such primitive. P9 must either add one in P5's domain (coordination) or hand-edit `queue_entries` (which P9 explicitly forbids itself from doing).

### B3 — `account_closed` is NON-BENIGN in P5 → cancel FREEZES the date, the opposite of P9's design.
P0 (`2026-05-25-p0-data-model.md:539`) defines `cancel_reason as enum ('schedule_conflict','venue_issue','changed_mind','safety','misconduct','other')`. P5's `match_cancel_lock` benign set is hardcoded: `benign := p_reason in ('schedule_conflict','venue_issue','changed_mind','other')` (P5:1486). Anything not in that list → **`update date_instances set status='cancelled'` (freeze, no roll)** and notifies both parties `lock_cancelled_frozen` (P5:1488–1497). P9 *adds* `account_closed` to the enum (Task 2) but it will land **outside** the benign set, so the creator's night is **killed, not re-rolled to standby** — directly contradicting P9 Task 7's claim ("`account_closed` is treated benign for the *night* … can re-offer to standby"). Either P5 must be edited to classify `account_closed` (and decide freeze-vs-roll deliberately), or P9's narrative is a lie that ships a worse outcome (the standby loses the date too).

### B4 — The P5 "stand-in" test shims encode the WRONG contract, so green tests prove nothing.
Task 7 / Task 9 ship `create function cancel_lock(p_lock_id, p_reason, p_actor)` and `expire_offer(p_offer, p_reason)` and `withdraw_from_queue(p_entry, p_reason)` *inside the test files*. These match P9's (wrong) calls, not P5's real functions. So: (a) the tests pass against a fiction; (b) when P5 lands, the shims are skipped (`if not exists`) but P5's real names differ, so `_p9_release_in_flight_state` still references `cancel_lock`/`expire_offer`/`withdraw_from_queue`, which **do not exist** → the function body throws `function ... does not exist` at first real call. The "provable in isolation" claim is false: it proves the wrong thing.

### B5 — P2 `jobs` shim is schema-incompatible with the real P2 table → enqueue fails when P2 lands.
P9 shim (Task 1): `jobs(kind text, payload, status job_status DEFAULT 'queued', run_after, attempts, last_error)`, with `job_status as enum ('queued','running','done','failed')`. Real P2 (`2026-05-25-p2-scheduler-notifications.md`): column is **`job_type`** not `kind` (P2:228), enum is **`job_status as enum ('pending','running','done','failed','cancelled')`** (P2:105) — there is **no `queued` value**, and the table carries required typed FK columns (`date_instance_id`, `offer_id`, `lock_id`, `queue_entry_id`). Consequences: if P2 lands first, `create table if not exists` no-ops, then P9's `insert into jobs (kind, payload, run_after)` throws **column "kind" does not exist**; and the `pg_type` guard means P9 never gets its `'queued'` value, so even a hand-fixed insert with `status` default `'queued'` is an invalid enum. If P9 lands first, P2's own migration collides. The "reconciles cleanly" claim is wrong in both orderings.

### B6 — `auth.users` is never deleted or disabled → "deleted" users can still log in into a profile-less app.
P9 only ever touches `profiles` (hard-delete) or tombstones it (hold). Supabase identity lives in `auth.users` (email/phone/password/OAuth). Nothing in P9 deletes, anonymizes, or bans the `auth.users` row. Result: (a) a hard-deleted user retains a valid session/credentials but now has **no `profiles` row** → every `auth.uid()`-joined query and RLS policy that assumes a profile breaks; (b) GDPR/CCPA erasure is **incomplete** — email/phone (PII) survive in `auth.users`; (c) re-login resurrects a ghost. The worker must call `auth.admin.deleteUser()` (hard) or disable/ban the auth user (tombstone), inside the same teardown.

### B7 — Re-signup with the same email/phone is undefined; enables rating-evasion and breaks tombstones.
No mechanism prevents a suspended/deleted user from re-registering with the same email/phone and getting a clean `profiles` row, shedding `reliability_score`, `standing`, open reports, and legal holds. This is the explicit abuse vector in the prompt (mass-delete to dodge bad ratings). With `auth.users` untouched (B6) and no identity-hash carryover, the "accountability skeleton" is trivially bypassed by leave-and-rejoin. P9 needs a durable identity fingerprint (hashed email/phone) checked at signup against tombstoned/held identities.

### B8 — `profiles.standing` (P7) vs `profiles.account_status='suspended'` (P9): dual source of truth for SUSPEND.
P7 (`2026-05-25-p7-trust-safety-ratings.md:84`) adds `profiles.standing` with enum value **`suspended`** plus a `user_sanctions` audit table, and owns *when* to suspend. P9 (Task 2) adds `account_status='suspended'` and `suspend_account()` with `status_reason`. Two columns now both claim to represent "suspended," updated by two phases, with no documented reconciliation, no trigger keeping them in sync, and no precedence rule. Feed suppression keys off `account_status` (P9 Task 5) while the ladder keys off `standing` (P7) → a user P7 marks `standing='suspended'` is **still in the feed** unless someone also flips `account_status`. This contradiction must be resolved (one column, or a defined derivation) before either ships.

### B9 — Chat is never redacted; hard-delete cascades messages away, contradicting the stated "keep the envelope" design.
P6 (`2026-05-25-p6-chat.md:172`): `chat_messages.sender_id ... references profiles(id) on delete cascade`. So P9's `_p9_hard_delete_user` (`delete from profiles`) **silently deletes all the deleted user's messages**, including from the *counterparty's* thread — corrupting the other party's history (B-class because P9's own Architecture promises "keeps the message envelope (sender tombstoned) so the other party's thread is not corrupted"). For the *held* path, `_p9_anonymize_user` touches no chat at all → **message bodies with PII survive un-redacted** under a legal hold that is supposed to retain structure, not content. P9 ships neither the sender re-point nor body redaction; it defers to "P6 coordination" but the FK cascade actively does the wrong thing in the meantime.

---

## 4. HIGH (correctness / compliance holes)

### H1 — Delete *during an active lock the day of the date*: counterparty is silently abandoned.
Because of B3, when a user with a lock starting in <2h (or with any safety report on the instance) deletes, P5 freezes the date (no roll) — but P9 emits **no P9-level notification** to the counterparty explaining the date is off because the other person left. P5's `lock_cancelled_frozen` notify fires only if `match_cancel_lock` is actually called correctly (it isn't — B1/B2). Net: the counterparty learns nothing, and the "freed + told the date is off" guarantee in the goal is unmet. No notification is the prompt's explicit failure mode.

### H2 — Delete while counterparty is mid-checkin / safety escalation in flight.
P7 schedules `safety_checkin` jobs at `starts_at+30m` and an escalation state machine (`safety_checkins`). If the *other* party is mid-checkin when the deleter's lock is torn down, the lock vanishes/freezes but the `safety_checkins` row and its escalation job are not addressed by P9. Worst case: emergency-contact escalation fires for a date that no longer exists, or the checkin can never resolve. P9 must coordinate teardown with P7's `safety_checkins`.

### H3 — Suspend leaves the suspended user's in-flight OFFERS to *others* half-handled, and re-roll can re-add them.
Task 7 step ordering is offers → locks → queues. P9's own note (P9:813) admits that if P5 auto-rolls synchronously, a just-vacated slot could **re-offer to the departing user before step 3 withdraws them**. But B3 means cancel_lock won't roll for `account_closed` anyway; and `match_autowithdraw_user_conflicts` is window-scoped so a departing user's *non-overlapping* standby entries are never cleared by P5. The ordering caveat is real and unresolved, and the "remove from all queues first" requirement has no implementing function (B2).

### H4 — Resurrection after grace: cancel job is best-effort, worker also scans directly → double-process / resurrect race.
`cancel_deletion_request` does `delete from jobs where status='queued'` (best-effort) AND flips the request to `cancelled`. But the worker `processDueRequests` **scans `deletion_requests` directly** (`.eq('status','grace_period')`), ignoring jobs. If a job was already claimed/running when the user cancels, or the direct scan races the cancel, `_p9_process_deletion` could fire. The orchestrator's `status in ('completed','cancelled') → no-op` guard saves the *cancelled* case (good), but there is **no guard for a request that flipped back to `grace_period` via a resume**, and `pause_account` (Task 5) lets a `deletion_pending` user go to `paused` while the open `deletion_requests` row keeps counting down → the worker still deletes a *paused* (not pending) user. State-machine hole: lifecycle transitions and the deletion_requests lifecycle are not interlocked.

### H5 — GDPR export is incomplete (missing chat, blocks-detail, reports-about, notifications, auth identity).
`build_data_export` omits: the user's **chat messages** (P6) — core personal data; the **content of blocks** (only timestamps); **reports filed *about* the user** (arguably their data under access right, certainly under some regimes); **notifications**; and anything in `auth.users` (email/phone — the primary identifiers). A right-of-access response that omits the user's messages and email is non-compliant. Also `verifications` (Task 10) is dumped whole minus `user_id` — may leak internal verification vendor refs/PII not intended for self-export.

### H6 — Erasure is incomplete: `audit_log`, `notifications`, `data_exports`, P7 `user_sanctions`/`safety_checkins`, P5 idempotency ledger retain PII / FKs.
`notifications.user_id` is `on delete cascade` (P9 shim) so those clear on hard-delete — but `notifications.data jsonb` of the *counterparty* may embed the deleter's id/name and is untouched. `data_exports.document` (the full JSON dump) is `on delete cascade` so it clears on hard-delete, but on the **held/anonymize** path it is **not scrubbed** — a complete PII snapshot survives under legal hold beyond what the hold requires (the hold needs accountability data, not the user's full self-export). P5's `match_idem` ledger and P7's `user_sanctions`/`safety_checkins` rows referencing the user are never considered.

### H7 — `match_ratings` sentinel "skipped rating" insert collides with P7's schema and recompute.
Task 7 inserts all-NULL `match_ratings` rows for the deleter's owed ratings to silence "please rate" prompts. P7 adds `revealed_at` and `disputed` to `match_ratings` and reveals lone ratings at window close, and recomputes reliability from **revealed** rows. P9's all-null insert sets no `revealed_at`; whether P7's `rating_window_close` job will then "reveal" a null rating (polluting the ratee's score / triggering the `unsafe_or_disrespectful` report auto-open path on null) is undefined. Inserting fake rating rows to control UI state is fragile coupling into another phase's scoring table; a `rating_window_closed` flag or exclusion-by-status is cleaner. Also `on conflict (lock_id, rater_id)` matches P0's unique constraint (good) but the *intent* (suppress prompt) belongs in P7/P2, not a fabricated row here.

### H8 — Ratee `reliability_score` is never recomputed after rater re-point / teardown.
Re-pointing `rater_id` to the sentinel preserves the row but P7's reveal/recompute may treat sentinel-authored rows differently, and P9 never calls `recompute_reliability(ratee)` after teardown. A ratee's score can silently drift or freeze on stale inputs. Coordinate with P7.

### H9 — `has_active_legal_hold` is not consulted on SUSPEND/PAUSE and not re-checked at delete-time vs request-time (TOCTOU).
A hold can be *placed* during the grace window (a report filed after the user requests deletion). The worker checks `has_active_legal_hold` at process time (good), but `request_account_deletion` does not record the hold state, and there's no guard preventing the *grace job from being dropped* (cancel path) in a way that loses the deletion obligation. Conversely a hold *released* during grace correctly downgrades to hard-delete — but then reports about the user must still survive (they do, via free `target_id`); not tested for the release-during-grace transition.

### H10 — Feed suppression rewrites P0's `browse_feed` but will drift from / clobber P4's version.
Task 5 does `create or replace view browse_feed` copying P0's columns plus `cr.account_status='active'`. P4 (browse feed phase) also owns/extends `browse_feed`. Whoever's migration sorts last wins, silently dropping the other's columns/filters (e.g., P4 compatibility/standing filters, P7 `standing`-based rank suppression). A `create or replace view` is a full redefinition, not an additive patch — this is a cross-phase clobber hazard with no test asserting P4's columns survive.

### H11 — Suspended user's reveal/chat access is not revoked.
SUSPEND cancels locks/withdraws queues but P5's reveal is *derived* from `offer_active` (P5:566). Expiring offers revokes reveal (good) — *if* `match_expire_offer` is actually called (it isn't, B1/B2). For chat: an `active` thread tied to a still-`active` lock that gets frozen (not cancelled cleanly) may leave the suspended user with live chat access to the counterparty. No explicit chat-access revocation on suspend.

---

## 5. MEDIUM

- **M1 — Sentinel UUID `00000000-0000-0000-0000-0000000de1e7` is malformed-looking but valid; risk is collision/readability.** It is a valid UUID (8-4-4-4-12 with `de1e7` padded). Fine, but undocumented that it must never be a real `auth.users` id; add a guard/comment. Also the sentinel profile is inserted with `account_status='deleted', is_tombstone=true` — it will therefore be **filtered out of `browse_feed`** (good) but **counts as a tombstoned user** in any analytics/queries over deleted users; flag it as a system row.
- **M2 — `request_account_deletion` allows `p_grace_days => 0`** (`greatest(0,...)`), enqueuing a job at `now()`, which the worker processes essentially immediately — defeating "regret protection" and skipping the legally-implied minimum. No floor; an attacker (or a buggy client) can request instant deletion to dodge an imminent rating.
- **M3 — Worker has no claim/locking against concurrent invocations.** `processDueRequests` selects due rows then RPCs each; two overlapping cron runs select the same rows. `_p9_process_deletion` uses `for update` + terminal no-op, which serializes, but the second invocation still does redundant work and both flip `worker_error` on the same row. P2's pattern is `FOR UPDATE SKIP LOCKED`; P9's worker does not use it.
- **M4 — No `attempts`/backoff/dead-letter on the deletion request.** `attempts` column exists but the worker never increments it on failure (only `_p9_process_deletion` bumps it, and only on the path that reaches `processing`). A request that throws before `processing` (e.g., the P5-name error from B1) never advances `attempts`, never goes to `failed`, and is retried forever every cron tick, each time writing `worker_error`. No max-attempts → `failed` transition. The `failed` enum value is defined but unreachable.
- **M5 — `suspend_account` can be called on a `deletion_pending` user and silently strands the deletion request.** `where ... account_status <> 'deleted'` lets suspend overwrite `deletion_pending` → user is now `suspended` but the `deletion_requests` grace row + job still count down → worker later deletes a "suspended for accountability" user, destroying the very record P7 suspended them to keep. Lifecycle precedence undefined.
- **M6 — `resume_account` from `paused` does not check for an open `deletion_requests` row.** If a user is `deletion_pending`, `pause_account` moves them to `paused` (Task 5 allows `deletion_pending → paused`), then `resume_account` moves `paused → active` — but the open deletion request and its job are never cancelled. Worker deletes a now-`active` user. (Cluster with H4/M5: the lifecycle ↔ deletion_requests interlock is broken in several directions.)
- **M7 — Anonymize does not clear `status_reason`** which can contain free-text moderation notes naming third parties; on a held tombstone this persists. Also `profiles.first_name='[deleted user]'` but other potentially-PII profile columns added by P1 (e.g., display fields) are not enumerated — the scrub list is hardcoded and will rot as P1/P3 add columns. No "deny-list by default" strategy.
- **M8 — `_p9_anonymize_user` and `_p9_hard_delete_user` use `auth.uid()` as the audit actor**, but they run from the worker under service-role where `auth.uid()` is **null** → audit rows record `actor=null` for every real deletion, losing the "who/what triggered" trail. Should record a system/worker sentinel or the request id.
- **M9 — Tests insert directly into `profiles` bypassing `auth.users`** (consistent with P0), so none of the auth-identity, RLS-policy, or `auth.admin.deleteUser` behavior (B6) is exercised. The plan acknowledges this for policy tests but the gap now hides the entire auth-lifecycle blocker. At least one integration test must cover the `auth.users` teardown.

---

## 6. LOW / hygiene

- **L1** — Migration filename `20260525130650` (orchestrator) is introduced in Task 9 prose but missing from the top-of-file "File Structure" list (only `130600` is listed). Inconsistent inventory.
- **L2** — `data_exports` retains the full PII document for 7 days with only `expires_at` RLS gating reads; there is no purge job that actually deletes expired rows (the `expired` status is never set by anything). PII lingers indefinitely in the table after `expires_at`.
- **L3** — `notifications` shim FK `on delete cascade` to `profiles` will fight P2's authoritative definition if P2 chose `set null` or a different cascade; coordinate, don't assume.
- **L4** — The Deno worker mock test never asserts the `grace_period` filter or `process_after <= now()` predicate (the mock returns `opts.due` regardless), so the worker's due-selection logic is untested; only the loop/error-handling is.
- **L5** — `build_data_export` "must not leak other" test is a brittle `ILIKE '%"other"%'` substring check that breaks if any fixture/value contains the substring; not a real isolation proof.
- **L6** — `_p9_release_in_flight_state` writes an `audit_log` row with `action='in_flight_released'` and `new_status='deletion'|'suspension'` — overloading `new_status` (a status column) with an event-type string; inconsistent with P0's audit semantics (`new_status` = actual entity status).

---

## 7. Missing / Undefined Edge Cases (explicit)

1. **Delete during an active lock on the day of the date** → freeze (B3), counterparty not notified by P9 (H1), near-cutoff branch untested.
2. **Delete while counterparty mid-checkin** → safety_checkins orphaned, escalation may fire for a dead date (H2).
3. **Resurrection after grace** → resume/pause leave the deletion request live; worker deletes a reactivated user (H4/M5/M6).
4. **Re-signup with same email/phone post-deletion** → wholly undefined; abuse-enabling (B7).
5. **Suspended user's in-flight offers to others** → re-roll can re-offer to the departing user; non-overlapping standbys never cleared (H3).
6. **Hold placed *during* grace window** → handled at process-time only; request-time state not recorded; TOCTOU (H9).
7. **Hold released during grace** → downgrades to hard-delete; reports-about-survival not tested for this transition (H9).
8. **Two concurrent cron invocations** → redundant processing, duplicate `worker_error` writes (M3).
9. **Delete request with grace_days=0** → instant deletion, regret window defeated (M2).
10. **A user who is BOTH a rater and a ratee on the same lock** deletes → rater re-point vs lock cascade interaction on the *unheld* path (P9 admits ratings on the deleter's own locks cascade away — acceptable per plan, but the counterparty's rating *of the deleter* also vanishes with the lock, losing accountability the plan claims to keep; only ratings *authored by* the deleter are re-pointed, not ratings *about* a non-held deleter).
11. **Mass-deletion to dodge ratings** → no rate-limit on `request_account_deletion`, no carryover of `reliability_score`/`standing` to a re-signup (B7).
12. **`auth.users` row outliving the profile** → login into a profile-less app (B6).

---

## 8. Cross-Phase Seam Verification (NAME-MATCH AUDIT)

| P9 calls / assumes | Reality in sibling plan | Status |
|---|---|---|
| `cancel_lock(lock_id, reason, actor)` | P5 has `match_cancel_lock(p_actor, p_lock_id, p_reason, p_idem_key)` (P5:1468) | **BROKEN — name + arity + order + missing idem_key** |
| `expire_offer(offer_id, reason)` | P5 has `match_expire_offer(p_offer_id)` — 1 arg, no reason, returns int (P5:1100) | **BROKEN — name + arity** |
| `withdraw_from_queue(entry_id, reason)` | **No such function in P5.** Closest: `match_autowithdraw_user_conflicts(user, rng, keep_instance)` — window-scoped, different intent (P5:1137) | **BROKEN — does not exist** |
| `account_closed` is benign → re-rolls night | P5 benign set = `('schedule_conflict','venue_issue','changed_mind','other')`; anything else FREEZES (P5:1486–1497) | **BROKEN — opposite behavior** |
| Add `account_closed` to `cancel_reason` (P0 enum) | P0 enum at p0:539; `alter type ... add value if not exists` is correct mechanically | OK (but see freeze, B3) |
| Enqueue into `jobs (kind, payload, run_after)` status `queued` | P2 `jobs` has `job_type` not `kind`; enum `('pending','running','done','failed','cancelled')` — no `queued`; required typed FK cols (P2:105,120,228) | **BROKEN — column + enum mismatch** |
| `notifications` shape | P2 adopts v2 `notifications` with `dedup_key`, richer `notification_type` enum, prefs/consent (P2:17,521) | Partial — shim under-specifies; FK cascade may differ (L3) |
| P6 chat: keep envelope, tombstone sender | `chat_messages.sender_id on delete cascade` (P6:172); P9 ships no redaction | **BROKEN — cascade deletes; held path un-redacted (B9)** |
| P7 SUSPEND = `account_status='suspended'` | P7 owns `profiles.standing` incl `suspended` + `user_sanctions` (P7:84) | **CONFLICT — dual source of truth (B8)** |
| P7 reliability recompute after teardown | P7 `recompute_reliability(user)`; P9 never calls it; P7 added `revealed_at`/`disputed` to `match_ratings` | **BROKEN — fake null ratings + no recompute (H7/H8)** |
| `has_active_legal_hold` reads `reports.status in ('open','reviewing','actioned')`, `target_type='user'` | P0 `reports.status` check = those 4 values; `target_type` check includes `'user'` (p0:691,695) | OK |
| Re-point `match_ratings.rater_id` before delete | P0 `match_ratings.rater_id ... on delete cascade` (p0:619) → re-point is necessary and correct | OK |
| Reports about user survive hard-delete | P0 `reports.target_id` has no FK (p0:692) → survives | OK (correctly leveraged) |
| `auth.users` teardown | Not addressed anywhere in P9 | **BROKEN — missing (B6/B7)** |

---

## 9. Compliance (GDPR/CCPA) Assessment

- **Right to erasure:** Incomplete. `auth.users` (email/phone/credentials) is never erased (B6) → primary identifiers survive. Held-path leaves `data_exports.document`, `status_reason`, and chat bodies un-scrubbed (H6/M7/B9). The "anonymize in place" approach for held users is defensible *if* it provably removes all PII while keeping only accountability structure — the current scrub list is hardcoded, incomplete, and will rot (M7).
- **Right of access (export):** Incomplete (H5). Omits chat messages, email/phone, reports-about, notifications. A compliant export of "all personal data" cannot omit the user's messages and primary identifiers.
- **Retention / legal hold:** Conceptually sound (explicit + implicit-from-open-report, anonymize-not-delete). But TOCTOU on hold-during-grace is unhandled at request time (H9), and the hold does not gate SUSPEND data effects. Over-retention risk: held tombstone keeps the full self-export JSON (H6).
- **Auditability of erasure:** Audit rows record `actor=null` from the worker (M8) and overload `new_status` (L6) — weakens the legal trail proving *when/why* erasure happened.
- **Net:** As written, an erasure run would leave the user able to log in with surviving email/phone and surviving chat content — **not defensible as GDPR/CCPA erasure.**

---

## 10. Top Fixes (priority order)

1. **Fix the P5 seam end-to-end (B1–B4).** Replace all calls with the real names/signatures: `match_cancel_lock(p_user, lock_id, 'account_closed', <stable idem_key>)`, `match_expire_offer(offer_id)`, and obtain a real queue-withdraw primitive from P5 (add `match_withdraw_from_queue(entry_id, reason)` in the P5 domain via coordination, since none exists). **Decide `account_closed`'s benign-vs-freeze classification in P5 explicitly** (B3) — almost certainly it should FREEZE for a *safety* suspension and may roll for a benign user delete; the two leave-reasons likely need different cancel reasons. Rewrite the test stand-ins to match the *real* P5 signatures so green tests mean something. Add the missing counterparty notification (H1).
2. **Add `auth.users` teardown + re-signup/resurrection defense (B6, B7).** Worker must `auth.admin.deleteUser()` on hard-delete and ban/disable on tombstone, in the same transaction/orchestration; persist a hashed-identity fingerprint on tombstones/holds and check it at signup so a deleted/suspended/held person cannot re-register clean and shed ratings/holds. Without this, erasure is non-compliant *and* the anti-abuse goal fails.
3. **Resolve the SUSPEND dual-source-of-truth and the lifecycle↔deletion_requests interlock (B8, H4, M5, M6).** Pick one authoritative representation of "suspended" (reconcile P7 `standing` with P9 `account_status`, or derive one from the other with a trigger and a precedence rule), and make every lifecycle transition (`pause`/`resume`/`suspend`) atomically cancel/guard any open `deletion_requests` row + its job, and make the worker refuse any user not currently `deletion_pending`. Also fix the P2 `jobs` shim to match P2's real `job_type`/enum/columns (B5) so enqueue actually works.

---

*Audited against repo plans as of 2026-05-25. The plan's internal Self-Review asserts "Type/name consistency" and "P9 calls, never re-implements" — both claims are false against the P5/P2 plans that exist in this repository. Re-plan the seams before executing any task.*
