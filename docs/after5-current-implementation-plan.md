# After5 — Current Implementation Plan

> **For agentic workers:** Phases R0–R5 below are sequenced. R0 slices are bite-sized and TDD-shaped; R1–R5 slices are scoped roadmap units that get their own detailed plan when their phase begins. REQUIRED SUB-SKILL when executing a coded slice: `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get one real tester pair through `signup → verified → post night → browse → offer → lock → reveal → rate` in production — safely, observably, once — then build forward from evidence.

**Status:** Active baseline. Supersedes `docs/superpowers/reports/2026-05-30-CONSOLIDATED-SUMMARY.md` as the forward plan. Replaces stale `p6–p11` plans (which are archived, not executed).

**Date:** 2026-05-30 · **Prod ref:** `ufufmcpnysvwtutpbian`

**Authority order (when facts conflict):** prod behavior → repo implementation → migrations/types/edge-fns/routes/tests → recent audits → old plans/docs. **Implementation reality beats stale plans. Prod beats local. Tests are evidence, not proof of user value.**

---

## 1. Executive Summary

**What After5 is today:** a live, working date-itinerary *planner* for Kelowna with a near-complete *dating marketplace* bolted on behind an off switch. The planner is real and earns its keep. The dating loop is built end-to-end at the schema/RPC/edge/UI level, passed a *local* E2E, and has never been touched by a real user in production.

**What works (for real):** `/plan → generate-plan → itineraries → /plan/i/[id]`. Deterministic place selection + LLM-writes-the-copy (the LLM never picks venues — that's a genuine architectural win). The planner→dating bridge via `post_night` is the correct seam.

**What only appears to work:** the matching loop ("done" = deployed + locally green, not prod-proven); the web app ("shipped" = local `main` is ~78 commits ahead of what Vercel serves); ratings (a form that inserts a row with zero downstream consequence); notifications (rows insert, but a closed-tab user is unreachable — web-push/email/ops-email are all stubs); chat (`chat_lock_ready` returns `true`, the UI is a "coming soon" placeholder).

**What's dangerous:** `.env.local` points at **prod** with service-role reach; six dormant job handlers can mark themselves `done` while doing nothing (supabase-js `.rpc()` resolves an error object instead of throwing); prod-dangerous seed/cohort scripts have no host guard; `admin_alerts` and `audit_log` are write-only — safety events reach no human; `profiles.email` leaks to a revealed match.

**What blocks a tester cohort (must fix first):** CI is red and ungated; the live build is stale and unpushed; you can't see safety alerts; offers can expire unseen; prod-dangerous scripts are unguarded.

**What blocks public launch (later, real):** no staging tier; no sandbox/live provider split; no GDPR delete/export; the email PII leak; no error reporting; no moderation surface.

**Where the next 4–8 weeks go:** **R0** make reality trustworthy (1 week) → **R1** make the loop reachable for a cohort (3–5 days) → **R2** prove it once in prod, attended (1–2 days + fixes) → **R3** make unattended cohort safe with push/email + admin visibility (1–2 weeks) → **R4** date-quality eval harness, in parallel once R0 lands (1 week) → **R5** re-specced feature work, evidence-first.

We found the truth. Good. The foundation is sound — RLS, hardened `SECURITY DEFINER`, server-bound actors, fail-closed webhooks are all genuinely solid. This is a *reachability and operations* problem, not a rot problem. The path from here is short and concrete.

---

## 2. Non-Negotiable Operating Principles

1. **No new feature phase until the loop is reachable and proven once in prod.** "Built" ≠ "works." One attended traversal is the bar.
2. **No stale-plan execution.** `p6–p11` and the pre-5b roadmap are archived. Re-spec against current reality before building.
3. **No fake buttons, dead UI, disconnected dashboards, or undocumented contract drift.** If a contract changed in code, the doc changes in the same PR.
4. **No production-affecting script without a host/env guard.** A stray `psql $PROD_URL < seed.sql` must abort, not run.
5. **No cohort testing without safety visibility.** If a report/abuse alert can't reach a human, the cohort doesn't start.
6. **No unattended offer mechanic without push or email fallback.** A 23-hour offer cannot depend on an open browser tab.
7. **No public launch without** delete/export, the email-leak fix, a staging/sandbox decision, and a moderation path.
8. **Date generation stays a strategic moat** — but its eval is an *offline harness first*, never live prompt-tuning against prod.
9. **Prefer deletion, redirect, contract-correction, and guards over new surface area.** The cheapest line of code is the one you delete.
10. **Verify, don't trust.** Subagent "passed" claims and old docs both get re-checked against running reality.

---

## 3. Current Reality Baseline

Legend: 🟢 GREEN works now · 🟡 YELLOW built but unproven/partial · 🔴 RED broken/blocking · 🔵 BLUE preserve (strategic) · ⚪ GRAY legacy/defer/delete-candidate

| Subsystem | Status | Reality |
|---|---|---|
| **Planner / generator** | 🟢🔵 | `/plan → generate-plan → itineraries → /plan/i/[id]` works and is live. Deterministic selection + LLM copy. The wedge and the moat. Keep and protect. |
| **Planner→dating bridge** | 🟢🔵 | `post_night` turns a verified user's itinerary into a swipeable `date_instance`. Correct gated seam. Preserve. |
| **Dating loop (schema/RPC/edge)** | 🟡 | Full spine exists: profiles, swipes, offers, locks, reveal, ratings, jobs, notifications, safety. 8 `match-*` edge fns deployed, actor bound server-side. **Zero prod traffic.** Behind `match_v2_enabled` (OFF). |
| **Dating loop (UI)** | 🟡 | D/E/F/G built + browser-verified locally. Not deployed to prod (stale Vercel). |
| **Verification / onboarding** | 🔴 | Phone OTP (Twilio) and Persona ID both implemented but **unproven in prod** — 0 verified users, no inquiries in the audit snapshot. Hard stop for organic entry. |
| **Offers / locks / reveal** | 🟡 | RPCs + RLS verified (127100–127700 applied to prod). `match_make_offer` returns a **jsonb discriminated union**, reciprocal commits-and-returns. Never exercised by a human. |
| **Ratings** | 🟡⚪ | `RatingForm` inserts a `match_ratings` row. **No downstream**: no reliability, standing, or enforcement. Trust-system theater until wired. |
| **Chat** | 🟡⚪ | `chat_threads` exists; `chat_lock_ready` is a `true` stub; UI is a "coming soon" placeholder. Not a product surface yet. |
| **Notifications** | 🔴 | In-app Realtime works *only with an open tab*. Web-push, email fallback, ops-email = `*_not_wired` stubs. Expo push exists but native is undeployed and `devices` is written by nothing. Core urgency mechanic is undeliverable on web. |
| **Admin / moderation** | 🔴 | `admin_alerts` and `audit_log` are write-only — **no reader, no admin RLS select, no UI**. Safety events page no one. |
| **Infrastructure** | 🔴 | Strong data plane (RLS, hardened DEFINER, server-bound actors, HMAC webhooks). Weak ops envelope: no staging, laptop edge deploys, hand-applied prod migrations. |
| **CI** | 🔴 | Red on every PR (3 PhotoStep failures fail vitest under `set -e`). No lint / typecheck / `next build` gate. |
| **Privacy / GDPR** | 🔴 | No delete/export/purge. `profiles.email` readable by a revealed counterpart (other PII correctly owner-locked on `profiles_private`). |
| **Mobile-web / PWA** | 🟡 | Screens are mobile-first and responsive; SSR/PKCE sound. **No manifest, icons, service worker, web-push, or background reachability.** |
| **Date-quality eval** | ⚪ | Specs only. No harness. `date-engine-v2`/bandit specs are unwired. **Blocked dependency:** the truthfulness gate's place fact-bank columns don't exist yet (see §5, §6 R4). |

---

## 4. Resolve Contradictions and Unknowns First

These get resolved (or explicitly marked unresolved) **before** any feature work. Where I already have a verified answer from this session, it's recorded as **[KNOWN]** with the confirming command for re-check. Everything else has an exact verification step.

| # | Question | Current best answer | Exact verification |
|---|---|---|---|
| U1 | Is Vercel prod serving the latest dating UI? | **[KNOWN] No.** Prod = `d350ab5`, dating UI/rebrand/reveal-hardening **not live**. | `mcp__vercel__list_deployments` (filter target=production, state=READY) → read `meta.githubCommitSha`. |
| U2 | Exact live commit, `main`, `origin/main`? | **[KNOWN-ish]** local `main` ≈ `e2f9b89`; ~78 ahead of `origin/main`; Vercel = `d350ab5`. Re-confirm — this env reports After5 as **not a git repo**, so run in the actual repo. | `git -C <repo> fetch origin && git -C <repo> rev-parse HEAD origin/main && git -C <repo> rev-list --count origin/main..HEAD` |
| U3 | Edge fns from current repo or laptop drift? | **[KNOWN]** Laptop drift — entrypoints are `file:///Users/...`. No fn→SHA map. | `mcp__supabase__list_edge_functions` → inspect `entrypoint_path` + `version` per fn; compare against `supabase/functions/*`. |
| U4 | Is `/home` the dating home and `/account` the legacy dead-end? | **[KNOWN] Yes.** `/home` = dating-aware FirstSessionHome (keep); `/account` = legacy split-brain (fix/redirect). | `Read apps/web/app/home/page.tsx` + `apps/web/app/account/page.tsx`; confirm `/account` has no first-class path into `/feed`/`/matches`/`/nights/new`. |
| U5 | Does local `db reset` reproduce prod after `126850`? | **[KNOWN] No.** Prod-only `126850_p5_cancel_reason_extend` has no local file; version-string drift; `temp_race` leftover on prod. | `supabase db reset` then diff `supabase migration list` vs `mcp__supabase__list_migrations`; grep local `supabase/migrations` for `126850`. |
| U6 | Are Persona / Twilio / Resend / web-push / jobs secrets set in prod? | **UNRESOLVED.** Not auditable from repo. | `supabase secrets list --project-ref ufufmcpnysvwtutpbian` (names only); Twilio SMS provider in Supabase **Auth dashboard** (not CLI); Persona template id env; Resend domain DNS status; confirm `JOBS_RUNNER_SECRET`/`CRON_SECRET` set and matched by the Vercel cron caller. |
| U7 | Which scripts can mutate prod and need guards? | **[KNOWN]** `scripts/cohort-unblock.sql`, `scripts/seed-cohort-nights.sql`, `scripts/qa-feed-seed.sql` — no host/env guard. | `Read` each; confirm none assert DB host before `insert`/`update`/`auth.users` writes. |
| U8 | Which notification paths reach a human? | **[KNOWN]** Only in-app Realtime (open tab). web-push/email/ops-email = stubs; `devices` unwritten. | `grep -rn "not_wired\|web_push\|ops_email" supabase/functions`; `grep -rn "into devices\|from('devices')" apps supabase`. |
| U9 | Which `admin_alerts` / `audit_log` / reports rows have read surfaces? | **[KNOWN]** None for `admin_alerts`/`audit_log`. reports/disputes/blocks RLS needs confirmation. | `grep -rn "admin_alerts\|audit_log" apps/web`; query `pg_policies` for select policies on `admin_alerts`, `audit_log`, `reports`, `disputes`, `blocks`. |

