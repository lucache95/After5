# P5 — Matching State Machine — Pre-Implementation Audit

**Auditor stance:** paranoid principal engineer. Assumption: smart authors moving fast. Verdict drawn from cross-referencing the P5 plan against spec §6–§8, the P0 data model, the roadmap, and sibling plans P2/P4/P6/P7/P9.

**Overall score: 6.5 / 10.** The *intra-phase* concurrency design (advisory-lock-then-check, derived reveal predicate, idempotency ledger, deferred-roll throttle, race harness) is genuinely strong and largely correct in isolation. But the plan is **not executable as written** and **will not produce a working end-to-end loop**, because (a) its core fixture references a `profiles.email` column that no phase creates, (b) every cross-phase SEAM it claims to honor is misaligned by name AND structure with the phases that consume it (P2 job interface, P6 chat hooks, P9 transition functions, P2/P6/P7/P9 hook names), and (c) several transitions are logically incomplete (creator-cancels-own-date-pre-lock is missing entirely; deferred `auto_roll` jobs have no consumer; chat is never opened/gated). The phase will pass its *own* tests in isolation and then silently fail to integrate. That is the most dangerous failure mode for "the most critical plan."

Counts: **Critical (blocks build or breaks loop): 9. High: 8. Medium: 7. Low: 5.**

---

## 1. Critical Issues (must fix before any execution)

**C1 — `profiles.email` does not exist; the fixture factory and EVERY test fail at line 1.**
`p5_fixture_reset()` does `insert into profiles (id, first_name, email, dating_enabled, verification) select id, split_part(email,'@',1), email, ...` and every single `.sql`/`.sh` test resolves ids via `where email='p5_creator@test.local'`. P0 Task 2 (`alter table profiles`) adds `primary_city_id, dating_enabled, age, vibe_tags, age_pref, gender, gender_preferences, distance_pref_km, blurred_photo_url, clear_photo_url, reliability_score, verification` — **no `email` column**. `grep` across all of P0–P11 confirms no phase ever does `add column ... email` on `profiles`. `auth.users` has `email`; `profiles` does not. Consequence: `p5_fixture_reset()` raises `column "email" of relation "profiles" does not exist`, so 100% of the test suite (13 SQL files + 2 race harnesses) fails before testing anything. The whole TDD loop is built on a column that isn't there. Fix: either add `email` to `profiles` (coordinate with P0/P1) or join `auth.users` for the email and look up profiles by `id`/`first_name`.

**C2 — `auth.users` insert is almost certainly invalid in a bare migration test.** `insert into auth.users (id, email) values (...)` supplies only `id` + `email`. Supabase's `auth.users` has many `NOT NULL`/defaulted columns (`instance_id`, `aud`, `role`, `encrypted_password`, etc.) and triggers; inserting with two columns frequently fails or trips the `on_auth_user_created` handler. P0's own fixtures sidestep this by inserting directly into `profiles` (P0 risk note). P5's self-review *flags* this divergence and tells P0 to change — but P5 ships code that depends on the unverified path. At minimum this needs a proven `auth.users` seed or a documented `profiles`-direct seed that doesn't violate the FK. As written it is unproven and likely broken.

**C3 — Cross-phase SEAM name mismatch: the job/notify interface. P5's `enqueue()`/`notify()`/`jobs` ≠ P2's real interface.** P5 shim defines `jobs(kind text, run_at, payload, status, dedupe_key)` and `enqueue(p_kind text, p_run_at timestamptz, p_payload jsonb, p_dedupe_key text)`. P2 ACTUALLY ships `jobs(job_type job_type ENUM, run_after timestamptz, dedup_key text, plus typed FK cols offer_id/lock_id/date_instance_id/queue_entry_id)` and `enqueue_job(p_type job_type, p_run_after timestamptz, p_offer_id, p_lock_id, p_date_instance_id, p_queue_entry_id, p_payload, p_dedup_key)`. These are **different names, different arity, different column names (`run_at` vs `run_after`, `dedupe_key` vs `dedup_key`, `kind` vs `job_type`), and incompatible types (`text` vs `enum`).** The plan's claim — "when P2 lands it replaces these with the real implementations (same names) and P5 needs no change" — is **false**. Either P5's 11 `enqueue(...)`/`cancel_jobs(...)` call sites all break when P2 lands, or P2's shim collides with P2's real table. This is the single most important integration defect.

