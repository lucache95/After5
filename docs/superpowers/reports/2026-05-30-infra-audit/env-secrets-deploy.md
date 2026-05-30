# Infra Audit — §1 Environments, §2 Secrets, §8 Deployment Safety
Date: 2026-05-30 · Scope: READ-ONLY · Repo: /Users/lucas/Projects/After5 · Prod ref: ufufmcpnysvwtutpbian

Verdicts: §1 Environments **RED** · §2 Secrets **YELLOW** · §8 Deployment Safety **RED**

---

## §1 Environments — RED

### Tiers that actually exist
- **local** (`http://127.0.0.1:54321`) — only referenced by `.env.development.local`.
- **production** — Supabase ref `ufufmcpnysvwtutpbian`.
- **NO staging Supabase project.** `mcp__supabase__list_branches` errors ("Project reference is missing") = no preview/persistent branches exist. There is local + prod only.
- **NO Vercel preview/staging tier configured in repo.** `.vercel/project.json` = single project `after5` (prj_duxdnFH3jYXWvMXrleupvP8AmPMo, team_A8DpnXlFOSzkCAyXTHcW91i3). `vercel.json` defines framework + 3 crons but no per-target env separation. Branch→target mapping is whatever the Vercel dashboard says (not in repo).

### Env files on disk (all gitignored — see §2)
| File | Points at |
|---|---|
| `.env.local` | **PROD** (`https://ufufmcpnysvwtutpbian.supabase.co`) — confirmed |
| `apps/web/.env.local` | **PROD** (largest file: Cloudflare, Gemini, Replicate, CRON_SECRET, SUBSCRIBER_TOKEN_SECRET, ADMIN_EMAILS, Mapbox, Google Places) |
| `.env.development.local` | **local** `127.0.0.1:54321` (the only true-local file) |
| `.env.prod.local` | `PROD_DB_PASSWORD` only |
| `.env.local.example` | template (PROD url placeholder) |

### Dangerous env assumptions (flag these for future agents)
1. **`.env.local` and `apps/web/.env.local` point at PROD.** Anything reading `.env.local` (the Next.js default-loaded file) operates against the live DB with a `SUPABASE_SECRET_KEY` (service_role). Convention "local = safe" is FALSE here. The genuinely-local file is the oddly-named `.env.development.local`.
2. **Two parallel naming schemes** coexist: client-style (`NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SECRET_KEY`) in `.env.local`, vs edge-style (`SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY`) in `.env.development.local`. A future agent can easily edit the wrong one.
3. **No sandbox/live provider separation.** `.env.local.example` lists `TWILIO_TEST_ACCOUNT_SID/_AUTH_TOKEN`, but **no code references `TWILIO_TEST_*` or any "sandbox" path** (grep clean). Persona, Resend, Replicate, Gemini, Cloudflare, Google Places are all single-key — local/dev runs hit LIVE providers (real SMS, real verification, real spend).

### Feature flags — global-flip risk
`feature_config(key text primary key, value jsonb)` (migration `20260525123800_p2_feature_config.sql`). **No `user_id`/cohort column — flags are 100% global.** `match_v2_enabled` row inserted `false` on prod (per runbook Task 10). Flipping `match_v2_enabled=true` is a single-row UPDATE affecting **all users at once**; the runbook calls it "per cohort" but the schema has no cohort mechanism. RLS: service-role + admin write only, no anon/authenticated. Reads via SECURITY DEFINER RPCs.

---

## §2 Secrets — YELLOW

### NO committed secrets (GREEN sub-finding)
- `git ls-files | grep env` → only `.env.local.example` (placeholders) + `apps/web/next-env.d.ts` (TS shim). No real keys.
- `git check-ignore` confirms `.env.local`, `.env.development.local`, `.env.prod.local`, `apps/web/.env.local` are ALL ignored.
- `git log --all --diff-filter=A` for env files → no history of any real env file ever being committed.
- **No secret VALUE is committed to git.**