**Rule:** U6 is the only fully-unresolved blocker and it gates R1/R2 (verification path). U1/U2/U3/U4/U5/U7/U8/U9 are known — R0 *records and acts on* them rather than re-investigating from scratch.

---

## 5. Kill / Keep / Merge / Defer

| Surface / system | Status | Decision | Why | Required action | Verification |
|---|---|---|---|---|---|
| `/plan` | 🟢🔵 | **Keep** | Live wedge + SEO surface | None | Loads + generates in prod |
| `generate-plan` (edge fn) | 🟢🔵 | **Keep** | The moat; deterministic select + LLM copy | None now; eval in R4 | `list_edge_functions` shows active |
| `/plan/i/[id]` | 🟢🔵 | **Keep** | Itinerary render; entry to `post_night` | None | Renders persisted itinerary |
| `/nights/new` + `post_night` | 🟢🔵 | **Keep** | Correct planner→dating bridge | Confirm gated on verified+dating | Read route + RPC grants |
| `/home` | 🟢 | **Keep** | Dating-aware canonical post-login home | Make it the single post-login destination | U4 |
| `/account` | 🔴 | **Merge → settings-only + redirect** | Legacy split-brain; can strand users in planner-only view | Convert to settings; link to `/home`/`/feed`/`/nights/new`/`/matches`; redirect bare `/account`→`/home` | R0.8 |
| `/vote/[id]` | ⚪ | **Verify → Keep or Defer** | Planner-era itinerary voting; unclear if in dating funnel | Read route; classify | `Read apps/web/app/vote/[id]/page.tsx`; check inbound links |
| Planner SEO routes (`/places`,`/vibes`,`/types`,`/neighborhoods`,`/templates/[id]`,`/wow/[id]`) | 🟢🔵 | **Keep** | SEO + content engine, not dead weight | None; don't delete blindly | Spot-load each |
| `/admin/eval` | ⚪ | **Verify → Defer or Kill** | Likely an eval stub with no backend | Read route; if dead UI, gate behind admin or remove | `Read` route; grep usage |
| `generate-cover` (edge fn) | 🟡 | **Keep (verify use)** | Cover-image gen for itineraries | Confirm still called by planner | `list_edge_functions` + grep callers |
| `classify-photos` (edge fn) | 🟡 | **Keep (verify use)** | Photo moderation/classification on upload | Confirm wired to onboarding photo step | grep callers in upload path |
| `RatingForm` / `match_ratings` | 🟡⚪ | **Keep UI, Defer consequences** | Inserts but no downstream | Don't call it a trust system until R5 wires reliability | grep for readers of `match_ratings` |
| Chat placeholder / `chat_lock_ready` | 🟡⚪ | **Keep placeholder, Re-spec in R4** | Stub returns `true`; not a surface | Don't execute `p6` verbatim | Read `chat_lock_ready` def |
| `admin_alerts` | 🔴 | **Keep + add reader (R0.3)** | Write-only safety sink | Add admin RLS select + minimal reader | R0.3 |
| Dormant job types (`match_stale_date_close`, `match_expire_pending`, `match_reconfirm_timeout`, `chat_purge_thread`, `process_deletion`, `analytics_relay_drain`) | 🔴 | **Keep enqueue, guard handler (R0.2)** | Target RPCs don't exist → silent-complete risk | Fail-closed guard + capability allowlist | R0.2 |
| `scripts/cohort-unblock.sql`, `seed-cohort-nights.sql`, `qa-feed-seed.sql` | 🔴 | **Keep + guard (R0.4)** | Prod-dangerous, unguarded | Host/env assertion header | R0.4 |
| Stale `p6–p11` plans + pre-5b roadmap/contract | ⚪ | **Archive + watermark** | Encode phantom columns, scalar-return, wrong ownership | Move to `docs/superpowers/plans/archive/` with STALE banner | R0.7 |

