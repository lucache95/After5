# Phase 13: Lifecycle Correctness - Research

**Researched:** 2026-06-13
**Domain:** Correctness/wiring fixes on existing match/chat/job machinery (Postgres RPCs + Deno job runner + Next.js client surfaces)
**Confidence:** HIGH (all findings are file:line evidence from THIS repo; one prod-state claim is ASSUMED pending read-only prod inspection)

## Summary

Phase 13 is pure correctness work on machinery that already exists. Every LIFE requirement is a *wiring gap*: a function/handler/control that runs but does the wrong thing (or nothing). The four bugs are independently small and well-localized:

- **LIFE-01:** `match_cancel_lock` (`supabase/migrations/20260527126900_p5_b_complete.sql:171`) flips the lock to `cancelled` and re-rolls the instance, but **never touches `chat_threads`**. The cancelled date's thread stays in `state='promoted'`, `revoked_at IS NULL`, so the messageable gate (`state in ('open','promoted') and revoked_at is null`) keeps it fully live and "you're locked in." The existing close path `close_chat_thread(p_offer)` (`20260525124500_p2_chat_core.sql:82`) **only acts on `state='open'`** — it will NOT close a *promoted* thread, so the seam is more than "call the existing function."
- **LIFE-02:** The lock-page "something's wrong" control (`apps/web/app/matches/[lockId]/LockDetail.tsx:172` `confirmFlag()`) is **inert** — it sets local UI state and fires a toast, calling no RPC, writing no row. The `reports` table + `report_reason_category` enum + `reports_reporter_insert` RLS all exist (`20260525120900_p0_reports_blocks.sql`). `flag_no_show` exists, is authenticated-callable and either-party (`20260604121000_e5_loop_completion.sql:118`), and **has no UI producer**.
- **LIFE-03:** `StandbyList.tsx:49` and `inbox/queue/page.tsx:30` filter `queue_entries` to `status='interested'` only. Standby rows carry `status='standby'`, so they are invisible. Separately, the only code that *sets* `status='standby'` (`p5_b_complete.sql:136`, inside `match_autowithdraw_user_conflicts`) dispatches **no** "you've been bumped to standby" notification.
- **LIFE-04 (the real bug):** `match_accept_offer` enqueues two cascade jobs of type `standby_roll` with `{kind:'autoclose_creator_conflicts'|'autowithdraw_user_conflicts', creator/user, keep_instance, time_range}` (live body: `20260606130200_e19_lock_rpc_producers.sql`, mirrored at `p5_accept_lock.sql:119-125`). But the `standby_roll` handler (`supabase/functions/process-jobs/handlers.ts:95`) **ignores `kind` entirely** and unconditionally calls `match_auto_roll({ p_instance: id(job,"instance_id") })`. The payload has **no `instance_id` key**, so `match_auto_roll(null)` runs (and no-ops on a null instance). The two cascade consumer RPCs `match_autoclose_creator_conflicts` / `match_autowithdraw_user_conflicts` are defined and revoked but **never called by anything** — confirmed by repo-wide grep. So the conflict cascade is fully inert today.

**Primary recommendation:** Treat each LIFE item as a single thin seam. LIFE-04 is the highest-value fix: branch the `standby_roll` handler on `payload.kind` and route the three kinds (`autoroll`, `autoclose_creator_conflicts`, `autowithdraw_user_conflicts`) to their respective RPCs, and normalize the payload key (`instance` vs `instance_id`). Verify on prod read-only first.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Cancelled-lock chat closure (LIFE-01)**
- Cancelling a lock revokes its chat thread: `state → 'closed'`, `revoked_at` set (the close path already exists in `p2_chat_core`; `match_cancel_lock` must call it — today it never touches the thread).
- The thread becomes **read-only**, not deleted: **past messages stay visible** as history, with a clear "this date was cancelled" banner. Killing the misleading "you're locked in" state is the non-negotiable core of LIFE-01.
- Applies to BOTH parties' view of the thread.
- **Persistence principle (locked for the future):** chat persistence follows MUTUAL interest. A pass/declined offer always closes the channel. A cancelled lock is the only case where staying open is defensible — but only once a block escape-hatch exists. Block does NOT exist today, so "stay open unless blocked" is DEFERRED to Phase 15. Close-on-cancel is safe-by-default in the meantime.

