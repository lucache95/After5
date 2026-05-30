# Infra Audit — §6 Observability, §7 CI/Verification, §10 Mobile-Web Readiness

Date: 2026-05-30. READ-ONLY. Repo: `/Users/lucas/Projects/After5`. Authority: repo reality.

---

## §6 Observability — can we debug PROD? VERDICT: RED

**Logs.** Supabase logs (`mcp__supabase__get_logs`) and Vercel runtime/build logs (`mcp__vercel__*`) are reachable via MCP. Both are short-retention platform logs (Supabase ~1h/1day depending on plan; Vercel runtime logs are ephemeral on non-Pro and short on Pro). No log shipping/aggregation, no retention beyond the platform default. Adequate for live tail, useless for post-hoc incident forensics.

**`audit_log`** (`supabase/migrations/20260525121100_p0_audit_log.sql`). Table exists; written by triggers/SQL across P5 migrations. It is a write path with no read surface in the app — no admin page, no query in `apps/web`. Forensic value only if someone opens a SQL console.

**`admin_alerts`** (`supabase/migrations/20260525123700_p2_admin_alerts.sql`). Written by `raise_admin_alert(kind, payload)` (execute revoked from public/authenticated — DEFINER only) and inline in P5 migrations (`p5_b_complete.sql:220`, `p5_c_sql.sql:68/85`). **NOBODY READS IT.** Grep found zero SELECTs, zero RLS read policy, and no `app/admin/*` page for alerts (admin pages cover insiders/feedback/venues/eval/dates only). The fail-loud ops email (`defaultSendOpsEmail` in `supabase/functions/_shared/notify.ts`) hard-returns `{ ok:false, error:'ops_email_not_wired' }`. **So every safety alert lands in a table with no UI, no notification, no email. This is the biggest observability hole: safety/abuse events fail silently into `admin_alerts`.**

**Error reporting.** No Sentry/equivalent configured. `sentry` strings appear only inside `apps/web/.next/**` build chunks (transitive vendor code), not in source/config. App + edge-function exceptions are invisible beyond platform logs.

**Notification delivery visibility.** `notifications.delivery_error`/`delivered` columns exist (`p2_notifications.sql`). `dispatchNotification` records channel/outcome, but the two real fallback senders are stubs returning `ok:false`: `defaultSendEmail` → `'email_not_wired'`, `defaultSendWebPush` → `'web_push_not_configured'`. Expo push is real. So non-push deliveries fail; failures are logged to the row but, again, nothing surfaces them.

**Moderation/reports.** No moderation/report admin UI or query found.

**analytics_events / analytics_relay: DORMANT.** `process-jobs/handlers.ts:71` dispatches an `analytics_relay` job to RPC `analytics_relay_drain` — but no such function is defined in migrations and no code enqueues an `analytics_relay` job. Events accumulate (if written at all) and are never drained.

**Fails INVISIBLY (no log + no alert + no human surface):** (1) safety `admin_alerts` rows; (2) ops-email sink (`ok:false` silently); (3) email + web-push delivery failures; (4) `audit_log` (write-only); (5) analytics never drained.

---

## §7 CI / Verification — VERDICT: RED (suite is failing) / partially subagent-suitable

Only one workflow: `.github/workflows/5b-tests.yml`. On push/PR to `main`, a paths-filter gate then one `e2e` job: `supabase start` → export env → background `functions serve` (polls match-shortlist until ≠503) → `playwright install chromium` → **`bash supabase/tests/_all_5b.sh`**.

`_all_5b.sh` runs: db reset → SQL suite (`*.sql`, ON_ERROR_STOP) → race harnesses → scoped Deno tests (`match-*` + `_shared` only; non-5b functions have pre-existing TS errors) → **`pnpm --filter @after5/web test` (full vitest)** → functions-serve → Playwright E2E. `set -euo pipefail`, so any step fails the run.

**Currently RED.** Web vitest run here: **3 failed / 220 passed (1 file failed of 52)**, failures in `apps/web/app/onboarding/steps/__tests__/PhotoStep.test.tsx` (role=`alert` not found after Next click). Vitest exits 1 → step 5 of `_all_5b.sh` fails → **CI is red on any code-touching PR.** The PhotoStep failures DO fail CI.

**Coverage gaps:** root `package.json` has `lint`, `typecheck`, `build` scripts, but **CI runs none of them.** `next build` (prod build) is never executed in CI — prod-build breakage ships undetected.

**Determinism / subagent suitability:** SQL/Deno/vitest steps are hermetic-ish and single-command. The full pipeline needs manual setup (`supabase start`, background `functions serve` readiness poll, Playwright browser install, env via `supabase status -o env`) — not a clean one-shot for a subagent; the functions-serve poll and E2E are the flaky/heavy parts. Subagent-runnable in isolation: `pnpm --filter @after5/web test` and `pnpm db:test`. NOT subagent-friendly: E2E (`_all_5b.sh` end-to-end).

---

## §10 Mobile-Web Readiness — VERDICT: YELLOW session, RED offers/PWA

**SSR session (mobile Safari refresh/resume): OK.** `apps/web/middleware.ts` uses `@supabase/ssr` `createServerClient` with correct `getAll`/`setAll` that rebuild the response and write rotated cookies back. Refreshes session every request; `getUser()` forces validation. Survives refresh/resume. Plus www→apex 301 (keeps PKCE verifier on one origin) and a `?code=` rescue redirect to `/auth/callback`. PKCE magic-link handling looks sound.

**Push/email fallback for the time-boxed offer: RED — confirmed gap.** Offer notifications flow through `dispatchNotification` (`process-jobs/handlers.ts`). Real channel = Expo push (native, not deployed). `defaultSendWebPush` and `defaultSendEmail` are stubs returning `ok:false`. So on mobile web with no open tab, a `offer_expiring`/`offer_received` reaches the user via **nothing**: in-app notifications are Realtime-only (open tab required), there is **no web-push, no email delivery, no SW**. A time-boxed offer can expire fully unseen.

**`devices` table: written by NOTHING.** It is the token source for `dispatch_notification` (`p2_dispatch_notification.sql:88` selects `expo_push_token`/`web_push_sub` from `devices`), but no code (web or edge) inserts/registers a device. So even push has no tokens to send to.

**PWA/installability: ABSENT (confirmed).** No `manifest.json`/`.webmanifest`, no `<link rel=manifest>`, no service worker anywhere under `apps/web` (source). Not installable; no background/offline capability; web-push is impossible without a SW anyway.

**Slow-network: not audited in depth** (out of scope budget); no SW retry/offline layer exists.

---

## Bottom line
- **Biggest invisible-prod failure:** safety events → `admin_alerts` with zero readers + ops-email sink returning `ok:false`. **Safety/abuse alerts reach NO human.**
- **CI:** RED today (3 PhotoStep tests fail the pipeline). No lint/typecheck/`next build` in CI. Only partially subagent-suitable.
- **Mobile-web blockers:** no web-push, no SW/PWA, no email fallback, and `devices` is never populated → time-boxed offers can be missed entirely. SSR session handling itself is correct.