---

## 6. Re-Baselined Roadmap

### R0 — Re-baseline and make reality trustworthy
**Goal:** the repo, plans, and contracts accurately describe what's running; the obvious operational footguns are disarmed.
**Exit:** §9 R0→R1 gate.
Slices: R0.1–R0.8 (detailed in §7).

### R1 — Make the dating loop reachable
**Goal:** a controlled tester cohort can enter the loop without depending on unproven public verification.
Includes: deploy the intended web commit (after CI green); confirm edge-fn versions; safe cohort-unblock with **real, reviewed tester UUIDs**; seed real Kelowna date nights; decide how to enable matching given **global** `match_v2_enabled` (cohort-unblock the *users* rather than flipping the global flag for everyone, OR add cohort targeting to `feature_config`); land the `/account` redirect; confirm `/feed`/`/matches`/`/offers` reachable for cohort.
**Exit:** §9 R1→R2 gate.

### R2 — Prove one production traversal
**Goal:** one attended, end-to-end production run with two real accounts and captured evidence. (Traversal + evidence list in §7 R2.1.)
**Deliverable:** `docs/superpowers/reports/<date>-prod-traversal.md` — row references, screenshots, logs, bugs, follow-ups.
**Exit:** §9 R2→R3 gate.

### R3 — Make unattended cohort safe
**Goal:** a small cohort can use the app without an engineer babysitting each interaction.
Includes: minimal PWA (manifest/icons/SW); web-push subscription + VAPID fanout; **email fallback for `offer_received` / `offer_expiring`**; notification permission prompt *after onboarding*; `admin_alerts` reader live (from R0.3, now load-bearing); delivery-failure visibility; error reporting (Sentry or equiv); a cohort runbook + ops checklist.
**Exit:** §9 R3→public-beta gate.