**C4 — P5 enqueues job kinds that are NOT in P2's frozen `job_type` enum.** P5 enqueues `'offer_expiry'`, `'auto_roll'`, `'bulk_withdraw'`, `'reconfirm_timeout'`, and `'notify:'||kind`. P2's `job_type` enum is a CLOSED set: `offer_expiry | standby_roll | pending_expiry | stale_date_close | day_of_reconfirm | safety_check_in`. So `auto_roll`, `bulk_withdraw`, `reconfirm_timeout`, and all `notify:*` kinds **do not exist** in P2. When the shim is replaced by P2's enum-typed table, `enqueue('auto_roll',...)` throws `invalid input value for enum job_type: "auto_roll"`. P5's standby-roll concept is `auto_roll`; P2's is `standby_roll` calling `p5_promote_standby`. They are different mechanisms with different names.

**C5 — Deferred `auto_roll` jobs have NO consumer → the cascade throttle is correct in test but inert in production.** `match_autowithdraw_user_conflicts` enqueues `enqueue('auto_roll', now(), {instance}, 'auto_roll:'||instance)` and the cascade-throttle test asserts the job exists. But **nothing ever runs that job.** P2's runner dispatches `standby_roll` → `p5_promote_standby(date_instance_id)`. P5 never implements `p5_promote_standby` (it's a P2 no-op stub), and P2 never dispatches `auto_roll`. Net effect: when a popular user locks a night, every *other* creator's vacated #1 slot is parked in a deferred job that is never executed, so those dates stall in `seeking` with no active offer forever. The throttle's "defer, don't cascade" design is sound, but the deferred half is never wired — a real loop hole. Must implement `p5_promote_standby` to call `match_auto_roll`, AND enqueue the P2-recognized `standby_roll` type, not a phantom `auto_roll`.

**C6 — Chat seam completely unwired; P6 cannot function and lock can bypass the min-rapport gate.** P6 explicitly states: "When an offer becomes `offer_active`, P5 calls `open_chat_thread(date_instance_id, candidate_id)`; on pass/expire `close_chat_thread(...)`; on lock `promote_chat_thread_to_lock(...)`; and **P5's `confirm_lock` MUST call `chat_lock_ready(thread_id)` and refuse to lock if false**." P5's `match_make_offer` never calls `open_chat_thread`; `match_resolve_offer_negative` never calls `close_chat_thread`; `match_accept_offer` never calls `promote_chat_thread_to_lock` and never calls `chat_lock_ready`. Consequences: (1) chat threads never open, so no one can chat with an offer-holder — the spec §7.2 reveal+chat promise is unfulfilled; (2) the lock transition skips the min-rapport gate entirely, so the "locked near-strangers" mitigation P6 built is dead. P5 also has no function named `confirm_lock` — it's `match_accept_offer`, another name mismatch (see C7).

