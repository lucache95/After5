# After5 — R1 Reachability Deploy Runbook

**Goal:** make the dating loop reachable for a small, controlled tester cohort — *without* exposing the public — then hand straight into R2 (one attended production traversal).

**Prepared:** 2026-05-30, against verified prod reality (`docs/CURRENT-PROD-REALITY.md`). Prod ref `ufufmcpnysvwtutpbian`.

> 🔶 **GATED** = irreversible / outward-facing — do it deliberately, you (Lucas) run it. The agent does not run GATED steps autonomously.
> Every step has a **verify** and, where relevant, a **rollback**. Do them in order; don't skip a verify.

---

## Pre-flight (do before anything ships)

- [ ] **CI is green on `main`.** Open a PR or check the `static-checks` job (now also runs the date-quality suite). A red CI means do not deploy.
- [ ] **Confirm the flag is still OFF:** `select key,value from feature_config where key='match_v2_enabled';` → expect `false`.
- [ ] **Decide the cohort's admin:** ensure your email is in Vercel's `ADMIN_EMAILS` (Production). This is what gates `/admin/alerts`. (Already set 39 days ago — confirm it includes the address you'll watch alerts from.)
- [ ] **Snapshot current deploy** for rollback: record the current Vercel production SHA (`d350ab5`) so you can promote-previous if needed.

---

## Step 1 — 🔶 GATED: deploy the web build

This is the big one: pushing `main` triggers Vercel to build & deploy the dating UI (currently 96 commits ahead of what's live).

```bash
git push origin main
```

- **Verify:** Vercel deployment goes READY; deployed `meta.githubCommitSha` == local `main` HEAD. Then smoke it:
  - `/plan` still generates an itinerary (planner intact).
  - `/home` renders the dating-aware home.
  - `/account` shows the new dating-loop nav (no "Your home" split-brain).
  - The loop UI is present but **gated** (flag still OFF → ComingSoon/no matching), which is correct at this point.
- **Rollback:** Vercel dashboard → promote the previous deployment (`d350ab5`).

---

## Step 2 — 🔶 GATED: redeploy the changed edge function

Only `process-jobs` changed this session (R0.2 fail-closed guard); it's **v1** on prod and needs the guard.

```bash
supabase functions deploy process-jobs --project-ref ufufmcpnysvwtutpbian
# (or via the Supabase MCP deploy_edge_function)
```

- **Verify:** `list_edge_functions` shows `process-jobs` bumped to v2; record version→git SHA in `CURRENT-PROD-REALITY.md`. Trigger one cron tick (or wait one minute) and confirm no errors in `get_logs`.
- **Note:** no other edge fns changed. No schema migrations are pending — `126850` was a *local* history backfill (already functionally on prod), and `/admin/alerts` needs **no migration** (it reads via service-role behind `requireAdmin`, live as soon as Step 1 deploys).

---

## Step 3 — 🔶 GATED: secrets (only what the cohort path needs)

| Secret | Where | Needed for | When |
|---|---|---|---|
| **`JOBS_RUNNER_SECRET`** | set IDENTICALLY on **Vercel (web)** AND **Supabase edge** | cron→process-jobs chain | **before cohort** — 🔴 currently MISSING on both |
| `PERSONA_WEBHOOK_SECRET` | Supabase edge secret (currently **blank**) | organic identity verification | **only if testing organic verify** — the attended cohort bypasses it (Step 4), so optional for R2 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` | Vercel | web-push offer delivery | **R3** (unattended) — not needed for an attended R2 |
| `RESEND_API_KEY` | already on Vercel ✅ | offer email (Next route) | already works |
| `CRON_SECRET` | already on Vercel ✅ | Vercel→cron-route auth (Vercel injects it) | already works — **separate from `JOBS_RUNNER_SECRET`** |

- **🔴 The cron chain is currently broken** (verified read-only 2026-05-30): the route `/api/cron/process-jobs` authenticates the incoming Vercel call with `CRON_SECRET` (present), then forwards to the edge fn with `process.env.JOBS_RUNNER_SECRET`; the edge fn checks `Deno.env.get('JOBS_RUNNER_SECRET')`. **`JOBS_RUNNER_SECRET` is set on neither Vercel nor Supabase edge**, so the chain dead-ends (route 500 on missing var, or edge 401). Jobs (offer-expiry, rating-window, etc.) are NOT being processed in prod.
- **Fix:** generate one strong value; set `JOBS_RUNNER_SECRET` = that value on **both** Vercel (Production) and Supabase edge secrets. **Verify:** hit `/api/cron/process-jobs?secret=<CRON_SECRET>&dry_run=true` → 200; then a real (non-dry) hit → `{invoked:true, status:200}` (not 401/500); confirm `process-jobs` edge logs show 200s.

---

## Step 4 — 🔶 GATED: cohort enablement (the careful part)

**Decision — RESOLVED (read-only investigation 2026-05-30):** `match_v2_enabled` is a **hard global gate inside every matching RPC** (`match_shortlist`, `match_make_offer`, `match_accept_offer`, pass/expire/withdraw, `b_complete`, reciprocal, the swipe hook all begin with `if not (match_v2_enabled) then raise P5000`). There is no per-user/cohort column. **Therefore "unblock users without flipping the flag" does NOT work** — a verified, unblocked cohort user still hits P5000 unless the flag is ON globally.

- **Recommended for an attended R2: flip ON → test → flip OFF.** Flipping the global flag is acceptably cohort-safe *right now* because the flag only empowers users who are `verified + dating_enabled + active`, and (a) there are **0 organic verified users** and (b) **organic verification is currently closed** (Persona webhook secret blank → can't complete; Twilio unproven). So with the flag ON, the ONLY users who can act are the UUIDs you manually `cohort-unblock`. Flip it back OFF after the traversal. ⚠️ This containment relies on verification staying closed — do NOT leave the flag ON while also fixing Persona/Twilio.
  ```sql
  -- flip ON for the test window (deliberate, prod)
  update feature_config set value='true'::jsonb where key='match_v2_enabled';
  -- … run R2 traversal …
  update feature_config set value='false'::jsonb where key='match_v2_enabled';  -- flip back OFF
  ```
- **For a sustained / unattended cohort: add a cohort allowlist** (a code change to the flag check — e.g. an `allowed_user_ids` set or a per-user `dating_cohort` column checked alongside `match_v2_enabled`) so ON doesn't expose every future verified user. Don't run an unattended public cohort on the bare global flip.

**Then unblock the reviewed testers** (deliberate prod write — note the new `-v target` guard):

```bash
# Review the UUIDs FIRST. Edit the cohort_input CTE in the script with real tester ids.
psql "$PROD_URL" -v target=prod -v city_slug=kelowna -f scripts/cohort-unblock.sql
psql "$PROD_URL" -v target=prod -f scripts/seed-cohort-nights.sql
```

- **Verify:** the cohort UUIDs show `dating_enabled=true, verification='verified', account_state='active'`; `browse_feed_for_viewer` returns seeded nights for them; a **non-cohort** account sees the planner-only experience (no loop).
- **Rollback:** re-block the cohort UUIDs (set `dating_enabled=false`); un-seed the test nights.

---

## Step 5 — Verify the chain, then hand to R2

- [ ] Cron → `process-jobs` runs clean (no `job_missing_rpc` alerts unless expected); check `/admin/alerts`.
- [ ] A cohort user can reach `/feed`, see a seeded night, and the offer UI is live.
- [ ] `match_v2_enabled` is in the state your Path A/B decision requires — and the public is NOT exposed.

→ Proceed to **R2 (attended production traversal)**: two real accounts run signup→post-night→browse→offer→accept→lock→reveal→rate, capturing row-level evidence into `docs/superpowers/reports/<date>-prod-traversal.md`.

---

## Quick reference — what's already done (no action needed)

- Web build is committed on `main` (R0–R4 + R3-offline). Just needs Step 1's push.
- `/admin/alerts` reader: live on web deploy (service-role + `ADMIN_EMAILS`), no migration.
- `process-jobs` fail-closed guard: committed; needs Step 2 redeploy.
- Prod-dangerous scripts: now require `-v target` (bare run aborts).
- Offer email: Next route built, uses the Resend key already on Vercel.
- Eval harness: offline, no prod involvement.

## The outward-facing gate (unchanged)
Nothing in R1 happens autonomously. Steps 1–4 are yours to run. The agent can *prepare* (write SQL, draft secret-set commands, pre-verify locally) but will not push, deploy, set prod secrets, flip the flag, or write to prod.