### R4 — Date-quality eval v0 (parallelizable after R0)
**Goal:** protect and improve the generator with measurement, not vibes. Offline CLI harness only — **no dashboard, no bandit, no prod writes.**
- **Three systems, scored separately:** selection quality (did deterministic pick a good sequence?), writing quality (given fixed places, is the copy desirable/specific/coherent?), portfolio diversity (are the 3 returned itineraries meaningfully different?).
- **Gates (deterministic, ruthless, unit-tested):** banned copy / emoji / title ≤ 8 words; open-at-arrival; travel + pacing; budget sanity; adjacent-stop contrast; exactly one peak; user-intent compliance; first-date safety; **truthfulness / unsupported-concrete-claim**; city/context fit; portfolio diversity across the 3.
- **Gradient (only for gate-passers, 1–5, severity-capped):** desirability `0.30`, arc `0.20`, vibe_coherence `0.15`, city_context_fit `0.15`, specificity_taste `0.15`, hook `0.05`. `finalScore = min(20·weightedAvg, gateCap)`; caps tiered (impossible arrival 25, unsupported claim 35, must-have violation 40, first-date safety 45, same-category adjacency 55, banned phrase/emoji/length 70, minor tone 85).
- **Judge validation:** 3–5 humans score 20–30 outputs; collect absolute + pairwise; compare via pairwise agreement + rank correlation; run bias probes (order swap, length, polished-vs-grounded, fake-vs-supported specifics); keep an anchor set for drift.
- **⚠️ Hard dependency (gate-zero):** the truthfulness gate needs a **place fact-bank** (`allowed_claims`, `signature_items`, `setting_tags`, `sensory_tags`, `avoid_claims`) and an `experience_category`/per-stop `role` taxonomy. **These columns do NOT exist on `places` today** (verified). `places` *does* have: `typical_duration_min`, `opens`/`closes`/`closed_days`/`hours_week`, `price_tier`/`typical_per_person`, `drive_cluster`/`lat`/`lng`, `time_of_day`, `weather_dependent`, `reservation_required`, `type`, `cuisine`, `vibe_tags`, `pairing_tags`, `local_insight`, `notes`, `llm_summary`, `reviews`. **So:** logistics/pacing/budget/safety/contrast gates are buildable now; the truthfulness gate ships v0 against **hand-authored fixture metadata** (frozen JSON), and grounding against *real prod venues* waits on a fact-bank enrichment project (track it, don't pretend it's free).

### R5 — Re-specced feature work (evidence-first, only after R0–R3)
S7 chat re-specced against current reality (is it pre-lock, post-lock, or both? does it gate locking? retention/purge/export/moderation?); ratings → reliability/standing + enforcement ladder; reports/blocks/disputes + moderation UI; account lifecycle (delete/export/pause); payments framing (later); analytics relay (later). **Do not run old S7–S11 / p6–p11 plans directly.**

---

## 7. Implementation Slices

### Slice R0.1 — Make CI green and useful
**Goal:** every future change starts from a green, gated runway.
**Files/systems:** `apps/web/components/onboarding/PhotoStep*` (+ its test), `apps/web/vitest.setup.ts`, `.github/workflows/5b-tests.yml`.
**Non-goals:** rewriting onboarding; new tests beyond fixing the 3 failures.
**Risks:** PhotoStep failures are real product bugs, not just test rot — fix the cause, don't delete the test.

- [ ] **Step 1 — Reproduce the red.** Run: `pnpm --filter @after5/web test -- PhotoStep` → Expected: 3 failing (stale "next" button assertion). Read the failures; decide test-stale vs component-bug.
- [ ] **Step 2 — Fix the failing tests at the cause.** If the component changed, update the component or the test to match real behavior; if jsdom-gap, extend `vitest.setup.ts` polyfill (object-URL already polyfilled there). Show the diff in the PR.
- [ ] **Step 3 — Verify green.** Run: `pnpm --filter @after5/web test` → Expected: full suite PASS (incl. the 3).
- [ ] **Step 4 — Add gates to `5b-tests.yml`.** Add jobs: `pnpm --filter @after5/web lint`, `pnpm --filter @after5/web typecheck`, `pnpm --filter @after5/web build` (`next build`). Keep heavy Playwright E2E as a separate, non-per-commit job.
- [ ] **Step 5 — Verify the workflow passes locally.** Run lint+typecheck+build commands directly; Expected: all exit 0.
- [ ] **Step 6 — Commit.** `git commit -m "ci: fix PhotoStep tests; add lint/typecheck/build gates"`

**Acceptance:** PR CI is green; lint+typecheck+`next build` block merge on failure.
**Verification:** open a trivial PR, watch CI go green; introduce a deliberate type error → CI fails.
**Rollback:** revert the workflow commit; tests stay fixed.
**Fun check:** *Now every change starts from a green runway instead of a haunted house.*

### Slice R0.2 — Job runner missing-RPC guard (fail-closed)
**Goal:** a job whose target RPC doesn't exist **fails and alerts**, never silently completes.
**Files/systems:** `supabase/functions/process-jobs/index.ts` (read first — confirm the dispatch switch + payload key `user`), `supabase/tests/` (Deno test).
**Non-goals:** implementing the 6 missing RPCs; changing retry/backoff.
**Risks:** supabase-js `.rpc()` resolves `{ error }` rather than throwing on `function-not-found` (PGRST202 / 42883) — the current handler doesn't inspect it.

- [ ] **Step 1 — Read the handler.** `Read supabase/functions/process-jobs/index.ts`; locate where it calls `supabase.rpc(type, payload)` and where it marks `done`.
- [ ] **Step 2 — Write the failing test.** Enqueue a job of a known-missing type (e.g. `process_deletion`); assert the job ends `failed`/dead-lettered AND an `admin_alerts` row is written — NOT `done`.

```ts
Deno.test("missing-RPC job fails closed and alerts", async () => {
  await enqueue({ type: "process_deletion", payload: { user: TEST_UUID } });
  await runJobsOnce();
  const job = await getJob({ type: "process_deletion", user: TEST_UUID });
  assertEquals(job.status, "failed");           // not "done"
  const alert = await latestAdminAlert("job_missing_rpc");
  assert(alert, "expected an admin_alert for the missing RPC");
});
```

- [ ] **Step 3 — Run it; confirm it fails** (current code marks `done`). Run: `supabase/tests/_all_5b.sh` (or the Deno test directly).
- [ ] **Step 4 — Add the guard.** Two layers: (a) a **capability allowlist** of job types whose RPC exists; unknown/unsupported types short-circuit to `failed` + alert. (b) inspect `{ error }` from every `.rpc()`:

