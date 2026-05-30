# After5 — Implementation Checklist

Companion to `docs/after5-current-implementation-plan.md`. Tick top-to-bottom. Don't cross a phase gate until every box above it is checked.

## Pre-flight — Verify reality (run before coding)
- [ ] **U1/U2** Record SHAs: `git -C <repo> fetch origin && git -C <repo> rev-parse HEAD origin/main && git -C <repo> rev-list --count origin/main..HEAD`
- [ ] **U1** Vercel prod SHA via `mcp__vercel__list_deployments` (target=production, state=READY) → `meta.githubCommitSha`
- [ ] **U3** Edge-fn versions/entrypoints via `mcp__supabase__list_edge_functions` (look for `file:///Users/...` drift)
- [ ] **U4** Read `apps/web/app/home/page.tsx` + `apps/web/app/account/page.tsx`
- [ ] **U5** `supabase migration list` vs `mcp__supabase__list_migrations`; confirm `126850` missing locally
- [ ] **U6** `supabase secrets list --project-ref ufufmcpnysvwtutpbian`; check Twilio (Auth dashboard), Persona template id, Resend DNS, `JOBS_RUNNER_SECRET`/`CRON_SECRET`
- [ ] **U7** Read `scripts/cohort-unblock.sql`, `seed-cohort-nights.sql`, `qa-feed-seed.sql` — confirm no host guard
- [ ] **U8** `grep -rn "not_wired\|web_push\|ops_email" supabase/functions`; `grep -rn "devices" apps supabase`
- [ ] **U9** Query `pg_policies` for select on `admin_alerts`, `audit_log`, `reports`, `disputes`, `blocks`
- [ ] **Verify** `/vote/[id]` and `/admin/eval` — classify Keep/Defer/Kill

## R0 — Re-baseline (must-fix before cohort)
- [ ] **R0.1** Fix 3 PhotoStep tests; suite green; add lint + typecheck + `next build` to `5b-tests.yml`
- [ ] **R0.2** Job runner: capability allowlist + inspect `{ error }` → fail-closed + `admin_alerts`; test for missing-RPC; redeploy `process-jobs` (record version→SHA)
- [ ] **R0.3** `admin_alerts` admin-only RLS select + minimal `/admin/alerts` reader; RLS test (non-admin = 0 rows)
- [ ] **R0.4** Host/env guard header on the 3 prod-dangerous scripts; verify abort on non-local
- [ ] **R0.5** Backfill `126850` migration locally (derive from prod); `db reset` reproduces; document `temp_race` cleanup
- [ ] **R0.6** Write `docs/CURRENT-PROD-REALITY.md` (SHAs, live slices, fn→SHA, migrations, secrets, prod-only objects)
- [ ] **R0.7** Rewrite `INTEGRATION-CONTRACT.md` + `RECONCILED-MASTER-PLAN.md`; archive p6–p11 + pre-5b roadmap to `docs/superpowers/plans/archive/` with STALE banner
- [ ] **R0.8** `/account` → settings-only + redirect bare `/account`→`/home`; no planner-only dead-end

### GATE R0 → R1
- [ ] CI green + gates active · SHAs recorded · `126850` backfilled · stale plans archived · contract rewritten · `admin_alerts` readable · scripts guarded · jobs fail-closed · `/account` resolved

## R1 — Reachability (must-fix before cohort)
- [ ] **R1.1** Deploy intended web commit to Vercel (after CI green); planner still works; dating UI present + gated
- [ ] **R1.2** Apply pending prod migrations (R0.3 policy, `126850`); confirm `match_v2_enabled` OFF; `get_advisors` clean; record fn versions
- [ ] **R1.3** Cohort enablement: unblock reviewed tester UUIDs (NOT global flag flip) OR add `feature_config` cohort targeting; seed ≥1 Kelowna night; confirm non-cohort users see planner-only

### GATE R1 → R2
- [ ] Intended commit live · migrations applied · flag OFF · cohort prepared + matching safe · seed nights present · rollback known

## R2 — Prove one prod traversal (must-fix before cohort)
- [ ] **R2.1** Attended traversal A+B: signup → verified/cohort → post night → feed → interest → offer → accept → lock → reveal → rating window → rating
- [ ] Capture evidence: user IDs, `date_instance` id, swipe/offer/lock/lock_participants/notification/job/rating rows, `audit_log`, log errors, screenshots
- [ ] Write `docs/superpowers/reports/<date>-prod-traversal.md`; triage + file bugs

### GATE R2 → R3
- [ ] Traversal complete with evidence · bugs filed · no silent DB/job/notification failure

## R3 — Unattended cohort safe (before public beta)
- [ ] **R3.1** Minimal PWA (manifest/icons/SW); web-push subscription + `devices` registration; VAPID fanout; email fallback for `offer_received`/`offer_expiring`; permission prompt after onboarding
- [ ] Delivery-failure visibility → `admin_alerts`; error reporting (Sentry/equiv); cohort runbook + ops checklist

### GATE R3 → public beta
- [ ] Offers reach closed-tab users (push/email) · safety alerts reach a human · report/moderation path · delete/export done or scope narrowed · email leak fixed · staging/sandbox decided

## R4 — Date-quality eval v0 (parallel after R0)
- [ ] **R4.1** `packages/date-quality` (types/gates/score/judge/runEval) + tests; 30 Kelowna fixtures (18/8/4); baseline; `scripts/eval-dategen.ts`
- [ ] Gates (incl. truthfulness against **fixture** fact-bank — note prod fact-bank columns don't exist yet); severity-capped gradient; baseline diff + nonzero-on-regression; judge human-calibration plan

## R5 — Re-specced feature work (evidence-first, after R0–R3)
- [ ] S7 chat re-spec · ratings→reliability/standing + enforcement · reports/blocks/disputes + moderation UI · account delete/export/pause · payments framing · analytics relay
