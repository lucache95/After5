# 5b Deploy-Readiness Audit — 2026-05-29

Read-only audit. Nothing applied, deployed, or pushed. Prod ref `ufufmcpnysvwtutpbian`. `match_v2_enabled` is OFF on prod.

---

## 1. Migration drift (local `supabase/migrations/` vs prod `list_migrations`)

### (a) 5 remediation migrations PENDING prod-apply
Prod's P5 chain stops at `20260527127000_p5_c_sql` (recorded version `20260528163836`). These 5 local files are NOT on prod:

| Order | Local file | Purpose |
|---|---|---|
| 1 | `20260527127100_p5_reciprocal_pair_wire.sql` | reciprocal pair wiring (make_offer discriminated return) |
| 2 | `20260527127200_p5_job_rpcs_backfill.sql` | job RPCs backfill (`match_bulk_withdraw`, `close_rating_window`) + `locks.rating_closed_at` |
| 3 | `20260527127300_p5_feature_config_read_policy.sql` | client-read RLS on `feature_config` |
| 4 | `20260527127400_p5_host_pre_offer_disclosure.sql` | host pre-offer Tier-3 disclosure (profiles RLS) |
| 5 | `20260527127500_p5_offer_recipient_date_read.sql` | offer recipient can read offered `date_instance` (RLS) |

Apply strictly in 127100→127500 filename order. **Ordering risk: 127200 must precede process-jobs edge redeploy** — the runner calls `match_bulk_withdraw`/`close_rating_window` and reads `locks.rating_closed_at`; deploying the function before 127200 = poison-loop / failed jobs. 127300 must land before flag-on or the UI's `feature_config` client read 403s.

### (b) Prod-only `20260527126850_p5_cancel_reason_extend` (recorded version `20260528163524`) — NO local file
Applied directly to prod this session (sits between local 126800 and 126900). It extends the `cancel_reason` enum. Local `20260527126900_p5_b_complete.sql` re-adds the same values with `add value if not exists` (idempotent), so a fresh **local reset does NOT diverge functionally** — but the migration-history tables differ: prod has a row local lacks. `supabase db push` will not error (it only pushes missing local versions), but `supabase migration list` will always show this prod-only entry as drift. Recommend backfilling a matching no-op local file `20260527126850_p5_cancel_reason_extend.sql` to reconcile history. Low risk.

### (c) version-vs-filename recording mismatch
Several prod rows have `version` (apply timestamp) != embedded `name` (intended filename), e.g. `version 20260528062253` / `name 20260527124550_s2_notification_type_5b_extend`, and the whole p5 block recorded under `20260528xxxxxx` versions. Cosmetic — `db push` keys off the leading numeric prefix, so the 127100-500 set will still apply. No functional risk; reconciliation is hygiene only.

---

## 2. Edge functions (prod `list_edge_functions` vs local `supabase/functions/`)

Deployed match-* (all `verify_jwt:true`, version 2-3): `match-shortlist`, `match-make-offer`, `match-accept-offer`, `match-pass-offer`, `match-withdraw`, `match-cancel-lock`, `match-resolve-reciprocal`, `match-demand-hint`. Also generate-blur, start-verification, confirm-phone, persona-webhook (v2).

### NEEDS REDEPLOY for 5b correctness
- **`match-make-offer`** — prod deployed `2026-05-28 16:59`. Local `index.ts` was last committed `2026-05-29 11:50` (commit `ab4d087`, discriminated jsonb `{kind:'offer'|'reciprocal'}` return). **Prod is running the OLD bare-uuid version. STALE — must redeploy.** Also depends on migration 127100 being applied first.
- **`process-jobs`** — **NOT deployed to prod at all** (absent from `list_edge_functions`). Local `handlers.ts` (modified `2026-05-29 11:56`) carries the payload-key `'user'` fix (`bulk_withdraw: id(job,'user')`, line 67). Must deploy. The Vercel cron `/api/cron/process-jobs` is a thin proxy that `fetch`es `${SUPABASE_URL}/functions/v1/process-jobs` with `JOBS_RUNNER_SECRET` — **so the cron is currently hitting a non-existent function.** Deploy depends on migration 127200.