```ts
const SUPPORTED = new Set([
  "match_bulk_withdraw", "close_rating_window", /* …confirmed-existing RPCs… */
]);

if (!SUPPORTED.has(job.type)) {
  await failJob(job, { code: "unsupported_job_type" });
  await alertAdmin("job_missing_rpc", { type: job.type, job_id: job.id });
  continue;
}
const { error } = await supabase.rpc(job.type, job.payload);
if (error) {
  await failJob(job, { code: error.code ?? "rpc_error", detail: error.message });
  if (error.code === "PGRST202" || error.code === "42883")
    await alertAdmin("job_missing_rpc", { type: job.type, job_id: job.id });
  continue;             // never fall through to markDone()
}
await markDone(job);
```

- [ ] **Step 5 — Run the test; confirm PASS.**
- [ ] **Step 6 — Commit + deploy guard.** `git commit -m "fix(jobs): fail-closed on missing RPC + admin alert"`; redeploy `process-jobs` via `mcp__supabase__deploy_edge_function` (record version→SHA).

**Acceptance:** missing-RPC job → `failed` + `admin_alerts` row; existing jobs unaffected.
**Verification:** `mcp__supabase__get_logs` shows the alert path on a synthetic missing-RPC job (local).
**Rollback:** redeploy prior `process-jobs` version (recorded).
**Fun check:** *The job runner stops lying about work it never did.*

### Slice R0.3 — `admin_alerts` reader (so safety isn't invisible)
**Goal:** an admin can see safety/ops alerts — load-bearing for R3 cohort.
**Files/systems:** a new migration (RLS select policy), `apps/web/app/admin/alerts/page.tsx` (minimal), an `is_admin` mechanism.
**Non-goals:** full moderation console; alert mutation/resolution workflow (R5).
**Risks:** must NOT open `admin_alerts` to authenticated users — admin-only.

- [ ] **Step 1 — Find the admin mechanism.** Query: how is "admin" expressed? `select column_name from information_schema.columns where table_name='profiles' and column_name ilike '%admin%';` and check for an `admins`/`app_roles` table + any existing `is_admin()` helper: `\df *admin*`. Use whatever exists; if nothing exists, add a minimal `admins(user_id uuid primary key)` table.
- [ ] **Step 2 — Write the failing test** (SQL/RLS): a non-admin `select * from admin_alerts` returns 0 rows; an admin returns rows.
- [ ] **Step 3 — Add the migration.** Admin-only select policy, e.g.:

```sql
-- new migration: admin_alerts_admin_read
alter table admin_alerts enable row level security;
create policy admin_alerts_admin_read on admin_alerts
  for select to authenticated
  using (exists (select 1 from admins a where a.user_id = auth.uid()));
```

- [ ] **Step 4 — Apply locally, run the RLS test, confirm PASS.**
- [ ] **Step 5 — Minimal reader page.** `/admin/alerts`: server component, selects recent `admin_alerts` (newest first), renders type/created_at/payload. No write actions. Gate the route on `is_admin`.
- [ ] **Step 6 — Commit.** `git commit -m "feat(admin): admin_alerts read policy + minimal reader page"`. Apply migration to prod in the R1 batch (not now).

**Acceptance:** admin sees alerts; non-admin sees nothing (RLS-enforced, not just UI).
**Verification:** local — promote a test user to admin, load `/admin/alerts`; confirm a non-admin gets an empty/forbidden view.
**Rollback:** drop the policy + page; no data change.
**Fun check:** *Safety stops happening in the dark.*

### Slice R0.4 — Guard prod-dangerous scripts
**Goal:** seed/cohort scripts abort unless explicitly, deliberately run.
**Files/systems:** `scripts/cohort-unblock.sql`, `scripts/seed-cohort-nights.sql`, `scripts/qa-feed-seed.sql`.
**Non-goals:** changing what the scripts do when legitimately run.
**Risks:** a guard that's trivially bypassed is theater — require an explicit override token.

- [ ] **Step 1 — Add a host/env assertion header** to each script that aborts unless the connected DB is local OR an explicit override is set:

```sql
-- GUARD: refuse to run unless local, or AFTER5_ALLOW_PROD_WRITE=1 is set in the session.
do $$
begin
  if current_setting('after5.allow_prod_write', true) is distinct from '1'
     and inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1') then
    raise exception 'Refusing to run on non-local host % without after5.allow_prod_write=1',
      host(inet_server_addr());
  end if;
end $$;
```

- [ ] **Step 2 — Verify it aborts.** Point at a non-local host without the override → Expected: `raise exception`. With `set after5.allow_prod_write='1';` first → proceeds.
- [ ] **Step 3 — Document the override** at the top of each script + in the cohort runbook (R3): cohort-unblock against prod requires setting the GUC *and* pasting reviewed tester UUIDs.
- [ ] **Step 4 — Commit.** `git commit -m "chore(scripts): host/env guard on prod-dangerous seeds"`

**Acceptance:** running any of the three against a non-local host without the override aborts before any write.
**Verification:** dry-run against local (proceeds) and a dummy non-local DSN (aborts).
**Rollback:** remove the header (don't).
**Fun check:** *No more 3am "wait, which database was that" cold sweat.*

### Slice R0.5 — Backfill `126850` migration + `temp_race` cleanup plan
**Goal:** `supabase db reset` reproduces prod more faithfully.
**Files/systems:** `supabase/migrations/` (new backfill file mirroring prod-only `126850_p5_cancel_reason_extend`), a cleanup note for `temp_race`.
**Non-goals:** reconciling every version-string drift (cosmetic — document it instead).
**Risks:** the backfill must match what prod actually applied — derive from prod, not memory.

- [ ] **Step 1 — Dump the prod object.** Via `mcp__supabase__execute_sql`: read the actual `cancel_reason` enum/constraint state on prod so the backfill is faithful (recall: accepted values are exactly `mutual` / `no_show` / `creator_pre_lock` / `safety`).
- [ ] **Step 2 — Write the local migration file** reproducing that change, named to sort correctly relative to neighbors.
- [ ] **Step 3 — `supabase db reset`; confirm** local `cancel_reason` matches prod; run the 5b suite.
- [ ] **Step 4 — Write the `temp_race` cleanup note** (drop-after-verify) into the runbook; do NOT drop on prod in R0.
- [ ] **Step 5 — Commit.** `git commit -m "fix(db): backfill prod-only 126850; note temp_race cleanup"`

**Acceptance:** fresh `db reset` includes `126850`; documented version-drift caveat exists.
**Verification:** `supabase migration list` (local) vs `mcp__supabase__list_migrations` (prod) — `126850` present in both.
**Rollback:** delete the backfill file.
**Fun check:** *"Works on my machine" finally means something.*

### Slice R0.6 — Record deployment truth → `docs/CURRENT-PROD-REALITY.md`
**Goal:** one file that states exactly what's live, so no one re-investigates.
**Files/systems:** `docs/CURRENT-PROD-REALITY.md`.
**Non-goals:** changing what's deployed (that's R1).

