# 5b Matching — Technical Debt Audit (read-only)

Date: 2026-05-29
Scope: `supabase/migrations`, `supabase/functions`, `supabase/tests`, root config. The "5b" matching loop (sub-projects A/B/C: shortlist → offer → accept/pass/expire → lock → reveal, demand hint, admin tooling, idempotency).
Method: grep + read + local Postgres introspection (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) + full `db:test` run. No code changed.

## Test/build status
- `npm run db:test` (all 44 `supabase/tests/*.sql`): **exit 0, GREEN.** No failing SQL test.
- Deno edge-fn `*.test.ts` and the two `*.sh` concurrency tests were NOT executed (out of `db:test` scope; see Y4).
- All 8 `match-*` edge functions HAVE an `index.test.ts`. No missing per-fn test file — the sub-project C "zero tests" gap the user mentioned is closed.

## Findings

### RED — will break or actively mislead

| ID | Area | File / object | Description | Recommended action | Effort |
|----|------|---------------|-------------|--------------------|--------|
| R1 | Job runner | `supabase/functions/process-jobs/handlers.ts` | 8 of 14 dispatch entries call RPCs that **do not exist in the DB**: `match_stale_date_close`, `match_expire_pending`, `match_reconfirm_timeout`, `match_bulk_withdraw`, `chat_purge_thread`, `close_rating_window`, `process_deletion`, `analytics_relay_drain`. These are forward-declared for S6/S7/S8/S10/S12. If a job of any of these `type`s is enqueued during the tester cohort, the handler throws `function does not exist` and the job fails (possibly poison-loops). Only `offer_expiry`→`match_expire_offer` and `standby_roll`→`match_auto_roll` resolve today. `handlers_test.ts` only asserts a handler function exists, NOT that the target RPC exists — so the gap is invisible to CI. | Before cohort: confirm 5b never enqueues these job types (audit every `enqueue`/insert into `jobs`), OR add a guard so an unknown/missing RPC dead-letters instead of poison-looping. Add a test asserting each referenced RPC exists in `pg_proc`. | M |
| R2 | Type drift | `supabase/functions/_shared/notify.ts` (NotificationType union, comment "exactly — 15 values") | DB `notification_type` enum has **20** values; the TS union lists only **15**. Missing: `reciprocal_detected`, `offer_passed`, `offer_expired`, `lock_cancelled_frozen`, `lock_cancelled_rolled` — exactly the 5 types 5b SQL emits via `dispatch_notification`. `genericNotify` casts `job.payload.notification_type as NotificationType`, so any deferred-notify job carrying a 5b type is a type lie; direct typed `dispatchNotification` calls for these types won't compile. Same class of stale-count bug the user just fixed in `p2_notifications.sql` (15→20). | Add the 5 values to the union; delete the "15 values" comment or replace with a generated/asserted source. | S |

### YELLOW — fix soon

