# Verification-Gap Audit — After5 5b (2026-05-30)

Read-only. Goal: an honest inventory of what is BUILT but UNVERIFIED / UNTESTED / partially-proven, so nothing ships on a false "done". Nothing changed.

Ground-truth this run (commands actually executed):
- `npm run db:test` → **exit 0, GREEN.** All `supabase/tests/*.sql` pass.
- `pnpm --filter @after5/web test` → **exit 1. 3 failed / 220 passed / 223 total; 1 failed file of 52.** All 3 failures are PhotoStep (#23). No `.skip`/`.todo`/`.only`/`xit`/`xdescribe` anywhere in `apps/web`. The `node` vitest project has **no test files** (packages/* carry none; SQL is covered by db:test).
- Prod (`ufufmcpnysvwtutpbian`) read-only: `feature_config.match_v2_enabled = false` (confirmed OFF), `offer_window_hours = 24`. `process-jobs` edge fn **IS deployed** (v1, this session). Backfill RPCs `close_rating_window`, `match_bulk_withdraw`, `match_auto_roll`, `match_expire_offer` **exist on prod** (127200 applied). 6 forward-declared RPCs absent on prod. Security advisor: anon-revoke on the two reveal helpers **landed** (no 5b `anon_security_definer` flags remain; only PostGIS `st_estimatedextent`).

**Stale-report correction:** the 2026-05-29 deploy-audit lists "127200 pending" and "process-jobs NOT deployed" — both were closed later that session (commit `1d013d8`). Verified against live prod here.

---

## Currently-failing / skipped tests (exact)

3 failing, 0 skipped. All in `apps/web/app/onboarding/steps/__tests__/PhotoStep.test.tsx`:
1. `PhotoStep > success: uploads clear.jpg, runs generate-blur, advances to preferences`
2. `PhotoStep > error + retry: failed upload shows error; retry re-uploads`
3. `PhotoStep > cancel/replace: picking a new file clears a prior error`

Root cause: the tests click `getByRole('button', {name:/next/i})` but the real component renders a crop UI with a **"looks good"** button (no "next"). Stale test selectors vs the restyled component, not a runtime bug — but it means **PhotoStep's upload→generate-blur→advance path is currently UNVERIFIED by a passing test** (the 2 tests that do pass only cover the disabled-empty state and HEIC reject). All PhotoStep tests are **pure-mock** (storage `upload`, `functions.invoke`, `advanceOnboarding` all `vi.fn()`) — they never touch real storage or the generate-blur edge fn even when green. (#23)

---

## 🔴 verify-before-cohort

- **R1-residual — 6 job types poison-loop if ever enqueued.** `process-jobs/handlers.ts` dispatches `stale_date_close→match_stale_date_close`, `pending_expiry→match_expire_pending`, `reconfirm_timeout→match_reconfirm_timeout`, `chat_purge→chat_purge_thread`, `deletion_process→process_deletion`, `analytics_relay→analytics_relay_drain`. **None of these 6 RPCs exist on local OR prod** (verified `pg_proc`). Nothing in 5b enqueues them today (grep of all `enqueue_job` calls: only `offer_expiry`, `standby_roll`, `rating_window`, `bulk_withdraw` are emitted), so the loop is latent — but a single mis-typed/manual enqueue = `function does not exist` → failed job, possibly poison-loop. Risk: stuck job runner if triggered. Cheapest verify: `select distinct type from jobs;` on prod before+during cohort = empty/only-the-4; add a runner guard that dead-letters unknown/missing RPCs. (5b tech-debt R1)
- **`rating_window` & `bulk_withdraw` are LIVE job types but the cron→handler→RPC chain is never E2E'd.** `match_accept_offer` enqueues `rating_window` on **every** accept; the safety cancel branch enqueues `bulk_withdraw`. The target RPCs (`close_rating_window`, `match_bulk_withdraw`) exist and have **SQL unit tests** (`b_job_rpcs.sql`, `c_job_handler_rpcs.sql`), but **no test drives the deployed `process-jobs` function picking up a real `jobs` row and calling them.** The H E2E uses `supabase functions serve` against local — it never invokes process-jobs at all. Risk: a wiring/payload-key bug (the `bulk_withdraw` payload key is `'user'`, easy to drift) only surfaces in prod. Cheapest verify: locally enqueue one `rating_window` + one `bulk_withdraw` job and invoke the deployed function once; assert the RPC ran.
- **Prod loop is 0-verified end-to-end — nobody has gone signup→match on prod.** Twilio (no SMS provider) and Persona (secrets unconfirmed) both hard-block onboarding; prod has 27 profiles / 0 verified / 0 dating_enabled / 0 `date_instances`. The entire match loop on prod rests on the local E2E + the Task-10-Step-1 smoke. The flag is OFF, so this is expected, but "the loop works on prod" is currently **asserted, not observed.** Cheapest verify: run `cohort-unblock.sql` + `seed-cohort-nights.sql` against prod for 2 tester uids, flip the flag, traverse swipe→accept→reveal once in a real browser. (funnel audit)
- **Cohort scripts only ever dry-run locally with placeholder uids — never run on real prod data.** `scripts/cohort-unblock.sql` and `scripts/seed-cohort-nights.sql` carry sample/placeholder rows and "local dev" run instructions; both are service-role RLS-bypass scripts. Untested against the actual prod schema (e.g. the `enforce_age_gate` trigger + `profiles_private.birthdate` interaction the funnel audit flagged). Risk: a failed/half-applied bypass leaves testers stuck or in a bad state. Cheapest verify: run each on a prod **branch** (Supabase branch) or in a transaction with `ROLLBACK` first.
- **Resend ops-alert / safety fail-loud sink returns `ok:false` (silent).** `_shared/notify.ts` (L68/L75-76): the high-stakes safety escalation email is "Returns ok:false until wired." A cohort can trigger `safety_checkin`/`safety_alert`; today escalation has **no out-of-band delivery**. Risk: a safety event fires and nobody is paged. Cheapest verify: wire `OPS_ALERT_EMAIL` + Resend and send one test alert; until then, treat safety flows as un-monitored. (5b tech-debt Y5)

## 🟡 verify-before-public

- **Auth email templates rebranded but NOT wired, NOT deployed, NOT rendered.** `supabase/email-templates/{magic-link,confirm-signup,reset-password}.html` edited this session. `config.toml` does **not** wire them (`content_path` lines are still commented). The README says "paste into the Supabase dashboard + send yourself a magic link to confirm rendering" — **not done.** Prod auth currently sends Supabase defaults or whatever's in the dashboard, i.e. likely planner-era / generic copy. Built ≠ live. Cheapest verify: paste into dashboard, trigger a real magic link, eyeball the inbox (Gmail + Apple Mail). (branding audit P0)
- **G email half is entirely deferred (not built), but "G done" is easy to misread.** Roadmap Task 8 checkboxes are **all open**. Only the in-app notification center shipped. Missing: `lib/email/resend.ts`, the 4 React Email templates, `notification-dispatcher` edge fn, and Resend domain (DKIM/SPF/DMARC) verification. So **no 5b notification reaches a user by email** — in-app only. Risk: testers who aren't in the app miss offers/matches/expiries entirely. (#22, roadmap Task 8)
- **Realtime in-app is unit-tested against a mock transport, never proven with a live insert.** `lib/after5/__tests__/realtime{,.lock,.notif}.test.ts` + the NotificationCenter/Bell/Badge tests assert channel-name shape and handler wiring against a **mocked** Supabase channel. **No test (unit or E2E) proves a real row insert into `notifications` produces a live client notification.** The H happy-path E2E does the reveal via a button click, not via a Realtime push. Risk: a subscription/RLS/filter bug means notifications silently never arrive live. Cheapest verify: in a logged-in browser, service-role-insert a `notifications` row for that user and watch the bell update.
- **Y3 — `profiles.email` column-leak to relationship-gated counterparts (UNCHANGED on prod).** A reveal-relationship counterpart can `select email from profiles where id=<peer>`. Bounded (not stranger/anon), documented/accepted for a closed cohort, but **not fixed** — advisor can't flag it (row-level policy by design). Risk: a determined tester reads a match's email. Fix before public (S10 `profiles_revealed_view` / move email off `public.profiles`). (security pass Y3 / #25-class)
- **Y2 — empty `<img>` src guard (#21).** `MatchesList.tsx:31`, `LockDetail.tsx:57`, `RevealModal.tsx:26` pass `clear_photo_url ?? ''` to `Polaroid src`. Empty-string src can trigger a re-request of the current page in some browsers. Low risk, but the reveal screens — the emotional payoff of the loop — are exactly where a missing photo would show. Cheapest verify: render a reveal for a counterpart with null `clear_photo_url`; confirm no broken-image/page-refetch. (#21)
- **Y2-security (reveal expiry lag) — time-expired-but-status-active offer keeps reveal.** Reveal predicates key on `offers.status in ('active','accepted')`, not `expires_at`. Between expiry-time and the `offer_expiry` job firing, the candidate retains profile (incl. email) + instance read. Bounded to a real counterpart + job-lag window. The whole concern depends on the process-jobs cron running tightly — which itself is not yet prod-observed (see 🔴 above). Cheapest verify: monitor offer_expiry job lag on prod; defense-in-depth = add `and o.expires_at > now()`. (security pass Y2)
- **`function_search_path_mutable` on 5b helpers (prod WARN).** `match_instance_lock_key`, `match_pair_lock_key`, `offer_expires_at`, `tstzrange_from_start_duration` + shared trigger fns lack a pinned `search_path`. Hardening, not a leak. (deploy audit §5)
- **Leaked-password protection disabled (prod WARN).** Auth dashboard toggle. (deploy audit §5)
- **Onboarding flow is unit-mocked only; never traversed end-to-end.** The PhotoStep failures are one symptom; more broadly no E2E walks welcome→basics→photo→preferences→phone→verify→done against a real stack. The phone/verify steps can't be exercised at all without Twilio/Persona. Risk: step-advance / `advanceOnboarding` wiring breaks unseen.

## 🟢 known-acceptable (verified or deliberately scoped)

- **`match_v2_enabled = false` on prod** — confirmed; the loop is gated off until a deliberate cohort flip. De-risks everything above.
- **Anon-revoke on `match_host_can_see_candidate` / `match_offer_recipient_can_see_instance`** — security pass Y1 **is applied to prod** (verified: no 5b `anon_security_definer` advisor flags remain).
- **Access-control RED set: none.** Security pass found no PII leak / auth bypass / cross-tenant read; 21 hostile probes denied.
- **`db:test` GREEN** (all SQL) and **220/223 web tests pass.** Match RPC contract, RLS negatives, idempotency, demand-hint boundaries all covered by passing SQL tests.
- **`prune_idempotency_ledger` never auto-runs (no pg_cron)** — slow leak, not a launch blocker at cohort scale. (tech-debt Y2)
- **Migration-history drift** (prod-only `126850_p5_cancel_reason_extend` with no local file; version-vs-filename divergence; s4/s5 5a-loop residue) — functionally reconciled (loop works), hygiene only. Backfill the local file before relying on a clean `db reset`. (coherency audit Check 3)
- **`match_demand_hint` heuristic stub** — arbitrary thresholds, flagged as not-real-demand. Acceptable for MVP; tell the cohort. (tech-debt Y1)

---

## Items resting only on a subagent's word (independently re-checked here)

- "process-jobs deployed + 127200 applied" — was a session claim; **re-verified live on prod** this run (RPCs present, fn ACTIVE). ✅ holds.
- "anon revoke applied to prod" — **re-verified via advisor** this run. ✅ holds.
- "H E2E passed (happy + negatives)" — specs exist and are coherent, selectors documented against real DOM, but the run is **forced-local** (`127.0.0.1:54321` + `functions serve`) per `playwright.config.ts`; I did **not** re-run Playwright this session (needs the full local stack + functions-serve + browser). The "passed" rests on the prior session's run. Cheapest re-verify: `pnpm --filter @after5/web exec playwright test`.
- "5b reciprocal/job-rpc/RLS fixes are local-green" — the SQL tests are green here; the **prod** application of the reciprocal-pair wiring + the v3 redeploys of `match-make-offer`/`match-resolve-reciprocal` are deployed (entrypoints in /tmp = fresh) but **never exercised against prod** since the flag is off (same gap as the 🔴 prod-loop item).

## Task-number map
#21 image-src null guard · #22 transactional/auth emails (G email half + template wiring) · #23 PhotoStep test failures · #25-class email column-leak (Y3) · 5b tech-debt R1 (job poison-loop) / Y5 (Resend safety sink) / Y2 (pg_cron prune).