- [ ] **Step 1 — Capture the three SHAs** (U2 command) + Vercel prod SHA (U1) + per-fn versions/entrypoints (U3).
- [ ] **Step 2 — Write the file:** deployed web SHA vs `main` (distance), which product slices are live (planner: yes; dating UI: no), edge-fn version→SHA table, applied prod migrations (127100–127700 verified; `match_v2_enabled`=OFF), secret-status table (from U6), known prod-only objects (`126850`, `temp_race`).
- [ ] **Step 3 — Commit.** `git commit -m "docs: CURRENT-PROD-REALITY snapshot"`

**Acceptance:** a newcomer can answer "what's live?" from one file.
**Verification:** every claim in the file traces to a command in §4.
**Fun check:** *The map finally matches the territory.*

### Slice R0.7 — Rewrite contracts + archive stale plans
**Goal:** the contract describes shipped reality; stale plans can't mislead a future agent.
**Files/systems:** `docs/INTEGRATION-CONTRACT.md` (rewrite), `docs/RECONCILED-MASTER-PLAN.md` (rewrite → R0–R5), `docs/superpowers/plans/archive/` (move p6–p11 + pre-5b roadmap with a STALE banner).
**Non-goals:** writing R1–R5 detailed task plans (each gets its own plan at phase start).

- [ ] **Step 1 — Rewrite `INTEGRATION-CONTRACT.md`** to record: `match_make_offer` returns jsonb `{kind:'offer',offer_id}|{kind:'reciprocal',pair_id}`; reciprocal commits-and-returns (no P5008 on make-offer path); `match_resolve_reciprocal` carries `p_idem_key` (uuid, not text); `notification_type` has 20 values; `cancel_reason` ∈ {mutual,no_show,creator_pre_lock,safety}; error envelope `{ok:false, code:'<string>', message, detail?:string, errcode?:'P50xx'}` — branch on string `code`; **`profiles.bio`/`photos[]`/`expectations[]` do NOT exist**; `chat_lock_ready` is a true/open stub; `RatingForm` inserts with no downstream; browse-feed account-state creator filter is a known gap; 6 job RPCs missing + `process-jobs` guard requirement (R0.2).
- [ ] **Step 2 — Rewrite `RECONCILED-MASTER-PLAN.md`** to point at this document's R0–R5.
- [ ] **Step 3 — Archive** `p6`–`p11` + pre-5b roadmap/contract into `docs/superpowers/plans/archive/` with a top banner: `> ⚠️ STALE / DO NOT EXECUTE — superseded by docs/after5-current-implementation-plan.md (2026-05-30).`
- [ ] **Step 4 — Commit.** `git commit -m "docs: re-baseline integration contract + master plan; archive stale p6–p11"`

**Acceptance:** no live plan encodes a phantom column or scalar return; archived plans are clearly watermarked.
**Verification:** `grep -rn "profiles.bio\|photos\[\]\|returns uuid" docs/` finds only archived/STALE files.
**Fun check:** *Future-you stops building against a ghost.*

### Slice R0.8 — Resolve the `/account` dead-end
**Goal:** one canonical post-login home; no planner-only cul-de-sac.
**Files/systems:** `apps/web/app/account/page.tsx`, `apps/web/app/home/page.tsx`, any post-login redirect.
**Non-goals:** redesigning `/home`.

