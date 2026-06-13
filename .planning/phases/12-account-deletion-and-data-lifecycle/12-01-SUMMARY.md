---
phase: 12
plan: "12-01"
subsystem: account-lifecycle
requirement: ACCT-01
status: built-local-green
prod_applied: false
date: 2026-06-13
---

# Phase 12 Plan 01: Account Deletion & Data Lifecycle Summary

End-to-end GDPR/CCPA account deletion: anonymize-in-place with a 7-day soft grace
window, active-commitment cleanup at request, auth removal at finalize, and a
privacy-preserving reputation carry-forward on re-signup. LOCAL-GREEN ONLY — no prod
migration applied, no edge function deployed.

## What shipped (4 atomic commits, local `main`, unpushed)

| Commit | Unit |
|--------|------|
| `171d685` | Migration: `reputation_ledger` + 5 RPCs |
| `7b55d8a` | SQL tests (4 cases) |
| `0b8a457` | `deletion_process` edge handler + Deno tests |
| `99c0244` | Delete-account UI + onboarding reputation seed + regenerated types |

## Files created

- `/Users/lucas/projects/After5/supabase/migrations/20260613120000_acct01_account_deletion.sql`
- `/Users/lucas/projects/After5/supabase/tests/acct01_account_deletion.sql`
- `/Users/lucas/projects/After5/apps/web/app/account/DeleteAccountSection.tsx`
- `/Users/lucas/projects/After5/apps/web/app/account/__tests__/DeleteAccountSection.test.tsx`

## Files changed

- `/Users/lucas/projects/After5/supabase/functions/process-jobs/handlers.ts` — `deletion_process` branch + `callRpcReturning` helper
- `/Users/lucas/projects/After5/supabase/functions/process-jobs/handlers_test.ts` — `deletion_process` in `ALL_TYPES` + 5 happy/edge tests
- `/Users/lucas/projects/After5/supabase/functions/process-jobs/handlers_rpc_fail_closed_test.ts` — fail-closed RPC test
- `/Users/lucas/projects/After5/apps/web/app/account/page.tsx` — select `account_state`, render `DeleteAccountSection`
- `/Users/lucas/projects/After5/apps/web/app/account/__tests__/page.test.tsx` — stub `DeleteAccountSection`
- `/Users/lucas/projects/After5/apps/web/app/onboarding/steps/DoneStep.tsx` — call `seed_reputation_from_ledger` best-effort on enable
- `/Users/lucas/projects/After5/apps/web/app/onboarding/steps/__tests__/DoneStep.test.tsx` — `rpc` on fake client + seed assertion
- `/Users/lucas/projects/After5/packages/types/src/database.ts` — regenerated from local (ledger + 4 RPCs)

## Migration contents (NOT prod-applied)

`reputation_ledger` (service-role-only: RLS enabled, no client policies, grants revoked)
+ RPCs:
- `request_account_deletion()` — auth'd; advisory-lock, idempotent guard, write ledger
  from verified phone (fail-loud if salt unset; skip + log if no verified phone), cancel
  active locks via `match_cancel_lock` (counterpart notified), `match_bulk_withdraw`
  (resolves offers negative → closes chats + withdraws queue), flip `deletion_pending`,
  enqueue 7-day `deletion_process` job (dedup `deletion:<uid>`).
- `cancel_account_deletion()` — auth'd; re-flip `active` + `cancel_jobs`. Idempotent.
- `process_account_deletion(uuid)` — service-role; anonymize-in-place (first_name →
  "someone who left", null email/clear/blurred, delete `profiles_private` +
  `profile_photos` rows, `dating_enabled=false`, `account_state='deleted'`), RETURNS the
  storage paths the handler purges. Idempotent (already-deleted → no-op, no paths).
- `seed_reputation_from_ledger()` — auth'd; carries `reliability_score` on re-signup +
  increments `prior_account_count`. Standing seed DEFERRED to Phase 15 (column written).
- `acct_identity_hash(text)` — internal; salted SHA-256 of E.164 verified phone.

All functions `security definer set search_path = public[, extensions]`; self-serve RPCs
granted to `authenticated`, service-role RPCs revoked from public/anon/authenticated.

## Salt mechanism (chosen)