**Safety + report controls persist real records (LIFE-02)**
- The lock-page "something's wrong" control writes a real `reports` row (today it's a silent toast that calls no RPC). **Reuse the existing report reasons/taxonomy** — do not invent a new one.
- No-show flagging gets a working UI producer wired to the existing `flag_no_show` RPC.
- **Either party** can flag (report and no-show), with a **confirm step** before submit — a no-show dents the other person's reliability score.

**Standby visibility + notifications (LIFE-03)**
- Standby queue rows surface in the candidate's queue/inbox views (today filtered to `interested` only). Show with a clear "standby" badge — the components exist (`StandbyCard`, `StandbyList`); they're just not surfaced.
- **Notify on both** events: when the candidate is bumped to standby, and when an offer rolls to them.

**Conflict cascade fires end-to-end (LIFE-04)**
- Investigation-led, Claude's discretion on fix scope: VERIFY on prod (with a real conflicting-offer test pair) that accepting an offer fires the creator-conflict autoclose + user-conflict autowithdraw cascade through the job runner. FIX the `standby_roll` handler's `kind`-branching / `instance_id` keying if it's broken (the requirement explicitly suspects it is), and leave a regression test behind.

### Claude's Discretion
- Fix scope for LIFE-04 (investigation-led).

### Deferred Ideas (OUT OF SCOPE)
- **Per-thread mute** + **block** (the safety escape-hatch) → Phase 15 (Moderation & Safety Operations). Mute *may* be pulled into Phase 14 but must not be split from block into Phase 13.
- **Liberalize cancelled-lock chat to "stay open unless blocked"** → Phase 15, AFTER block exists. Phase 13 ships close-on-cancel.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIFE-01 | Cancelling a lock closes/revokes its chat thread (`state→closed`, `revoked_at` set). | `match_cancel_lock` (`p5_b_complete.sql:171`) never touches the thread; `close_chat_thread` (`p2_chat_core.sql:82`) exists but is `state='open'`-only — seam documented below. Messageable gate at `chat_send_rpc.sql:11` + `thread-view.ts:69`. |
| LIFE-02 | "Something's wrong" writes a real report; no-show gets a UI producer for `flag_no_show`. | Inert `confirmFlag()` at `LockDetail.tsx:172`; `reports` table + enum + RLS at `p0_reports_blocks.sql:13-64`; `flag_no_show` at `e5_loop_completion.sql:118` (authenticated, either-party, no UI producer). |
| LIFE-03 | Standby rows surface in candidate queue; notify on bump + roll. | `interested`-only filter at `StandbyList.tsx:49` + `queue/page.tsx:30`; `status='standby'` set at `p5_b_complete.sql:136` with no notify; `standby_promoted` notif type exists (`p2_notifications.sql:11`). |
| LIFE-04 | Conflict cascade executes through the job runner; fix `standby_roll` keying. | Handler ignores `kind`, reads non-existent `instance_id` (`handlers.ts:95`); orphaned consumer RPCs `match_autoclose_creator_conflicts`/`match_autowithdraw_user_conflicts` (`p5_b_complete.sql:101,122`) never called. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cancel-closes-chat (LIFE-01) | DB RPC (`match_cancel_lock` / chat-close helper) | — | Thread state is a DB invariant; mutation must be atomic with the lock cancel inside the SECURITY DEFINER RPC. The client only *reads* `state`/`revoked_at`. |
| Real report write (LIFE-02 report) | DB (`reports` row) | API/Backend (a `file_report` DEFINER RPC) + Client (LockDetail confirm UI) | RLS allows direct insert (`reporter_id = auth.uid()`) but a DEFINER RPC is the established pattern; UI is the producer. |
| No-show UI producer (LIFE-02 no-show) | Client (LockDetail confirm UI) | DB (`flag_no_show` already exists) | Backend RPC is built; only a client producer + confirm step is missing. |
| Standby surfacing (LIFE-03 view) | Frontend Server (SSR `StandbyList`/`queue/page`) | DB (RLS already allows the read) | Pure query-filter change in two server components; RLS `queue_candidate_read_own` already scopes by `auth.uid()`. |
| Standby/roll notify (LIFE-03 notify) | DB RPC (`match_autowithdraw_user_conflicts` / `match_auto_roll`) | — | Notifications dispatch via `dispatch_notification` inside the same RPCs that change queue status. |
| Conflict cascade routing (LIFE-04) | DB RPC consumers + Deno job handler | — | The handler dispatch (`handlers.ts`) + the consumer RPCs both live below the client; no UI change. |

## Standard Stack

No new libraries. All four fixes use the existing stack:

| Layer | Tool | Already in repo |
|-------|------|------------------|
| DB mutations | Postgres SECURITY DEFINER RPCs, pinned `search_path`, advisory locks | Yes — match loop is built entirely this way |
| Job dispatch | Deno edge fn `process-jobs` + `HANDLERS` dispatch table | `supabase/functions/process-jobs/handlers.ts` |
| Notifications | `dispatch_notification(p_user, p_type, p_payload)` | `20260525123600_p2_dispatch_notification.sql:16` |
| Client RPC calls | `@/lib/after5/match` `call<T>()` wrapper, `idemKey()` | `apps/web/lib/after5/match.ts` |
| UI confirm sheets | `vaul` Drawer (already used for cancel + flag) | `LockDetail.tsx` (Drawer.Root) |
| Migration tests | pgTAP `.sql` in `supabase/tests/` via `pnpm db:test` | `supabase/tests/b_complete.sql` etc. |
| Handler tests | Vitest/Deno test (`handlers_test.ts`) | `supabase/functions/process-jobs/handlers_test.ts` |

**Installation:** None. No `package.json` changes expected for this phase.

## Package Legitimacy Audit

Not applicable — this phase installs **no external packages**. All work is edits to existing SQL migrations, the existing Deno edge function, and existing React components. (slopcheck gate skipped: zero new dependencies.)

## Architecture Patterns

### Data flow: lock-accept conflict cascade (LIFE-04, as-built vs. intended)

```
                          match_accept_offer  (DEFINER RPC, live body = e19_lock_rpc_producers.sql)
                                   │
                                   ├─ insert lock, promote chat thread, dispatch new_match …
                                   │
                                   ├─ enqueue_job('standby_roll', payload={kind:'autoclose_creator_conflicts',
                                   │                creator, keep_instance, time_range},  dedup='autoclose:…')
                                   │
                                   └─ enqueue_job('standby_roll', payload={kind:'autowithdraw_user_conflicts',
                                                    user, keep_instance, time_range},   dedup='autowithdraw:…')
                                   ▼
        Vercel cron /api/cron/process-jobs (every minute) → process-jobs edge fn → claims due rows
                                   ▼
        HANDLERS['standby_roll']  (handlers.ts:95)
                                   │
        AS-BUILT (BUG):  reads payload['instance_id']  → null  → match_auto_roll(null)  → no-op.
                         payload.kind is NEVER read. The two cascade consumer RPCs are never called.
                                   │
        INTENDED:  switch on payload.kind →
                     'autoroll'                    → match_auto_roll(p_instance := payload.instance)
                     'autoclose_creator_conflicts' → match_autoclose_creator_conflicts(payload.creator,
                                                          payload.keep_instance, payload.time_range)
                     'autowithdraw_user_conflicts' → match_autowithdraw_user_conflicts(payload.user,
                                                          payload.time_range, payload.keep_instance)
```

Note the payload key mismatch: every `standby_roll` *producer* writes `instance` (the autoroll variant, `p5_b_complete.sql:142`) or `creator/user/keep_instance/time_range` (the conflict variants) — **never `instance_id`**, which is the only key the handler reads.

### Pattern 1: kind-branched job handler

**What:** A single `job_type` carrying a `payload.kind` discriminator routed to multiple consumer RPCs.
**When to use:** LIFE-04 — `standby_roll` already overloads three logical operations under one type.
**Example (intended shape — derive exact code from existing handlers.ts conventions):**
```typescript
// Source: pattern derived from supabase/functions/process-jobs/handlers.ts:95-97 + the
// producer payloads in 20260606130200_e19_lock_rpc_producers.sql / p5_b_complete.sql:141.
const standbyRoll: Handler = async (db, job) => {
  const kind = (job.payload.kind as string | undefined) ?? "autoroll";
  switch (kind) {
    case "autoroll":
      // producers write key 'instance' (p5_b_complete.sql:142), NOT 'instance_id'
      await callRpc(db, "match_auto_roll", { p_instance: id(job, "instance") });
      break;
    case "autoclose_creator_conflicts":
      await callRpc(db, "match_autoclose_creator_conflicts", {
        p_creator: id(job, "creator"),
        p_keep_instance: id(job, "keep_instance"),
        p_rng: job.payload.time_range,   // tstzrange serialized from rng
      });
      break;
    case "autowithdraw_user_conflicts":
      await callRpc(db, "match_autowithdraw_user_conflicts", {
        p_user: id(job, "user"),
        p_rng: job.payload.time_range,
        p_keep_instance: id(job, "keep_instance"),
      });
      break;
    default:
      throw new Error(`standby_roll: unknown kind ${kind}`);
  }
};
```
**OPEN QUESTION (verify in plan):** the consumer RPCs `match_autoclose_creator_conflicts(p_creator, p_keep_instance, p_rng)` and `match_autowithdraw_user_conflicts(p_user, p_rng, p_keep_instance)` are currently `revoke all … from public, anon, authenticated` (`p5_b_complete.sql:385-386`). The process-jobs runner uses the **service-role** client (admin), which bypasses grants, so they should be callable — but confirm the runner is service-role (it is, per `handlers.ts` admin client convention) and that `time_range` round-trips as a `tstzrange` literal through supabase-js `.rpc()`.

### Pattern 2: thread-close keyed by lock (LIFE-01 seam)

**What:** Closing a *promoted* thread on lock-cancel.
**Why the existing close path is insufficient:** `close_chat_thread(p_offer)` (`p2_chat_core.sql:82-89`) is hard-gated `where offer_id = p_offer and state = 'open'`. A locked thread is `state='promoted'` (`promote_chat_thread_to_lock` sets it, `p2_chat_core.sql:73`). So calling `close_chat_thread` from `match_cancel_lock` would silently no-op.
**Two viable seams (planner picks):**
1. **Widen the existing helper** to also close `'promoted'` threads, OR add a sibling `revoke_chat_thread(p_lock uuid)` that closes by `lock_id` (the thread carries `lock_id` after promotion). Set `state='closed'`, `revoked_at = coalesce(revoked_at, now())`, honoring `not legal_hold`.
2. **Inline the UPDATE** inside `match_cancel_lock` (atomic with the lock cancel). The thread to close is the one whose `lock_id = p_lock`.
**Recommended:** option 1's `revoke_chat_thread(p_lock)` helper — keyed by lock, reusable, mirrors the existing helper grants (`revoke … from public, authenticated`), and is independently testable. Call it in BOTH branches of `match_cancel_lock` (safety AND non-safety) so a cancelled date is always read-only.
**Account-deletion ripple (beneficial):** `acct01_account_deletion.sql:163` already calls `match_cancel_lock(v_uid, rec.id, 'creator_pre_lock', …)`. Once LIFE-01 lands, account deletion will *also* close those threads for free — ensure the close is idempotent (the `coalesce(revoked_at, now())` guard handles re-entry).

### Pattern 3: real report from an inert UI control (LIFE-02)

**Seam:** `LockDetail.tsx:172` `confirmFlag()` currently only does local state + toast. Replace with a real call. Two report-write options:
- **Direct insert** — the `reports_reporter_insert` RLS policy (`p0_reports_blocks.sql:62`) permits `with check (reporter_id = auth.uid())`, so an authed client *could* `.from('reports').insert(...)`. BUT the project convention (CLAUDE.md, ARCHITECTURE) is DEFINER RPCs for all loop writes, and there is **no `file_report` RPC today** (grep confirms none exists). 
- **New `file_report(p_target_type, p_target_id, p_reason_category, p_detail, p_idem_key)` DEFINER RPC** — re-checks `auth.uid()`, inserts the report, optionally `dispatch_notification` to admins/`admin_alerts`. This matches the codebase's "Definer RPCs for Mutations" pattern and lets the lock-page control set `target_type='lock'`, `target_id=lockId`.
**Reuse the taxonomy:** `report_reason_category` enum = `('harassment','safety_threat','no_show_dispute','payment_dispute','inappropriate_content','fake_profile','other')` (`p0_reports_blocks.sql:17`). The UI reason picker must use these verbatim — do NOT invent new reasons (locked decision).
**No-show:** wire a confirm-gated button to the existing `flag_no_show` client path. Add a thin client wrapper in `match.ts` (sibling to `cancelLock`): `flagNoShow(lock)` → `call('match-flag-no-show', { lock, idem_key: idemKey() })` (verify the edge-function route name; `flag_no_show` is the RPC — check whether an edge fn / route already proxies it).

### Recommended file touch-list (evidence-grounded)

```
supabase/migrations/<new>_life01_cancel_closes_chat.sql   # revoke_chat_thread(p_lock) + call from match_cancel_lock
supabase/migrations/<new>_life02_file_report.sql          # file_report DEFINER RPC (reuse enum)
supabase/migrations/<new>_life03_standby_notify.sql       # add bump/roll dispatch in autowithdraw/auto_roll
supabase/functions/process-jobs/handlers.ts               # LIFE-04: kind-branch standby_roll
apps/web/app/matches/[lockId]/LockDetail.tsx              # LIFE-02: confirmFlag → real report; add no-show control
apps/web/lib/after5/match.ts                              # LIFE-02: flagNoShow + fileReport client wrappers
apps/web/app/inbox/StandbyList.tsx                        # LIFE-03: broaden status filter, add badge
apps/web/app/inbox/queue/page.tsx                         # LIFE-03: broaden head-count filter
apps/web/components/StandbyCard.tsx                       # LIFE-03: render a 'standby' badge by status
supabase/tests/b_complete.sql (or new)                    # LIFE-01/04 pgTAP regression
supabase/functions/process-jobs/handlers_test.ts          # LIFE-04 handler kind-branch regression
```

### Anti-Patterns to Avoid
- **Calling `close_chat_thread` and assuming it closes a locked thread.** It is `state='open'`-only — it will silently no-op on the `promoted` thread that a lock has. (LIFE-01 trap.)
- **Reading `payload.instance_id` in the standby_roll handler.** No producer writes that key. (LIFE-04 root cause — do not preserve it.)
- **`USING(true)` on any new report/no-show write policy.** Secure-by-default RLS (CLAUDE.md). Keep `with check (reporter_id = auth.uid())`; never an open update/delete policy.
- **Inventing new report reasons.** Locked decision: reuse `report_reason_category`.
- **Surfacing standby rows that leak host identity.** `StandbyList` is blind-safe via `get_night_detail` (DEFINER, blind-safe projection) — keep that path; do NOT switch to a direct `date_instances` embed (RLS denies it for a non-creator candidate anyway).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| No-show flagging backend | A new no-show RPC | `flag_no_show` (`e5_loop_completion.sql:118`) | Already authenticated, either-party, idempotent, advisory-locked, sets `locks.status='no_show'`, reliability recompute downstream. |
| Report taxonomy | A new reason list | `report_reason_category` enum (`p0_reports_blocks.sql:17`) | Locked decision + admin queue already reads it. |
| Thread messageable check | New gating logic | `chat_thread_messageable` (server, `chat_send_rpc.sql:8`) + `isMessageable` (client, `thread-view.ts:69`) | Already the single source of truth; LIFE-01 just needs to make `state/revoked_at` reflect cancellation. |
| Standby UI rows | New components | `StandbyCard` + `StandbyList` | Built; only the query filter + a badge are missing. |
| Conflict cascade consumers | New autoclose/autowithdraw logic | `match_autoclose_creator_conflicts` / `match_autowithdraw_user_conflicts` (`p5_b_complete.sql:101,122`) | Fully written; the ONLY gap is the handler never calls them. |
| Notification dispatch | Direct `insert into notifications` | `dispatch_notification(p_user, p_type, p_payload)` | Handles consent/quiet-hours/rate-limit/dedup/channel selection. |

**Key insight:** Almost nothing in this phase is net-new logic. Every requirement is "an existing capability is not wired to its trigger." The risk is *over*-building — adding parallel logic instead of connecting what exists.

## Runtime State Inventory

This phase changes code/handlers/migrations but also touches **live prod state** (LIFE-04 verification, and any data already in a wrong state). Inventory:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data (wrong-state rows) | (1) Cancelled locks on prod whose `chat_threads` are still `state='promoted'`/`revoked_at IS NULL` — these are live-looking dead threads created before LIFE-01. (2) `jobs` rows of type `standby_roll` with `kind` conflict payloads that have been silently no-op'ing (status likely `done` because `match_auto_roll(null)` returns cleanly, not erroring). | Code edit fixes NEW cancels/cascades. A **one-time data migration** may be needed: (a) close any already-cancelled lock's still-open thread; (b) optionally re-enqueue cascade for any prod lock that should have triggered one. Both are data-migration tasks distinct from the code fix. Quantify via prod read-only inspection (see Validation). |
| Live service config | None — no n8n/Datadog/external dashboards in scope for this phase. | None — verified: this is in-repo SQL + edge fn + client. |
| OS-registered state | None. The only scheduler is **Vercel Cron** (`apps/web/vercel.json`, `/api/cron/process-jobs` every minute) — config is in git, not OS-registered. No task-scheduler/launchd/systemd state. | None — verified. |
| Secrets/env vars | `CRON_SECRET`, `JOBS_RUNNER_SECRET` gate the cron route (CLAUDE.md). No new secrets; no secret renames. | None — verify the prod cron is actually firing (LIFE-04 depends on the runner running). |
| Build artifacts | The Deno edge fn `process-jobs` must be **redeployed** after the `handlers.ts` change (`supabase functions deploy process-jobs`). The currently-live version is **v9** (deployed for ACCT-01, per STATE.md). | Redeploy edge fn as a gated prod step; bump implies a new version. |

**The canonical question — after every file is updated, what runtime systems still carry the old behavior?**
- The **deployed `process-jobs` edge fn (v9)** keeps the broken handler until redeployed.
- **Prod `chat_threads`/`jobs` rows** already in a wrong state from past cancels/accepts are NOT fixed by code alone — they need a data-migration sweep (scope TBD by prod inspection; may be near-zero if the loop has low prod volume).

## Common Pitfalls

### Pitfall 1: "close path already exists" understates the LIFE-01 work
**What goes wrong:** Planner wires `match_cancel_lock` → `close_chat_thread(offer_id)` and the thread stays open.
**Why:** `close_chat_thread` is `state='open'`-only; a locked thread is `state='promoted'` (`p2_chat_core.sql:73,88`).
**How to avoid:** Close by `lock_id` (or widen the helper to include `'promoted'`). Set `state='closed'` + `revoked_at` directly. Verify with a pgTAP test that asserts `isMessageable`-equivalent (`state='closed'` AND `revoked_at` set) after cancel.
**Warning signs:** Test only checks `locks.status='cancelled'` and not `chat_threads.state`.

### Pitfall 2: LIFE-04 handler "looks fixed" because jobs are marked `done`
**What goes wrong:** `match_auto_roll(null)` returns `null` cleanly (no error), so the `standby_roll` job completes successfully. The cascade silently does nothing while every job reads as healthy.
**Why:** `callRpc` only throws on RPC *error*; a no-op return is "success."
**How to avoid:** Verify by *effect* (did the creator's conflicting instances actually close? did the candidate's conflicting offers withdraw?), not by job status. The regression test must assert downstream state changes, and assert the consumer RPCs were invoked.
**Warning signs:** "Jobs all `done`, must be working" reasoning.

### Pitfall 3: Multiple `match_accept_offer` definitions — fixing the wrong one
**What goes wrong:** Editing `p5_accept_lock.sql` thinking it's the live body. It was re-`CREATE OR REPLACE`d by, in order: `p5_match_cohort_allowlist.sql` (127800) → `e16_dispatch_identity_revealed.sql` (20260606120100) → **`e19_lock_rpc_producers.sql` (20260606130200, the LIVE body)**.
**Why:** Postgres last-writer-wins on `CREATE OR REPLACE FUNCTION`; migrations apply in timestamp order.
**How to avoid:** The LIFE-04 fix is in **`handlers.ts`** (the consumer), NOT in `match_accept_offer` (the producer payloads are correct — they carry `kind`/`creator`/`user`/`keep_instance`/`time_range`). Only touch the producer if you also change the payload contract.
**Warning signs:** Editing the cascade *enqueue* instead of the cascade *dispatch*.

### Pitfall 4: LIFE-03 "bump to standby" has no dispatch site
**What goes wrong:** Adding the "offer rolled to you" notify (easy — `match_auto_roll` already dispatches `standby_promoted` at `p5_b_complete.sql:89`) but forgetting the "you were bumped TO standby" notify, which has **no existing dispatch** — the only `status='standby'` setter (`match_autowithdraw_user_conflicts`, `p5_b_complete.sql:136`) dispatches nothing.
**How to avoid:** Add a `dispatch_notification(p_user, <type>, …)` inside `match_autowithdraw_user_conflicts` for the bumped user. **No `standby_bumped`/`offer_rolled` notif type exists** — either reuse an existing type or add an enum value (`alter type notification_type add value …`, the established pattern, e.g. `s2_notification_type_5b_extend.sql`). Confirm the chosen type with the planner; `standby_promoted` already means "offer rolled to you," so the *bump* likely needs a NEW value or a generic `account`/`offer_withdrawn`-style reuse.
**Warning signs:** Only one of the two LIFE-03 notify events wired.

### Pitfall 5: `time_range` (tstzrange) round-trip through supabase-js `.rpc()`
**What goes wrong:** The conflict consumers take a `tstzrange` param; passing `job.payload.time_range` (a JSON string like `["2026-...","2026-..."]` or `[lo,hi)` literal) may not coerce.
**How to avoid:** Confirm how `rng` is serialized into the payload at enqueue (`jsonb_build_object('time_range', rng)` stores the tstzrange's text form) and that `match_autowithdraw_user_conflicts(p_rng tstzrange)` accepts that text cast. Test the round-trip in the handler regression. If it doesn't coerce, pass the bounds and reconstruct, or change the consumer to accept text + cast internally.

## State of the Art

| Old (as-built) | Current (intended) | Impact |
|----------------|---------------------|--------|
| `standby_roll` handler reads `instance_id`, ignores `kind` | Branch on `kind`; route to 3 consumer RPCs; read `instance` | LIFE-04 cascade actually fires |
| `match_cancel_lock` leaves thread `promoted` | Thread → `closed`/`revoked_at` on cancel | LIFE-01 read-only cancelled chat |
| `confirmFlag()` toast-only | Real `file_report` + no-show producer | LIFE-02 persisted safety records |
| Queue views filter `interested` only | Include `standby` (+ badge) | LIFE-03 visible standby |

**Deprecated/outdated:** Nothing to deprecate — all fixes are additive wiring on existing functions.

## Code Examples

### Standby query filter broadening (LIFE-03)
```typescript
// Source: apps/web/app/inbox/StandbyList.tsx:45-50 (current = interested-only).
// Broaden to include standby (and likely shortlisted, which is pre-offer "in line").
const { data: rows } = await supabase
  .from('queue_entries')
  .select('date_instance_id, status, rank')
  .eq('candidate_id', userId)
  .in('status', ['interested', 'shortlisted', 'standby'])   // was .eq('status','interested')
  .order('rank', { ascending: true, nullsFirst: false });
// queue/page.tsx:26-30 head-count must broaden identically so the empty-state stays honest.
```

### No-show client wrapper (LIFE-02)
```typescript
// Source: pattern from apps/web/lib/after5/match.ts:152 (cancelLock). Verify the edge-fn
// route that proxies flag_no_show RPC (the RPC is authenticated-callable directly; confirm
// whether an edge function 'match-flag-no-show' exists or the client calls the RPC directly).
export function flagNoShow(lock: string): Promise<null> {
  return call<null>('match-flag-no-show', { lock, idem_key: idemKey() });
}
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The deployed prod `match_accept_offer` body matches `e19_lock_rpc_producers.sql` (so prod enqueues the `kind` cascade payloads with no `instance_id`). | LIFE-04 / Summary | If prod is on an older migration, the producer payload may differ. Resolve via prod read-only `pg_get_functiondef` inspection before fixing. |
| A2 | Prod has accumulated some cancelled-lock threads still `promoted` and/or no-op'd `standby_roll` jobs (i.e., a data sweep may be needed). | Runtime State Inventory | If prod loop volume is ~0, no data migration needed — fixes are forward-only. Quantify by read-only prod query. |
| A3 | The process-jobs runner uses the service-role (admin) client, so it bypasses the `revoke … from authenticated` on the consumer RPCs. | LIFE-04 Pattern 1 | If the runner is NOT service-role, the consumer RPCs need a grant. Verify in `index.ts` client construction. |
| A4 | `tstzrange` serialized into the job payload round-trips back into the consumer RPC's `p_rng tstzrange` param via supabase-js `.rpc()`. | Pitfall 5 | If it doesn't coerce, the cascade fix needs payload re-shaping. Test in the handler regression. |
| A5 | No existing `standby_bumped`/`offer_rolled` notification type — a new enum value (or a reuse) is needed for the LIFE-03 "bumped to standby" event. | LIFE-03 / Pitfall 4 | Confirmed absent in `p2_notifications.sql:11` + extends; but a reuse decision needs founder/planner sign-off. |
| A6 | `flag_no_show` is reached from the client via an edge-fn route (like other `match-*` calls) rather than a direct `.rpc()`; the exact route name is unverified. | LIFE-02 Code Example | Wrong route name = broken no-show button. Grep `supabase/functions/match-*` for an existing proxy before wiring. |

## Open Questions

1. **Does a one-time prod data migration belong in this phase?**
   - What we know: New cancels/accepts will be correct after the code fix. Pre-existing wrong-state rows are not.
   - What's unclear: How many such rows exist on prod (likely small given pre-launch volume).
   - Recommendation: Run the read-only prod inspection queries first (Validation section). If counts are non-trivial, add a guarded data-migration task; if ~0, document "forward-only, no backfill."

2. **Report write: new `file_report` RPC vs. direct RLS insert?**
   - What we know: RLS permits the direct insert; convention favors a DEFINER RPC; no `file_report` exists.
   - Recommendation: Add a minimal `file_report` DEFINER RPC for consistency + future admin-alert dispatch, unless the planner opts for the lighter direct insert.

3. **Which notification type for "bumped to standby"?**
   - Recommendation: add `standby_bumped` enum value (cheap, clear) OR confirm a reuse with the founder. `standby_promoted` is taken by the offer-roll event.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Local Supabase stack (Postgres 17 @ 54322) | pgTAP migration tests (`pnpm db:test`) | Assumed ✓ (project standard) | PG17 | `supabase start` |
| Supabase CLI | local apply, `functions deploy`, advisor | Assumed ✓ | — | install per CLAUDE.md |
| Deno (via Supabase) | `process-jobs` handler tests | Assumed ✓ | 1.x | — |
| Vitest 2.1.8 | TS/handler + component tests | ✓ (in `package.json`) | 2.1.8 | — |
| Prod read access (`ufufmcpnysvwtutpbian`) | LIFE-04 prod verification (read-only) | Must confirm | — | Supabase MCP `execute_sql` (read-only) or `supabase db dump`/SQL console |

**Missing dependencies with no fallback:** None identified — all tooling is the project standard.
**Note:** The Supabase MCP `execute_sql` / `get_logs` / `list_migrations` tools (or the SQL console) are the intended channel for the **read-only** prod verification; do NOT mutate prod outside a gated apply.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pgTAP (DB) via `psql` + Vitest 2.1.8 (TS) + Deno test (edge handlers) |
| Config file | `vitest.config.ts` / `vitest.workspace.ts`; DB tests have no config (loose `.sql` files) |
| Quick run command | `pnpm db:test` (loops `supabase/tests/*.sql`); `pnpm -w vitest run <file>` for TS |
| Full suite command | `supabase/tests/_all_5b.sh` (db reset → pgTAP → Deno → Vitest → E2E) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIFE-01 | After `match_cancel_lock`, the thread is `state='closed'` AND `revoked_at` set (both branches: mutual + safety) | pgTAP | `psql … -f supabase/tests/b_complete.sql` (extend) | ⚠️ exists, lacks chat-thread assertions — Wave 0 |
| LIFE-01 | Client `isMessageable('closed', <ts>)===false` | unit (Vitest) | `pnpm -w vitest run apps/web/app/messages/__tests__/thread-view.test.ts` | ✅ (add cancelled-case row) |
| LIFE-02 | "something's wrong" confirm writes a `reports` row (verifiable) with `target_type='lock'` + a valid `reason_category` | pgTAP (RPC) + Vitest (LockDetail confirm) | `psql … -f supabase/tests/<new>_life02.sql`; `pnpm -w vitest run apps/web/app/matches/[lockId]/__tests__/LockDetail.test.tsx` | ❌ new — Wave 0 |
| LIFE-02 | No-show producer calls `flag_no_show`; `locks.status='no_show'` after confirm | pgTAP (RPC already tested?) + Vitest (UI producer) | as above | ⚠️ verify `flag_no_show` pgTAP coverage exists; UI producer test new |
| LIFE-03 | Standby (`status='standby'`) rows appear in `StandbyList` output; badge renders | unit (Vitest) | `pnpm -w vitest run apps/web/app/inbox/__tests__/StandbyList.test.tsx` | ✅ exists — extend with a standby-status fixture |
| LIFE-03 | `match_autowithdraw_user_conflicts` dispatches a bump notify; `match_auto_roll` dispatches roll notify (already has `standby_promoted`) | pgTAP | `psql … -f supabase/tests/b_complete.sql` (extend) | ⚠️ Wave 0 |
| LIFE-04 | `standby_roll` handler routes by `kind` to the 3 consumer RPCs; conflict cascade closes/withdraws conflicting nights (assert downstream state, not job status) | Deno handler test + pgTAP end-to-end | `deno test supabase/functions/process-jobs/handlers_test.ts`; `psql … -f supabase/tests/b_complete.sql` | ⚠️ handler test exists but only covers simple `standby_roll` — Wave 0 |

### Sampling Rate
- **Per task commit:** the single affected test (`pnpm -w vitest run <file>` or `psql -f <one test>.sql`).
- **Per wave merge:** `pnpm db:test` (all pgTAP) + `pnpm -w vitest run` (changed packages).
- **Phase gate:** full `_all_5b.sh` green; security advisor clean after every DDL (CLAUDE.md); local-green before any prod apply.

### Wave 0 Gaps
- [ ] `supabase/tests/b_complete.sql` — add assertions: after `match_cancel_lock` (mutual + safety), the lock's thread is `state='closed'` AND `revoked_at` not null (LIFE-01).
- [ ] `supabase/tests/<new>_life02_reports.sql` — `file_report` writes a `reports` row with the reused enum + `target_type='lock'`; RLS denies a non-reporter insert.
- [ ] `supabase/functions/process-jobs/handlers_test.ts` — add cases: `standby_roll` with `kind='autoclose_creator_conflicts'` calls `match_autoclose_creator_conflicts`; `kind='autowithdraw_user_conflicts'` calls `match_autowithdraw_user_conflicts`; `kind='autoroll'`/absent calls `match_auto_roll` with `payload.instance`.
- [ ] `supabase/tests/b_complete.sql` (or new) — end-to-end: accept a conflicting offer pair, run the enqueued `standby_roll` jobs through the dispatch, assert the creator's other seeking instance is `cancelled` and the candidate's other active offer is `expired`/withdrawn.
- [ ] `apps/web/app/inbox/__tests__/StandbyList.test.tsx` — add a `status='standby'` fixture row and assert it renders with a standby badge.
- [ ] No framework install needed — all harnesses exist.

### Prod verification (LIFE-04, READ-ONLY — do not mutate prod)
Use Supabase MCP `execute_sql` (read-only) / SQL console against `ufufmcpnysvwtutpbian`:
1. Confirm the live body: `select pg_get_functiondef('match_accept_offer(uuid,uuid,uuid)'::regprocedure);` — verify it enqueues `standby_roll` with `kind`/`time_range`/`keep_instance` (no `instance_id`).
2. Inspect recent cascade jobs: `select type, status, payload->>'kind' kind, last_error, created_at from jobs where type='standby_roll' order by created_at desc limit 50;` — expect `kind` conflict rows that are `done` with NO downstream effect (the bug signature).
3. Count wrong-state threads (LIFE-01 backfill scope): `select count(*) from chat_threads ct join locks l on l.id=ct.lock_id where l.status in ('cancelled','no_show') and ct.state<>'closed';`
4. (Optional, with a disposable test pair) reproduce a conflicting accept on a STAGING/local stack — never on prod with real users.

## Security Domain

> `security_enforcement: true`, ASVS level 1, block on `high`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | All new/edited RPCs re-check `p_actor = auth.uid()` (existing pattern: `match_cancel_lock:183`, `flag_no_show:128`). |
| V3 Session Management | no (new) | Supabase session cookie unchanged. |
| V4 Access Control | yes | `file_report` RLS: `with check (reporter_id = auth.uid())`; `flag_no_show` membership check (creator OR matched). Standby read scoped by `queue_candidate_read_own` (`candidate_id = auth.uid()`). **Never `USING(true)`** on update/delete (CLAUDE.md). |
| V5 Input Validation | yes | zod on any new edge-fn/route input; `reason_category` constrained by the enum; `report_reason` not free-form. |
| V6 Cryptography | no | No crypto in scope. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Outsider files a report/no-show against a date they're not in | Spoofing/Tampering | `auth.uid()` re-check + party-membership predicate (already in `flag_no_show`; mirror in `file_report`). |
| Accidental no-show tap dents reliability unfairly | Tampering | Locked decision: confirm step before submit (LIFE-02). |
| Standby surfacing leaks host identity pre-reveal | Information Disclosure | Keep the blind-safe `get_night_detail` projection in `StandbyList`; do not embed `date_instances` directly. |
| New report write policy too broad (`USING(true)`) | Elevation | Default-deny; insert-only `with check (reporter_id = auth.uid())`; no select/update/delete policy for users (admin/service-role reads only — matches `p0_reports_blocks.sql`). |
| DDL adds an RLS-less or over-permissive table | Multiple | Run Supabase security advisor after every DDL (CLAUDE.md); review live migration before prod apply. |

## Sources

### Primary (HIGH confidence — this repo)
- `supabase/migrations/20260527126900_p5_b_complete.sql` — `match_cancel_lock`, `match_auto_roll`, `match_autoclose_creator_conflicts`, `match_autowithdraw_user_conflicts` (lines 40,101,122,171).
- `supabase/migrations/20260525124500_p2_chat_core.sql` — `chat_threads` schema + `close_chat_thread`/`promote_chat_thread_to_lock` (lines 10-94).
- `supabase/migrations/20260527126400_p5_accept_lock.sql` + `20260606130200_e19_lock_rpc_producers.sql` — `match_accept_offer` cascade enqueues.
- `supabase/functions/process-jobs/handlers.ts` — `standby_roll` handler (line 95), dispatch table.
- `supabase/migrations/20260525123000_p2_jobs.sql` — jobs table + `job_type` enum.
- `supabase/migrations/20260525120900_p0_reports_blocks.sql` — `reports` table, `report_reason_category` enum, RLS.
- `supabase/migrations/20260604121000_e5_loop_completion.sql` — `flag_no_show` (line 118).
- `supabase/migrations/20260525123400_p2_notifications.sql` + `…123600_p2_dispatch_notification.sql` — notif enum + dispatch.
- `apps/web/app/matches/[lockId]/LockDetail.tsx` — inert `confirmFlag()` (line 172).
- `apps/web/app/inbox/StandbyList.tsx` (line 49) + `inbox/queue/page.tsx` (line 30) — interested-only filter.
- `apps/web/app/messages/[threadId]/page.tsx` + `app/messages/thread-view.ts:69` + `…/p7_chat_send_rpc.sql:8-11` — messageable gate.
- `supabase/migrations/20260613120000_acct01_account_deletion.sql:163` — account deletion calls `match_cancel_lock`.
- `package.json:21` (`db:test`), `supabase/tests/_all_5b.sh`, `supabase/tests/b_complete.sql` — test harness.

### Secondary
- `.planning/phases/13-lifecycle-correctness/13-CONTEXT.md` (locked decisions), `.planning/REQUIREMENTS.md` (LIFE-01..04), `.planning/STATE.md` (prod = edge fn v9), `./CLAUDE.md` (conventions).

### Tertiary
- None — no external/web sources needed; all evidence is in-repo.

## Metadata

**Confidence breakdown:**
- LIFE-01 seam: HIGH — exact functions + the `state='open'`-only gotcha cited.
- LIFE-02 inert control: HIGH — `confirmFlag()` body read; `flag_no_show`/`reports` confirmed.
- LIFE-03 filter: HIGH — exact `.eq('status','interested')` lines; notify-gap traced.
- LIFE-04 root cause: HIGH — handler ignores `kind`, reads non-existent `instance_id`; consumers proven orphaned by grep. Prod-body match is A1 (ASSUMED) pending read-only prod check.

**Research date:** 2026-06-13
**Valid until:** 2026-07-13 (stable internal code; re-verify if migrations land before planning)