`match-resolve-reciprocal` deployed `2026-05-28 17:00`; verify against local after 127100 — likely also needs redeploy since it shares the reciprocal_pairs wiring. Other match-* unchanged since local commit baseline; spot-check, but no known 5b correctness delta.

---

## 3. Secrets / env

### Edge functions read (Deno.env.get):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `JOBS_RUNNER_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID`, `PERSONA_WEBHOOK_SECRET`, `REPLICATE_API_TOKEN`.

### App (Vercel) reads (process.env): incl.
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_PROJECT_REF`, `CRON_SECRET`, `JOBS_RUNNER_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO`, `ADMIN_EMAILS`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_PLACES_API_KEY`, `REPLICATE_API_TOKEN`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_POSTHOG_*`, `CLOUDFLARE_*`, `SUBSCRIBER_TOKEN_SECRET`. Twilio set present in `.env.local.example` (phone-verify path).

### Required-but-likely-unset flags (verify on prod/Vercel — values not inspected):
- **`JOBS_RUNNER_SECRET`** — MUST match between the Vercel app env and the Supabase edge-function secret, or the process-jobs proxy auth fails (502). Not present in any local `.env` key list dump → **likely unset on at least one side. HIGH priority.**
- **`CRON_SECRET`** — gates the Vercel cron route. In `apps/web/.env.local`; confirm set in Vercel prod env.
- **Twilio set** (`TWILIO_*`) — phone verification. Memory notes Twilio is still a known blocker (Step 2). External creds — needs user.
- **Persona set** (`PERSONA_*`) — `persona-webhook` deployed; confirm secrets set on Supabase. External creds — needs user.
- **`RESEND_*`** — email; confirm on Vercel.
- Supabase auto-injects `SUPABASE_URL`/`SERVICE_ROLE_KEY`/`ANON_KEY` into edge functions; `JOBS_RUNNER_SECRET`, `ANTHROPIC_*`, `PERSONA_*`, `REPLICATE_*` must be set explicitly as function secrets.

---

## 4. Vercel

- `.vercel/project.json`: projectId `prj_duxdnFH3jYXWvMXrleupvP8AmPMo`, org `team_A8DpnXlFOSzkCAyXTHcW91i3`, name **`after5`**.
- Config at `apps/web/vercel.json` (Next.js, monorepo build via pnpm filter). Crons: weekly-broadcast (Sun 16:00), post-date-feedback (daily 17:00), **process-jobs (every minute)**.
- **`main` is 68 commits AHEAD of `origin/main`** (`git log origin/main..main`). All of 5b-D/E/F/G/H + the R1/R2 remediations are LOCAL ONLY — NOT pushed, NOT deployed. The currently-live Vercel build predates the entire 5b UI surface.
- Auto-deploy: standard Vercel GitHub integration deploys on push to the production branch (`main`). **Gap: nothing reaches prod until `git push origin main`.** Production domain not in repo config (set in Vercel dashboard) — needs user to confirm.

---

## 5. get_advisors (prod) — findings touching 5b tables/functions

### Security (no new ERRORs on 5b objects)
- Only ERROR is pre-existing `spatial_ref_sys` (PostGIS, public, RLS off) — not 5b.
- **`anon_security_definer_function_executable` (WARN)** on `record_swipe`, `post_night`, `browse_feed_for_viewer`, `match_reveal_allowed` — these SECURITY DEFINER RPCs are EXECUTE-able by `anon`. With `match_v2_enabled` OFF the UI gates them, but **revoke `anon` EXECUTE before flag-on** (matches the secure-by-default memory). The 5b match_* RPCs (make_offer, accept, pass, withdraw, cancel, shortlist, resolve_reciprocal, reveal_allowed/_pair, demand_hint) are `authenticated`-executable (expected) but flagged `authenticated_security_definer_function_executable` — acceptable by design.
- `function_search_path_mutable` (WARN): `match_instance_lock_key`, `match_pair_lock_key`, `offer_expires_at`, `tstzrange_from_start_duration`, plus shared trigger fns — set `search_path` to harden. Low risk.
- `rls_enabled_no_policy` (INFO) on `admin_alerts`, `analytics_events`, `audit_log` — locked-by-default (no policy = deny). Fine; service-role writes only.
- Auth: leaked-password protection disabled (WARN) — toggle in dashboard.

### Performance (all WARN/INFO, none blocking)
- `auth_rls_initplan` (WARN) on `profiles`, `queue_entries`, `offers`, `locks`, `notifications`, `swipes`, `match_ratings`, `date_instances`, `reciprocal_pairs`, `blocks` — policies use `auth.uid()`/`current_setting()` un-wrapped; wrap as `(select auth.uid())` to avoid per-row re-eval. Scale optimization, not launch-blocking at low volume.
- `multiple_permissive_policies` (WARN) on `queue_entries` (many roles), `date_instances`, `profiles` — overlapping SELECT policies; consolidate later.
- `unindexed_foreign_keys` (INFO) on `locks` (3 FKs), `queue_entries` (2), `offers`, `swipes`, `match_ratings`, `date_instances` (2), `profiles`, `blocks` — add covering indexes before meaningful traffic.
- `unused_index` (INFO) on `date_instances_*` indexes — expected (pre-traffic).

---

## GO-LIVE PUNCH LIST (prioritized)

### A. Safe to do behind the OFF flag (no outward user impact)
1. Apply migrations 127100→127500 in order to prod (`db push`). Risk: med (RLS/RPC DDL). Reversible: yes (down-migrate / restore). Needs-user: no.
2. Redeploy edge `match-make-offer` (jsonb return) — AFTER step 1. Risk: low. Reversible: yes (redeploy prior). Needs-user: no.
3. Deploy edge `process-jobs` (currently absent; payload-key fix) — AFTER step 1 (127200). Risk: med (cron starts hitting it). Reversible: yes (delete fn). Needs-user: no.
4. Verify/redeploy `match-resolve-reciprocal` against local post-127100. Risk: low. Reversible: yes. Needs-user: no.
5. Set Supabase edge secret `JOBS_RUNNER_SECRET` = Vercel `JOBS_RUNNER_SECRET` (match exactly). Risk: low. Reversible: yes. Needs-user: maybe (chooses value).
6. Revoke `anon` EXECUTE on `record_swipe`/`post_night`/`browse_feed_for_viewer`/`match_reveal_allowed`. Risk: low. Reversible: yes (re-grant). Needs-user: no.
7. (Hygiene) Backfill local no-op file for prod-only `126850_p5_cancel_reason_extend` to reconcile history. Risk: none. Reversible: yes. Needs-user: no.
8. (Optional pre-traffic) Add covering FK indexes; wrap RLS `auth.uid()` in `(select …)`. Risk: low. Reversible: yes. Needs-user: no.

### B. Outward-facing (needs explicit GO)
9. `git push origin main` (68 commits) → triggers Vercel prod deploy of all 5b UI. Risk: high (first outward exposure; build must pass). Reversible: yes (Vercel rollback). Needs-user: YES — explicit go.
10. Flip `match_v2_enabled` ON in prod `feature_config` — ONLY after 1-6 done + smoke. Risk: high (opens the loop). Reversible: yes (flip off). Needs-user: YES — explicit go.

### Blocked on user / external action
- **Twilio** creds (`TWILIO_*`) on prod — phone verification; known blocker. External.
- **Persona** secrets (`PERSONA_*`) confirmed set on Supabase. External.
- **Resend** (`RESEND_*`), **CRON_SECRET**, **JOBS_RUNNER_SECRET** confirmed set in Vercel prod env. User must verify dashboard.
- **Production domain** confirmation + DNS — Vercel dashboard, not in repo. User.
- Enable Auth leaked-password protection — dashboard toggle. User.
- The push (item 9) and flag-flip (item 10) require explicit user go.