- [ ] **Step 1 — Read both routes** (U4); confirm `/home` is the dating-aware destination and `/account` lacks first-class dating links.
- [ ] **Step 2 — Decide + implement:** convert `/account` to settings-only with explicit links to `/home`, `/feed`, `/nights/new`, `/matches`; redirect bare `/account`→`/home` for the default post-login landing. Keep saved-plan access reachable from settings (don't orphan the planner).
- [ ] **Step 3 — Test:** post-login lands on `/home`; `/account` shows settings + working links; no path strands a user in planner-only.
- [ ] **Step 4 — Commit.** `git commit -m "fix(nav): /account → settings + redirect to /home; kill split-brain"`

**Acceptance:** no logged-in route dead-ends away from the dating loop.
**Verification:** click-through from login → never stuck; every `/account` link resolves to a live dating surface.
**Rollback:** revert; restore prior `/account`.
**Fun check:** *Every door now leads somewhere alive.*

---

### Slice R1.1 — Deploy the intended web build
**Goal:** Vercel serves the dating UI, from a known commit, after CI is green.
**Files/systems:** git (`origin/main`), Vercel project.
**Non-goals:** flipping `match_v2_enabled` for everyone.
**Risks:** deploying before CI green re-introduces the haunted house; do R0.1 first.
**Acceptance:** Vercel prod SHA == intended `main` SHA; planner still works; dating UI present but gated.
**Verification:** `mcp__vercel__get_deployment` SHA matches; `/home` renders dating-aware build; planner `/plan` still generates.
**Rollback:** Vercel "promote previous deployment" to `d350ab5`.
**Fun check:** *The thing we've been building is finally the thing that's live.*

### Slice R1.2 — Apply pending prod migrations + confirm edge fns
**Goal:** prod schema/fns match the deployed build.
**Files/systems:** `mcp__supabase__apply_migration` (R0.3 admin policy + 126850 if not already), edge fns.
**Non-goals:** new schema.
**Acceptance:** R0.3 admin policy live; `match_v2_enabled` confirmed still OFF; edge-fn versions recorded.
**Verification:** `mcp__supabase__get_advisors` clean; `list_migrations` shows the applied set.
**Rollback:** per-migration rollback SQL from the runbook.
**Fun check:** *Prod and repo finally agree on the rules.*

### Slice R1.3 — Cohort enablement (safe path around global flag)
**Goal:** real testers reach dating-ready state without exposing the public.
**Files/systems:** `scripts/cohort-unblock.sql` (now guarded), `scripts/seed-cohort-nights.sql`, `feature_config`.
**Non-goals:** building a full cohort-targeting system (decide: per-user unblock now vs `feature_config` cohort column later).
**Risks:** `match_v2_enabled` is **global** — flipping it ON exposes everyone. Prefer cohort-unblocking *users* (verification bypass for reviewed UUIDs) while the flag stays OFF, OR add cohort targeting before flipping.
**Acceptance:** N reviewed tester UUIDs are dating-enabled; ≥1 seeded Kelowna date night per relevant creator; public users see no dating loop.
**Verification:** query the cohort users' `dating_enabled`/verification state; confirm feed has swipeable nights for them; confirm a non-cohort user sees the planner-only experience.
**Rollback:** re-block cohort UUIDs; un-seed nights.
**Fun check:** *A handpicked few get the keys; everyone else stays blissfully unaware.*

### Slice R2.1 — Attended production traversal
**Goal:** prove the loop once, with evidence.
**Traversal:** A signs up → B signs up → both verified/cohort-enabled → A posts an itinerary as a date night → B sees it in feed → B expresses interest → offer created → offer accepted → lock created → reveal works → rating window opens → rating submitted → inspect logs/jobs/notifications/audit/DB.
**Evidence to capture:** user IDs, `date_instance` id, swipe rows, offer row, lock + `lock_participants` rows, notification rows, job rows, rating row, `audit_log` entries, any edge/log errors, screenshots of critical UI states.
**Non-goals:** load testing; unattended flows.
**Acceptance:** the traversal completes; defects come from observed reality; the only manual step is the documented cohort-unblock.
**Verification:** `docs/superpowers/reports/<date>-prod-traversal.md` with row references + screenshots; `mcp__supabase__get_logs` clean of silent failures.
**Rollback:** N/A (read-mostly); clean up test rows after.
**Fun check:** *The first real heartbeat of the dating loop in the wild.*

### Slice R3.1 — Offer reachability (PWA + push + email fallback)
**Goal:** a closed-tab tester still gets the offer.
**Files/systems:** `apps/web` PWA (`manifest.json`, icons, service worker), web-push subscription + `devices` registration (currently written by nothing), VAPID fanout, email transport for `offer_received`/`offer_expiring` (Resend), permission prompt after onboarding.
**Non-goals:** native app; full notification preference matrix.
**Risks:** Resend domain DNS must be verified (U6) before email works; web-push needs VAPID keys in prod secrets.
**Acceptance:** closed-tab tester receives an offer via web-push OR email; offer expiry is experienced as intended; delivery failures land in `admin_alerts`.
**Verification:** close the tab, trigger an offer, observe push/email; check a forced-failure surfaces to the reader.
**Rollback:** feature-flag the push/email path off; in-app Realtime remains.
**Fun check:** *The 23-hour clock finally ticks where the user can hear it.*

### Slice R4.1 — Date-quality eval harness v0
**Goal:** measure generated-date quality offline before touching prompts.
**Files/systems:** `packages/date-quality/{types,gates,score,judge,runEval}.ts` + `__tests__`, `fixtures/dategen/kelowna-v0/*.json` (30: 18 normal / 8 adversarial / 4 golden), `baselines/dategen/baseline-v0.json`, `scripts/eval-dategen.ts`.
**Non-goals:** dashboard, bandit, prod writes, dating-loop changes.
**Risks:** truthfulness gate depends on fixture fact-bank metadata (gate-zero — see §6 R4); judge can reward polished-but-wrong copy (mitigate: gates first, evidence required, human calibration).
**Acceptance:** runner loads fixtures → isolates the writing pass with frozen place IDs → runs gates → judges only gate-passers → computes severity-capped score → diffs baseline → emits JSON+MD → exits nonzero on regression (critical gate regression, mean drop >3, any fixture drop >10, unsupported claim, banned copy).
**Verification:** `pnpm tsx scripts/eval-dategen.ts` produces `eval-results/dategen/latest.{json,md}`; unit tests for gates + `computeScore` pass.
**Rollback:** delete the package (no runtime coupling).
**Fun check:** *We can finally tell a genuinely great Kelowna date from a confidently-worded fib.*

---

## 8. Risk Register

| Risk | Sev | Likelihood | Evidence | Mitigation | Phase |
|---|---|---|---|---|---|
| Stale Vercel deploy / unpushed `main` | 🔴 | Certain | Prod=`d350ab5`, ~78 behind | Push intended commit after CI green | R0/R1 |
| No staging tier | 🔴 (public) | Certain | local+prod only | Add Supabase+Vercel staging | Public prep |
| `.env.local` points at prod | 🔴 | Certain | audit: service-role reach | Env rename + `ENVIRONMENT` guard + script guards | R0/R5 |
| No sandbox/live provider split | 🔴 (public) | Certain | local hits live Persona/Twilio/Resend | Provider sandbox keys + env split | Public prep |
| Offers unreachable closed-tab | 🔴 | Certain | web-push/email stubs; `devices` unwritten | PWA + web-push + email fallback | R3 |
| Safety alerts invisible | 🔴 | Certain | `admin_alerts` 0 readers | Admin reader + RLS (R0.3) | R0/R3 |
| CI red + ungated | 🔴 | Certain | 3 PhotoStep fails; no build gate | Fix + add lint/typecheck/build | R0 |
| Missing GDPR delete/export | 🔴 (public) | Certain | no delete/export/purge fns | Account lifecycle | R5 |
| Email PII leak via reveal | 🔴/🟡 | Certain | `profiles_select_revealed` exposes `profiles.email` | Move email→`profiles_private` or reveal view | Before public |
| Silent-complete dormant jobs | 🔴 | High | 6 RPCs missing; `.rpc()` resolves error | Fail-closed guard (R0.2) | R0 |
| Prod-dangerous seed/cohort scripts | 🔴 | Med | no host guard | Host/env assertion (R0.4) | R0 |
| Global `match_v2_enabled` | 🟡/🔴 | Certain | no cohort column | Unblock users not flag, or add targeting | R1 |
| Verification unproven (Twilio/Persona) | 🔴 | High | 0 verified users/inquiries | Cohort bypass for R2; verify secrets (U6) | R1/R5 |
| Chat placeholder | 🟡 | Certain | `chat_lock_ready` stub | Re-spec, don't run p6 | R4/R5 |
| Ratings no downstream | 🟡 | Certain | no readers of `match_ratings` | Wire reliability/standing | R5 |
| Stale p6–p11 plans | 🟡 | Certain | phantom columns/contracts | Archive + watermark (R0.7) | R0 |
| Date-quality eval unbuilt | 🟡 | Certain | specs only | Offline harness (R4) | After R0 |
| Judge false positives | 🟡 | Med | polished-vs-grounded ambiguity | Gates-first + human calibration | R4 |
| `db reset` ≠ prod (126850/temp_race) | 🟡/🔴 | Certain | prod-only migration | Backfill + document drift (R0.5) | R0 |

---

## 9. Verification Gates

**R0 → R1 requires:**
- CI green; lint + typecheck + `next build` gates active (R0.1).
- Current deployed SHA, `main`, `origin/main`, edge-fn versions recorded in `CURRENT-PROD-REALITY.md` (R0.6).
- `126850` backfilled locally; version-drift + `temp_race` documented (R0.5).
- Stale p6–p11 archived + watermarked; contract rewritten (R0.7).
- `admin_alerts` has a reader + admin RLS (R0.3).
- Prod-dangerous scripts guarded (R0.4).
- Job runner fails closed on missing RPC (R0.2).
- `/account` dead-end resolved (R0.8).

**R1 → R2 requires:**
- Intended web commit deployed to Vercel (R1.1); planner still works.
- Pending prod migrations applied; `match_v2_enabled` confirmed OFF; advisors clean (R1.2).
- Reviewed tester UUIDs prepared; matching enabled *safely* (users unblocked, not global flip) (R1.3).
- ≥1 seeded Kelowna date night available to the cohort.
- Verification bypass/cohort path documented; rollback known.

**R2 → R3 requires:**
- One production traversal completed with evidence (R2.1).
- Bugs triaged + filed from observed reality.
- No silent DB/job/notification failure during the traversal.

**R3 → public beta requires:**
- Offers reach closed-tab users via web-push OR email (R3.1).
- Safety alerts reach a human (admin reader live + monitored).
- Basic report/moderation path exists.
- Delete/export implemented OR launch scope explicitly narrowed.
- Email PII leak resolved.
- Staging/sandbox decision made + documented.

---

## 10. Do-Not-Do List

- ❌ Build S7 chat next just because old plans say so.
- ❌ Execute p6–p11 verbatim — they encode phantom columns, scalar returns, wrong ownership.
- ❌ Optimize `generate-plan` prompts without the eval harness (R4).
- ❌ Flip global `match_v2_enabled` for everyone to enable a cohort.
- ❌ Run cohort/seed scripts against prod without the guard + reviewed UUIDs.
- ❌ Call the dating loop "done" before one prod traversal (R2).
- ❌ Rely on in-app Realtime for time-boxed offers.
- ❌ Treat `RatingForm` as a trust/safety system until ratings affect standing.
- ❌ Launch public users without delete/export + the email-leak fix.
- ❌ Assume `.env.local` is safe — it points at prod.

---

## 11. Final Recommended Next 10 Actions

1. **Verify deployment truth** — record Vercel prod SHA, local `main`, `origin/main`, edge-fn versions (U1–U3, R0.6).
2. **Make CI green + add lint/typecheck/`next build` gates** (R0.1).
3. **Archive stale p6–p11 + rewrite the integration contract & master plan** to current reality (R0.7).
4. **Add the `admin_alerts` reader + RLS, and the job missing-RPC fail-closed guard** (R0.3, R0.2).
5. **Guard prod-dangerous scripts + backfill the `126850` migration** (R0.4, R0.5); resolve `/account` (R0.8).
6. **Deploy the intended web build** to Vercel + apply pending prod migrations (R1.1, R1.2).
7. **Prepare reviewed cohort UUIDs + seed Kelowna nights**, matching enabled safely around the global flag (R1.3).
8. **Run the attended production traversal** and write the evidence report (R2.1).
9. **Ship the offer-reachability slice** — minimal PWA + web-push + email fallback (R3.1).
10. **Build date-quality eval v0** offline (R4.1) — in parallel once R0 lands.

**Must-fix before tester cohort:** R0.1, R0.2, R0.3, R0.4, R0.5, R0.7, R0.8, R1.1, R1.2, R1.3.
**Must-fix before public launch:** staging tier, sandbox/live split, GDPR delete/export, email-leak fix, error reporting, moderation path, secret-rotation doc.
**Safe to defer:** pg_cron (Vercel cron is fine interim), version-string drift (document), chat (R4/R5), ratings consequences (R5), payments + analytics relay (later).

---

*Verify, don't trust. Prefer deletion over addition. Prove it once, then go fast.*