### Inventory (names + state; values NOT printed)
| Secret | Used where | Local set | Prod-needed |
|---|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | web, edge | yes | yes (Vercel + Supabase auto) |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | web | yes | yes |
| SUPABASE_SECRET_KEY (service_role) | web server | yes (`.env.local` → PROD) | yes |
| SUPABASE_SERVICE_ROLE_KEY / ANON_KEY / URL | edge fns (`_shared`) | yes | Supabase-injected |
| SUPABASE_PUBLISHABLE_KEY | edge fns | (Supabase) | auto |
| ANTHROPIC_API_KEY + ANTHROPIC_MODEL | edge `_shared`, web | yes | edge secret reqd |
| PERSONA_API_KEY / _TEMPLATE_ID / _WEBHOOK_SECRET | edge `start-verification`, `persona-webhook` | API+template set; **PERSONA_WEBHOOK_SECRET UNSET in `.env.local`** | webhook secret MUST be set on prod or webhook is unverified |
| TWILIO_ACCOUNT_SID / _AUTH_TOKEN / _MESSAGE_SERVICE_SID / _PHONE_NUMBER | confirm-phone path | yes | yes |
| TWILIO_API_KEY_SID/_SECRET, TWILIO_TEST_* | declared, **unused in code** | unset | n/a |
| REPLICATE_API_TOKEN | edge `generate-blur/cover` | apps/web only | edge secret reqd |
| JOBS_RUNNER_SECRET | edge `process-jobs`, web cron | (apps/web) | edge + Vercel must match |
| CRON_SECRET | web `/api/cron/*` | apps/web yes | Vercel (auto for Vercel cron) |
| SUBSCRIBER_TOKEN_SECRET | web | apps/web yes | Vercel |
| RESEND_API_KEY / _FROM_EMAIL / _REPLY_TO | web email | **RESEND_API_KEY UNSET in `.env.local`** (set in apps/web) | Vercel |
| GEMINI_API_KEY, GOOGLE_PLACES_API_KEY, NEXT_PUBLIC_MAPBOX_TOKEN, CLOUDFLARE_* (4), ADMIN_EMAILS | web | apps/web yes | Vercel |
| NEXT_PUBLIC_POSTHOG_KEY/_HOST | web | host only, KEY unset | optional |

### Findings
- **No missing-on-prod secret could be definitively confirmed** without dashboard read (out of scope), but the duplicated/diverging local files (`.env.local` missing RESEND_API_KEY & PERSONA_WEBHOOK_SECRET that `apps/web/.env.local` has) are a strong signal of **drift** and make "is it set on prod?" unanswerable from repo alone.
- **No rotation/revocation procedure documented anywhere** (grep of plans/reports found none). The memory note "watch for leaked/expired secrets" has no backing runbook.
- Edge-function secrets (ANTHROPIC, PERSONA_*, REPLICATE, JOBS_RUNNER_SECRET) are set out-of-band via `supabase secrets set` — not in repo, not auditable here. Treat as **unverified on prod**.

---

## §8 Deployment Safety — RED

### How things reach prod
- **Web:** git push → Vercel auto-build (`pnpm --filter @after5/web build`). BUT `main` is **78 commits ahead of origin/main** (unpushed). The live Vercel deploy reflects an OLD commit; ~78 commits of work (incl. reveal hardening 2107c82, rebrand) are NOT deployed.
- **Migrations:** hand-applied via MCP `apply_migration` / `supabase db push` following `docs/superpowers/plans/5b-prod-migration-rollout.md` (55KB runbook). Each task has explicit **Rollback SQL** (good) and a "verification must run GREEN or rollback+STOP" gate (good).
- **Edge functions:** all 16 ACTIVE on prod, deployed via local `supabase functions deploy`. Several `entrypoint_path` are literal `file:///Users/lucas/Projects/After5/...` → deployed straight from a **developer laptop, out-of-band from git/CI**. No way to verify deployed code == repo `HEAD`.

### Unsafe manual steps
1. **78-commit-ahead unpushed `main`** — prod web is stale; a `git push` would deploy 78 commits' worth of untested-in-prod changes at once (no staging gate).
2. **Edge functions deployed from laptop**, not CI — drift between repo and prod is undetectable; future agent can't trust `supabase/functions/**` matches prod.
3. **Hand-run MCP `apply_migration`** against live prod — no preview/branch dry-run (no staging tier exists).
4. **Enum-add migration is one-way** (runbook line 187: Postgres can't drop enum values; rollback = leave them).
5. **`match_v2_enabled` flip is a global single-row UPDATE** — no cohort gating despite "per cohort" wording.
6. **process-jobs / prune_idempotency**: pg_cron NOT enabled on prod (runbook); pruning relies on Vercel cron `* * * * *` hitting `/api/cron/process-jobs` guarded by JOBS_RUNNER_SECRET/CRON_SECRET — if those drift between Vercel and edge, the job chain silently breaks.

### Pre-prod gate
- **There is NO staging tier and NO automated pre-prod gate.** The only gate is the manual "verification SQL GREEN" step inside the migration runbook, executed by hand against prod itself. Rollback exists per-migration (SQL captured), but is manual.

---

## Bottom line
- Committed secrets: **NONE** (good — all env files gitignored, no real keys tracked or in history).
- Staging tier: **does not exist** (local + prod only; no Supabase branches, no Vercel preview env in repo).
- Most dangerous env assumption: **`.env.local`/`apps/web/.env.local` point at PROD with service_role** — "local" is a misnomer; local dev mutates production and hits live providers (no sandbox).
- Most dangerous deploy facts: **78 unpushed commits on `main`** (stale prod web) + **edge functions deployed from a laptop out-of-band from git** + **no pre-prod gate**.
- Likely missing/unverifiable on prod: PERSONA_WEBHOOK_SECRET and RESEND_API_KEY are unset/divergent across local env files; edge secrets unauditable from repo. No rotation procedure documented.