**C7 — Transition-function NAME mismatches across every sibling phase.** P5 names its functions `match_make_offer / match_accept_offer / match_pass_offer / match_expire_offer / match_cancel_lock / match_auto_roll / match_resolve_reciprocal / match_reveal_allowed`. Consumers expect different names:
  - **P9** calls `cancel_lock(p_lock_id, p_reason, p_actor)`, `withdraw_from_queue(p_queue_entry_id, p_reason)`, `expire_offer(p_offer_id, p_reason)` — P5 has `match_cancel_lock(p_actor, p_lock_id, p_reason, p_idem_key)` (different name, different arg order, extra `p_idem_key`), `match_expire_offer(p_offer_id)` (no reason arg), and **no `withdraw_from_queue` at all**. P9's orphan-teardown will bind to its own stand-in stubs forever and never drive the real loop. Also P9 needs `cancel_reason` to include `account_closed`; P0's enum doesn't have it and P5 doesn't add it — P9 says it will, but P5's `match_cancel_lock` only treats `schedule_conflict|venue_issue|changed_mind|other` as benign, so `account_closed` would be treated **non-benign → freeze**, contradicting P9's requirement that the night re-offers to standby.
  - **P6** calls `confirm_lock`, `open_chat_thread`, `close_chat_thread`, `promote_chat_thread_to_lock`, `chat_lock_ready` — none exist in or are called by P5.
  - **P2** dispatches `p5_promote_standby(p_date_instance_id)` and `p5_reap_pending(p_queue_entry_id)` — P5 implements neither; it has `match_auto_roll(p_instance)` (different name/signature) and no pending-reaper at all. P2's `run_offer_expiry` worker is described in P5's deps as "calls our `expire_offer(...)`" but P2's `offer_expiry` handler marks the offer expired *itself* and enqueues `standby_roll`; it does NOT call `match_expire_offer`/`expire_offer`. So expiry runs through P2's path, not P5's transition logic, meaning **P5's auto-roll-on-expiry never fires in production** (only in P5's own isolated test that calls `match_expire_offer` directly).
  - **P7** calls `can_rematch(a,b)` / reads a `rematch_blocked` signal and `locks.rollover_frozen`; P5 reads `reports` directly for the safety freeze and never references `rollover_frozen` or `can_rematch`. P7 adds `locks.rollover_frozen` and a `standing` field that P5's accept/auto-roll is supposed to honor (cooldown: "cannot create/accept a new lock"); P5's `match_accept_offer` has **no standing/cooldown check**, so the P7 enforcement ladder is silently bypassed.

**C8 — Missing flow: "creator cancels own date pre-lock."** Roadmap line 187 assigns "Creator deletes date pre-lock" to P5. The plan has no function for a creator cancelling/deleting a `seeking` instance that has an active offer or standby queue. Consequences left undefined: the active offer-holder is stranded with a live reveal+chat to a now-dead date; pending/standby candidates never learn; the `offer_expiry` job keeps ticking against an orphaned offer; `queue_entries` rows leak. P0's `date_instances` RLS lets a creator directly `update ... status='cancelled'`, which fires the audit trigger but performs none of the offer-resolution / notification / reveal-revocation logic — so a creator can unilaterally and silently strand a candidate. This is a real undefined edge case in the core loop.

**C9 — Migration timestamp collision across phases (db will not apply).** P5 uses `20260525130000`–`20260525130900`. **P2 uses `20260525130000`–`20260525130700`; P6 uses `20260525130000`–`20260525131000`; P7 uses `20260525130000`–`20260525131000`; P9 uses `20260525130000`–`20260525130800`.** Five phases all claim the same `1300xx` filename band. In one `supabase/migrations/` directory, identical-prefix filenames either overwrite or apply in ambiguous order; specifically P2's `20260525130700_p2_p5_hooks.sql`, P5's `20260525130700_p5_reciprocal.sql`, P6's `20260525130700_p6_report_message.sql`, P7's `20260525130700_p7_block_propagation.sql`, and P9's `20260525130700_p9_anonymize_fn.sql` collide. The plan's "P5 uses `20260525130000`+ so it always sorts after P0" reasoning ignores every *other* phase. There is no global migration-numbering coordination. `supabase db reset` will not produce a deterministic, complete schema once siblings land.

---

## 2. State-Machine Correctness (transition-by-transition)

- **`interested → shortlisted` (`match_shortlist`)**: OK, but `match_ingest_interest` is called by P5's tests manually; **who calls it in production?** Deps say "P4 post-swipe or batched" but P4 must actually invoke `match_ingest_interest` and the plan never confirms P4 does. If P4 only writes `swipes` and nobody seeds `queue_entries`, the creator's shortlist pool is always empty. Unverified seam to P4.
- **`shortlisted → offer_active` (`match_make_offer`)**: Solid; advisory-lock-then-check + P0 partial-unique backstop is correct. Bug: it requires `date_instances.status='seeking'`, but **`match_auto_roll` calls `match_make_offer` after a pass/expire while the instance is still `seeking`** — fine — *except* in the reconfirm path and after `match_autoclose_creator_conflicts`, the instance may be `cancelled`; `match_auto_roll` guards `st<>'seeking' → return`, so OK. But see C5: the *deferred* roll never runs.
- **`offer_active → locked` (`match_accept_offer`)**: Strong on concurrency (advisory + GiST + unique). **Missing:** `chat_lock_ready` gate (C6), standing/cooldown check (C7-P7), and chat promotion. `locks` insert does not set `locked_at` explicitly (P0 defaults it) — OK. The `result` is stored in idempotency ledger *before* return — correct ordering.
- **`offer_active → offer_passed/offer_expired → standby → auto-roll`**: `match_resolve_offer_negative` sets queue to `offer_passed`/`offer_expired` then immediately overwrites to `standby` in a second `UPDATE` — the intermediate terminal status never persists, so the `audit_log` status-transition trigger logs `offer_passed`/`offer_expired` then `standby` (two rows). Acceptable but wasteful; the first UPDATE is dead-ish. **Loopability risk:** a candidate who passes goes to `standby` and remains eligible for `match_auto_roll`'s second `standby` query — so a passed candidate can be **re-offered the same night they just declined**. Spec §7.1 puts passed/expired in `standby (ordered)` but a *pass* is an explicit decline; re-offering them is likely wrong. No guard distinguishes "declined" from "lapsed/standby."
- **`locked → cancelled → (re-seek + reconfirm | freeze)`**: Logic matches spec §7.6. But reconfirm requires BOTH creator and `match_next_standby`; if the standby pool changes between cancel and reconfirm (someone else withdraws), `match_next_standby` returns a *different* user than the one notified — the reconfirm party check `p_actor not in (cre, nxt)` then rejects the originally-notified candidate. Race/skew bug.
- **Reciprocal**: see §4.

---

## 3. Concurrency & Idempotency

- **Advisory-lock-then-check**: correctly applied throughout; re-entrancy of `pg_advisory_xact_lock` within a txn is real and the `match_auto_roll → match_make_offer` nesting is safe. Good.
- **Idempotency replay does `match_idem_lookup` OUTSIDE the advisory lock** (comment admits it). Two concurrent first-time accepts with the *same* idem key: both see `prior=null`, both proceed, both take the lock serially — first inserts the ledger row, second... also tries to insert via `match_idem_store` which is `on conflict do nothing`, but the second already created a *different* lock attempt. Actually the second is gated by `offer.status<>'active' → OFFER_NOT_ACTIVE`, so only one lock — OK. But the second's `OFFER_NOT_ACTIVE` exception means its idem key is **never stored**, so a *third* retry with that same key re-runs and re-raises instead of replaying. Minor idempotency gap for the loser.
- **`match_idem_lookup` is `STABLE security definer`** but reads a table that another txn just wrote — fine within MVCC. OK.
- **`temp_race(k,v)` table** used by `.sh` harnesses is referenced before creation; the plan says "also create it in p5_helpers.sql" only in a Step-2 aside — easy to miss; the harness `insert into temp_race` will fail if helpers not loaded. Fragile but not fatal.
- **Expiry-vs-accept race**: correctly modeled; both take the instance lock and re-read status. The one true hole is that in *production* expiry runs via P2's handler (which doesn't take P5's advisory lock or call `match_expire_offer`) — see C7. So the race the test proves safe is **not the race that actually happens** in production.

---

## 4. Reciprocal Pair Logic

- **Detection is asymmetric and under-triggered.** `match_detect_reciprocal` is only invoked from `match_shortlist_with_reciprocal`, which the Edge layer wires to `match-shortlist`. But `match_make_offer`/`match_set_rank` never call detection, and the detect predicate includes `offer_active` candidates — so a pair that becomes reciprocal *via an offer* (not a shortlist) is never detected. The detection moment is too narrow vs the predicate.
- **Double-lock / already-locked edge case (explicitly requested):** `match_resolve_reciprocal` calls `match_accept_offer`, which can raise `DOUBLE_BOOKED` (GiST) if the pair's two nights overlap and one side is already locked. The reciprocal function does **not** catch `DOUBLE_BOOKED`; it propagates raw, and the `reciprocal_pairs.status` is left `open` with a half-applied offer creation (it created an offer on the chosen night via `match_make_offer` just before the failing accept). Partial state on failure. Also: if one of the pair is **already locked elsewhere on an overlapping window**, the chooser cannot lock either night — the pair is stuck `open` with no resolution path and no user-facing error mapping (`DOUBLE_BOOKED`→409 exists, but the pair row never closes).
- **Concurrent resolve**: pair advisory lock is correct; the `pstatus='resolved'` branch tries `match_idem_lookup` for *this actor's* key, but the winning resolve was likely by the *other* actor with a *different* key, so the loser's lookup returns null → `PAIR_ALREADY_RESOLVED` (409). Acceptable, but the loser never gets the lock_id of the resolution they're now party to.

---

## 5. Cross-Phase Seam Integrity

The headline finding. **Every** declared seam is misaligned. Summary table of NAME ALIGNMENT (requested explicitly):

| Consumer | Expects | P5 provides | Status |
|---|---|---|---|
| P9 | `cancel_lock(lock_id, reason, actor)` | `match_cancel_lock(actor, lock_id, reason, idem_key)` | **MISMATCH** name+args |
| P9 | `expire_offer(offer_id, reason)` | `match_expire_offer(offer_id)` | **MISMATCH** name+args |
| P9 | `withdraw_from_queue(entry_id, reason)` | *(absent)* | **MISSING** |
| P9 | `cancel_reason` includes `account_closed` benign | enum lacks it; would be non-benign→freeze | **MISSING/WRONG** |
| P6 | `confirm_lock(...)` calls `chat_lock_ready` | *(absent; uses `match_accept_offer`, no gate call)* | **MISSING** |
| P6 | `open_chat_thread` / `close_chat_thread` / `promote_chat_thread_to_lock` calls | never called | **MISSING** |
| P2 | `p5_promote_standby(date_instance_id)` | `match_auto_roll(instance)` | **MISMATCH** name; stub never filled |
| P2 | `p5_reap_pending(queue_entry_id)` | *(absent — no pending-expiry reaper)* | **MISSING** |
| P2 | `enqueue_job(type ENUM, run_after, ...)` | `enqueue(kind text, run_at, ...)` | **MISMATCH** name+args+types |
| P2 | `offer_expiry` handler expires offer itself | P5 assumes it calls `expire_offer` | **WRONG ASSUMPTION** |
| P7 | reads `locks.rollover_frozen`, `can_rematch`, `standing` cooldown on accept | P5 reads `reports` directly; no standing check | **MISMATCH/MISSING** |
| P4 | must call `match_ingest_interest` | unconfirmed P4 invokes it | **UNVERIFIED** |

Net: P5 is an island. It passes its own tests and integrates with **nothing**. The "Dependencies & assumed interfaces" section invented an interface that P2 did not build, then asserted compatibility that does not exist.

---

## 6. Auth / RLS / Idempotency

- **Grants (Task 9)** are good: revoke-from-public + grant authenticated/service-role on all `match_*`. But `match_pair_lock_key`/`match_instance_lock_key`/`enqueue`/`notify`/`cancel_jobs`/`match_idem_*` are NOT prefixed `match_` for some and ARE for others; the `like 'match\_%'` loop **misses `enqueue`, `cancel_jobs`, `notify`** (intended — those are P2's) but also misses nothing P5-critical. However `match_ingest_interest`, `match_shortlist_with_reciprocal`, `match_detect_reciprocal`, `match_reconfirm`, `match_autoclose_creator_conflicts`, `match_autowithdraw_user_conflicts` ARE caught by `match\_%` and get granted to `authenticated` — meaning **a client can directly RPC `match_autowithdraw_user_conflicts(any_user, any_range, any_instance)`** and forcibly withdraw an arbitrary user from queues. These internal helpers must be service-role-only, not `authenticated`. **Privilege-escalation hole.**
- `match_autoclose_creator_conflicts` and `match_detect_reciprocal` similarly become client-callable; `match_detect_reciprocal` lets any authenticated user fabricate `reciprocal_pairs` rows and send `reciprocal_detected` notifications to arbitrary users (notification spam / spoofing).
- `match_reveal_allowed`/`match_my_status` use `auth.uid()` correctly.
- Edge functions verify JWT and never trust body actor — good. But `match-demand-hint` routes to `match_my_status` using the caller's JWT client "so RLS applies" — yet `match_my_status` is `SECURITY DEFINER`, which **bypasses RLS**; the comment is self-contradictory. Demand hint via definer is fine, but the stated RLS reliance is wrong.

---

## 7. Notifications & Analytics

- P5 calls `notify(user, kind, payload)` for `offer_received`, `locked`, `offer_passed`, `candidate_withdrawn`, `reciprocal_detected`, `reconfirm_requested`, `lock_cancelled_frozen`. P2's frozen `notification_type` enum is `offer_received, offer_expired, standby_promoted, pending_expired, date_auto_closed, day_of_reconfirm, safety_check_in, lock_confirmed, new_interest, cancellation`. **Mismatches:** P5 sends `'locked'` (P2 has `lock_confirmed`), `'candidate_withdrawn'` (not in enum), `'reciprocal_detected'` (not in enum), `'reconfirm_requested'` (P2 has `day_of_reconfirm`), `'lock_cancelled_frozen'` (P2 has `cancellation`), `'offer_passed'` (not in enum). When P2's typed `dispatch_notification` replaces the shim, every one of these throws an enum error. **No `offer_expired` notification is sent by P5** (P2's handler sends it) — consistent only if expiry stays in P2, which then bypasses P5's transition (C7).
- **Analytics emission: entirely absent.** The roadmap and spec call for measurable funnel events (offer→accept rate, roll depth, cancel reasons). P5 writes `audit_log` via P0 triggers (state changes only) but emits **no product analytics events** for offer-made, offer-accepted, auto-roll-triggered, reciprocal-resolved, cancel-by-reason. Reporting the loop's health post-launch is impossible from this plan. Not blocking, but a real gap for "the core loop."
- **`new_interest` creator hint never enqueued** — P5 ingests interest silently; the creator is never notified someone swiped, though P2 defines the type for exactly this.

---

## 8. Scalability

- `match_demand_hint` does a 3-table join (`queue_entries ⋈ profiles ⋈ presence_heartbeats`) per read, recomputed live, with no covering index — self-review acknowledges and punts to P11. For a hot instance polled by many viewers this is N reads × join. Acceptable for launch, flagged.
- `match_autowithdraw_user_conflicts` cap of 25 + `bulk_withdraw` overflow job — but `bulk_withdraw` is not a P2 `job_type` (C4), so overflow is lost. The standby-drop `UPDATE ... where status in ('shortlisted','standby')` is **uncapped** (only the offer-withdrawal loop respects the cap) — a user shortlisted on hundreds of overlapping nights triggers one giant UPDATE inside the lock transaction, holding the instance advisory lock and bloating the txn. Throttle is half-applied.
- `presence_heartbeats` upsert-per-client with `for all` policy is fine; no TTL cleanup job defined (table grows unbounded). Minor.
- Advisory-lock keys via `md5→bit(64)→bigint` can collide (64-bit truncation of 128-bit md5); two different instances sharing a key would serialize spuriously. Astronomically unlikely; note only.

---

## 9. Test Coverage Gaps (vs the edge cases this audit was asked to probe)

- **Offer expiry vs accept race** — covered (but tests P5's path, not production's P2 path; C7).
- **Double-accept (same offer)** — covered (`p5_race_two_accepts.sh`).
- **Creator cancels own date pre-lock** — **NOT covered; flow doesn't exist (C8).**
- **Both users delete** — **NOT covered.** No test for P9 teardown driving P5 when both parties leave; the reciprocal/lock counterparty resolution under double-delete is undefined.
- **Reciprocal pair where one side is already locked / overlapping** — **NOT covered;** `DOUBLE_BOOKED` propagation from `match_resolve_reciprocal` is untested and leaves partial state (§4).
- **Passed candidate re-offered same night** — **NOT covered;** the standby re-eligibility loophole (§2) has no test asserting a *declined* candidate is excluded.
- **Reconfirm with shifting standby pool** — **NOT covered** (§2 skew bug).
- **Privilege escalation on internal helpers** — **NOT covered;** no negative test that `authenticated` cannot call `match_autowithdraw_user_conflicts` (§6).
- **Notification/enqueue type validity against P2's real enums** — **NOT covered;** tests run against the permissive shim, hiding C3/C4/C7-notifications.
- **`match_ingest_interest` block-pair filtering** is tested implicitly only via shortlist; no direct test that a blocked right-swiper is excluded.
- Positive: idempotent-accept, reveal-scope, cascade-throttle (deferred-job assertion), shortlist/rank-freeze, demand-hint presence gating are all well covered *in isolation*.

---

## 10. Top Priorities (ordered)

1. **Fix the fixture/schema foundation (C1, C2).** Add `profiles.email` (or stop using it) and prove the `auth.users` seed, or nothing runs. Blocks 100% of tests.
2. **Reconcile the P2 job/notify interface for real (C3, C4, §7).** Adopt P2's actual `enqueue_job(type job_type, run_after, ...)` signature and the frozen `job_type`/`notification_type` enums; add `auto_roll`/`reconfirm_timeout`/`bulk_withdraw` to P2's enum *in coordination with P2*, or map P5's needs onto `standby_roll`/`pending_expiry`. Delete the divergent shim and depend on P2's real one.
3. **Wire and rename every cross-phase SEAM (C5, C6, C7).** Implement `p5_promote_standby`/`p5_reap_pending` to drive `match_auto_roll`/pending-reap; expose P9's `cancel_lock/expire_offer/withdraw_from_queue` (or have P9 bind to `match_*` names — pick one and align both plans); make `match_accept_offer` call `chat_lock_ready` + `promote_chat_thread_to_lock`, and `match_make_offer` call `open_chat_thread`; make `match_make_offer`/`match_accept_offer` honor P7's `standing` cooldown and `rollover_frozen`; add `account_closed` to `cancel_reason` and treat it as night-benign + departing-user-removed.

Also fix before launch (not top-3 but critical): the creator-cancel-own-date flow (C8), the global migration-numbering collision (C9), the internal-helper privilege-escalation grants (§6), and the passed-candidate re-offer loophole (§2).

**Bottom line:** the matching *engine* is well-engineered in a vacuum; the matching *integration* is fiction. Executing this plan verbatim yields a phase that passes its own suite and connects to nothing — offers never expire through P5, standby never rolls in production, chat never opens, locks skip the rapport gate and the safety cooldown, and account-deletion can't drive the loop. Resolve §10.1–§10.3 and the seam table in §5 before writing a line of code.
