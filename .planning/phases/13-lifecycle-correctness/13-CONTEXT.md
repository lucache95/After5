# Phase 13: Lifecycle Correctness - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (founder decisions, 2026-06-13)

<domain>
## Phase Boundary

No object sits in a state that looks live but is actually dead, and the safety/cascade
machinery actually fires. Requirements: **LIFE-01, LIFE-02, LIFE-03, LIFE-04**. This is
correctness work on the EXISTING match/chat machinery — wiring real records and real
cascades to surfaces that today are silent, misleading, or invisible. Not green-field.
</domain>

<decisions>
## Implementation Decisions (LOCKED by founder)

### Cancelled-lock chat closure (LIFE-01)
- Cancelling a lock revokes its chat thread: `state → 'closed'`, `revoked_at` set
  (the close path already exists in `p2_chat_core`; `match_cancel_lock` must call it —
  today it never touches the thread).
- The thread becomes **read-only**, not deleted: **past messages stay visible** as
  history (gentler + preserves context), with a clear "this date was cancelled" banner.
  The misleading "you're locked in" state is the actual bug — killing that is the
  non-negotiable core of LIFE-01.
- Applies to BOTH parties' view of the thread.
- **Persistence principle (locked for the future):** chat persistence follows MUTUAL
  interest. A *pass / declined offer* always closes the channel (messaging someone who
  declined you is unwanted contact). A *cancelled lock* is the only case where staying
  open is even defensible (both already mutually chose each other) — but only once a
  block escape-hatch exists. Block does NOT exist today (no `blocked_users` table / RPC;
  the only in-thread valve is report), so "stay open unless blocked" is DEFERRED to
  Phase 15, not shipped here. Close-on-cancel is safe-by-default in the meantime.

### Safety + report controls persist real records (LIFE-02)
- The lock-page "something's wrong" control writes a real `reports` row (today it's a
  silent toast that calls no RPC). **Reuse the existing report reasons/taxonomy** — do
  not invent a new one.
- No-show flagging gets a working UI producer wired to the existing `flag_no_show` RPC.
- **Either party** can flag (report and no-show), with a **confirm step** before submit
  — a no-show dents the other person's reliability score, so it must not be a single
  accidental tap.

### Standby visibility + notifications (LIFE-03)
- Standby queue rows surface in the candidate's queue/inbox views (today those views
  filter to `interested` only, so standby is invisible). Show with a clear "standby"
  badge — the components exist (`StandbyCard`, `StandbyList`); they're just not surfaced.
- **Notify on both** events: when the candidate is bumped to standby, and when an offer
  rolls to them.

### Conflict cascade fires end-to-end (LIFE-04)
- Investigation-led, Claude's discretion on fix scope: VERIFY on prod (with a real
  conflicting-offer test pair) that accepting an offer fires the creator-conflict
  autoclose + user-conflict autowithdraw cascade through the job runner. FIX the
  `standby_roll` handler's `kind`-branching / `instance_id` keying if it's broken (the
  requirement explicitly suspects it is), and leave a regression test behind.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `StandbyCard` (`apps/web/components/StandbyCard.tsx`) + `StandbyList`
  (`apps/web/app/inbox/StandbyList.tsx`) — standby UI already built, needs surfacing.
- `flag_no_show` RPC exists (e5_loop_completion / e19_safety_dispatch_rpcs /
  e17_recompute_reliability migrations) — needs a UI producer.
- Chat close machinery: `chat_threads.state in ('open','promoted','closed')` +
  `revoked_at` (`p2_chat_core`, 20260525124500) — close path exists; cancel must call it.
- `match_cancel_lock` lives in p0_locks / p5 migrations — cancels jobs + flips status
  but does NOT touch the chat thread (the LIFE-01 gap).

### Established Patterns
- Job runner: `enqueue_job` / handlers branch on `job.type`; cron `/api/cron/process-jobs`
  fires each minute (the LIFE-04 cascade rides this).
- Secure-by-default RLS, pinned `search_path`, gated prod-apply, security advisor after DDL.
- Report flow already exists in offer/chat UI (existing reasons taxonomy to reuse).

### Integration Points
- `match_cancel_lock` (RPC) → call the existing thread-close path.
- Queue/inbox candidate views (`apps/web/app/inbox/queue`, `InboxSummaryRow`) → drop the
  `interested`-only filter so standby rows show.
- Lock page "something's wrong" control + a no-show control → wire to RPCs.
</code_context>

<specifics>
## Specific Ideas

- Cancelled-thread banner copy: "this date was cancelled" (read-only), NOT "you're
  locked in" / not a messageable "chat is open" state.
- No-show / report controls get an explicit confirm before submit (reliability impact).
</specifics>

<deferred>
## Deferred Ideas

- **Per-thread mute** (notification preference, low-stakes — no safety gating) +
  **block** (contact control, the safety escape-hatch). These are the same
  "manage this conversation" control set (mute · block · report) and land together in
  **Phase 15 (Moderation & Safety Operations)**, where block already belongs. Mute is
  simple enough to pull into Phase 14 if desired, but should not be split from block
  into Phase 13 (a correctness phase).
- **Liberalize cancelled-lock chat to "stay open unless blocked"** (founder's preferred
  end-state) → Phase 15, AFTER block exists. Phase 13 ships close-on-cancel.
</deferred>
