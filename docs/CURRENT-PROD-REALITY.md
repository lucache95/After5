# After5 — Current Production Reality

**Snapshot date:** 2026-05-30 · **Prod ref:** `ufufmcpnysvwtutpbian` · **Authority:** verified live this session (commands in `docs/after5-current-implementation-plan.md` §4).

> One file that answers "what is actually live?" so no one re-investigates. Every row was confirmed against the running prod project, the git repo, Vercel, and the local stack on 2026-05-30. Re-confirm before acting on anything safety- or money-adjacent.

---

## 1. Deployment truth

| What | Value | Note |
|---|---|---|
| Vercel production commit | `d350ab5` (= `origin/main` `d350ab58`) | Serves **pre-5b** code. Dating UI / Barbiecore rebrand / reveal-hardening are **NOT live**. |
| `origin/main` | `d350ab58` | What Vercel builds from. |
| local `main` HEAD | `2107c821` | **78 commits ahead** of `origin/main`, unpushed. |
| active work branch | `r0.1-ci-green-gates` | R0 re-baseline work; ahead of `main`, unpushed, not deployed. |
| Vercel project | `prj_duxdnFH3jYXWvMXrleupvP8AmPMo` (team `after5`) | Deploys from `origin/main` on push. |

**Implication:** the live product is the planner. The entire dating UI tier exists only in local `main` + this branch. Deploying it is **R1.1** (gated on CI green, which R0.1 just delivered).

## 2. Prod data (the loop has never run)

| Metric | Value (2026-05-30) |
|---|---|
| Verified users (`profiles.verification='verified'`) | **0** (confirmed live) |
| `date_instances` | ~0 (reality audit; re-confirm `select count(*) from date_instances`) |
| Swipes / offers / locks / ratings | 0 (reality audit) |

The matching loop has been proven only by **one local E2E**, never in production by a human. Proving it once attended is **R2**.

## 3. Feature flags (`feature_config`)

| key | value | updated_at |
|---|---|---|
| `match_v2_enabled` | **`false`** | 2026-05-28 21:04 UTC |
| `offer_window_hours` | `24` | 2026-05-27 05:28 |

`match_v2_enabled` is **global** — no cohort/user/city targeting column. Flipping it ON exposes every user. Cohort enablement (R1.3) must unblock *users* (verification bypass for reviewed UUIDs) rather than flip the global flag, OR add targeting first.

## 4. Migrations

- Prod history runs through `p5_reveal_hardening` (prod version `20260530160224`). The 5b remediation set `127100`–`127700` + reveal-hardening are all applied.
- **Version-key drift (documented, accepted):** prod `schema_migrations.version` = the *apply* timestamp (e.g. `20260529234051`); `name` = the original logical filename (e.g. `20260527127100_p5_reciprocal_pair_wire`). `supabase migration list` will show mismatched version columns vs local filenames. This is cosmetic — do **not** "fix" it with naive `db push`/`repair` without care.
- **`126850_p5_cancel_reason_extend`**: was prod-only; now **backfilled locally** (this branch) as an idempotent no-op so `db reset` reproduces prod ordering. Local + prod `cancel_reason` enums are functionally identical: `schedule_conflict, venue_issue, changed_mind, account_closed, safety, misconduct, other, mutual, no_show, creator_pre_lock`.
- **`temp_race`**: leftover table still on prod. Cleanup deferred (drop-after-verify) — not load-bearing.

## 5. Edge functions (16 ACTIVE)

All deployed; **entrypoints are laptop/CLI paths (`file:///Users/lucas/...` or `file:///tmp/user_fn_...`) — out-of-band from git, no version→SHA map.** Treat deployed code as *possibly* ahead/behind repo until a CI deploy + SHA map exists (R1.2 / R5).

| slug | version | verify_jwt | slug | version | verify_jwt |
|---|---|---|---|---|---|
| generate-plan | 39 | false | match-cancel-lock | 2 | true |
| classify-photos | 5 | false | match-resolve-reciprocal | 3 | true |
| generate-cover | 6 | false | match-demand-hint | 2 | true |
| match-shortlist | 3 | true | generate-blur | 2 | true |
| match-make-offer | 3 | true | start-verification | 2 | true |
| match-accept-offer | 2 | true | confirm-phone | 2 | true |
| match-pass-offer | 2 | true | persona-webhook | 2 | false |
| match-withdraw | 2 | true | process-jobs | 2 | false |

