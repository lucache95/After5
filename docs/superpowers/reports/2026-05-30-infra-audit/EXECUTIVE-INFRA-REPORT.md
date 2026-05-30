# After5 — Infrastructure Reality Report (2026-05-30)

Read-only infra audit, repo reality is authority, strict/adversarial (assume failed webhooks, stale env, expired secrets, duplicate events, future agents). Synthesized from 4 sub-reports in this folder: `env-secrets-deploy.md`, `db-data-privacy.md`, `edge-jobs-webhooks.md`, `observability-ci-mobileweb.md`.

## Headline
The **data plane is well-built; the operational envelope is not.** RLS, SECURITY DEFINER hardening, grants, and webhook authentication are genuinely solid (the things that usually leak — don't). But **environments, deployment, observability, notification delivery, and CI** are not safe to run real users against: safety alerts reach no human, time-boxed offers can expire unseen, there is no staging tier, "local" mutates prod, deploys are laptop-driven and unpushed, and CI is red on every PR.

---

## §11 — Gap classification

### 🔴 BLOCKS WEB MVP (must fix to deliver the intended experience)
- **Offer notifications don't deliver.** Web-push, email, and the ops-alert sink are all `*_not_wired` stubs; the only real channel is Expo push (native, undeployed) and the `devices` token table is **written by nothing**. A closed-tab user gets nothing for a 23-hour offer → the core urgency mechanic is undeliverable on web.
- **No PWA / service worker** (no manifest, not installable, no background delivery).
- **Safety/abuse is invisible.** `admin_alerts` has **zero readers** (no UI, no query, no RLS select policy) and the ops-email sink returns `ok:false` — safety events page no one.

### 🔴 BLOCKS TESTER COHORT
- **Web app is unpushed** — `main` is ~78 commits ahead of `origin`; Vercel serves pre-5b code. The cohort would test an old build.
- **CI is red on every PR** (3 PhotoStep failures fail vitest → `set -e` fails the workflow) — no green baseline to gate on.
- **No safety visibility** during the cohort (admin_alerts blind).
- **Notification delivery** (above) — can't run an unattended cohort on the offer mechanic.

### 🔴 BLOCKS PUBLIC LAUNCH
- **No staging tier** — local + prod only; every change validated against prod or nothing.
- **No sandbox/live provider split** — local dev hits LIVE Persona/Twilio/Resend (real SMS, real spend, real verifications).
- **GDPR/deletion absent** — zero delete/export/purge functions; no data-subject path.
- **Email PII leak (Y3)** — `profiles.email` is readable by a revealed counterpart (other PII is correctly owner-locked on `profiles_private`).
- **Silent-complete dormant jobs** — handlers don't inspect the RPC error, and supabase-js resolves (not throws) on `function-not-found`, so a future `deletion_process`/`chat_purge` job would mark itself `done` having done nothing. Dangerous exactly when GDPR/chat ship.
- **No error reporting** (no Sentry); **no CI lint/typecheck/`next build`** gate (prod-build breakage ships undetected); **no secret rotation/revocation** documented.
- **Prod-dangerous seed scripts** — `cohort-unblock.sql`, `seed-cohort-nights.sql`, `qa-feed-seed.sql` bypass verification / write `auth.users` with **no host/env guard** against a stray `psql <PROD_URL>`.

### 🟢 SAFE TO DEFER
- pg_cron-not-installed (Vercel cron is an acceptable interim scheduler) — but it's a single point of failure to monitor.
- Migration version-string drift (cosmetic), `temp_race` leftover table cleanup.
- Cron `?secret=` query-param fallback (move to header), in-memory rate-limit hardening, webhook timestamp staleness/dedup ledger.

---

## §12 — Scores (0–10, strict)

| Dimension | Score | Note |
|---|---|---|
| Local reproducibility | **3** | `db reset` diverges from prod (prod-only 126850 + version drift + temp_race); `.env.local` points at PROD; no staging. |
| Deployment safety | **3** | 78 unpushed commits, laptop edge-fn deploys (`file:///Users/...` entrypoints), hand-run MCP applies on live prod, no staging gate. Runbook (rollback SQL + verify gates) is the bright spot. |
| Database safety | **6** | RLS/DEFINER/grants clean + strong runbook; dragged by reset-divergence + drift. |
| Secret hygiene | **6** | **Nothing committed** (clean); but env-file drift, out-of-band secrets, no rotation doc, no sandbox split. |
| Webhook safety | **8** | persona-webhook HMAC + fail-closed; process-jobs secret-gated; match-* JWT/p_actor bound. Minor replay/dedup gaps. |
| Async/job reliability | **4** | Real dead-letter (backoff, terminal at 5); but silent-complete dormant jobs, no real delivery, no event-dedup ledger, Vercel-cron SPOF. |
| Observability | **2** | admin_alerts/safety reach no human; no error reporting; email/push failures invisible; audit_log write-only. |
| Security / privacy | **5** | PII mostly owner-locked + RLS solid + security-pass no-RED; dragged by email leak + GDPR-absent + prod-dangerous seeds. |
| CI reliability | **3** | Red on every PR; no lint/typecheck/`next build` gate; E2E needs heavy manual setup. |
| Production readiness | **3** | Sum of the above. |

## INFRASTRUCTURE VERDICT: 🔴 RED

Not safe to operate for real users yet. The foundation (schema, RLS, auth, webhook verification) is sound — this is recoverable, not rotten — but the operating layer has three hard blockers even for a *tester cohort*: **(1) you can't see safety alerts, (2) offers can expire unseen, (3) the live build isn't deployed and CI is red.** Fix those three before anyone touches the app; fix staging/sandbox/GDPR/rotation/error-reporting before public.

### The order that turns it YELLOW (cohort-safe), cheapest first
1. **Make CI green + add a prod-build/typecheck gate** (fix the 3 PhotoStep tests; add `next build`, `typecheck`, `lint` to `5b-tests.yml`).
2. **Give `admin_alerts` a reader** (a minimal admin query/page + RLS select for admins) so safety events are visible during the cohort.
3. **Close the offer-delivery gap** — minimal PWA (manifest+SW) + web-push **with email fallback**; or, for an attended cohort, an email-on-offer.
4. **Push `main`→Vercel** so the cohort tests the real build (after CI is green).
5. **Guard the prod-dangerous seeds** (host/env assertion at the top of each).
Then for public: staging tier, sandbox/live provider split, GDPR delete/export, the Y3 email move to private, dormant-job error-check, secret-rotation doc, error reporting.