| ID | Area | File / object | Description | Recommended action | Effort |
|----|------|---------------|-------------|--------------------|--------|
| Y1 | Stub shipped | `match_demand_hint` — `20260527127000_p5_c_sql.sql` | Swipe-count heuristic STUB (right-swipe count: ≥30 almost_full / ≥15 filling_up / ≥5 warming_up / else quiet). "real ML model is post-MVP." Functionally fine but the thresholds are arbitrary and the UI may present it as signal. Test `c_demand_hint_heuristic.sql` pins exact boundaries — fine, but couples UI semantics to magic numbers. | Keep for MVP; flag in cohort comms that the hint is heuristic, not real demand. | S |
| Y2 | Scheduler missing | `prune_idempotency_ledger` (`c_sql.sql`) + `pg_cron` | `pg_cron` is **NOT installed** (verified: `pg_extension` has no `pg_cron`). The prune function exists but **never auto-runs**; the migration comment says it relies on an S2 job runner job that isn't wired. `transition_idempotency` grows unbounded until someone calls it manually. Not fatal short-term but a slow leak. | Wire a recurring `jobs` row (or Vercel cron) to call `prune_idempotency_ledger`, or document the manual cadence. Verify on prod too. | S |
| Y3 | Cron/infra inventory | no `vercel.json` in repo root | No `vercel.json` tracked — the process-jobs cron (noted as live in project memory: "Vercel Pro + process-jobs cron live") is configured **outside the repo** (Vercel dashboard) or in an app subdir. Schedule is not source-controlled; cannot review or reproduce. | Commit the cron config (vercel.json or equivalent) so the schedule is auditable. | S |
| Y4 | Test coverage gap | `supabase/tests/p5_concurrency_lib.sh`, `z_chat_thread_races.sh` | The two shell-based concurrency tests are NOT run by `db:test` (which globs `*.sql` only). The hardest-to-reason-about surface (advisory-lock races, chat thread races) has tests that no command in `package.json` invokes. | Add a `db:test:concurrency` script and run it in CI / pre-cohort. | S |
| Y5 | Secret not wired | `supabase/functions/_shared/notify.ts` (Resend ops-alert sink) | Comments at L68/L75-76: high-stakes Resend fallback + C11.8 fail-loud ops-alert email are "Returns ok:false until wired." The safety fail-loud sink (`admin_alert` channel → ops inbox) is NOT actually sending email. Safety check-in / safety_alert escalation has no out-of-band delivery. | Wire `OPS_ALERT_EMAIL` + Resend before any cohort that can trigger safety flows. | M |
| Y6 | Untracked file | `scripts/qa-feed-seed.sql` | Local-dev QA seed (superuser, RLS-bypass, hardcoded QA UUID `5f387641…`). Useful, re-runnable. Not ignored, not committed. | Commit it (it's a shared dev tool), keeping the "local dev only" header. | S |
| Y7 | Untracked docs | `docs/superpowers/plans/2026-05-26-date-quality-eval.md`, `docs/superpowers/specs/2026-05-26-good-date-standard.md` | Planning/spec docs, not ignored. The rest of `docs/superpowers/` is tracked, so these are likely just forgotten adds. | Commit (they belong with the tracked spec set). | S |
| Y8 | Twilio gap | (no Twilio in `supabase/functions`) | Project memory says "Twilio blocks smoke Step 2." There is **no Twilio code in edge functions** — phone confirm goes through `confirm-phone`/`start-verification` (Persona) using `PERSONA_API_KEY`/`PERSONA_TEMPLATE_ID`. The Twilio blocker is an upstream Supabase Auth SMS-provider config, not repo code. | Inventory only: resolve Twilio SMS provider config in Supabase Auth dashboard before Step 2. Not a code change. | — |

### GREEN — noted, no action needed

| ID | Area | Object | Note |
|----|------|--------|------|
| G1 | Stub replaced cleanly | `match_auto_roll` | B-lite no-op stub (`20260527126800`, returns `null`) is replaced via `create or replace` by B-complete (`20260527126900`) with the real body. No orphaned/dead duplicate; consumer `match_resolve_offer_negative` keeps calling the same name. Clean divergence resolution. |
| G2 | Reveal residual risk — documented & bounded | `match_reveal_allowed_pair`, `profiles_select_revealed` (`20260527126600`) | The A.7 "RESIDUAL COLUMN-LEAK RISK" is real but **bounded and accepted**: an authenticated user in a reveal relationship CAN `SELECT email FROM profiles WHERE id=<peer>` and read non-Tier-3 columns, because the policy is row-level (no column REVOKE — would break S1 read paths). Scope is narrow: only counterparties already sharing an offer/lock can probe, not any user. Mitigations: F's modal + C's edge fns project Tier-3 only. Negative test `a_revealed_rls_negative.sql` passes. Acceptable for 5b; S10 may add `profiles_revealed_view`. |
| G3 | `can_enter_lock_flow` | `20260525123500` | Not a stub — full C3 logic (account_state='active' AND standing NOT IN cooldown/locked_ban/suspended AND NOT rollover_frozen). Revoked from public/authenticated, called only by DEFINER RPCs. Test `p2_can_enter_lock_flow.sql` passes. |
| G4 | Admin tooling | `admin_force_expire_offer`, `admin_force_cancel_lock` (`c_sql.sql`) | Service-role-only (REVOKEd from public/anon/authenticated; verified by `c_admin_tooling_permissions.sql`). `cancel_reason` uses creator as a documented "actor placeholder" — cosmetic, low risk. |
| G5 | Untracked tooling | `.understand-anything/` (848K) | Generated knowledge-graph artifacts from the understand-anything skill. NOT ignored and NOT committed. Recommend adding to `.gitignore` (generated, large, machine-local) — see shortlist. |
| G6 | Feature flag | `feature_config.match_v2_enabled` | LOCAL value is `true` (a prior dev session set it; `on conflict do nothing` preserves it). Migration comment confirms PROD first-apply inserts `false`. Verify prod is still `false` until cohort flip — local ≠ prod here by design. |

## Must-address-before-tester-cohort (Task 10 Step 2)

1. **R1** — Guard / verify the 8 missing handler RPCs. Either prove 5b never enqueues those job types, or make the runner dead-letter on missing RPC. A single mis-typed job currently poison-loops. (highest risk)
2. **Y5** — Wire the Resend ops-alert / safety fail-loud sink. A live cohort can trigger safety_checkin/safety_alert; today escalation email returns `ok:false` (silent).
3. **Y8 / Twilio** — Resolve the SMS provider in Supabase Auth so phone confirm (Step 2 smoke) unblocks. Config, not code.
4. **G6** — Confirm prod `match_v2_enabled` is still `false` and flip deliberately per cohort (local is `true` and will mislead).
5. **R2** — Add the 5 missing `NotificationType` values so deferred-notify jobs carrying 5b types are type-safe.
6. **Y2** — Schedule `prune_idempotency_ledger` (no pg_cron) before the ledger growth becomes a prod issue.

## Advisor note
`mcp__supabase__get_advisors` targets the remote project; this audit ran against LOCAL Postgres only (no advisor run performed here). Recommend running `get_advisors` (security + performance) against prod ref `ufufmcpnysvwtutpbian` and re-checking findings touching `profiles`/`offers`/`locks`/`queue_entries` (esp. the G2 reveal policy and any SECURITY DEFINER search_path warnings).