`process-jobs` is **v2 on prod** (redeployed 2026-05-30, SHA `68777b8d`) — the R0.2 fail-closed guard is **live** (health-checked: 401 on no/bad `x-jobs-secret`). All other edge fns unchanged.

## 6. Secrets (the operational gaps)

**Supabase edge-function secrets** (`supabase secrets list`):

| Secret | State |
|---|---|
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | set |
| `PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID` | set |
| **`PERSONA_WEBHOOK_SECRET`** | **BLANK** (digest = SHA-256 of empty string) |
| **`RESEND_API_KEY`** | **BLANK** |
| `RESEND_FROM_ADDRESS`, `REPLICATE_API_TOKEN`, all `SUPABASE_*` | set |
| `TWILIO_*`, `JOBS_RUNNER_SECRET`, `CRON_SECRET` | **not present** in edge secrets |

**Vercel project env** (web app):

| Secret | State |
|---|---|
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO` | set (Production) |
| `CRON_SECRET` | set (Production) |
| `ADMIN_EMAILS` | set (Production + Development) |
| `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_*`, `REPLICATE_API_TOKEN`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `SUBSCRIBER_TOKEN_SECRET` | set |

**Implications:**
- ✅ **Email from the web app works** — `RESEND_API_KEY` is on Vercel; `apps/web/lib/email/resend.ts` reads `process.env.RESEND_API_KEY`. R3's offer-email should be a Next route/server action (which has the key), not an edge function.
- ⚠️ **Email from an edge function would silently skip** — edge `RESEND_API_KEY` is blank. Don't build email delivery in an edge fn without setting it.
- 🔴 **Identity verification is broken on prod right now** — `persona-webhook` fails closed when `PERSONA_WEBHOOK_SECRET` is absent, and it's blank. Persona inquiries can't be confirmed → no organic `verified` users. **R1 blocker.** (R2 sidesteps this via cohort-unblock; organic verification needs the secret set + a controlled test.)
- `CRON_SECRET` lives on Vercel (the cron caller); the edge-side check expects `JOBS_RUNNER_SECRET` via `x-jobs-secret`. **Verify these match** before relying on the cron→process-jobs chain (R1.2 / R3).
- Twilio (phone OTP) is configured in the **Supabase Auth dashboard**, not edge secrets — verify there; unproven on prod.

## 7. Routes & ownership

- `/home` — dating-aware FirstSessionHome. **Canonical post-login home. Keep.**
- `/account` — legacy planner/account dashboard; split-brain dead-end risk. **R0.8 (pending product decision).**
- Planner/SEO surfaces — `/plan`, `/plan/i/[id]`, `/places`, `/vibes`, `/types`, `/neighborhoods`, `/templates/[id]`, `/wow/[id]`, `/vote/[id]`. **Keep** (wedge + SEO).
- `/admin/dates/[id]` (existing) + `/admin/alerts` (added this branch, R0.3) — gated by `requireAdmin` (ADMIN_EMAILS allowlist, fail-closed).
- `/admin/eval`, `/api/admin/eval`, `/api/votes`, `/api/vote-sessions` exist — classify in R0.7 (likely keep planner-vote, verify admin/eval is gated or dead).

## 8. What this branch (`r0.1-ci-green-gates`) changed (not yet deployed)

- CI: PhotoStep tests fixed; `static-checks` job (lint/typecheck/build/unit) added.
- `process-jobs`: fail-closed on missing/errored RPC + `job_missing_rpc` admin alert (local; redeploy pending).
- `/admin/alerts` reader (service-role behind `requireAdmin`).
- `126850` backfilled locally; prod-dangerous scripts now require `-v target`.
- Plan docs: `after5-current-implementation-plan.md` (+ checklist), this file.

**Nothing on this branch is pushed or deployed.** Web deploy = R1.1; edge redeploy = R1.2 — both after `main` is updated and CI is green.
