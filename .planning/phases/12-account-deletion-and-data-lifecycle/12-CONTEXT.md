# Phase 12: Account Deletion & Data Lifecycle - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (decisions accepted/overridden by founder 2026-06-13)

<domain>
## Phase Boundary

A user can delete their account end-to-end, and no active commitment is left dangling. Requirement: **ACCT-01**. This is the last true launch gate after Persona prod verification (resolved 2026-06-13). GDPR/CCPA right-to-erasure.

Today only the `deletion_process` value exists in the `job_type` enum — there is NO request RPC, NO `deletion_process` job handler, NO UI, and NO cascade/anonymize logic. An enqueued `deletion_process` job would hit "no handler" and dead-letter.
</domain>

<decisions>
## Implementation Decisions (LOCKED by founder)

**A — Delete model: anonymize-in-place, NOT hard row-delete.**
The user is FK-referenced by matches/ratings/messages/locks/queue_entries. Scrub PII rather than delete the row: `first_name` → a neutral tombstone ("someone who left"), null `email`/`phone`/`clear_photo_url`/`blurred_photo_url`, delete `profile_photos` rows + their storage objects (clear + blurred), delete `profiles_private` (birthdate/bio/PII), flip `account_state='deleted'`, `dating_enabled=false`. Counterparties' past dates/ratings stay referentially coherent against the tombstone row.

**B — Grace period: 7-day soft window.**
Request → `account_state='deletion_pending'` + enqueue a `deletion_process` job with `run_after = now() + 7 days`, dedup_key `deletion:<uid>`. A "changed your mind?" cancel affordance (and re-login) cancels the pending deletion (re-flip to `active`, cancel the job) until it fires. Guards against rage-quit regret + accidental loss.

**C — Active commitments: cleaned up on the deletion REQUEST (not at finalize).**
On request: cancel any active lock the user is party to via the existing cancel path so the counterpart is notified (`lock_cancelled_*`), expire their active offers, close their chat threads, withdraw/clear their queue_entries. Nobody is left locked to a ghost during the 7-day window.

**D — Auth removal at finalize, service-role admin API.**
The `deletion_process` job handler (service-role) anonymizes (per A), then removes the `auth.users` row via the admin API so the email frees and they cannot sign back in.

**E — Re-signup allowed, BUT reputation follows the person (anti-abuse — founder override).**
Deleting must NOT be a reliability-score/standing reset. At deletion (request or finalize, before scrub), if the user has a verified durable identifier, preserve a **privacy-preserving identity hash** + their reputation in a new `reputation_ledger`:
  - `identity_hash text primary key` — salted SHA-256 of the normalized **verified phone (E.164)** and/or Persona identity. NOT email (changes on re-signup). Use a server-side secret salt.
  - `reliability_score numeric`, `standing standing_state`, `prior_account_count int default 1`, `last_seen timestamptz`.
On re-signup, AFTER the new account re-verifies phone/ID (so the hash is trustworthy), look up `reputation_ledger` by `identity_hash`; if found, seed the new profile's `reliability_score` (and standing once Phase 15 lands) from it, and increment `prior_account_count`. A bad actor returns exactly as bad as they left.
  - **reliability_score carries now; standing carry-forward fully lands with Phase 15** (standing machinery doesn't exist yet — write the ledger column now, wire the standing seed in Phase 15).
  - **GDPR posture:** retaining a one-way salted hash + a reputation score after an erasure request is a *legitimate-interest / fraud-and-safety* basis — we keep NO profile data, only the hash + score. Flag for the privacy policy (needs a line documenting this retention). This is a deliberate, defensible policy stance, not an oversight.

All other choices at Claude's discretion, following codebase conventions (secure-by-default RLS, pinned search_path, gated prod-apply, security advisor after DDL).
</decisions>

<code_context>
## Existing Code Insights

- `deletion_process` is a `job_type` enum value with NO handler (`supabase/functions/process-jobs/handlers.ts`). The job runner dead-letters unknown handlers after 5 attempts → `job_missing_rpc` alert.
- `account_state` enum (`account_lifecycle`): `active|paused|deletion_pending|deleted` already exists (`profiles`). `can_enter_lock_flow` already gates on `account_state='active'`, and feeds/feed RPCs filter `account_state='active'` — so flipping to `deletion_pending`/`deleted` already removes the user from the marketplace surfaces.
- Job enqueue/handler pattern: `enqueue_job(type, run_after, payload, dedup_key)`; handlers in `process-jobs/handlers.ts` branch on `job.type` and call an RPC; cron `/api/cron/process-jobs` fires every minute.
- Photo storage convention: `profile-photos` bucket, `<uid>/...` paths; mirror columns `clear_photo_url`/`blurred_photo_url` on `profiles`.
- Lock cancel path: `match_cancel_lock(actor, lock, reason, idem)` dispatches `lock_cancelled_*` and rolls the instance. Offer/queue/chat cleanup helpers exist (`match_resolve_offer_negative`, `close_chat_thread`, `match_bulk_withdraw`).
- Verified phone lives in `auth.users.phone` + a `verifications(kind='phone', state='verified')` row; Persona identity ref in `verifications(kind='age'/'selfie', provider_ref)`.
- Onboarding seeds reliability via no path yet; reliability_score recompute is `recompute_reliability` (E17).
- Settings/account UI: `apps/web/app/account/` (profile editor lives here).
</code_context>

<specifics>
## Specific Ideas

- New migration: `reputation_ledger` table (RLS: service-role only; no client read/write) + `account_state` already present.
- New RPC `request_account_deletion()` (auth'd self-serve): flips `account_state='deletion_pending'`, cleans active commitments (C), preserves reputation to the ledger (E), enqueues the 7-day `deletion_process` job. Idempotent.
- New RPC `cancel_account_deletion()` (auth'd, within window): re-flip to `active`, cancel the job.
- New RPC `process_account_deletion(p_user)` (service-role, the job handler target): anonymize (A) + remove auth user (D). Idempotent, fail-loud.
- `deletion_process` handler branch in `process-jobs/handlers.ts` → `process_account_deletion`.
- Onboarding hook: after phone/ID verification, `seed_reputation_from_ledger()` lookup by identity_hash.
- UI: a "delete my account" affordance in `/account` (settings) → confirm modal (irreversible-after-7-days copy) → calls `request_account_deletion`; a pending-deletion banner with "cancel deletion" while `deletion_pending`.
- Tests: SQL tests for each RPC (request cleans commitments, ledger preserved, cancel restores, finalize anonymizes + removes auth, re-signup carries score); RLS test (ledger service-role-only); a deletion E2E.
</specifics>

<deferred>
## Deferred Ideas

- Standing carry-forward on re-signup → Phase 15 (standing machinery doesn't exist yet; write the ledger column now).
- Email denylist / hard re-signup block → out of scope (E: re-signup allowed, reputation carries instead).
- Data-export ("download my data") → future; not part of this launch gate.
</deferred>