The identity hash uses a salted SHA-256 of the verified phone (`auth.users.phone`, proven
verified via a `verifications` row). The salt is the Postgres custom GUC
`app.reputation_salt`, read with `current_setting('app.reputation_salt', true)` inside the
SECURITY DEFINER RPCs — so the secret never reaches the client bundle. If the GUC is unset
the deletion path FAILS LOUD (`raise 'reputation_salt_unset'`, errcode P5002) so reputation
preservation can never be silently skipped. Set at the DATABASE level by a superuser.

Local: set as `supabase_admin` (the `postgres` role is not superuser locally and cannot set
the GUC) — `alter database postgres set app.reputation_salt = '<local-dev-salt>'`. Confirmed
it persists across fresh `postgres` connections, so the edge runner reads it too.

## Test results (LOCAL)

- SQL (`psql ... -f supabase/tests/acct01_account_deletion.sql`): all 4 cases PASS
  (CASE1 request+cleanup+ledger+enqueue+cancel; CASE2 anonymize+paths+idempotent;
  CASE3 re-signup carry + prior_account_count++; CASE4 ledger service-role-only RLS).
- Deno (`deno test --allow-env --no-check --node-modules-dir=none ...handlers*`):
  **20 passed / 0 failed** (6 new deletion_process tests).
- Vitest (`pnpm --filter @after5/web exec vitest run` account + DoneStep):
  **26 passed / 0 failed** (5 new DeleteAccountSection tests + 1 new DoneStep seed test).
- `pnpm --filter @after5/web exec tsc --noEmit`: clean (exit 0).

## Known pre-existing issue (out of scope)

`handlers_rpc_fail_closed_test.ts`'s `makeDb` has a pre-existing TS2353 (`from` not in the
inferred return type) — present at HEAD before this work. The repo runs these Deno tests
with `--no-check` (per `_all_5b.sh` / file headers). NOT fixed (scope boundary). Logged here
rather than touched.

## GATED prod-apply commands (founder runs — DO NOT auto-run)

1. Set the salt secret (as a superuser — Supabase SQL editor / service connection). Pick a
   strong random value; do NOT reuse the local dev salt:
   ```sql
   alter database postgres set app.reputation_salt = '<STRONG_RANDOM_SECRET>';
   ```
   Verify on a fresh connection: `select current_setting('app.reputation_salt', true);`
2. Apply the migration to prod (ufufmcpnysvwtutpbian). Migration-history drift means
   `supabase db push` is unreliable — apply via Supabase MCP `apply_migration` (name
   `acct01_account_deletion`) with the body of
   `supabase/migrations/20260613120000_acct01_account_deletion.sql`.
3. Run the prod security advisor after the DDL: MCP `get_advisors` (expect no new findings;
   `reputation_ledger` is intentionally RLS-enabled-with-no-policies + revoked grants).
4. Deploy the edge function:
   ```bash
   supabase functions deploy process-jobs --project-ref ufufmcpnysvwtutpbian
   ```
   The handler uses the existing `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_URL` runner env
   (already set for process-jobs). No NEW edge/Vercel env var is required — the salt lives in
   the DB GUC, read by the RPC, not by the handler.
5. Regenerate prod types if you track them separately (local types already regenerated).

## Decisions / notes

- `profiles` has no `phone` column; verified phone lives in `auth.users.phone`. PII scrub on
  `profiles` = first_name/email/clear/blurred; phone/birthdate/bio live in `profiles_private`
  (deleted wholesale). Matches the locked spec.
- Active-lock cancel uses reason `creator_pre_lock` (a valid `match_cancel_lock` reason that
  rolls the instance + notifies the counterpart). The `safety` reason was intentionally NOT
  used (it would warn the counterpart's standing — wrong for a self-initiated deletion).
- Lock cleanup is skipped cleanly when `match_v2_enabled` is off (no live match surface).
- `process_account_deletion` returns storage paths (rather than the handler pre-reading them)
  so the DB is the single source of which objects to purge; handler purges + deletes auth.
- Reputation `standing` column is written to the ledger now but NOT seeded back on re-signup
  (deferred to Phase 15 per the locked spec).

## Self-Check: PASSED

- Migration file exists + applied locally (5 functions present, ledger RLS enabled).
- SQL tests: 4/4 cases + final notice fire.
- Deno: 20/20. Vitest: 26/26. tsc: clean.
- 4 commits present on local `main` (171d685, 7b55d8a, 0b8a457, 99c0244), unpushed.
