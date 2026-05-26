# P6 — Chat — Pre-Build Audit

**Auditor stance:** paranoid principal product engineer + systems architect. Question audited: *if you execute this plan exactly as written, do you get a working, end-to-end, two-party chat that opens at offer, persists through the lock, blocks/reports correctly, retains/purges per policy, and gates the lock — wired to its sibling phases?*

**Verdict up front: No, not as written.** The 13 tasks are internally well-formed (real SQL/TS/Deno, TDD shape, idempotent policies, sensible decisions). But the **entire phase is dead code on arrival** because the P5 seam it depends on does not exist in P5, and three sibling phases (P5/P7/P9) reference a chat schema that contradicts the one P6 ships. The DB objects will build and the psql tests will pass in isolation, yet **no offer will ever open a thread, no lock will ever consult the rapport gate, and block/delete propagation from P7/P9 will error against P6's tables.** This is a classic "passes its own tests, ships a disconnected subsystem" failure.

Score and counts are in §10.

---

## 1. Cross-Phase Seam Integrity (the load-bearing failures)

These are the findings that turn the whole phase inert. Verified against the actual P5/P7/P9 plan bodies, not their prose summaries.

### 1.1 THE primary seam is fictional: P5 never calls any P6 hook. (BLOCKER)
P6's architecture (lines 13–16) declares it "depends on two P5 contracts and defines them as named hooks so P5 can wire them": `open_chat_thread`, `close_chat_thread`, `promote_chat_thread_to_lock`, and the gate `chat_lock_ready` that "P5's `confirm_lock` transition MUST call." I read P5 end to end:

- **There is no `confirm_lock` in P5.** P5's real lock function is **`match_accept_offer(p_actor, p_offer_id, p_idem_key)`** (P5 Task 5, line 834). The audit prompt flagged exactly this and it is correct: the named hook target does not exist.
- **`match_make_offer` (P5 Task 4, lines 642–684) does NOT call `open_chat_thread`.** It creates the offer, promotes the queue entry, enqueues the expiry job, and notifies — nothing opens a chat thread. So **no thread is ever created** when an offer goes active.
- **`match_accept_offer` (P5 lines 834–885) does NOT call `chat_lock_ready` and does NOT call `promote_chat_thread_to_lock`.** It inserts the lock unconditionally. So **the min-rapport gate — the single biggest "decision" of this phase — is never consulted, and a lock never gets its `lock_id` attached to the thread.**
- **`match_resolve_offer_negative` / `match_pass_offer` / `match_expire_offer` / `match_auto_roll` (P5 Task 6, lines 1062–1112) do NOT call `close_chat_thread`** and do not re-point the thread on auto-roll. So **threads are never closed on pass/expire** (retention timers never start) and **on standby roll the thread is never re-pointed to the new candidate** (P6's `open_chat_thread` has re-point logic at lines 293–299, but nothing calls it).

P6 says "If P5 lands first, reconcile these names." **P5 has landed (it is a written, detailed plan) and it reconciled nothing** — it uses a *different chat mechanism entirely (see 1.2)*. Executing P6 as written yields tables + RPCs that no caller invokes. The product has no chat.

### 1.2 P5 already chose a DIFFERENT chat-access model — they collide. (BLOCKER)
P5 Task 4 line 566 and Self-Review line 1826 state: *"P6 (chat) gates message access on the same `match_reveal_allowed` predicate so chat opens exactly with the offer and closes when it resolves — this plan provides the predicate; P6 consumes it."* P5 built `match_reveal_allowed(viewer, instance)` (lines 688–693) as a **live, stateless** predicate (reveal/chat = "is there an active offer for you right now").

P6 ignored this entirely and built a **stateful** model: a persisted `chat_threads` row with a `status` column managed by RPCs. These are two incompatible designs for the same seam:
- P5 assumes chat eligibility is *computed live* from offer state (so it "auto-revokes" with no write).
- P6 assumes chat eligibility is *materialized* in `chat_threads.status` and must be transitioned by explicit RPC calls that P5 never makes.

Neither plan consumes the other. **Someone must pick one model and rewrite the loser.** This is the single most important thing to resolve before either phase is built. (Recommend: keep P6's stateful threads — you need a persisted thread for retention/transcript/attachments anyway — and make P5 call `open_chat_thread` inside `match_make_offer` and `chat_lock_ready`+`promote_chat_thread_to_lock` inside `match_accept_offer`. Then P5's `match_reveal_allowed` governs *identity reveal*, P6's thread governs *messaging*.)

### 1.3 P7 writes `chat_threads.revoked_at` — a column P6 does not have. (BLOCKER)
P7's `block_user` propagation (P7 lines 102–103, 1132–1135) does:
```sql
if to_regclass('public.chat_threads') is not null then
  update chat_threads set revoked_at = now() ...
```
P6's `chat_threads` (Task 1, lines 84–101) has **no `revoked_at` column** — it expresses revocation via `status='frozen'`. P7's degrade-gracefully guard only checks the *table* exists, not the *column*, so when both phases are present **P7's block propagation will throw `column "revoked_at" does not exist`** and the block's chat-revocation step fails. Two phases independently invented block→chat propagation with **incompatible mechanisms** (P6: `freeze_threads_on_block` trigger on `blocks` insert; P7: explicit `update chat_threads set revoked_at`). They must be reconciled to one. (Note: P6's trigger actually makes P7's update redundant *if* they share a column name — but they don't.)

### 1.4 P9 needs the message envelope to survive a profile delete; P6's FKs CASCADE it away. (BLOCKER, legal/safety)
P9's core mechanic (P9 lines 16, 829) is "deletion ≠ blind cascade": *redact message bodies authored by a deleted user but keep the message envelope (sender tombstoned) so the other party's thread is not corrupted and moderation/legal can still see that a message existed,* re-pointing sender to the `[deleted user]` sentinel profile.

P6 makes this **impossible**:
- `chat_messages.sender_id uuid not null references profiles(id) on delete cascade` (Task 2, line 172) → deleting a profile **hard-deletes every message that user sent**. There is no envelope to tombstone.
- `chat_threads.creator_id` and `candidate_id` are both `on delete cascade` (Task 1, lines 87–88) → deleting **either** party **cascade-deletes the entire thread and all its messages** (`chat_messages.thread_id ... on delete cascade`), destroying the *innocent counterpart's* transcript and any frozen, legal-held moderation evidence.

This directly defeats the P6 retention decision (line 44(d): "a thread touched by a block or report is frozen and exempt from auto-deletion — legal-hold for moderation"). A banned user who then deletes their account erases the very thread the report was filed on. **P6 must set these FKs to `on delete set null` (with a sentinel) or `restrict`, matching P9's tombstone model.** As written, P6 and P9 cannot both be true.

### 1.5 P2 cannot run `purge_expired_chat` and cannot push "new message." (BLOCKER for retention + core UX)
P6 says (line 44) the purge "is performed by a `purge_expired_chat()` function invoked by the P2 job runner" and the roadmap assigns "new-message push via P2."

- **Purge has no P2 hook.** P2's `job_type` is a **closed enum** (`offer_expiry, standby_roll, pending_expiry, stale_date_close, day_of_reconfirm, safety_check_in` — P2 lines 96–103) and P2's handler test asserts *"every job_type has a handler"* (P2 line 1005). There is **no `chat_purge` type, no handler, and no recurring-enqueue** for it. P6 never adds the enum value, the handler, or a daily self-rescheduling job. So `purge_expired_chat()` exists but **nothing ever calls it** — retention never happens; messages of closed/completed threads persist forever, contradicting the entire retention decision.
- **No new-message notification path.** P6's `send_message` never calls P2's `notify(...)`/`enqueue_job(...)`, and P2 has no `new_message` notification kind. So a recipient gets **no push/notification when a message arrives** — for a time-boxed-offer dating product where chat is the rapport surface, this is a core-loop hole, not polish. (Realtime updates only an *open, focused* client.)

### 1.6 Table-naming drift across phases. (MEDIUM, will cause silent misses)
P7 and P9 refer to the chat layer as **`chats`/`messages`** in prose (P9 lines 16, 829; roadmap P0 line 28 lists `chats`/`messages`). P6 ships **`chat_threads`/`chat_messages`**. P7 partially reconciled (it standardizes on `chat_threads`) but P9's redaction worker (Task 8) targets "message envelopes" without a confirmed table name. Lock the canonical names in one place before build or the P9 worker will redact nothing.

---

## 2. Missing Backends / Orphaned Actions / Missing APIs

- **`close_chat_thread`, `promote_chat_thread_to_lock`, `chat_lock_ready`, `set_lock_ready_override` have no caller** (see §1.1). `chat_lock_ready` and the entire `lock_ready_overrides` table + `set_lock_ready_override` RPC + "skip chat, lock anyway" UX are **orphaned**: the gate is never enforced because `match_accept_offer` does not call it. The mutual-override is a feature with no consumer.
- **`open_chat_thread` has no caller** (see §1.1) — the thread is never created.
- **No "list my threads" loading/empty/error contract for the client.** `listThreads` (Task 12) queries `my_chat_threads`; fine — but there is no defined empty state ("no active chats"), no error surface, and no pagination on `listMessages` beyond `.limit(100)` (older messages in a long thread are silently truncated with no cursor).
- **No client API to fetch the rapport-gate state.** The composer needs to show "send N more messages to unlock" or surface the override button. `chat_lock_ready` is `grant`ed to `authenticated`, but there is no helper in `chat.ts` to read it, and no view exposing `n_creator/n_cand` counts — the client cannot render the gate progress. The decision is enforced server-side but **invisible to the UI**.
- **Attachment send is a 3-step client choreography with no failure/compensation path.** Sign → upload-to-Storage → `send_message(path)` (Task 11 note, line 1253). If step 2 succeeds but step 3 fails (or the user backgrounds the app), you get an **orphaned Storage object with no message row** — never referenced, never purged (purge only deletes objects of threads with a past `purge_after`; an orphan in an open thread lives forever). No cleanup job is specified.
- **`report_message` is the only report entry, but P7 ships `file_report` and P8 owns report triage.** P6's `report_message` writes `reports` directly (Task 8) and freezes the thread, while P7's `file_report` (P7 Task 10) is the "official" report RPC with safety-class rollover-freeze logic. Two report-writing functions with different side effects — a message report via P6 freezes the *thread* but does **not** trip P7's `locks.rollover_frozen` (§7.6), so a harassment report sent *in chat* does not freeze auto-roll on the underlying lock. Inconsistent safety behavior depending on which button the user taps.

---

## 3. Impossible / Contradictory States

- **Thread re-point on standby roll resurrects a closed thread for a stranger.** `open_chat_thread` (lines 291–299) reuses the *same* `chat_threads` row when the candidate changes, flipping `status` back to `open` and nulling `purge_after`. But (a) nothing calls it on roll (§1.1), and (b) **if it were called, the new candidate inherits a thread whose `chat_messages` still contain the previous candidate's conversation** — there is no message wipe on re-point. The new offer-holder would read the prior stranger's chat with the creator. Severe privacy leak the moment the seam is fixed naively. The thread should be *new per candidate*, or messages must be scoped/cleared on re-point.
- **`promote_chat_thread_to_lock` sets `status='open'` and `purge_after=null` unconditionally** (lines 333–335) — even if the thread was `frozen` by a block/report. A lock forming on a frozen thread (possible if block landed then a different code path locks) would **un-freeze a moderation-held thread**. No guard for `status='frozen'`.
- **`close_chat_thread` after a block: status precedence.** `close_chat_thread` (lines 318–324) preserves `frozen` and leaves `purge_after` null for frozen threads — good. But `archive_thread_on_lock_end` and `freeze_threads_on_block` and `report_message` all independently write `status`/`purge_after` with different precedence rules. With no single state machine for `chat_thread_status`, **ordering of (block, lock-complete, report, close) determines the final state non-deterministically.** E.g., lock completes (archived, 30-day purge) then a report lands (frozen, purge null) — fine; but report then lock-complete: the lock trigger's `case when status='frozen' then 'frozen'` saves it — OK by luck. This works only because every writer happens to check `frozen` first; it is fragile and untested for interleavings.
- **`is_evergreen` / instance status vs thread:** P6 opens a thread keyed to `date_instance_id` with `unique(date_instance_id)`. But the spec (§4) allows **evergreen→scheduled conversion**, and P5 auto-closes *overlapping creator instances* on lock (`match_autoclose_creator_conflicts`, P5 line 888 sets `date_instances.status='cancelled'`). When a creator's *other* instance is auto-cancelled, its open chat thread (if any) is **never closed** — `close_chat_thread` isn't called by that cascade. Orphaned open threads on cancelled instances.

---

## 4. Auth / RLS / Privacy

- **`send_message` is `grant`ed to `authenticated` and trusts `p_sender_id`.** The plan itself flags this (lines 496–501) and prescribes an `auth.uid()` guard — but it is relegated to a "hardening note" and the *committed migration in Step 3 does not include it*; only Step 4's prose says "apply with the guard included." This is exactly the kind of note that gets lost in execution. **As literally written in the code block, any authenticated user can send a message as either party of any thread they can name** (SECURITY DEFINER bypasses RLS; the only check is `p_sender_id in (creator,candidate)`). Make the `auth.uid()` guard part of the migration body, not a footnote. Same risk applies to `mark_thread_read`, `report_message`, `set_lock_ready_override` (those *do* include the guard in-body — inconsistent).
- **The block-hide SELECT policy on `chat_messages` (Task 2) and `my_chat_threads` view make the thread vanish for BOTH parties on any block, including the victim's own block.** Correct for hiding the abuser, but: a victim who blocks mid-conversation **loses read access to the evidence transcript** they may need to attach to a report. Combined with §1.4 cascade, the victim cannot retrieve what was said. Consider keeping read access for the blocker (one-directional hide) so reporting still works.
- **`my_chat_threads` exposes `counterpart_id` to both parties unconditionally** (lines 557). Fine *during* an active offer/lock (identity is revealed per §7.2), but a `closed` thread (offer passed) still exposes `counterpart_id` to the candidate — the spec says reveal is **auto-revoked on pass/expire** (§7.2, P5's whole `match_reveal_allowed` model). P6's view leaks the counterpart's profile id after the offer is gone, contradicting reveal-revocation. The "writable=false" flag hides the composer but not the identity.
- **Storage object policies key on `(storage.foldername(name))[1]::uuid` = thread id** (Task 10). A party who *was* in a thread that got re-pointed to a new candidate (§3) retains read access to objects under that thread id — and the new candidate gains access to the *old* candidate's uploaded images. Same root cause as §3.
- **No RLS verification under a real JWT anywhere in P6.** Every psql test runs as superuser with `auth.uid()=null`, so the `auth.uid()` ownership guards and all RLS policies are **never actually exercised**. The Self-Review admits this (line 1543) and defers to "app-level integration tests in a later phase" that no phase owns. The two-parties-only guarantee — the central safety claim — is **untested**.

---

## 5. Edge Cases (the prompt's named scenarios)

- **Message to a closed/expired thread:** handled — `send_message` rejects `status<>'open'` (line 463). Good. But the *client* has no defined behavior when the RPC throws mid-compose (offer expired while typing). No "this chat just closed" state; the optimistic message (Task 12 `buildOptimisticMessage`) is appended `pending:true` and there is **no rollback path on RPC error** — it stays on screen forever as a ghost. Missing error/compensation state.
- **Race on offer-resolution while typing:** the P5 expiry job can resolve the offer (and, once wired, close the thread) at the exact moment the user sends. `send_message` re-reads `chat_threads` but is **not under the P5 instance advisory lock**, so it races P5's transition. Best case: a `not open` raise (ghost message, see above). It won't corrupt state, but the UX is undefined. No idempotency key on `send_message` (unlike P5's accept).
- **Attachment abuse:** mime/size enforced at bucket + signing function (good), but **no per-thread/per-user rate limit on `send_message` or on `chat-attachment-sign`** — a user can flood a thread or generate unlimited signed-upload URLs. P2 has a `rate_limits` table + `rate_limit_check` RPC (P2 line 13) that P6 does not use. Off-platform-contact spam is *flagged* but not throttled. Image content is never moderated (deferred to P3/P8, acknowledged) — but there's no hook recorded for it either.
- **Block mid-conversation:** `freeze_threads_on_block` trigger handles it (Task 7), but see §1.3 (collides with P7) and §4 (victim loses evidence).
- **Empty body + empty attachment:** guarded (line 477). **`body` length capped at 4000** (line 480) — but `attachment_type` is free text passed by the client and stored unchecked; the bucket limits the *object* mime, not the `chat_messages.attachment_type` string, so a client can store a mismatched/garbage `attachment_type` that the renderer trusts.
- **Self-message / creator messaging themselves:** `check (creator_id <> candidate_id)` on the thread (line 100) prevents the thread; fine.
- **Off-platform false positives:** `(\d[\s.\-]?){7,}` flags any 7-digit run — a venue address ("123 Main St, open 5-9, table 4 at 7pm") trivially trips it; the decision accepts this (soft warning only). Acceptable, but the client mirror (`looksLikeOffPlatformContact`) and the DB regex **differ subtly** (DB uses `\m...\M` word boundaries + spelled-out-digits clause; client uses `\b...\b` and omits spelled-digits), so the instant client warning and the server flag will **disagree** on some inputs — confusing UX where the warning shows but no flag persists, or vice versa.

---

## 6. Data Lifecycle / Retention Correctness

- **Purge never runs** (§1.5) — the whole retention policy is inert without the P2 hook.
- **`purge_expired_chat` sets purged threads to `status='closed'` and `purge_after=null` after deleting** (lines 1129–1131). An *archived completed-lock* thread (30-day tail) thus becomes `closed` after purge, **losing the archived distinction**, and a re-run is prevented (purge_after null) — acceptable, but the status rewrite is lossy and undocumented.
- **Storage purge correctness:** `purge_expired_chat` deletes `storage.objects` by `(storage.foldername(o.name))[1] = t.id::text` (line 1115). The signed-upload path is `${thread_id}/${uuid}.${ext}` (Task 11 line 1243) so foldername[1] = thread_id — matches. OK. But **orphaned objects** (uploaded, message never sent — §2) belong to *open* threads with `purge_after=null` and are **never purged**. Storage leak.
- **Legal-hold exemption is correct in spirit** (frozen ⇒ `purge_after=null` ⇒ skipped) but it relies on every freeze-writer setting `purge_after=null`, which they do — *except* that a thread frozen *after* a `purge_after` was already set (e.g. lock completed → archived w/ 30-day tail, then a report freezes it) correctly resets to null in `report_message`/`freeze_threads_on_block`. Verified consistent. However, **P9's `legal_holds` table is the authoritative hold (per P9 Task 4); P6's `frozen` status is a parallel, uncoordinated hold mechanism.** A P9 hold on a *user* does not freeze their threads, and a P6 `frozen` thread is invisible to P9's `has_active_legal_hold`. Two hold systems that don't talk.
- **Retention windows reference `date_instances.starts_at`** (line 751) for the 30-day completed tail. If a date is rescheduled (starts_at changes) after completion, the purge clock shifts. Minor, but undefined.

---

## 7. Notifications, Moderation, Abuse, Off-Platform

- **No new-message notification** (§1.5) — core gap.
- **No notification on thread open** ("you're the active pick — say hi" is a *system message in the thread*, line 309, not a push). Without a push, the offer-holder may never learn chat opened. Couples with §1.5.
- **Moderation seam to P8 is one-directional and lossy.** `report_message` writes a `reports` row with `target_type='message'` (good; P8's `target_type` check includes `'message'`, P8 line 305-era enum). But P8's report **state machine** (`open→triaged→investigating→resolved`, P8 line 305) has **no path to un-freeze the P6 thread** when a report is dismissed. A frozen thread stays frozen and purge-exempt **forever** if moderation dismisses it — there is no `unfreeze_thread` RPC and P8 doesn't know P6's thread exists. Threads accumulate as permanent moderation holds.
- **Off-platform flags feed nothing.** Decision says "repeated flags feed P8 anti-abuse later" (line 45) but there is **no aggregation, no counter, no signal** emitted — `contact_flagged` is a per-row boolean with no rollup, and P8's anti-abuse tables (`fraud_signals`) have no P6 writer. The "feeds P8" claim is unbacked.
- **Off-platform detection only runs on `body`** — an attachment caption is `body` (OK), but a user can put a phone number *in an image* and never trip the text detector. Acknowledged-ish (image moderation deferred) but worth stating: the whole off-platform defense is trivially bypassed by screenshotting contact info.

---

## 8. Frontend / UX / Mobile / States

- **No loading/empty/error states defined** for: thread list (empty = "no chats yet"), message list (loading skeleton), send failure (ghost optimistic message, §5), attachment upload progress/failure, "chat just closed" mid-session, rapport-gate progress. The Self-Review defers all UI states to P11 (line 1536) — but P6 ships `chat.ts` *helpers* with no state contract, so P11 has nothing concrete to render against for the gate/override flow.
- **Realtime reconnection / missed-message backfill is undefined.** `subscribeToThread` (Task 12) listens for `INSERT` only. On reconnect after a dropped socket, messages sent during the gap are **never delivered** (no replay; no "fetch since last seen"). Mobile networks drop constantly — this loses messages silently. Need a `listMessages(since)` reconciliation on (re)subscribe.
- **Realtime delivers INSERT only — read receipts (UPDATE of `read_at`) are not broadcast.** `mark_thread_read` UPDATEs rows, but the subscription filters `event: 'INSERT'` (line 1383). The sender's client **never sees "read" turn on** in real time. Read receipts are write-only.
- **Mobile push dependency** (spec §10) is load-bearing for chat (you must be told a message arrived) and is entirely missing (§1.5/§7).
- **`unread_count` in `my_chat_threads`** counts `read_at is null and sender_id <> auth.uid()` — correct, but it counts **system messages** (the opener) as unread, so every freshly-opened thread shows "1 unread" that the user never "sent." Minor polish bug.

---

## 9. Scalability / Concurrency

- **One Realtime channel per thread (`chat_${thread_id}`), Postgres-changes filtered by `thread_id`.** Supabase Realtime has practical limits on concurrent channels and on the number of `postgres_changes` filters per tenant; with one channel per *open chat*, a power user in many simultaneous offers/locks opens many channels, and globally this is a known fan-out/cost cliff. The plan defers presence/typing to P11 but does not bound channel count or discuss the documented Realtime limits. The Self-Review (line 1546) hand-waves "assumes Realtime honors RLS" but says nothing about channel scale — which the prompt explicitly flags.
- **`chat_messages` SELECT policy runs a correlated `blocks` NOT EXISTS subquery on every read** (Task 2, lines 191–204) and is *also* the predicate Realtime evaluates per-subscriber per-insert. At chat volume this is a per-message-per-recipient RLS cost; no index strategy for `blocks` lookups is mentioned (P0's `blocks` has a unique index on `(blocker_id, blocked_id)` but the policy queries both directions and by either side — partial index coverage only).
- **`send_message` does `update chat_threads set updated_at=now()`** on every message (line 490) → row-level write contention on the thread row under rapid back-and-forth; also re-fires the `set_updated_at` trigger and the `audit_chat_threads` trigger (line 120, `log_status_transition`) on *every message's* thread bump. The audit trigger only logs on status change, so it's a cheap no-op, but it fires per message — verify it doesn't write spurious audit rows (it shouldn't, since status is unchanged — OK, but worth a test).

---

## 10. Verdict, Score, Counts, Top-3 Must-Fix

**Build-readiness score: 3.5 / 10.**
Rationale: the in-isolation engineering quality is high (real TDD, idempotent DDL, thoughtful decisions, mostly-correct retention logic) — that earns the points. But the phase **fails its one job**: executed as written it produces a chat subsystem that **no part of the running product ever invokes**, and it **actively breaks three sibling phases** (P5 model collision, P7 `revoked_at`, P9 cascade-vs-tombstone). A phase that passes all its own tests and still ships zero working chat is not 5/10; the disconnection is fundamental.

**Issue counts:**
- BLOCKERS (must fix before any build): **6** — §1.1 P5 hooks uncalled, §1.2 P5/P6 model collision, §1.3 P7 `revoked_at` column, §1.4 P9 cascade vs envelope-tombstone, §1.5 P2 purge+new-message hooks absent, §4 `send_message` `auth.uid()` guard not in committed migration.
- HIGH: **7** — orphaned `chat_lock_ready`/override (§2), re-point message leak (§3), reveal-revocation leak in `my_chat_threads` (§4), thread freeze never lifted by P8 (§7), no Realtime backfill on reconnect (§8), read-receipts not broadcast (§8), Realtime channel-scale cliff unaddressed (§9).
- MEDIUM: **9** — table-name drift (§1.6), dual report RPCs/inconsistent freeze (§2), attachment orphan + no cleanup (§2/§6), promote un-freezes frozen thread (§3), orphan threads on auto-cancelled instances (§3), victim loses evidence on own block (§4), no rate-limit on send/sign (§5), off-platform regex client/server divergence (§5), two uncoordinated legal-hold systems (§6).
- LOW: **4** — purge status-rewrite lossy (§6), unread counts system msg (§8), attachment_type unchecked (§5), starts_at-reschedule shifts purge clock (§6).

**TOP 3 MUST-FIX (in order):**

1. **Resolve the P5↔P6 chat-access model collision, then actually wire the seam.** Pick one model (recommend P6's stateful threads for retention/transcript). Rewrite P5: `match_make_offer` must call `open_chat_thread`; `match_accept_offer` must call `chat_lock_ready` (and refuse the lock if false) then `promote_chat_thread_to_lock`; `match_resolve_offer_negative`/`match_auto_roll` must call `close_chat_thread` and correctly handle thread re-point (with message isolation) on standby roll. Until this is done, **P6 ships no chat.** Add a cross-phase integration test that drives offer→message→lock→complete→purge through the *real* P5 functions, not psql-superuser stubs.

2. **Fix the destructive FK + propagation contradictions with P7 and P9.** Change `chat_messages.sender_id` and `chat_threads.creator_id/candidate_id` off `on delete cascade` to a tombstone-compatible behavior (`set null` to the `[deleted user]` sentinel, or `restrict`) so P9 can preserve envelopes and legal-held threads survive a party's deletion. Reconcile block→chat propagation to ONE mechanism shared with P7 (either P6's `freeze_threads_on_block` trigger *or* P7's `revoked_at` update — and if keeping `status='frozen'`, P7 must stop writing `revoked_at`). Add an `unfreeze_thread` path so P8 can release a dismissed report's hold.

3. **Connect retention + notifications to P2, and harden the write path.** Add a `chat_purge` value to P2's `job_type` enum + a handler + a self-rescheduling daily enqueue (or move purge to a P2-owned cron) so `purge_expired_chat` actually runs; add a `new_message` notification kind and have `send_message` enqueue/notify the recipient. In the same pass, **put the `auth.uid()` ownership guard inside the `send_message` migration body** (not a footnote), add a rate-limit check via P2's `rate_limit_check`, and add Realtime reconnect backfill (`listMessages(since)`) so messages aren't silently lost.
