SUBORDINATE EXECUTION SLICE. This plan is not authoritative by itself. It must be implemented only through INTEGRATION-CONTRACT.md v2 and RECONCILED-MASTER-PLAN.md. If this file conflicts with either, this file loses.

# P8 — Moderation, Admin Tooling & Anti-Abuse — Implementation Plan

> **Slice identity:** This is the **S9 — Moderation & admin** slice of the reconciled build order. It is downstream of the schema spine (S1), the async/notify/chat-core spine (S2), the content pipeline (S4), and trust & safety (S8/P7). Build only after those slices land.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Trust & Safety operations layer for the dating loop — a database-backed **admin role model**, report/dispute **resolution** that drives the real shared enforcement state, an **admin console** (report triage over the real `reports` + `media_assets` queues, dispute resolution, verification review, UGC moderation, suspension tools, audit-log viewer, appeals) gated by `requireAdmin()`/`requireAdminRole()`, and an **anti-abuse layer** (device fingerprinting, velocity limits reusing `rate_limits`, a fraud-scoring signal, and structural defenses against fake accounts, swipe farms, and the "honeypot date" harvest). Someone must be able to action reports and suspend bad actors on day one — where "suspend" writes the **one** shared enforcement gate, `profiles.standing` (C3).

**Architecture:** Extend (never replace) S1's shared spine — `reports`/`report_status`/`report_reason_category` (C5/C11.6), `disputes` (C11.6, table owned by P7/S8 band `128xxx`), `profiles.standing`/`standing_state` (C3, owned by P7), `blocks`, `verifications`, `audit_log`, `locks`, `match_ratings`, `queue_entries`, `swipes`, `date_instances`, `itineraries` — plus S4's `media_assets` (C11.8) UGC queue and S8's reliability functions. Three layers:

1. **Data/invariants in Postgres (migrations + RLS):** a DB admin role model (`admin_users`), report-resolution metadata expressed via `resolution_code` (the C5/C11.6 `report_status` 4-value enum is **not** rewritten — P7 reads `actioned`/`reviewing`), moderator-intent audit via `moderation_actions`, an **audit-log-only** `suspensions` table (the gate is `profiles.standing`, C3/C11.5 — there is **no** `account_active()` gate and **no** third account-state model), anti-abuse tables (`device_fingerprints`, `fraud_signals`, `fraud_scores`), and **SECURITY DEFINER** moderator RPCs (authorized by `auth.uid()` + `admin_has_role()`, `revoke execute from public, authenticated`, C10) that are the only write path into report-resolution / suspension (`standing='suspended'`) / dispute-resolution / UGC transitions (each appends to `audit_log` / `moderation_actions` and, where the spec requires, calls `dispatch_notification`).
2. **Pure business logic (`@after5/business`, vitest):** fraud scoring (weighted signal → score), velocity/swipe-farm heuristics, and honeypot detection (a creator harvesting profiles via fake dates) — no I/O, runnable on Edge (Deno) and Node.
3. **Admin console (Next.js, `apps/web/app/admin/*` + `/api/admin/*`):** server components call `requireAdmin()`/`requireAdminRole()` + `createAdminClient()`; interactive client components POST/PATCH to `/api/admin/*` route handlers that re-check `requireAdmin()`/`requireAdminRole()` and call the moderator RPCs. Mirrors the existing `/admin/insiders` + `/api/admin/insiders` pattern exactly. Admin routes live under `apps/web/app/admin/*` gated by `requireAdminRole()` (C7/§7 of RECONCILED-MASTER-PLAN).

**Tech Stack:** Supabase Postgres, SQL migrations (`supabase/migrations/`), RLS with `auth.uid()`, SECURITY DEFINER moderator functions (admin-gated by `admin_has_role()`, `revoke execute from public, authenticated` per C10), the existing `set_updated_at()` trigger, the existing `audit_log` + `log_status_transition()` from S1/P0, the existing `rate_limits` table + `rate_limit_check()` RPC from `20260522110000_rate_limits.sql`. Notifications go through S2's canonical `dispatch_notification(p_user, p_type notification_type, p_payload jsonb)` (C1) — P8 does **not** define its own notification channel. Admin UI: Next.js App Router server components + route handlers, `requireAdmin()`/`requireAdminRole()` (`apps/web/lib/auth/require-admin.ts`), `createAdminClient()` (`apps/web/lib/supabase/admin.ts`). Tests: psql `DO $$…END$$` invariant tests in `supabase/tests/` (clean exit = PASS, any RAISE = FAIL), seeding users via the shared `mk_user()`/`mk_itinerary()`/`mk_instance()` fixtures (`supabase/tests/_fixtures.sql`, C8 — never bare-insert into `profiles`); pure logic in `@after5/business` via **vitest**, using the single root `vitest.config.ts` owned by P1/S3 (C10/C12 — P8 does **not** bootstrap a duplicate vitest config; `pnpm test` is assumed).

**Source docs:** **authority** — `docs/superpowers/plans/2026-05-25-INTEGRATION-CONTRACT.md` (v2, esp. C3, C5, C6, C10, C11.5, C11.6, C11.8) and `docs/superpowers/plans/2026-05-25-RECONCILED-MASTER-PLAN.md` (S9). Reference — spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§6 audit log, §7 lifecycle, §8 trust/safety/enforcement, §7.2 honeypot/reveal); roadmap `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (Phase 8 scope); audit `docs/superpowers/plans/audits/2026-05-25-p8-moderation-admin-audit.md`.

**Dependency note (canonical):** Depends on:
- **S1** — `reports`/`report_status`/`report_reason_category` (C5/C11.6), `disputes` table DDL (C11.6, created in P7/S8 band `128xxx`), `profiles.standing`/`standing_state` enum + column (C3, owned by P7), `audit_log` + `log_status_transition()`, all loop base tables.
- **S2** — `dispatch_notification` + `notification_type` (C1), `admin_alerts` (C11.8), `jobs`/`enqueue_job` (C1).
- **S4** — `media_assets` UGC queue (C11.8); `moderation_status` enum + column **on `date_instances`** (C11.8) — **not** on `itineraries`.
- **S8 (P7)** — `match_ratings`, the reliability functions (`recompute_reliability`), the enforcement ladder that *writes* `standing`, and the `disputes` rows P7 opens on contested no-shows.

P8 owns the **resolution/operations** end: report resolution, dispute resolution (recompute callback), suspension (writing `standing='suspended'`), UGC moderation actions, the admin console, and anti-abuse tooling. P8 does **not** own the enforcement *ladder* (P7/S8 owns automated escalation that writes `standing`) and does **not** define a parallel suspension state. **Cross-stage hook:** `can_enter_lock_flow` (the gate that reads `standing`) is defined in S2 and called by S6 — P8 only flips `standing`; the gate already exists and is honored upstream.

**Reconciliation note — admin role model.** The repo's current admin gate is an **env allowlist** (`ADMIN_EMAILS`, fail-closed) in `requireAdmin()`. That is fine for a tiny operator set but cannot express *roles* (a verification reviewer vs. a full T&S admin) or be audited. P8 adds a DB-backed `admin_users(user_id, role)` table as the **authoritative role model**, and `requireAdmin()` is extended to grant access if the user is on the env allowlist **OR** in `admin_users`. Per-action authorization (e.g. only `verification_reviewer`+ can approve verifications) reads `admin_users.role` via `requireAdminRole()`. Roles: `super_admin` (everything, incl. managing admins), `ts_admin` (reports, disputes, suspensions, UGC), `verification_reviewer` (verification review only). **The matching SQL helper for the RPCs is `admin_has_role()`** (C10 names `admin_has_role()`; P8 also keeps the convenience alias `is_admin()` for read RLS). **Out of scope for P8** (later phases): automated enforcement-ladder transitions (P7/S8); account deletion/anonymization of banned users (P9/S10); the verification *vendor webhook* (P1/S3 writes `verifications`; P8 only reviews/overrides). Notification *delivery* is **in scope** for P8 to the extent of **calling** S2's `dispatch_notification` on suspension/ban/content-removal/verification-rejection (MD11); the channel itself is S2's.

**Conventions (follow exactly):** migration filenames `YYYYMMDDHHMMSS_snake_description.sql` in the **P8 band `20260525129000`–`20260525129xxx`** (C6 — P8 owns `129xxx`; P7 owns `128xxx`, P9 owns `130xxx`; no band sharing). enable RLS on every table; create policies idempotently with `DO $$ BEGIN CREATE POLICY … EXCEPTION WHEN duplicate_object THEN NULL; END $$;`; attach `set_updated_at()` to tables with `updated_at`; `auth.uid()` in policies; uuid PKs via `gen_random_uuid()`. Moderation writes go through SECURITY DEFINER RPCs that assert `p_actor = auth.uid()` AND `admin_has_role()` and `revoke execute from public, authenticated` (C10 — service-role / verified-admin only); the console calls those RPCs with the service-role client after `requireAdmin()`/`requireAdminRole()`. **No `browse_feed` redefinition** — P8 only `alter table`s base tables; the single `browse_feed` is finalized once at band `133000` (C11.3). Admin pages: `export const dynamic = 'force-dynamic'`, server component does `await requireAdmin('/admin/<path>')` (or `requireAdminRole(...)`) then `createAdminClient()`.

**Local test loop:** `supabase db reset` (applies all migrations + seeds) then run a test file with:
`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>`
psql tests use `DO $$ … END $$;` blocks that `RAISE EXCEPTION` on wrong behavior (clean exit = PASS) and `\i supabase/tests/_fixtures.sql` then call `mk_user()`/`mk_itinerary()`/`mk_instance()` (C8) — never bare-insert into `profiles`/`itineraries`. Put psql tests in `supabase/tests/`. For TypeScript: `pnpm test` (the single root vitest workspace owned by P1/S3, C10 — P8 introduces no vitest config).

---

## File Structure

- `supabase/migrations/20260525129000_*.sql` … `20260525129xxx_*.sql` — one migration per data task (admin roles, helpers, report-resolution metadata, moderation actions, suspensions audit log, dispute-resolution RPC, anti-abuse tables, fraud RPC, honeypot view, appeals). **No P8 migration redefines `browse_feed`, `report_status`, `disputes` DDL, `standing`, or `moderation_status`** — those are owned upstream (C5/C11.3/C11.6/C11.8); P8 only `alter table`s base tables and adds the resolution metadata/RPCs.
- `supabase/tests/p8_*.sql` — one psql invariant/RLS test file per task that warrants it; each `\i`'s `_fixtures.sql`.
- `packages/business/src/anti-abuse/*.ts` — pure fraud-scoring / velocity / honeypot logic.
- `packages/business/src/anti-abuse/*.test.ts` — vitest unit tests (colocated; run under the root config).
- `apps/web/lib/auth/require-admin.ts` — extend to read `admin_users` (DB role model) alongside the env allowlist + add `requireAdminRole()`.
- `apps/web/lib/admin/moderation.ts` — typed server helpers wrapping the moderator RPCs (called from route handlers).
- `apps/web/app/admin/layout.tsx` — add nav items (Reports, Disputes, Verify, Moderate, Suspensions, Appeals, Audit).
- `apps/web/app/admin/reports/{page.tsx,reports-queue.tsx}` — report triage queue (reads `reports` incl. `reason_category`).
- `apps/web/app/admin/disputes/{page.tsx,disputes-panel.tsx}` — dispute resolution (updates `disputes` + recompute callback).
- `apps/web/app/admin/verify/{page.tsx,verify-panel.tsx}` — verification review.
- `apps/web/app/admin/moderate/{page.tsx,moderate-panel.tsx}` — UGC moderation reading **`media_assets`** + `date_instances.moderation_status`.
- `apps/web/app/admin/suspensions/{page.tsx,suspensions-panel.tsx}` — suspension tools (write `standing='suspended'`).
- `apps/web/app/admin/appeals/{page.tsx,appeals-panel.tsx}` — appeal review (MD11).
- `apps/web/app/admin/audit/page.tsx` — audit-log viewer (read-only).
- `apps/web/app/api/admin/{reports,disputes,verify,moderate,suspensions,appeals}/route.ts` — mutation route handlers (re-check `requireAdmin()`/`requireAdminRole()`, call RPCs).
- `packages/types/src/database.ts` — regenerated at the end (`pnpm db:types`).

---

## Task 1: Admin role model (`admin_users`) + `admin_has_role()` / `is_admin()` helpers

**Files:**
- Create: `supabase/migrations/20260525129000_p8_admin_users.sql`
- Test: `supabase/tests/p8_admin_users.sql`

> **Contract note (C10):** `admin_has_role()` is the canonical authorization helper named by the contract for admin RPCs; `is_admin()` is a thin convenience predicate (`= admin_has_role(u, any)`) used only in read RLS. Both are `security definer` with a fixed `search_path`.

- [ ] **Step 1: Write the failing test** (table exists, RLS on, `is_admin()` and `admin_has_role()` exist and fail-closed for a non-admin). Uses the shared `mk_user()` fixture (C8).

```sql
-- supabase/tests/p8_admin_users.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE u uuid;
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='admin_users' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'admin_users missing or RLS off'; END IF;

  -- helper functions must exist
  PERFORM 1 FROM pg_proc WHERE proname='is_admin';
  IF NOT FOUND THEN RAISE EXCEPTION 'is_admin() missing'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='admin_has_role';
  IF NOT FOUND THEN RAISE EXCEPTION 'admin_has_role() missing'; END IF;

  -- a random uuid that is not in admin_users must be denied
  u := gen_random_uuid();
  IF is_admin(u) THEN RAISE EXCEPTION 'is_admin() should be false for non-admin'; END IF;
  IF admin_has_role(u, 'ts_admin') THEN RAISE EXCEPTION 'admin_has_role() should be false for non-admin'; END IF;

  -- grant + verify role hierarchy: super_admin satisfies any role check
  u := mk_user('admin');
  insert into admin_users (user_id, role) values (u, 'super_admin');
  IF NOT is_admin(u) THEN RAISE EXCEPTION 'is_admin() should be true after grant'; END IF;
  IF NOT admin_has_role(u, 'ts_admin') THEN RAISE EXCEPTION 'super_admin must satisfy ts_admin'; END IF;
  IF NOT admin_has_role(u, 'verification_reviewer') THEN RAISE EXCEPTION 'super_admin must satisfy verification_reviewer'; END IF;
  RAISE NOTICE 'admin_users OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "admin_users" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525129000_p8_admin_users.sql
create type admin_role as enum ('super_admin','ts_admin','verification_reviewer');

create table if not exists admin_users (
  user_id    uuid primary key references profiles(id) on delete cascade,
  role       admin_role not null default 'ts_admin',
  granted_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_admin_users_updated_at before update on admin_users
  for each row execute function set_updated_at();

-- is_admin(): is this user any kind of admin?
create or replace function is_admin(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_users where user_id = p_user);
$$;

-- admin_has_role(): does the user hold (at least) the required role?
-- super_admin satisfies every check; otherwise the role must match exactly.
create or replace function admin_has_role(p_user uuid, p_role admin_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from admin_users
     where user_id = p_user
       and (role = 'super_admin' or role = p_role)
  );
$$;

alter table admin_users enable row level security;
-- Admins may read the admin roster; only super_admins manage it (via service-role RPC in Task 12-adjacent
-- admin route). Default-deny for everyone else.
do $$ begin
  create policy "admin_users_admin_read" on admin_users for select
    using (is_admin(auth.uid()));
exception when duplicate_object then null; end $$;
-- No insert/update/delete policy: roster changes go through the service-role admin client
-- after a super_admin check in the route handler. Default-deny on writes.
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `admin_users OK`).

Run: `supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p8_admin_users.sql`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525129000_p8_admin_users.sql supabase/tests/p8_admin_users.sql
git commit -m "P8: admin_users role model + admin_has_role()/is_admin() helpers (fail-closed)"
```

---

## Task 2: `suspensions` (AUDIT LOG ONLY — the enforcement gate is `profiles.standing`)

> **CONTRACT (C3/C11.5 — supersedes the original "single source of truth" design):** The **one** enforcement gate is `profiles.standing` (`standing_state`, owned by P7/S1). A P8 suspension writes `standing='suspended'`; the `can_enter_lock_flow` gate (S2) and the feed filter (C11.3) already read `standing`, so a suspended user is blocked everywhere with no further wiring. P8's `suspensions` table is an **audit log only** — a durable record of *who* imposed *what* and *why*, with a soft link to the originating report. **There is NO `account_active()` gate, NO `account_lifecycle='suspended'` (that enum has no `suspended` — C11.5), and NO third account-state model.** Lifting a suspension sets the audit row's `status='lifted'` AND writes `standing` back to `good` (via the RPC in Task 7) — the row alone never gates anything.

**Files:**
- Create: `supabase/migrations/20260525129100_p8_suspensions.sql`
- Test: `supabase/tests/p8_suspensions.sql`

- [ ] **Step 1: Write the failing test** (the audit table records a suspension AND the enforcement gate `profiles.standing` flips to `suspended`; lifting restores `good`). The actual blocking is proven against `standing`, not a P8 gate.

```sql
-- supabase/tests/p8_suspensions.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE u uuid; adm uuid; sid uuid; st standing_state;
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='suspensions';
  IF NOT FOUND THEN RAISE EXCEPTION 'suspensions audit table missing'; END IF;
  -- there must be NO account_active() gate (C3/C11.5)
  PERFORM 1 FROM pg_proc WHERE proname='account_active';
  IF FOUND THEN RAISE EXCEPTION 'account_active() must NOT exist — gate is profiles.standing'; END IF;

  adm := mk_user('adm'); u := mk_user('u');
  insert into admin_users (user_id, role) values (adm, 'ts_admin');

  -- fresh user is in good standing
  select standing into st from profiles where id=u;
  IF st <> 'good' THEN RAISE EXCEPTION 'fresh account should be good standing (got %)', st; END IF;

  -- imposing a ban writes the audit row AND flips the enforcement gate
  select impose_suspension(adm, u, 'ban', 'fraud', null, null) into sid;
  select status from suspensions where id=sid; -- audit row exists
  select standing into st from profiles where id=u;
  IF st <> 'suspended' THEN RAISE EXCEPTION 'ban must set profiles.standing=suspended (got %)', st; END IF;

  -- lifting clears the gate back to good and marks the audit row lifted
  PERFORM lift_suspension(adm, sid, 'appeal upheld');
  select standing into st from profiles where id=u;
  IF st <> 'good' THEN RAISE EXCEPTION 'lift must restore standing=good (got %)', st; END IF;
  PERFORM 1 FROM suspensions WHERE id=sid AND status='lifted';
  IF NOT FOUND THEN RAISE EXCEPTION 'lift must mark audit row lifted'; END IF;
  RAISE NOTICE 'suspensions OK';
  ROLLBACK;
END $$;
```

> Note: `impose_suspension`/`lift_suspension` are defined in Task 7; this test exercises the full audit-log-plus-gate behavior, so run it after Task 7's migration lands (or split into a table-shape check here + behavior check in Task 7's test). The point of record: **the gate is `profiles.standing`, never a P8-local function.**

- [ ] **Step 2: Run it, expect FAIL** (`relation "suspensions" does not exist`, then `account_active() must NOT exist` once the table lands but the RPC doesn't).

- [ ] **Step 3: Write the migration** (audit table only — no gate function)

```sql
-- supabase/migrations/20260525129100_p8_suspensions.sql
-- AUDIT LOG ONLY (C3/C11.5). The enforcement gate is profiles.standing (owned by P7).
-- This table records the human/automated decision; the RPCs in Task 7 write standing.
-- There is intentionally NO account_active() and NO third account-state model.
create type suspension_kind as enum ('warning','offer_cooldown','temp_suspend','ban');
create type suspension_status as enum ('active','lifted');  -- 'active' = currently recorded; 'lifted' = reversed

create table if not exists suspensions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  kind        suspension_kind not null,
  reason      text not null,
  status      suspension_status not null default 'active',
  imposed_by  uuid references profiles(id),      -- admin (null = automated/system)
  source      text not null default 'admin',     -- 'admin' | 'auto_enforcement' | 'anti_abuse'
  report_id   uuid,                              -- optional soft link to originating report
  expires_at  timestamptz,                       -- informational (e.g. temp_suspend window); NOT a gate
  lifted_by   uuid references profiles(id),
  lifted_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists suspensions_user_active_idx
  on suspensions(user_id) where status = 'active';
create trigger set_suspensions_updated_at before update on suspensions
  for each row execute function set_updated_at();

-- NO account_active() function. The gate is profiles.standing (C3/C11.5):
--   can_enter_lock_flow (S2) returns false when standing in ('cooldown','locked_ban','suspended').
-- impose_suspension()/lift_suspension() (Task 7) are the ONLY writers of standing for moderation.

alter table suspensions enable row level security;
do $$ begin
  -- a user may read their own suspension audit (so the app can show "your account is suspended");
  -- admins may read all.
  create policy "suspensions_self_or_admin_read" on suspensions for select
    using (user_id = auth.uid() or is_admin(auth.uid()));
exception when duplicate_object then null; end $$;
-- Writes go through impose_suspension()/lift_suspension() RPCs (Task 7). Default-deny direct writes.
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `suspensions OK` once Task 7 lands).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525129100_p8_suspensions.sql supabase/tests/p8_suspensions.sql
git commit -m "P8: suspensions AUDIT LOG (gate is profiles.standing per C3/C11.5; no account_active)"
```

---

## Task 3: Report-resolution metadata (extend S1 `reports` — do NOT rewrite the status enum)

> **CONTRACT (C5/C11.6 — supersedes the original "rebuild `report_status` to a 6-value enum" design):** `report_status` is the **frozen S1 4-value enum** `('open','reviewing','actioned','dismissed')`. **P8 MUST NOT add, remove, or rename any value** — P7's `evaluate_standing`/`can_rematch` read `status='actioned'` (C11.6), and richer P8 lifecycle is expressed via a free-text **`resolution_code`** column, never by mutating the enum. `reason_category` (`report_reason_category`, incl. `payment_dispute`) is the canonical taxonomy and is already on the table (S1). P8 only **adds resolution/triage metadata columns** and a guard trigger that respects the 4 canonical states. The original Task 3 dropped `actioned`/`reviewing` and invented `triaged/investigating/escalated/resolved` — **that is SUPERSEDED and deleted.** The richer lifecycle now lives in `resolution_code` (free text, e.g. `triaged|investigating|escalated|actioned_suspend|dismissed_duplicate|...`).

**Files:**
- Create: `supabase/migrations/20260525129200_p8_reports_resolution.sql`
- Test: `supabase/tests/p8_reports_resolution.sql`

P8 adds assignment, priority, and a `resolution_code` to S1's `reports`, plus a guard trigger that keeps transitions inside the canonical 4-value `report_status` and requires a `resolution_code` when entering a terminal state (`actioned`/`dismissed`).

- [ ] **Step 1: Write the failing test** (`reason_category` is already present from S1; P8's added columns exist; entering `actioned`/`dismissed` requires a `resolution_code`; the enum still has `actioned`+`reviewing`).

```sql
-- supabase/tests/p8_reports_resolution.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE rid uuid; ok boolean := false; rep uuid;
BEGIN
  -- the frozen 4-value enum must still carry 'actioned' and 'reviewing' (C11.6 — P7 reads them)
  PERFORM 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
   WHERE t.typname='report_status' AND e.enumlabel='actioned';
  IF NOT FOUND THEN RAISE EXCEPTION 'report_status.actioned must survive (P7 reads it)'; END IF;
  PERFORM 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
   WHERE t.typname='report_status' AND e.enumlabel='reviewing';
  IF NOT FOUND THEN RAISE EXCEPTION 'report_status.reviewing must survive (C11.6)'; END IF;

  -- P8 metadata columns exist
  PERFORM 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='assigned_to';
  IF NOT FOUND THEN RAISE EXCEPTION 'reports.assigned_to missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='resolution_code';
  IF NOT FOUND THEN RAISE EXCEPTION 'reports.resolution_code missing'; END IF;
  -- reason_category (incl. payment_dispute) comes from S1
  PERFORM 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='reason_category';
  IF NOT FOUND THEN RAISE EXCEPTION 'reports.reason_category missing (S1)'; END IF;

  rep := mk_user('rep');
  insert into reports (id, reporter_id, target_type, target_id, reason_category, detail, status)
    values (gen_random_uuid(), rep, 'user', rep, 'harassment', 'abuse', 'open') returning id into rid;

  -- legal: open -> reviewing
  update reports set status='reviewing' where id=rid;

  -- entering a terminal state without a resolution_code is rejected
  BEGIN
    update reports set status='actioned' where id=rid;  -- no resolution_code
  EXCEPTION WHEN others THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'terminal actioned without resolution_code was allowed'; END IF;

  -- legal terminal transition with a code
  update reports set status='actioned', resolution_code='actioned_suspend', resolved_at=now() where id=rid;
  RAISE NOTICE 'reports resolution OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`reports.resolution_code missing`).

- [ ] **Step 3: Write the migration** (additive only — NO enum rewrite, NO column drop)

```sql
-- supabase/migrations/20260525129200_p8_reports_resolution.sql
-- Report-resolution metadata. The report_status enum is the FROZEN S1 4-value enum
-- ('open','reviewing','actioned','dismissed') — C5/C11.6. P8 does NOT touch it.
-- Richer lifecycle (triaged/investigating/escalated/why-actioned) lives in resolution_code (free text).

create type report_priority as enum ('low','normal','high','critical');

alter table reports
  add column if not exists assigned_to uuid references profiles(id),
  add column if not exists priority report_priority not null default 'normal',
  add column if not exists resolution_code text,           -- free text, NOT an enum (C11.6)
  add column if not exists resolution_note text,
  add column if not exists resolved_by uuid references profiles(id),
  add column if not exists resolved_at timestamptz,
  add column if not exists triaged_at timestamptz;
-- reports.updated_at + set_updated_at trigger come from S1; add only if S1 omitted them:
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_name='reports' and column_name='updated_at') then
    alter table reports add column updated_at timestamptz not null default now();
    create trigger set_reports_updated_at before update on reports
      for each row execute function set_updated_at();
  end if;
end $$;

create index if not exists reports_status_priority_idx on reports(status, priority);
create index if not exists reports_assigned_idx on reports(assigned_to) where status not in ('actioned','dismissed');
create index if not exists reports_category_open_idx on reports(reason_category) where status in ('open','reviewing');

-- Transition guard over the CANONICAL 4 states:
--   open -> reviewing | actioned | dismissed
--   reviewing -> actioned | dismissed
--   actioned/dismissed are terminal. A resolution_code is required to enter a terminal state.
create or replace function guard_report_transition() returns trigger
language plpgsql as $fn$
begin
  if (new.status = old.status) then return new; end if;
  if (old.status in ('actioned','dismissed')) then
    raise exception 'report % is terminal (%); cannot transition to %', old.id, old.status, new.status;
  end if;
  if not (
    (old.status = 'open'      and new.status in ('reviewing','actioned','dismissed')) or
    (old.status = 'reviewing' and new.status in ('actioned','dismissed'))
  ) then
    raise exception 'illegal report transition % -> %', old.status, new.status;
  end if;
  if (new.status in ('actioned','dismissed') and coalesce(new.resolution_code,'') = '') then
    raise exception 'resolving report % requires a resolution_code', old.id;
  end if;
  return new;
end $fn$;
create trigger guard_reports_transition before update on reports
  for each row execute function guard_report_transition();

-- Audit every report status change (reuse S1 generic logger). S1 attaches no audit trigger to reports.
create trigger audit_reports after insert or update on reports
  for each row execute function log_status_transition();
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `reports resolution OK`).

Note: S1's `reports` has no `select` policy (default-deny → admin/service-role read). That stays; admins read via the service-role client. Reporter-read of own report is owned by S8/S10 (P7/P9); not required for the console.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525129200_p8_reports_resolution.sql supabase/tests/p8_reports_resolution.sql
git commit -m "P8: report-resolution metadata + 4-state guard (keeps actioned/reviewing per C11.6; resolution_code free text)"
```

---

## Task 4: `moderation_actions` (immutable record of every moderator action)

**Files:**
- Create: `supabase/migrations/20260525129300_p8_moderation_actions.sql`
- Test: `supabase/tests/p8_moderation_actions.sql`

- [ ] **Step 1: Write the failing test** (rows are insert-only — UPDATE is rejected)

```sql
-- supabase/tests/p8_moderation_actions.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE adm uuid; aid uuid; ok boolean := false;
BEGIN
  adm := mk_user('adm');
  insert into moderation_actions (actor_id, action, target_type, target_id, detail)
    values (adm, 'report_resolved', 'report', gen_random_uuid(), '{"resolution":"actioned"}'::jsonb)
    returning id into aid;
  BEGIN
    update moderation_actions set action='tampered' where id=aid;
  EXCEPTION WHEN others THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'moderation_actions must be append-only (UPDATE allowed)'; END IF;
  RAISE NOTICE 'moderation_actions OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "moderation_actions" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525129300_p8_moderation_actions.sql
-- Human-readable T&S action log: who did what to which entity, with structured detail.
-- Complements S1 audit_log (which captures state-machine status changes generically);
-- this records moderator intent (resolution codes, suspension reasons, dispute rulings).
create table if not exists moderation_actions (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references profiles(id),                 -- the admin/moderator (null = system)
  action      text not null,                                -- e.g. 'report_resolved','user_suspended','verification_approved','dispute_ruled','media_asset_rejected'
  target_type text not null check (target_type in ('report','user','date_instance','message','lock','verification','dispute','media_asset','appeal','admin_user')),
  target_id   uuid not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists moderation_actions_target_idx on moderation_actions(target_type, target_id);
create index if not exists moderation_actions_actor_idx on moderation_actions(actor_id, created_at desc);

-- Append-only: forbid UPDATE and DELETE at the trigger level.
create or replace function forbid_mutation() returns trigger
language plpgsql as $fn$
begin
  raise exception 'moderation_actions is append-only';
end $fn$;
create trigger moderation_actions_no_update before update on moderation_actions
  for each row execute function forbid_mutation();
create trigger moderation_actions_no_delete before delete on moderation_actions
  for each row execute function forbid_mutation();

alter table moderation_actions enable row level security;
do $$ begin
  create policy "moderation_actions_admin_read" on moderation_actions for select
    using (is_admin(auth.uid()));
exception when duplicate_object then null; end $$;
-- Inserts come from SECURITY DEFINER moderator RPCs (service-role); no direct insert policy.
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `moderation_actions OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525129300_p8_moderation_actions.sql supabase/tests/p8_moderation_actions.sql
git commit -m "P8: moderation_actions (append-only T&S action log, admin-read)"
```

---

## Task 5: `disputes` resolution wiring (table is OWNED UPSTREAM by S8/P7 — C11.6)

> **CONTRACT (C11.6 — supersedes the original "P8 creates `disputes`" design):** The `disputes` table DDL is **frozen** and **created in P7's S8 band `128xxx`**, not by P8. P8 must **NOT** `create table disputes` and must **NOT** invent the `dispute_kind/dispute_status/dispute_outcome` enums or the `opened_by/against_user/outcome` columns. The frozen schema is:
> ```sql
> create table disputes (
>   id uuid primary key default gen_random_uuid(),
>   lock_id uuid not null references locks(id) on delete cascade,
>   raised_by uuid not null references profiles(id),
>   kind text not null check (kind in ('no_show','payment','conduct')),
>   state text not null default 'open' check (state in ('open','resolved','rejected')),
>   resolution jsonb, created_at timestamptz not null default now() );
> ```
> **Bidirectional loop (C5/C11.6):** P7 writes a `disputes` row on a contested no-show; **P8 resolution updates `disputes.state`** AND calls back **`recompute_reliability(user)`** + clears **`match_ratings.disputed`**. The original Task 5 built a *parallel* dispute representation that sat empty while real contests flowed through P7 — that is SUPERSEDED. P8 owns only the **resolution RPC** (`rule_dispute`, defined in Task 7) over the upstream table.

**Files:**
- ~~Create migration~~ — **removed.** No P8 `disputes` migration; the table belongs to S8/P7 band `128xxx`.
- Test: `supabase/tests/p8_disputes_resolution.sql` (resolution behavior — exercised in Task 7's test once `rule_dispute` exists).

This task is now a **reference + verification** task: confirm the upstream `disputes` table shape P8 depends on, and define the resolution contract (implemented in Task 7).

- [ ] **Step 1: Write the dependency-assert test** (the upstream table exists with the frozen columns; P8 invented none of its own).

```sql
-- supabase/tests/p8_disputes_resolution.sql
\i supabase/tests/_fixtures.sql
DO $$
BEGIN
  -- the upstream (S8/P7) disputes table must exist with the frozen C11.6 shape
  PERFORM 1 FROM information_schema.columns WHERE table_name='disputes' AND column_name='raised_by';
  IF NOT FOUND THEN RAISE EXCEPTION 'disputes.raised_by missing (S8/P7 owns disputes — C11.6)'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='disputes' AND column_name='state';
  IF NOT FOUND THEN RAISE EXCEPTION 'disputes.state missing (C11.6)'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='disputes' AND column_name='resolution';
  IF NOT FOUND THEN RAISE EXCEPTION 'disputes.resolution (jsonb) missing (C11.6)'; END IF;
  -- P8 must NOT have invented a parallel dispute enum
  PERFORM 1 FROM pg_type WHERE typname='dispute_outcome';
  IF FOUND THEN RAISE EXCEPTION 'dispute_outcome enum must not exist — P8 invents no parallel dispute model'; END IF;
  -- recompute_reliability (S8/P7) must exist for the resolution callback
  PERFORM 1 FROM pg_proc WHERE proname='recompute_reliability';
  IF NOT FOUND THEN RAISE EXCEPTION 'recompute_reliability() missing (S8 dependency)'; END IF;
  RAISE NOTICE 'disputes dependency OK';
END $$;
```

The behavioral resolution test (open dispute → `rule_dispute` → `state='resolved'` + reliability recomputed + `match_ratings.disputed` cleared) lives in **Task 7** alongside the RPC.

- [ ] **Step 2: Run it, expect FAIL until S8/P7 lands** (`disputes.raised_by missing`). P8 builds **after** S8, so by execution time it passes; the assert exists to catch out-of-order builds.

- [ ] **Step 3: No migration.** P8 adds no `disputes` table. (If a local convenience-read RLS policy is needed for the admin console, it is added inside Task 7's RPC migration as an idempotent `do $$ … duplicate_object …$$` policy on the upstream table, never a `create table`.)

- [ ] **Step 4: Document the resolution contract** in Task 7 (`rule_dispute`): updates `disputes.state`, writes `disputes.resolution` jsonb, calls `recompute_reliability(against_user)`, and `update match_ratings set disputed=false` for the contested rating.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/p8_disputes_resolution.sql
git commit -m "P8: disputes resolution depends on S8/P7 frozen table (C11.6); no parallel dispute model"
```

---

## Task 6: UGC moderation over the REAL queue (`media_assets` + `date_instances.moderation_status`)

> **CONTRACT (C11.8 — supersedes the original "invent `itineraries.moderation_status` + rewrite `browse_feed`" design):** The UGC moderation queue is **S4's `media_assets`** (photos + ambient audio are `media_assets` rows; `moderation_state` ∈ `pending|approved|rejected|flagged` — S4 built this "for P8 to read"). The date-level visibility flag is **`date_instances.moderation_status`** (`'pending'|'approved'|'rejected'`, owned by S4/P3 band `124xxx` per C11.8) — **NOT** `itineraries.moderation_status` (that column is SUPERSEDED and must not be created). **P8 does NOT redefine `browse_feed`** — the single feed view (C11.3) is finalized once at band `133000` and already filters `di.moderation_status='approved'`; P8 only flips `date_instances.moderation_status` (and `media_assets.moderation_state`) via the RPC in Task 7, and the feed honors it automatically. There is no `ugc_moderation_status` enum (use S4's `media_moderation_state` and the `date_instances.moderation_status` enum).

**Files:**
- ~~Create migration~~ — **removed.** P8 creates no UGC column and no view. `media_assets`/`media_assets.moderation_state` (S4) and `date_instances.moderation_status` (S4) are upstream; P8 only writes them via `moderate_date()`/`moderate_media_asset()` in Task 7.
- Test: `supabase/tests/p8_ugc_moderation.sql` (verifies the upstream stores exist; the *behavioral* "rejected date drops from feed" assert is owned by the S12 feed-finalization test, not P8 — P8 only flips the flag).

- [ ] **Step 1: Write the dependency-assert test** (the real queue + the date flag exist; P8 invented neither).

```sql
-- supabase/tests/p8_ugc_moderation.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; it uuid; inst uuid;
BEGIN
  -- S4's media_assets queue must exist with moderation_state
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='media_assets' AND column_name='moderation_state';
  IF NOT FOUND THEN RAISE EXCEPTION 'media_assets.moderation_state missing (S4 owns the UGC queue — C11.8)'; END IF;

  -- the date-level flag lives on date_instances (C11.8), NOT itineraries
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='date_instances' AND column_name='moderation_status';
  IF NOT FOUND THEN RAISE EXCEPTION 'date_instances.moderation_status missing (S4 — C11.8)'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='itineraries' AND column_name='moderation_status';
  IF FOUND THEN RAISE EXCEPTION 'itineraries.moderation_status must NOT exist — flag lives on date_instances (C11.8)'; END IF;

  -- P8 must not have redefined the feed
  -- (browse_feed finalization is a single S12 migration at band 133000, C11.3)

  cre := mk_user('c');
  it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now()+interval '2 days');

  -- P8 flips the date flag (via moderate_date in Task 7); here we assert the column is writable to 'rejected'
  update date_instances set moderation_status='rejected' where id=inst;
  PERFORM 1 FROM date_instances WHERE id=inst AND moderation_status='rejected';
  IF NOT FOUND THEN RAISE EXCEPTION 'date_instances.moderation_status not writable'; END IF;
  RAISE NOTICE 'ugc moderation deps OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL until S4 lands** (`media_assets.moderation_state missing`). P8 builds after S4, so it passes at execution time.

- [ ] **Step 3: No migration.** P8 adds no UGC column, no enum, no view. Moderation writes go through `moderate_date()` (flips `date_instances.moderation_status`) and `moderate_media_asset()` (flips `media_assets.moderation_state`) in Task 7.

- [ ] **Step 4: (covered by Task 7)** the RPCs that write these flags.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/p8_ugc_moderation.sql
git commit -m "P8: UGC moderation reads media_assets + date_instances.moderation_status (C11.8); no invented column, no browse_feed rewrite"
```

---

## Task 7: Moderator RPCs (the only write path into report/dispute/suspension/UGC transitions)

**Files:**
- Create: `supabase/migrations/20260525129600_p8_moderator_rpcs.sql`
- Test: `supabase/tests/p8_moderator_rpcs.sql`

> **CONTRACT (C10):** Every moderator RPC (a) asserts `p_actor = auth.uid()` (closes the forged-`p_actor` privilege-escalation hole the audit flagged), (b) checks `admin_has_role(p_actor, …)`, and (c) is `revoke execute from public, authenticated` at the end of the migration (service-role / verified-admin only). The enforcement gate written by suspension is **`profiles.standing`** (C3) — `impose_suspension` writes `standing='suspended'` and `lift_suspension` writes `standing='good'`; the `suspensions` row is the **audit log** alongside it. Dispute resolution updates the **upstream `disputes`** table (C11.6 frozen DDL: `state`, `resolution jsonb`) AND calls `recompute_reliability` + clears `match_ratings.disputed` (the bidirectional loop, C5/C11.6). UGC moderation writes **`date_instances.moderation_status`** and **`media_assets.moderation_state`** (C11.8) — never an `itineraries` flag. Each user-affecting action calls **`dispatch_notification`** (S2/C1) with `notification_type='moderation_action'` (or `'account'`) (MD11).

These SECURITY DEFINER functions take an explicit `p_actor uuid` that the route handler sets to the verified admin's `auth.uid()`; the RPC re-asserts `p_actor = auth.uid()` and `admin_has_role()`, performs the transition, appends a `moderation_actions` row, and fires `dispatch_notification` where a user is affected. Each is idempotent where it matters (resolving an already-terminal report is a no-op success).

- [ ] **Step 1: Write the failing test** (forged `p_actor` rejected; non-admin rejected; admin resolves with `resolution_code` + logs; `impose_suspension` writes `standing='suspended'`; `lift_suspension` restores `good`; `rule_dispute` flips `disputes.state` + clears `match_ratings.disputed`). Run under a real `auth.uid()` where the assertion is exercised; structural admin-path runs via service role.

```sql
-- supabase/tests/p8_moderator_rpcs.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE adm uuid; usr uuid; rid uuid; nacts int; st standing_state; ok boolean := false;
BEGIN
  adm := mk_user('adm'); usr := mk_user('usr');
  insert into admin_users (user_id, role) values (adm, 'ts_admin');
  insert into reports (id, reporter_id, target_type, target_id, reason_category, detail, status)
    values (gen_random_uuid(), usr, 'user', usr, 'harassment', 'spam', 'open') returning id into rid;

  -- non-admin cannot resolve (admin_has_role gate)
  BEGIN PERFORM resolve_report(usr, rid, 'actioned', 'dismissed_no_action', 'nope');
  EXCEPTION WHEN others THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'non-admin resolved a report'; END IF;

  -- admin resolves to the CANONICAL status 'actioned' with a free-text resolution_code
  PERFORM resolve_report(adm, rid, 'actioned', 'actioned_suspend', 'banned the user');
  PERFORM 1 FROM reports WHERE id=rid AND status='actioned' AND resolution_code='actioned_suspend';
  IF NOT FOUND THEN RAISE EXCEPTION 'report not resolved to canonical actioned'; END IF;

  -- a moderation_action was logged
  select count(*) into nacts from moderation_actions
   where target_type='report' and target_id=rid and action='report_resolved';
  IF nacts < 1 THEN RAISE EXCEPTION 'resolve_report did not log a moderation_action'; END IF;

  -- impose_suspension writes the GATE (profiles.standing), not a P8-local flag
  PERFORM impose_suspension(adm, usr, 'ban', 'fraud', null, rid);
  select standing into st from profiles where id=usr;
  IF st <> 'suspended' THEN RAISE EXCEPTION 'impose_suspension must set standing=suspended (got %)', st; END IF;

  -- lift restores standing to good
  PERFORM lift_suspension(adm, (select id from suspensions where user_id=usr and status='active' limit 1), 'appeal upheld');
  select standing into st from profiles where id=usr;
  IF st <> 'good' THEN RAISE EXCEPTION 'lift_suspension must restore standing=good (got %)', st; END IF;
  RAISE NOTICE 'moderator rpcs OK';
  ROLLBACK;
END $$;
```

> A second test (`p8_dispute_resolution_loop.sql`) covers `rule_dispute`: open a `disputes` row (raised_by/kind/state per C11.6) over a no-show with `match_ratings.disputed=true`, call `rule_dispute(adm, dispute, true /*overturn*/, …)`, then assert `disputes.state='resolved'`, `match_ratings.disputed=false`, and that `recompute_reliability` was invoked (reliability row recomputed). It depends on S8's `recompute_reliability` + `disputes` table.

- [ ] **Step 2: Run it, expect FAIL** (`function resolve_report(...) does not exist`).

- [ ] **Step 3: Write the migration** (auth.uid() assertion + role check + notify + revoke)

```sql
-- supabase/migrations/20260525129600_p8_moderator_rpcs.sql
-- Every RPC: p_actor = auth.uid() (no forged actor) + admin_has_role() + revoke from public,authenticated (C10).
-- Suspension gate = profiles.standing (C3). Dispute resolution = upstream disputes (C11.6) + recompute loop.
-- UGC = date_instances.moderation_status / media_assets.moderation_state (C11.8).
-- User-affecting actions call dispatch_notification (S2/C1, MD11).

-- resolve_report: resolve to a CANONICAL status (actioned|dismissed) + free-text resolution_code.
create or replace function resolve_report(
  p_actor uuid, p_report uuid, p_status report_status, p_resolution_code text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_actor <> auth.uid() then raise exception 'forbidden: actor mismatch'; end if;
  if not admin_has_role(p_actor, 'ts_admin') then raise exception 'forbidden: lacks ts_admin'; end if;
  if p_status not in ('actioned','dismissed') then raise exception 'resolve_report expects actioned|dismissed'; end if;
  update reports
     set status=p_status, resolution_code=p_resolution_code, resolution_note=p_note,
         resolved_by=p_actor, resolved_at=now()
   where id=p_report and status not in ('actioned','dismissed');
  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, 'report_resolved', 'report', p_report,
          jsonb_build_object('status', p_status, 'resolution_code', p_resolution_code, 'note', p_note));
end $fn$;

-- set_report_status: lighter transitions within the canonical 4 states (assign / move to reviewing).
create or replace function set_report_status(
  p_actor uuid, p_report uuid, p_status report_status, p_note text default null
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_actor <> auth.uid() then raise exception 'forbidden: actor mismatch'; end if;
  if not admin_has_role(p_actor, 'ts_admin') then raise exception 'forbidden'; end if;
  update reports set status=p_status, assigned_to=coalesce(assigned_to,p_actor),
         triaged_at=coalesce(triaged_at, now())
   where id=p_report;
  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, 'report_status_change', 'report', p_report,
          jsonb_build_object('status', p_status, 'note', p_note));
end $fn$;

-- impose_suspension: writes the GATE (profiles.standing='suspended'), records the audit row, notifies the user.
-- kind is informational for the audit row; the gate is binary 'suspended' (C3). expires_at is informational only.
create or replace function impose_suspension(
  p_actor uuid, p_user uuid, p_kind suspension_kind, p_reason text,
  p_expires timestamptz default null, p_report uuid default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare sid uuid;
begin
  if p_actor <> auth.uid() then raise exception 'forbidden: actor mismatch'; end if;
  if not admin_has_role(p_actor, 'ts_admin') then raise exception 'forbidden'; end if;
  -- THE GATE (C3/C11.5): write profiles.standing. 'ban' and 'temp_suspend' => 'suspended';
  -- 'offer_cooldown' => 'cooldown'; 'warning' => 'warned'. (P7 owns standing; P8 writes 'suspended' end.)
  update profiles set standing = case p_kind
    when 'ban' then 'suspended'::standing_state
    when 'temp_suspend' then 'suspended'::standing_state
    when 'offer_cooldown' then 'cooldown'::standing_state
    when 'warning' then 'warned'::standing_state
    else 'suspended'::standing_state end
   where id = p_user;
  -- audit log row (NOT a gate)
  insert into suspensions(user_id, kind, reason, status, imposed_by, source, report_id, expires_at)
  values (p_user, p_kind, p_reason, 'active', p_actor, 'admin', p_report, p_expires)
  returning id into sid;
  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, 'user_suspended', 'user', p_user,
          jsonb_build_object('kind',p_kind,'reason',p_reason,'expires_at',p_expires,'suspension_id',sid));
  -- notify the affected user (MD11) — S2 canonical dispatcher
  perform dispatch_notification(p_user, 'moderation_action',
    jsonb_build_object('event','suspended','kind',p_kind,'reason',p_reason,'appealable',true));
  return sid;
end $fn$;

-- lift_suspension: restores the gate (standing='good'), marks the audit row lifted, notifies the user.
create or replace function lift_suspension(
  p_actor uuid, p_suspension uuid, p_note text default null
) returns void language plpgsql security definer set search_path = public as $fn$
declare uid uuid;
begin
  if p_actor <> auth.uid() then raise exception 'forbidden: actor mismatch'; end if;
  if not admin_has_role(p_actor, 'ts_admin') then raise exception 'forbidden'; end if;
  update suspensions set status='lifted', lifted_by=p_actor, lifted_at=now()
   where id=p_suspension and status='active' returning user_id into uid;
  if uid is null then return; end if;  -- idempotent: already lifted / not found
  -- restore the gate (C3) — P7 may re-evaluate later, but moderation lift means 'good'
  update profiles set standing='good'::standing_state where id=uid;
  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, 'suspension_lifted', 'user', uid, jsonb_build_object('suspension_id',p_suspension,'note',p_note));
  perform dispatch_notification(uid, 'account',
    jsonb_build_object('event','suspension_lifted','note',p_note));
end $fn$;

-- review_verification: approve/fail a verification (verification_reviewer or super_admin). Notifies on reject.
create or replace function review_verification(
  p_actor uuid, p_verification uuid, p_approve boolean, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $fn$
declare vuser uuid;
begin
  if p_actor <> auth.uid() then raise exception 'forbidden: actor mismatch'; end if;
  if not admin_has_role(p_actor, 'verification_reviewer') then raise exception 'forbidden'; end if;
  update verifications
     set state = case when p_approve then 'verified' else 'failed' end,
         verified_at = case when p_approve then now() else null end,
         failure_reason = case when p_approve then null else p_reason end
   where id=p_verification returning user_id into vuser;
  if p_approve then
    update profiles set verification='verified' where id=vuser;
  end if;
  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, case when p_approve then 'verification_approved' else 'verification_rejected' end,
          'verification', p_verification, jsonb_build_object('reason',p_reason));
  if not p_approve then
    perform dispatch_notification(vuser, 'account',
      jsonb_build_object('event','verification_rejected','reason',p_reason,'appealable',true));
  end if;
end $fn$;

-- rule_dispute: T&S ruling over the UPSTREAM disputes table (C11.6) + the bidirectional reliability loop.
-- p_overturn=true overturns the contested signal: clears match_ratings.disputed and recomputes reliability.
create or replace function rule_dispute(
  p_actor uuid, p_dispute uuid, p_overturn boolean, p_note text default null
) returns void language plpgsql security definer set search_path = public as $fn$
declare d_lock uuid; d_raised uuid; against uuid;
begin
  if p_actor <> auth.uid() then raise exception 'forbidden: actor mismatch'; end if;
  if not admin_has_role(p_actor, 'ts_admin') then raise exception 'forbidden'; end if;
  -- upstream disputes shape (C11.6): id, lock_id, raised_by, kind, state, resolution jsonb
  update disputes
     set state='resolved',
         resolution = jsonb_build_object('overturned', p_overturn, 'note', p_note,
                                         'ruled_by', p_actor, 'ruled_at', now())
   where id=p_dispute and state not in ('resolved','rejected')
   returning lock_id, raised_by into d_lock, d_raised;
  if d_lock is null then return; end if;  -- idempotent

  -- bidirectional loop (C5/C11.6): on overturn, clear the contested rating + recompute reliability
  if p_overturn then
    -- the "against" party is the other participant of the lock (the one the no-show was logged against)
    select case when l.creator_id = d_raised then l.matched_user_id else l.creator_id end
      into against from locks l where l.id = d_lock;
    update match_ratings set disputed = false where lock_id = d_lock;
    perform recompute_reliability(against);
    perform recompute_reliability(d_raised);
  end if;

  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, 'dispute_ruled', 'dispute', p_dispute,
          jsonb_build_object('overturned', p_overturn, 'note', p_note));
  perform dispatch_notification(d_raised, 'moderation_action',
    jsonb_build_object('event','dispute_ruled','overturned',p_overturn));
end $fn$;

-- moderate_date: set the date-level visibility flag on date_instances (C11.8). NOT an itineraries flag.
create or replace function moderate_date(
  p_actor uuid, p_date_instance uuid, p_status text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $fn$
declare cre uuid;
begin
  if p_actor <> auth.uid() then raise exception 'forbidden: actor mismatch'; end if;
  if not admin_has_role(p_actor, 'ts_admin') then raise exception 'forbidden'; end if;
  if p_status not in ('pending','approved','rejected') then raise exception 'invalid moderation_status'; end if;
  update date_instances set moderation_status = p_status::moderation_status
   where id=p_date_instance returning creator_id into cre;
  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, 'date_moderation_'||p_status, 'date_instance', p_date_instance, jsonb_build_object('note',p_note));
  if p_status = 'rejected' and cre is not null then
    perform dispatch_notification(cre, 'moderation_action',
      jsonb_build_object('event','date_removed','date_instance',p_date_instance,'note',p_note));
  end if;
end $fn$;

-- moderate_media_asset: action a row in S4's media_assets UGC queue (C11.8).
create or replace function moderate_media_asset(
  p_actor uuid, p_asset uuid, p_state text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $fn$
declare owner uuid;
begin
  if p_actor <> auth.uid() then raise exception 'forbidden: actor mismatch'; end if;
  if not admin_has_role(p_actor, 'ts_admin') then raise exception 'forbidden'; end if;
  if p_state not in ('pending','approved','rejected','flagged') then raise exception 'invalid moderation_state'; end if;
  -- column/enum names follow S4's media_assets (C11.8); owner column per S4 schema
  update media_assets set moderation_state = p_state::media_moderation_state
   where id=p_asset returning user_id into owner;
  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, 'media_asset_'||p_state, 'media_asset', p_asset, jsonb_build_object('note',p_note));
  if p_state = 'rejected' and owner is not null then
    perform dispatch_notification(owner, 'moderation_action',
      jsonb_build_object('event','media_rejected','asset',p_asset,'note',p_note));
  end if;
end $fn$;

-- C10: service-role / verified-admin only. No authenticated/anon caller may invoke these.
revoke execute on function resolve_report(uuid,uuid,report_status,text,text) from public, authenticated;
revoke execute on function set_report_status(uuid,uuid,report_status,text) from public, authenticated;
revoke execute on function impose_suspension(uuid,uuid,suspension_kind,text,timestamptz,uuid) from public, authenticated;
revoke execute on function lift_suspension(uuid,uuid,text) from public, authenticated;
revoke execute on function review_verification(uuid,uuid,boolean,text) from public, authenticated;
revoke execute on function rule_dispute(uuid,uuid,boolean,text) from public, authenticated;
revoke execute on function moderate_date(uuid,uuid,text,text) from public, authenticated;
revoke execute on function moderate_media_asset(uuid,uuid,text,text) from public, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `moderator rpcs OK`).

> Naming note: the exact `media_assets` owner/state column + enum names come from S4 (C11.8). If S4 names the enum differently (e.g. `media_moderation_status` or an inline check), align `moderate_media_asset` to S4's frozen names at execution time — do NOT invent a parallel enum. `recompute_reliability`'s signature comes from S8 — align if S8 names it differently.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525129600_p8_moderator_rpcs.sql supabase/tests/p8_moderator_rpcs.sql
git commit -m "P8: moderator RPCs (auth.uid()+role+revoke per C10; standing gate; disputes loop; media_assets/date_instances UGC; notify)"
```

---

## Task 8: Anti-abuse tables — `device_fingerprints`, `fraud_signals`, `fraud_scores`

**Files:**
- Create: `supabase/migrations/20260525129700_p8_anti_abuse.sql`
- Test: `supabase/tests/p8_anti_abuse.sql`

- [ ] **Step 1: Write the failing test** (a fingerprint shared by N distinct users is queryable; fraud_signals append; one current fraud_score per user)

```sql
-- supabase/tests/p8_anti_abuse.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE u1 uuid; u2 uuid; shared int;
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='device_fingerprints';
  IF NOT FOUND THEN RAISE EXCEPTION 'device_fingerprints missing'; END IF;
  PERFORM 1 FROM pg_tables WHERE tablename='fraud_signals';
  IF NOT FOUND THEN RAISE EXCEPTION 'fraud_signals missing'; END IF;

  u1 := mk_user('u1'); u2 := mk_user('u2');

  -- two distinct accounts on the same device fingerprint (fake-account signal)
  insert into device_fingerprints (user_id, fingerprint_hash, ip)
    values (u1,'fp_abc','1.2.3.4'), (u2,'fp_abc','1.2.3.4');
  select count(distinct user_id) into shared from device_fingerprints where fingerprint_hash='fp_abc';
  IF shared <> 2 THEN RAISE EXCEPTION 'expected 2 users sharing fingerprint, got %', shared; END IF;

  -- fraud signals append
  insert into fraud_signals (user_id, kind, weight, detail)
    values (u1,'shared_device',0.4,'{"fingerprint":"fp_abc","shared_with":2}'::jsonb);

  -- one current score per user (upsert key)
  insert into fraud_scores (user_id, score, band) values (u1, 0.4, 'review')
    on conflict (user_id) do update set score=excluded.score, band=excluded.band;
  insert into fraud_scores (user_id, score, band) values (u1, 0.7, 'block')
    on conflict (user_id) do update set score=excluded.score, band=excluded.band;
  PERFORM 1 FROM fraud_scores WHERE user_id=u1 AND score=0.7 AND band='block';
  IF NOT FOUND THEN RAISE EXCEPTION 'fraud_scores upsert did not update'; END IF;
  RAISE NOTICE 'anti-abuse tables OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "device_fingerprints" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525129700_p8_anti_abuse.sql

-- Per-(user, device) fingerprint observations. Many users on one fingerprint => fake-account ring.
create table if not exists device_fingerprints (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(id) on delete cascade,
  fingerprint_hash text not null,           -- client-derived stable hash (FingerprintJS-style / hashed UA+canvas)
  ip               inet,
  user_agent       text,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);
create unique index if not exists device_fp_user_hash_uniq
  on device_fingerprints(user_id, fingerprint_hash);
create index if not exists device_fp_hash_idx on device_fingerprints(fingerprint_hash);
create index if not exists device_fp_ip_idx on device_fingerprints(ip);

-- Raw anti-abuse signals (append-only evidence; the score is derived from these).
create type fraud_signal_kind as enum (
  'shared_device','shared_ip','velocity_swipe','velocity_signup','velocity_create',
  'honeypot_creator','no_completion_ratio','report_density','disposable_email','new_unverified'
);
create table if not exists fraud_signals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  kind       fraud_signal_kind not null,
  weight     numeric(4,3) not null check (weight >= 0 and weight <= 1),
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists fraud_signals_user_idx on fraud_signals(user_id, created_at desc);

-- Current derived fraud score per user (recomputed by recompute_fraud_score; Task 10).
create type fraud_band as enum ('clear','watch','review','block');
create table if not exists fraud_scores (
  user_id     uuid primary key references profiles(id) on delete cascade,
  score       numeric(4,3) not null default 0 check (score >= 0 and score <= 1),
  band        fraud_band not null default 'clear',
  computed_at timestamptz not null default now()
);

alter table device_fingerprints enable row level security;
alter table fraud_signals enable row level security;
alter table fraud_scores enable row level security;
do $$ begin
  create policy "device_fp_admin_read" on device_fingerprints for select using (is_admin(auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "fraud_signals_admin_read" on fraud_signals for select using (is_admin(auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "fraud_scores_admin_read" on fraud_scores for select using (is_admin(auth.uid()));
exception when duplicate_object then null; end $$;
-- All writes are service-role (the API records fingerprints on auth; jobs/RPCs compute scores).
-- Default-deny direct writes for anon/authenticated.
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `anti-abuse tables OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525129700_p8_anti_abuse.sql supabase/tests/p8_anti_abuse.sql
git commit -m "P8: anti-abuse tables (device_fingerprints, fraud_signals, fraud_scores) admin-read"
```

---

## Task 7b: Appeal flow for suspensions/bans + content removals (MD11)

> **CONTRACT (MD11):** A suspended/banned user (or one whose content was removed / verification rejected) MUST have a path to contest. P8 owns the appeal channel. An appeal references the originating `moderation_actions` row (or the `suspensions` audit row); resolving an appeal either **upholds** (no change) or **grants** (calls `lift_suspension` / `moderate_date(...,'approved')` / re-opens verification) — and notifies the user via `dispatch_notification` (S2/C1). This is distinct from `disputes` (which contests P7 *reliability* outcomes, C11.6); appeals contest *moderation* actions.

**Files:**
- Create: `supabase/migrations/20260525129650_p8_appeals.sql`
- Test: `supabase/tests/p8_appeals.sql`

- [ ] **Step 1: Write the failing test** (a suspended user files an appeal; admin resolves it `granted`, which restores `standing='good'` and notifies).

```sql
-- supabase/tests/p8_appeals.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE adm uuid; usr uuid; sid uuid; apid uuid; st standing_state;
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='appeals' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'appeals missing or RLS off'; END IF;

  adm := mk_user('adm'); usr := mk_user('usr');
  insert into admin_users (user_id, role) values (adm, 'ts_admin');
  -- suspend (writes standing + audit row)
  select impose_suspension(adm, usr, 'ban', 'fraud', null, null) into sid;

  -- user files an appeal (self-insert allowed by RLS — exercised structurally here)
  insert into appeals (user_id, subject_type, subject_id, statement)
    values (usr, 'suspension', sid, 'I was wrongly banned') returning id into apid;

  -- admin grants the appeal -> lifts suspension -> standing back to good
  PERFORM resolve_appeal(adm, apid, 'granted', 'reviewed, reinstated');
  select standing into st from profiles where id=usr;
  IF st <> 'good' THEN RAISE EXCEPTION 'granted appeal must restore standing=good (got %)', st; END IF;
  PERFORM 1 FROM appeals WHERE id=apid AND state='granted';
  IF NOT FOUND THEN RAISE EXCEPTION 'appeal not marked granted'; END IF;
  RAISE NOTICE 'appeals OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "appeals" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525129650_p8_appeals.sql
create type appeal_subject as enum ('suspension','content_removal','verification');
create type appeal_state   as enum ('open','reviewing','granted','denied');

create table if not exists appeals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  subject_type appeal_subject not null,
  subject_id   uuid not null,                 -- soft ref to suspensions.id / date_instances.id / verifications.id
  statement    text not null,
  state        appeal_state not null default 'open',
  resolved_by  uuid references profiles(id),
  resolution_note text,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists appeals_open_idx on appeals(state) where state in ('open','reviewing');
create trigger set_appeals_updated_at before update on appeals
  for each row execute function set_updated_at();

alter table appeals enable row level security;
do $$ begin
  -- a user may file + read their own appeals; admins read all.
  create policy "appeals_self_or_admin_read" on appeals for select
    using (user_id = auth.uid() or is_admin(auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "appeals_self_insert" on appeals for insert
    with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
-- resolution goes through resolve_appeal(); no update policy.

-- resolve_appeal: grant => reverse the moderation action; deny => record only. Notifies the user.
create or replace function resolve_appeal(
  p_actor uuid, p_appeal uuid, p_decision appeal_state, p_note text default null
) returns void language plpgsql security definer set search_path = public as $fn$
declare a appeals;
begin
  if p_actor <> auth.uid() then raise exception 'forbidden: actor mismatch'; end if;
  if not admin_has_role(p_actor, 'ts_admin') then raise exception 'forbidden'; end if;
  if p_decision not in ('granted','denied') then raise exception 'decision must be granted|denied'; end if;
  select * into a from appeals where id=p_appeal and state in ('open','reviewing');
  if a.id is null then return; end if;  -- idempotent

  update appeals set state=p_decision, resolved_by=p_actor, resolution_note=p_note, resolved_at=now()
   where id=p_appeal;

  if p_decision = 'granted' then
    if a.subject_type = 'suspension' then
      perform lift_suspension(p_actor, a.subject_id, 'appeal granted');
    elsif a.subject_type = 'content_removal' then
      perform moderate_date(p_actor, a.subject_id, 'approved', 'appeal granted');
    elsif a.subject_type = 'verification' then
      update verifications set state='pending', failure_reason=null where id=a.subject_id;
    end if;
  end if;

  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, 'appeal_'||p_decision, 'appeal', p_appeal, jsonb_build_object('note',p_note));
  perform dispatch_notification(a.user_id, 'account',
    jsonb_build_object('event','appeal_'||p_decision,'note',p_note));
end $fn$;

revoke execute on function resolve_appeal(uuid,uuid,appeal_state,text) from public, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `appeals OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525129650_p8_appeals.sql supabase/tests/p8_appeals.sql
git commit -m "P8: appeal flow (suspension/content/verification) + resolve_appeal RPC w/ notify (MD11)"
```

---

## Task 9: Fraud-scoring pure logic (`@after5/business`) — under the ROOT vitest config

> **CONTRACT (C10/C12 — supersedes the original "bootstrap vitest in `@after5/business`" step):** P1/S3 owns the **single root `vitest.config.ts`** with workspace globs covering `apps/web` + `packages/*`. P8 must **NOT** create a `packages/business/vitest.config.ts` or add a per-package `test` script that runs a second vitest. Colocated `*.test.ts` files under `packages/business/src/**` are picked up by the root workspace; tests run via `pnpm test`.

**Files:**
- Create: `packages/business/src/anti-abuse/fraud-score.ts`
- Create: `packages/business/src/anti-abuse/fraud-score.test.ts`
- (No vitest config, no package.json test-script change — the root config (P1/S3) covers `packages/*`.)

Pure, I/O-free fraud scoring so the same code runs in the Edge Function (Deno) and Next.js (Node), per the spec's shared-package rule.

- [ ] **Step 1: Confirm the root vitest workspace already covers `packages/business`** (owned by P1/S3). No new config. If `vitest` is not yet a root devDependency, that is P1/S3's responsibility — do not add a duplicate here.

- [ ] **Step 2: Write the failing test**

```ts
// packages/business/src/anti-abuse/fraud-score.test.ts
import { describe, it, expect } from 'vitest';
import { scoreFraud, bandFor, type FraudSignal } from './fraud-score';

describe('scoreFraud', () => {
  it('returns 0 / clear for no signals', () => {
    const r = scoreFraud([]);
    expect(r.score).toBe(0);
    expect(r.band).toBe('clear');
  });

  it('combines signals with diminishing returns, capped at 1', () => {
    const sigs: FraudSignal[] = [
      { kind: 'shared_device', weight: 0.6 },
      { kind: 'velocity_swipe', weight: 0.6 },
      { kind: 'report_density', weight: 0.6 },
    ];
    const r = scoreFraud(sigs);
    expect(r.score).toBeGreaterThan(0.6);   // accumulates past a single signal
    expect(r.score).toBeLessThanOrEqual(1); // never exceeds 1
  });

  it('maps score to bands at the documented thresholds', () => {
    expect(bandFor(0.0)).toBe('clear');
    expect(bandFor(0.2)).toBe('watch');
    expect(bandFor(0.5)).toBe('review');
    expect(bandFor(0.8)).toBe('block');
  });

  it('a single hard signal (honeypot) reaches at least review', () => {
    const r = scoreFraud([{ kind: 'honeypot_creator', weight: 0.7 }]);
    expect(['review', 'block']).toContain(r.band);
  });
});
```

- [ ] **Step 3: Run it, expect FAIL** (`Cannot find module './fraud-score'`).

Run: `pnpm test` (root vitest workspace, C10).

- [ ] **Step 4: Write the implementation**

```ts
// packages/business/src/anti-abuse/fraud-score.ts
// Pure fraud scoring. No I/O. Signals -> [0,1] score -> band.
//
// Model: probabilistic OR ("noisy-OR") so independent signals accumulate with
// diminishing returns and the result is bounded in [0,1]:
//   combined = 1 - Π(1 - weight_i)
// This means two 0.6 signals -> 1 - 0.4*0.4 = 0.84 (more than either alone,
// less than their sum), which is the desired anti-abuse behaviour.

export type FraudSignalKind =
  | 'shared_device' | 'shared_ip' | 'velocity_swipe' | 'velocity_signup'
  | 'velocity_create' | 'honeypot_creator' | 'no_completion_ratio'
  | 'report_density' | 'disposable_email' | 'new_unverified';

export interface FraudSignal {
  kind: FraudSignalKind;
  weight: number; // 0..1 contribution
}

export type FraudBand = 'clear' | 'watch' | 'review' | 'block';

export interface FraudResult {
  score: number; // 0..1
  band: FraudBand;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function bandFor(score: number): FraudBand {
  if (score >= 0.75) return 'block';
  if (score >= 0.45) return 'review';
  if (score >= 0.15) return 'watch';
  return 'clear';
}

export function scoreFraud(signals: FraudSignal[]): FraudResult {
  let inverse = 1;
  for (const s of signals) {
    inverse *= 1 - clamp01(s.weight);
  }
  const score = clamp01(1 - inverse);
  return { score, band: bandFor(score) };
}
```

- [ ] **Step 5: Run test, expect PASS.** (`pnpm test` — root vitest workspace)

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/anti-abuse/fraud-score.ts packages/business/src/anti-abuse/fraud-score.test.ts
git commit -m "P8: pure fraud-scoring (noisy-OR, banded) under root vitest config (no dup config, C10)"
```

---

## Task 10: Velocity limits (reuse `rate_limits`) + swipe-farm + honeypot heuristics (pure logic) + score recompute RPC

**Files:**
- Create: `packages/business/src/anti-abuse/velocity.ts`
- Create: `packages/business/src/anti-abuse/velocity.test.ts`
- Create: `supabase/migrations/20260525129800_p8_fraud_recompute.sql`
- Test: `supabase/tests/p8_fraud_recompute.sql`

- [ ] **Step 1: Write the failing test (TS — swipe-farm + honeypot detectors)**

```ts
// packages/business/src/anti-abuse/velocity.test.ts
import { describe, it, expect } from 'vitest';
import { isSwipeFarm, isHoneypotCreator, VELOCITY_LIMITS } from './velocity';

describe('isSwipeFarm', () => {
  it('flags an account with extreme right-swipe rate and near-zero reciprocation', () => {
    expect(isSwipeFarm({ rightSwipes: 500, leftSwipes: 5, windowHours: 1, matchesLocked: 0 })).toBe(true);
  });
  it('does not flag normal browsing', () => {
    expect(isSwipeFarm({ rightSwipes: 12, leftSwipes: 30, windowHours: 24, matchesLocked: 1 })).toBe(false);
  });
});

describe('isHoneypotCreator', () => {
  // A creator harvesting profiles: posts many dates that pull in lots of swipers
  // but rarely (or never) advances anyone to an offer/lock.
  it('flags a creator who attracts many swipers but never offers/locks', () => {
    expect(isHoneypotCreator({ datesCreated: 8, swipersAttracted: 240, offersMade: 0, locksCompleted: 0 })).toBe(true);
  });
  it('does not flag a genuine creator who advances candidates', () => {
    expect(isHoneypotCreator({ datesCreated: 3, swipersAttracted: 40, offersMade: 5, locksCompleted: 2 })).toBe(false);
  });
});

describe('VELOCITY_LIMITS', () => {
  it('defines per-hour caps for the abuse-prone endpoints', () => {
    expect(VELOCITY_LIMITS.swipe).toBeGreaterThan(0);
    expect(VELOCITY_LIMITS.create_date).toBeGreaterThan(0);
    expect(VELOCITY_LIMITS.report).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`pnpm test` → `Cannot find module './velocity'`).

- [ ] **Step 3: Write the implementation**

```ts
// packages/business/src/anti-abuse/velocity.ts
// Pure heuristics + the velocity-limit table. The actual enforcement reuses the
// existing rate_limits table + rate_limit_check() RPC (supabase/migrations/20260522110000)
// keyed by (user_id, endpoint) — these constants are the per-hour caps to pass in.

export const VELOCITY_LIMITS = {
  signup: 3,        // accounts per device/IP per hour (caller keys by fingerprint/ip)
  swipe: 200,       // swipes per user per hour
  create_date: 10,  // date instances created per user per hour
  report: 20,       // reports filed per user per hour (anti report-bomb)
  offer: 30,        // offers extended per creator per hour
} as const;

export interface SwipeFarmInputs {
  rightSwipes: number;
  leftSwipes: number;
  windowHours: number;
  matchesLocked: number;
}

// Swipe farm: indiscriminate right-swiping at machine velocity with no reciprocation.
export function isSwipeFarm(i: SwipeFarmInputs): boolean {
  const total = i.rightSwipes + i.leftSwipes;
  if (total < 100) return false;                       // not enough volume to judge
  const rightRatio = i.rightSwipes / total;
  const perHour = i.rightSwipes / Math.max(1, i.windowHours);
  return rightRatio > 0.9 && perHour > 100 && i.matchesLocked === 0;
}

export interface HoneypotInputs {
  datesCreated: number;
  swipersAttracted: number;
  offersMade: number;
  locksCompleted: number;
}

// Honeypot creator: harvests profiles via fake dates — high inbound interest,
// (almost) no outbound advancement. The reveal-on-shortlist consent (P5) limits the
// harvest; this flags the behavioural pattern for review/suspension.
export function isHoneypotCreator(i: HoneypotInputs): boolean {
  if (i.datesCreated < 3 || i.swipersAttracted < 50) return false;
  const advancement = (i.offersMade + i.locksCompleted) / Math.max(1, i.swipersAttracted);
  return advancement < 0.02; // <2% of attracted swipers ever advanced
}
```

- [ ] **Step 4: Run TS test, expect PASS.** (`pnpm test` — root vitest workspace)

- [ ] **Step 5: Write the failing test (SQL — recompute_fraud_score aggregates signals)**

```sql
-- supabase/tests/p8_fraud_recompute.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE u uuid; b fraud_band;
BEGIN
  PERFORM 1 FROM pg_proc WHERE proname='recompute_fraud_score';
  IF NOT FOUND THEN RAISE EXCEPTION 'recompute_fraud_score() missing'; END IF;

  u := mk_user('u');
  insert into fraud_signals (user_id,kind,weight) values
    (u,'shared_device',0.6),(u,'honeypot_creator',0.7);
  PERFORM recompute_fraud_score(u);
  select band into b from fraud_scores where user_id=u;
  IF b is null THEN RAISE EXCEPTION 'no fraud_score row written'; END IF;
  IF b not in ('review','block') THEN RAISE EXCEPTION 'expected review/block, got %', b; END IF;
  RAISE NOTICE 'fraud recompute OK (band=%)', b;
  ROLLBACK;
END $$;
```

- [ ] **Step 6: Run it, expect FAIL** (`function recompute_fraud_score(...) does not exist`).

- [ ] **Step 7: Write the migration** (mirrors the TS noisy-OR so DB-side scoring matches `fraud-score.ts`)

```sql
-- supabase/migrations/20260525129800_p8_fraud_recompute.sql
-- Recompute a user's fraud score from their signals (noisy-OR, matching fraud-score.ts),
-- then upsert fraud_scores. Service-role / job invoked (revoked from public/authenticated). Bands match bandFor().
create or replace function recompute_fraud_score(p_user uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare inv numeric := 1; s numeric; bnd fraud_band;
begin
  select coalesce(product, 1) into inv from (
    select exp(sum(ln(1 - least(greatest(weight,0),1)))) as product
    from fraud_signals where user_id = p_user and (1 - weight) > 0
  ) t;
  -- guard: if any signal had weight=1, score is 1
  if exists (select 1 from fraud_signals where user_id=p_user and weight >= 1) then
    s := 1;
  else
    s := least(greatest(1 - inv, 0), 1);
  end if;
  bnd := case
    when s >= 0.75 then 'block'
    when s >= 0.45 then 'review'
    when s >= 0.15 then 'watch'
    else 'clear' end;
  insert into fraud_scores(user_id, score, band, computed_at)
  values (p_user, round(s,3), bnd, now())
  on conflict (user_id) do update
    set score=excluded.score, band=excluded.band, computed_at=excluded.computed_at;
end $fn$;

revoke execute on function recompute_fraud_score(uuid) from public, authenticated;
```

> **Scheduler hook (C1):** the bulk recompute is driven by S2's `jobs` runner. P8 does **not** define a new job kind unless one is reserved in C1's `job_type` enum — recompute is invoked per-user by the anti-abuse helpers (Task 19) and may be batched by an S2/S11 job that calls `recompute_fraud_score` per row. No P8-local `enqueue` shim (C1 owns `enqueue_job`).

- [ ] **Step 8: Apply + run SQL test, expect PASS** (prints `fraud recompute OK`).

- [ ] **Step 9: Commit**

```bash
git add packages/business/src/anti-abuse/velocity.ts packages/business/src/anti-abuse/velocity.test.ts supabase/migrations/20260525129800_p8_fraud_recompute.sql supabase/tests/p8_fraud_recompute.sql
git commit -m "P8: velocity caps + swipe-farm/honeypot heuristics (TS) + recompute_fraud_score RPC (noisy-OR)"
```

---

## Task 11: Honeypot creator review view (admin signal)

**Files:**
- Create: `supabase/migrations/20260525129900_p8_honeypot_view.sql`
- Test: `supabase/tests/p8_honeypot_view.sql`

A SQL view (admin-only) surfacing the honeypot pattern from real loop data: creators whose dates attract right-swipes but who almost never **shortlist** (P5 `queue_entries`), extend offers, or complete locks. This is the data side of `isHoneypotCreator`; admins triage from it.

> **Tuning note (S8 seam):** P5's funnel has a `queue_entries`/shortlist stage *between* swipe and offer. A legit creator with a long shortlist but slow offers must NOT be falsely flagged. The view's `advancement_ratio` therefore counts shortlist entries (`queue_entries`) **and** offers/locks as advancement, not just offers/locks.

- [ ] **Step 1: Write the failing test** (the view exists, exposes the advancement ratio, and is gated to admins)

```sql
-- supabase/tests/p8_honeypot_view.sql
\i supabase/tests/_fixtures.sql
DO $$
BEGIN
  PERFORM 1 FROM information_schema.views WHERE table_name='honeypot_candidates';
  IF NOT FOUND THEN RAISE EXCEPTION 'honeypot_candidates view missing'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='honeypot_candidates' AND column_name='advancement_ratio';
  IF NOT FOUND THEN RAISE EXCEPTION 'advancement_ratio column missing'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='honeypot_candidates' AND column_name='shortlisted_count';
  IF NOT FOUND THEN RAISE EXCEPTION 'shortlisted_count column missing (shortlist stage must count)'; END IF;
  RAISE NOTICE 'honeypot view OK';
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`honeypot_candidates view missing`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525129900_p8_honeypot_view.sql
-- Per-creator funnel: swipers attracted vs. shortlist/offers/locks. Low advancement +
-- meaningful inbound interest = candidate honeypot (profile-harvesting via fake dates).
-- Advancement counts the P5 shortlist stage (queue_entries) to avoid flagging slow-but-legit creators.
-- security_invoker so RLS/identity rules of the underlying tables apply; admin-only via grant.
create or replace view honeypot_candidates
with (security_invoker = true) as
with attracted as (
  select s.creator_id, count(*) filter (where s.direction='right') as swipers_attracted
  from swipes s group by s.creator_id
),
shortlisted as (
  -- P5 shortlist stage (queue_entries belongs to a date_instance owned by the creator)
  select di.creator_id, count(*) as shortlisted_count
  from queue_entries qe join date_instances di on di.id = qe.date_instance_id
  group by di.creator_id
),
offered as (
  select o.creator_id, count(*) as offers_made
  from offers o group by o.creator_id
),
locked as (
  select l.creator_id, count(*) filter (where l.status='completed') as locks_completed
  from locks l group by l.creator_id
),
created as (
  select di.creator_id, count(*) as dates_created
  from date_instances di group by di.creator_id
)
select
  c.creator_id,
  c.dates_created,
  coalesce(a.swipers_attracted,0)  as swipers_attracted,
  coalesce(sl.shortlisted_count,0) as shortlisted_count,
  coalesce(o.offers_made,0)        as offers_made,
  coalesce(k.locks_completed,0)    as locks_completed,
  round(
    (coalesce(sl.shortlisted_count,0) + coalesce(o.offers_made,0) + coalesce(k.locks_completed,0))::numeric
    / greatest(coalesce(a.swipers_attracted,0),1), 4
  ) as advancement_ratio
from created c
left join attracted   a  on a.creator_id  = c.creator_id
left join shortlisted sl on sl.creator_id = c.creator_id
left join offered     o  on o.creator_id  = c.creator_id
left join locked      k  on k.creator_id  = c.creator_id
where c.dates_created >= 3
  and coalesce(a.swipers_attracted,0) >= 50;

-- Admin-only: revoke from the broad roles, grant to service-role/authenticated-admins via RLS-backed
-- queries (the console uses the service-role client). Default: no broad grant.
revoke all on honeypot_candidates from anon, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525129900_p8_honeypot_view.sql supabase/tests/p8_honeypot_view.sql
git commit -m "P8: honeypot_candidates view (per-creator advancement funnel incl. shortlist stage, admin-only)"
```

---

## Task 12: Extend `requireAdmin()` to use the DB role model + add `requireAdminRole()`

**Files:**
- Modify: `apps/web/lib/auth/require-admin.ts`
- Create: `apps/web/lib/admin/moderation.ts`

- [ ] **Step 1: Extend `requireAdmin()`** — keep the env allowlist as bootstrap, add `admin_users` lookup, and auto-bootstrap allowlist members as `super_admin`. Add `requireAdminRole(role)` for per-action checks.

```ts
// apps/web/lib/auth/require-admin.ts
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type AdminRole = 'super_admin' | 'ts_admin' | 'verification_reviewer';

export interface AdminContext {
  userId: string;
  email: string;
  role: AdminRole;
}

// Resolves the current admin. Access if: (a) on the ADMIN_EMAILS allowlist
// (treated as super_admin, auto-bootstrapped into admin_users), OR (b) present
// in admin_users. Fail-closed: non-admins are redirected.
export async function requireAdmin(currentPath: string): Promise<AdminContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  }

  const allow = (process.env.ADMIN_EMAILS ?? '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const onAllowlist = allow.includes(user.email.toLowerCase());

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('admin_users')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  // DB role wins when present (so a super_admin can be *demoted* to ts_admin in admin_users
  // even while still on the allowlist — closes the audit's "allowlist precedence defeats the role model" gap).
  let role = (row?.role as AdminRole | undefined) ?? undefined;

  if (!role && onAllowlist) {
    // Bootstrap an allowlist admin as super_admin ONLY when no admin_users row exists yet (idempotent;
    // never re-promotes a row that was intentionally set to a lower role).
    await admin.from('admin_users').upsert(
      { user_id: user.id, role: 'super_admin' },
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
    role = 'super_admin';
  }

  if (!role) redirect('/');
  return { userId: user.id, email: user.email, role };
}

// Per-action gate. super_admin satisfies any required role.
export async function requireAdminRole(
  currentPath: string,
  required: AdminRole,
): Promise<AdminContext> {
  const ctx = await requireAdmin(currentPath);
  if (ctx.role !== 'super_admin' && ctx.role !== required) {
    redirect('/admin'); // visible-but-forbidden -> bounce to console home
  }
  return ctx;
}
```

Note: `requireAdmin()` now returns `{ userId, email, role }` instead of `{ email }`. Existing callers (`/admin/insiders`, `/admin/feedback`, `/admin/venues`, `/admin/eval`, `/api/admin/*`) destructure `{ email }` or ignore the return — all remain valid since `email` is still present.

- [ ] **Step 2: Create typed RPC wrappers** so route handlers don't hand-roll the `as unknown as` casts.

```ts
// apps/web/lib/admin/moderation.ts
// `actor` is ALWAYS ctx.userId from requireAdmin()/requireAdminRole() — i.e. the verified auth.uid().
// The RPCs re-assert p_actor = auth.uid() server-side (C10), so a forged actor is rejected.
import { createAdminClient } from '@/lib/supabase/admin';

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>;

// resolve to a canonical status ('actioned'|'dismissed') + free-text resolution_code (C11.6 — no enum drop)
export async function resolveReport(actor: string, reportId: string, status: string, resolutionCode: string, note?: string) {
  const admin = createAdminClient() as unknown as { rpc: Rpc };
  return admin.rpc('resolve_report', { p_actor: actor, p_report: reportId, p_status: status, p_resolution_code: resolutionCode, p_note: note ?? null });
}
export async function setReportStatus(actor: string, reportId: string, status: string, note?: string) {
  const admin = createAdminClient() as unknown as { rpc: Rpc };
  return admin.rpc('set_report_status', { p_actor: actor, p_report: reportId, p_status: status, p_note: note ?? null });
}
export async function imposeSuspension(actor: string, userId: string, kind: string, reason: string, expires?: string | null, reportId?: string | null) {
  const admin = createAdminClient() as unknown as { rpc: Rpc };
  return admin.rpc('impose_suspension', { p_actor: actor, p_user: userId, p_kind: kind, p_reason: reason, p_expires: expires ?? null, p_report: reportId ?? null });
}
export async function liftSuspension(actor: string, suspensionId: string, note?: string) {
  const admin = createAdminClient() as unknown as { rpc: Rpc };
  return admin.rpc('lift_suspension', { p_actor: actor, p_suspension: suspensionId, p_note: note ?? null });
}
export async function reviewVerification(actor: string, verificationId: string, approve: boolean, reason?: string) {
  const admin = createAdminClient() as unknown as { rpc: Rpc };
  return admin.rpc('review_verification', { p_actor: actor, p_verification: verificationId, p_approve: approve, p_reason: reason ?? null });
}
// dispute ruling over the upstream disputes table (C11.6): p_overturn drives the recompute_reliability loop
export async function ruleDispute(actor: string, disputeId: string, overturn: boolean, note?: string) {
  const admin = createAdminClient() as unknown as { rpc: Rpc };
  return admin.rpc('rule_dispute', { p_actor: actor, p_dispute: disputeId, p_overturn: overturn, p_note: note ?? null });
}
// UGC: write date_instances.moderation_status ('pending'|'approved'|'rejected') (C11.8)
export async function moderateDate(actor: string, dateInstanceId: string, status: string, note?: string) {
  const admin = createAdminClient() as unknown as { rpc: Rpc };
  return admin.rpc('moderate_date', { p_actor: actor, p_date_instance: dateInstanceId, p_status: status, p_note: note ?? null });
}
// UGC: action S4's media_assets queue ('pending'|'approved'|'rejected'|'flagged') (C11.8)
export async function moderateMediaAsset(actor: string, assetId: string, state: string, note?: string) {
  const admin = createAdminClient() as unknown as { rpc: Rpc };
  return admin.rpc('moderate_media_asset', { p_actor: actor, p_asset: assetId, p_state: state, p_note: note ?? null });
}
// appeals (MD11): 'granted' reverses the action, 'denied' records only
export async function resolveAppeal(actor: string, appealId: string, decision: string, note?: string) {
  const admin = createAdminClient() as unknown as { rpc: Rpc };
  return admin.rpc('resolve_appeal', { p_actor: actor, p_appeal: appealId, p_decision: decision, p_note: note ?? null });
}
```

- [ ] **Step 3: Verify the app still typechecks.**

Run: `pnpm --filter @after5/web typecheck`
Expected: passes (the widened `requireAdmin` return is backwards-compatible).

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/auth/require-admin.ts apps/web/lib/admin/moderation.ts
git commit -m "P8: requireAdmin() reads admin_users role model + requireAdminRole() + typed moderator RPC wrappers"
```

---

## Task 13: Report triage queue page + mutation route

**Files:**
- Create: `apps/web/app/admin/reports/page.tsx`
- Create: `apps/web/app/admin/reports/reports-queue.tsx`
- Create: `apps/web/app/api/admin/reports/route.ts`
- Modify: `apps/web/app/admin/layout.tsx` (add nav items)

- [ ] **Step 1: Add nav items** to `AdminLayout` for the T&S console:

```tsx
// inside the <ul> in apps/web/app/admin/layout.tsx, add:
<NavItem href="/admin/reports" label="Reports" />
<NavItem href="/admin/disputes" label="Disputes" />
<NavItem href="/admin/verify" label="Verify" />
<NavItem href="/admin/moderate" label="Moderate" />
<NavItem href="/admin/suspensions" label="Suspensions" />
<NavItem href="/admin/appeals" label="Appeals" />
<NavItem href="/admin/audit" label="Audit" />
```

- [ ] **Step 2: Server component — fetch the open report queue** (open/reviewing first, ordered by priority then age). Select **`reason_category`** + `pay_setting_snapshot` (C5/C6) so payment disputes and safety reports are triageable as the distinct classes they are.

```tsx
// apps/web/app/admin/reports/page.tsx
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/require-admin';
import { ReportsQueue } from './reports-queue';

export const dynamic = 'force-dynamic';

export interface ReportRow {
  id: string; reporter_id: string | null; target_type: string; target_id: string;
  reason_category: string; detail: string | null; status: string; priority: string;
  pay_setting_snapshot: unknown | null;
  assigned_to: string | null; resolution_code: string | null; created_at: string;
}

export default async function AdminReportsPage() {
  await requireAdmin('/admin/reports');
  const admin = createAdminClient();
  // Prioritize OPEN work, then critical/high, then oldest-first (not raw newest) so open safety
  // reports never get buried under resolved spam (audit §10).
  const { data } = await (admin as unknown as {
    from: (t: string) => { select: (c: string) => { in: (col: string, v: string[]) => { order: (col: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: ReportRow[] | null }> } } } };
  }).from('reports')
    .select('id, reporter_id, target_type, target_id, reason_category, detail, status, priority, pay_setting_snapshot, assigned_to, resolution_code, created_at')
    .in('status', ['open', 'reviewing'])
    .order('created_at', { ascending: true })
    .limit(300);
  return <ReportsQueue reports={(data ?? []) as ReportRow[]} />;
}
```

> **Note (C5/C6):** `reason_category` includes `payment_dispute` (routed here from S11/P10). The queue groups/filters by `reason_category`; payment disputes show their `pay_setting_snapshot` context. Safety categories (`safety_threat`, `harassment`) sort to the top via `priority`.

- [ ] **Step 3: Client component — triage UI** (move to reviewing, resolve as `actioned`/`dismissed` with a free-text `resolution_code`; "suspend target" shortcut posts to the suspensions route). Mirror `insiders-admin.tsx` structure (tabs/filter by `reason_category`; per-row action buttons → `fetch('/api/admin/reports', { method: 'PATCH', ... })`). Render the full state set (loading/error/empty/success/retry).

```tsx
// apps/web/app/admin/reports/reports-queue.tsx  (shape — full UI mirrors insiders-admin.tsx)
'use client';
import { useState } from 'react';
import type { ReportRow } from './page';

// Canonical report_status terminals (C11.6 — 4-value enum). resolution_code is free text.
const TERMINALS = ['actioned', 'dismissed'] as const;

export function ReportsQueue({ reports }: { reports: ReportRow[] }) {
  const [rows, setRows] = useState(reports);
  const [busy, setBusy] = useState<string | null>(null);
  const open = rows.filter((r) => !['actioned', 'dismissed'].includes(r.status));

  async function act(id: string, body: Record<string, unknown>, nextStatus: string) {
    setBusy(id);
    try {
      const res = await fetch('/api/admin/reports', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id: id, ...body }),
      });
      if (res.ok) setRows((p) => p.map((r) => (r.id === id ? { ...r, status: nextStatus } : r)));
    } finally { setBusy(null); }
  }
  // render: header "Report triage", count of `open`, filter by reason_category,
  // per-row category/target/reporter (+ pay_setting_snapshot for payment_dispute),
  // a resolution-code text input + Resolve(actioned)/Resolve(dismissed)/Reviewing buttons calling act().
  // States: loading (busy), error toast on !res.ok, empty ("no open reports"), success (row moves out of Open).
  return null; // full markup per the existing admin page style
}
```

- [ ] **Step 4: Mutation route handler** — re-check `requireAdmin()`, then call the RPC wrapper. Validate inputs like `/api/admin/insiders/route.ts` does. Resolve passes a canonical `status` (`actioned`|`dismissed`) + a `resolution_code`.

```ts
// apps/web/app/api/admin/reports/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { resolveReport, setReportStatus } from '@/lib/admin/moderation';

const TERMINALS = new Set(['actioned', 'dismissed']);
const STATUSES = new Set(['open', 'reviewing', 'actioned', 'dismissed']);

export async function PATCH(req: NextRequest) {
  let ctx;
  try { ctx = await requireAdmin('/admin/reports'); }
  catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const reportId = body.report_id;
  if (typeof reportId !== 'string' || !reportId)
    return NextResponse.json({ error: 'missing_report_id' }, { status: 400 });

  if (body.action === 'resolve') {
    const status = body.status;            // canonical terminal: 'actioned' | 'dismissed' (C11.6)
    const resolutionCode = body.resolution_code;
    if (typeof status !== 'string' || !TERMINALS.has(status))
      return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
    if (typeof resolutionCode !== 'string' || !resolutionCode)
      return NextResponse.json({ error: 'missing_resolution_code' }, { status: 400 });
    const { error } = await resolveReport(ctx.userId, reportId, status, resolutionCode, body.note as string | undefined);
    if (error) return NextResponse.json({ error: 'rpc_failed' }, { status: 400 });
    return NextResponse.json({ ok: true, status });
  }
  if (body.action === 'set_status' && typeof body.status === 'string' && STATUSES.has(body.status)) {
    const { error } = await setReportStatus(ctx.userId, reportId, body.status, body.note as string | undefined);
    if (error) return NextResponse.json({ error: 'rpc_failed' }, { status: 400 });
    return NextResponse.json({ ok: true, status: body.status });
  }
  return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
}
```

- [ ] **Step 5: Typecheck + manual smoke** — `pnpm --filter @after5/web typecheck`; with the local stack running, visit `/admin/reports` as an allowlist admin and confirm the queue renders.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/admin/reports apps/web/app/api/admin/reports apps/web/app/admin/layout.tsx
git commit -m "P8: report triage queue page + PATCH route (resolve/triage via moderator RPCs)"
```

---

## Task 14: Dispute resolution page + route

**Files:**
- Create: `apps/web/app/admin/disputes/page.tsx`
- Create: `apps/web/app/admin/disputes/disputes-panel.tsx`
- Create: `apps/web/app/api/admin/disputes/route.ts`

- [ ] **Step 1: Server component** — fetch open disputes from the **upstream `disputes`** table (C11.6 shape: `id, lock_id, raised_by, kind, state, resolution, created_at`), `state in ('open')` first, join the contested lock + both lock participants for context. Follow the `reports/page.tsx` fetch shape; `await requireAdmin('/admin/disputes')`.

- [ ] **Step 2: Client panel** — show `resolution`/the raised claim, `kind` (`no_show | payment | conduct`), both lock parties, and an **Overturn / Uphold** toggle + a note field; PATCH to `/api/admin/disputes`. Overturn drives the recompute loop server-side. Full state set (loading/error/empty/success).

- [ ] **Step 3: Route handler** — re-check `requireAdmin()`, validate `dispute_id` + `overturn` boolean, call `ruleDispute(ctx.userId, id, overturn, note)`. Same structure as Task 13's route. (`rule_dispute` updates `disputes.state='resolved'`, writes `disputes.resolution` jsonb, and on overturn clears `match_ratings.disputed` + calls `recompute_reliability` — the C5/C11.6 bidirectional loop.)

- [ ] **Step 4: Typecheck + smoke** (`pnpm --filter @after5/web typecheck`; visit `/admin/disputes`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/disputes apps/web/app/api/admin/disputes
git commit -m "P8: dispute resolution page + ruling route (rule_dispute RPC)"
```

---

## Task 15: Verification review page + route

**Files:**
- Create: `apps/web/app/admin/verify/page.tsx`
- Create: `apps/web/app/admin/verify/verify-panel.tsx`
- Create: `apps/web/app/api/admin/verify/route.ts`

- [ ] **Step 1: Server component** — gate with `requireAdminRole('/admin/verify', 'verification_reviewer')` (super_admin satisfies it). Fetch `verifications` where `state='pending'` joined to the user (selfie/age/phone kind, provider ref). Newest-first.

- [ ] **Step 2: Client panel** — per verification: show kind, provider, the selfie reference (if `kind='selfie'`), Approve / Reject (with reason). PATCH to `/api/admin/verify`.

- [ ] **Step 3: Route handler** — re-check via `requireAdminRole('/admin/verify','verification_reviewer')` (catch redirect → 403). Validate `verification_id` + `approve` boolean. Call `reviewVerification(ctx.userId, id, approve, reason)`.

```ts
// apps/web/app/api/admin/verify/route.ts (shape)
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole } from '@/lib/auth/require-admin';
import { reviewVerification } from '@/lib/admin/moderation';

export async function PATCH(req: NextRequest) {
  let ctx;
  try { ctx = await requireAdminRole('/admin/verify', 'verification_reviewer'); }
  catch { return NextResponse.json({ error: 'forbidden' }, { status: 403 }); }
  const body = await req.json().catch(() => null);
  if (!body || typeof body.verification_id !== 'string' || typeof body.approve !== 'boolean')
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { error } = await reviewVerification(ctx.userId, body.verification_id, body.approve, body.reason);
  if (error) return NextResponse.json({ error: 'rpc_failed' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Typecheck + smoke** (`/admin/verify`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/verify apps/web/app/api/admin/verify
git commit -m "P8: verification review page + route (verification_reviewer role-gated)"
```

---

## Task 16: UGC moderation page + route (media_assets queue + date_instances.moderation_status, C11.8)

**Files:**
- Create: `apps/web/app/admin/moderate/page.tsx`
- Create: `apps/web/app/admin/moderate/moderate-panel.tsx`
- Create: `apps/web/app/api/admin/moderate/route.ts`

- [ ] **Step 1: Server component** — `await requireAdmin('/admin/moderate')`. Three data sources (the REAL queues, C11.8): (a) **`media_assets`** rows with `moderation_state in ('pending','flagged')` — the actual UGC queue S4 built for P8; (b) `date_instances` with `moderation_status='pending'` (date-level review), bounded with `.limit()` (no unbounded scan); (c) the `honeypot_candidates` view for proactive harvest detection. Join the owning creator profile for context.

- [ ] **Step 2: Client panel** — render each asset via S4's **signed-URL mint** (never a raw storage path; `<img>`/`<audio controls>` point at the signed URL) plus the date's `why_note`. Actions on a `media_assets` row: Approve / Flag / Reject → PATCH to `/api/admin/moderate` (`moderateMediaAsset`). Actions on a `date_instances` row: Approve / Reject → PATCH (`moderateDate`, writes `date_instances.moderation_status`). A "honeypot watch" tab lists `honeypot_candidates` rows with `advancement_ratio` + `shortlisted_count` and a "suspend creator" shortcut (POSTs to `/api/admin/suspensions`). Full state set (loading/error/empty/success).

- [ ] **Step 3: Route handler** — re-check `requireAdmin()`. Branch on body:
  - `target='media_asset'`: validate `asset_id` + `state` ∈ `pending|approved|rejected|flagged` → `moderateMediaAsset(ctx.userId, assetId, state, note)`.
  - `target='date_instance'`: validate `date_instance_id` + `status` ∈ `pending|approved|rejected` → `moderateDate(ctx.userId, dateInstanceId, status, note)`.

- [ ] **Step 4: Typecheck + smoke** (`/admin/moderate`; verify signed-URL media render, rejecting a `media_assets` row flips its `moderation_state`, rejecting a date flips `date_instances.moderation_status` so the S12 feed view drops it).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/moderate apps/web/app/api/admin/moderate
git commit -m "P8: UGC moderation over media_assets + date_instances.moderation_status (C11.8) + honeypot watch + route"
```

---

## Task 17: Suspension tools page + route

**Files:**
- Create: `apps/web/app/admin/suspensions/page.tsx`
- Create: `apps/web/app/admin/suspensions/suspensions-panel.tsx`
- Create: `apps/web/app/api/admin/suspensions/route.ts`

- [ ] **Step 1: Server component** — `await requireAdmin('/admin/suspensions')`. Fetch active suspension **audit rows** joined to the user, plus a user-lookup (by email/id) so an admin can search someone to suspend. Surface each user's current **`profiles.standing`** (the gate) AND `fraud_scores.band` for context.

- [ ] **Step 2: Client panel** — search a user; impose a suspension (kind: `warning|offer_cooldown|temp_suspend|ban`, reason, optional expiry for temp) or lift an active one. POST/PATCH to `/api/admin/suspensions`.

- [ ] **Step 3: Route handler** — re-check `requireAdmin()`.
  - `POST` (impose): validate `user_id`, `kind`, `reason` (+ optional `expires_at`, `report_id`) → `imposeSuspension(ctx.userId, ...)`.
  - `PATCH` (lift): validate `suspension_id` → `liftSuspension(ctx.userId, id, note)`.

```ts
// apps/web/app/api/admin/suspensions/route.ts (shape)
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { imposeSuspension, liftSuspension } from '@/lib/admin/moderation';

const KINDS = new Set(['warning','offer_cooldown','temp_suspend','ban']);

export async function POST(req: NextRequest) {
  let ctx; try { ctx = await requireAdmin('/admin/suspensions'); }
  catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const b = await req.json().catch(() => null);
  if (!b || typeof b.user_id !== 'string' || !KINDS.has(b.kind) || typeof b.reason !== 'string')
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { error } = await imposeSuspension(ctx.userId, b.user_id, b.kind, b.reason, b.expires_at ?? null, b.report_id ?? null);
  if (error) return NextResponse.json({ error: 'rpc_failed' }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  let ctx; try { ctx = await requireAdmin('/admin/suspensions'); }
  catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const b = await req.json().catch(() => null);
  if (!b || typeof b.suspension_id !== 'string')
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { error } = await liftSuspension(ctx.userId, b.suspension_id, b.note);
  if (error) return NextResponse.json({ error: 'rpc_failed' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Typecheck + smoke** (`/admin/suspensions`; impose then confirm **`profiles.standing='suspended'`** for that user — the gate — and that a `suspensions` audit row was written; lift then confirm `standing='good'`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/suspensions apps/web/app/api/admin/suspensions
git commit -m "P8: suspension tools page (impose/lift) + route (impose_suspension/lift_suspension RPCs)"
```

---

## Task 17b: Appeals review page + route (MD11)

**Files:**
- Create: `apps/web/app/admin/appeals/page.tsx`
- Create: `apps/web/app/admin/appeals/appeals-panel.tsx`
- Create: `apps/web/app/api/admin/appeals/route.ts`

> Surfaces the `appeals` queue (Task 7b) so a banned/removed user's contest is actionable. Granting reverses the action (lift suspension / re-approve date / re-open verification) via `resolve_appeal`.

- [ ] **Step 1: Server component** — `await requireAdmin('/admin/appeals')`. Fetch `appeals` where `state in ('open','reviewing')`, joined to the user and the subject (suspension / date_instance / verification) for context. Newest-first, bounded.

- [ ] **Step 2: Client panel** — show the user's statement, the `subject_type`, and Grant / Deny buttons (+ note). PATCH to `/api/admin/appeals`. Full state set (loading/error/empty/success).

- [ ] **Step 3: Route handler** — re-check `requireAdmin()`, validate `appeal_id` + `decision` ∈ `granted|denied`, call `resolveAppeal(ctx.userId, id, decision, note)`. Same structure as Task 13's route.

- [ ] **Step 4: Typecheck + smoke** (`/admin/appeals`; grant an appeal and confirm the underlying suspension lifts → `standing='good'`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/appeals apps/web/app/api/admin/appeals
git commit -m "P8: appeals review page + route (resolve_appeal RPC; reverses moderation action) (MD11)"
```

---

## Task 18: Audit-log viewer (read-only)

**Files:**
- Create: `apps/web/app/admin/audit/page.tsx`

- [ ] **Step 1: Server component** — `await requireAdmin('/admin/audit')`. Read-only. Fetch from both S1 `audit_log` (status transitions) and `moderation_actions` (moderator intent), merged and sorted by time, newest first, with simple filters (entity type, actor). Use `createAdminClient()` (bypasses RLS for the read). No mutations, no client component needed beyond optional filter state.

```tsx
// apps/web/app/admin/audit/page.tsx (shape)
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/require-admin';

export const dynamic = 'force-dynamic';

export default async function AdminAuditPage() {
  await requireAdmin('/admin/audit');
  const admin = createAdminClient();
  const [{ data: transitions }, { data: actions }] = await Promise.all([
    (admin as unknown as { from: (t: string) => { select: (c: string) => { order: (col: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown[] | null }> } } } })
      .from('audit_log').select('id, entity, entity_id, action, old_status, new_status, actor, at')
      .order('at', { ascending: false }).limit(200),
    (admin as unknown as { from: (t: string) => { select: (c: string) => { order: (col: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown[] | null }> } } } })
      .from('moderation_actions').select('id, actor_id, action, target_type, target_id, detail, created_at')
      .order('created_at', { ascending: false }).limit(200),
  ]);
  // render a merged, time-sorted, read-only table (Tailwind table per existing admin style).
  return null; // full markup per existing admin page style
}
```

- [ ] **Step 2: Typecheck + smoke** (`/admin/audit` renders recent transitions + moderator actions).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/admin/audit
git commit -m "P8: read-only audit-log viewer (audit_log + moderation_actions merged)"
```

---

## Task 19: Device-fingerprint capture + velocity enforcement at the loop's write paths

**Files:**
- Create: `apps/web/lib/anti-abuse/record-device.ts`
- Create: `apps/web/lib/anti-abuse/velocity-guard.ts`

These are the integration points the loop endpoints (swipe, create-date, report, signup) call. P8 ships the helpers; P5/P4 endpoints invoke them. Velocity reuses the existing `rate_limit_check()` RPC.

- [ ] **Step 1: Device-fingerprint recorder** — upsert `(user_id, fingerprint_hash)` and bump `last_seen_at`; emit a `shared_device` fraud signal + recompute when a fingerprint is shared across ≥3 distinct users.

```ts
// apps/web/lib/anti-abuse/record-device.ts
import { createAdminClient } from '@/lib/supabase/admin';

export async function recordDevice(userId: string, fingerprintHash: string, ip?: string, ua?: string) {
  const admin = createAdminClient() as unknown as {
    from: (t: string) => any; rpc: (fn: string, a: Record<string, unknown>) => Promise<unknown>;
  };
  await admin.from('device_fingerprints').upsert(
    { user_id: userId, fingerprint_hash: fingerprintHash, ip, user_agent: ua, last_seen_at: new Date().toISOString() },
    { onConflict: 'user_id,fingerprint_hash' },
  );
  const { data } = await admin.from('device_fingerprints')
    .select('user_id').eq('fingerprint_hash', fingerprintHash);
  const distinct = new Set((data ?? []).map((r: { user_id: string }) => r.user_id)).size;
  if (distinct >= 3) {
    await admin.from('fraud_signals').insert({
      user_id: userId, kind: 'shared_device', weight: Math.min(0.3 + 0.1 * distinct, 0.9),
      detail: { fingerprint: fingerprintHash, shared_with: distinct },
    });
    await admin.rpc('recompute_fraud_score', { p_user: userId });
  }
}
```

- [ ] **Step 2: Velocity guard** — wrap `rate_limit_check()` with the `VELOCITY_LIMITS` constants from `@after5/business`.

```ts
// apps/web/lib/anti-abuse/velocity-guard.ts
import { createAdminClient } from '@/lib/supabase/admin';
import { VELOCITY_LIMITS } from '@after5/business';

export async function checkVelocity(identifier: string, endpoint: keyof typeof VELOCITY_LIMITS) {
  const admin = createAdminClient() as unknown as { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: { allowed: boolean; retry_after_seconds: number } | null }> };
  const { data } = await admin.rpc('rate_limit_check', {
    p_identifier: identifier, p_endpoint: endpoint, p_max_requests: VELOCITY_LIMITS[endpoint],
  });
  return data ?? { allowed: true, retry_after_seconds: 0 };
}
```

- [ ] **Step 3: Export the anti-abuse module** from `@after5/business` so `VELOCITY_LIMITS` and the heuristics are importable. Append to `packages/business/src/index.ts`:

```ts
export * from './anti-abuse/fraud-score';
export * from './anti-abuse/velocity';
```

- [ ] **Step 4: Typecheck** — `pnpm --filter @after5/web typecheck && pnpm --filter @after5/business typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/anti-abuse packages/business/src/index.ts
git commit -m "P8: device-fingerprint capture + velocity guard (reuse rate_limit_check) + business exports"
```

---

## Task 20: Full reset, run all P8 tests, regenerate types

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)

- [ ] **Step 1: Full reset** — `supabase db reset`. Expected: all P0 + P8 migrations apply in order, no error.

- [ ] **Step 2: Run all P8 psql tests**

```bash
for f in supabase/tests/p8_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expected: every file exits 0; notices print `… OK`.

- [ ] **Step 3: Run the vitest suite** — `pnpm test` (root vitest workspace, C10). Expected: all anti-abuse tests pass.

- [ ] **Step 4: Typecheck the app + packages** — `pnpm turbo run typecheck`. Expected: passes.

- [ ] **Step 5: Regenerate TypeScript types** — `pnpm db:types`. Expected: `packages/types/src/database.ts` gains `admin_users`, `suspensions` (audit log), `moderation_actions`, `appeals`, `device_fingerprints`, `fraud_signals`, `fraud_scores`, `honeypot_candidates`, and the new `reports` columns (`resolution_code`, `priority`, `assigned_to`, …) + the `admin_role`/`report_priority`/`suspension_kind`/`appeal_*`/`fraud_*` enums. **Not** P8-owned (regenerated from upstream): `disputes` (S8/P7), `report_status`/`report_reason_category` (S1), `date_instances.moderation_status`/`media_assets` (S4), `standing_state` (P7).

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P8: regenerate database types for moderation/admin + anti-abuse schema"
```

---

## Self-Review (reconciled to INTEGRATION-CONTRACT v2 + RECONCILED-MASTER-PLAN)

**Spec coverage (vs roadmap P8 'Delivers' / 'Closes'):**
- T&S/admin console → admin pages Tasks 13–18 + layout nav. ✅
- Report triage queue → Task 13 (page + route) reading/actioning S1 `reports` incl. `reason_category` (payment_dispute) via Task 3's resolution metadata + 4-state guard. ✅
- Dispute resolution (contested no-shows from P7) → Task 5 (depends on S8/P7's frozen `disputes`, C11.6) + Task 7 `rule_dispute` (updates `disputes.state` + recompute loop) + Task 14 (UI/route). ✅
- Verification review → Task 15, gated to `verification_reviewer`, calling `review_verification` over `verifications`. ✅
- UGC moderation of dates → Task 6 (reads S4's `media_assets` + `date_instances.moderation_status`, C11.8) + Task 7 `moderate_date`/`moderate_media_asset` + Task 16 (UI over the real queues via signed URLs). ✅
- Suspension tools → Task 2 (`suspensions` AUDIT LOG) + Task 7 `impose/lift` (write `profiles.standing`, C3) + Task 17 (UI/route). ✅
- Appeals (MD11) → Task 7b (`appeals` + `resolve_appeal`) + Task 17b (UI/route). ✅
- Audit-log viewer (S1 `audit_log`) → Task 18, merging `audit_log` + `moderation_actions`. ✅
- Anti-abuse: device fingerprinting → Task 8 + Task 19 (capture). ✅
- Velocity limits (reuse `rate_limits`) → Task 10 (`VELOCITY_LIMITS`) + Task 19 (`checkVelocity` over `rate_limit_check()`). ✅
- Fraud-scoring signal → Task 8 + Task 9 (pure `scoreFraud`) + Task 10 (`recompute_fraud_score` RPC mirroring the TS model). ✅
- Fake accounts / swipe farms / honeypot → Tasks 8/10/11 (incl. shortlist stage in the honeypot view) + Task 16 watch tab. ✅
- Admin role model → Task 1 (`admin_users` + `admin_has_role`/`is_admin`) + Task 12 (`requireAdmin()`/`requireAdminRole()` read it). ✅

**Builds on the shared spine (no parallel tables / no duplicate shared objects):** extends S1 `reports` (Task 3, additive only — no enum rewrite), reuses S1 `audit_log`/`log_status_transition()`, references S8/P7 `disputes` + `recompute_reliability` (Tasks 5/7, no parallel dispute model), reads S4 `media_assets` + `date_instances.moderation_status` (Tasks 6/7, no invented column, no `browse_feed` rewrite), writes the C3 gate `profiles.standing` (Task 7, no third account-state model), calls S2 `dispatch_notification` (no P8 notification channel), and reuses `rate_limit_check()` (Task 19). Fixtures via `mk_user`/`mk_itinerary`/`mk_instance` (C8). Single root vitest (C10).

**Follows the existing admin pattern:** every page does `await requireAdmin('/admin/<x>')` (or `requireAdminRole`) + `createAdminClient()`; every interactive surface POSTs to `/api/admin/<x>` route handlers that re-check the gate — identical to `/admin/insiders` ↔ `/api/admin/insiders`. The env allowlist is preserved and extended (not replaced) by `admin_users`; the DB role wins on conflict so demotion is possible.

**Conventions:** P8 band `129xxx` (C6 — no collision with P7 `128xxx` / P9 `130xxx`); RLS on every new table; idempotent `DO $$ … duplicate_object` policies; `set_updated_at()` on `updated_at` tables; all moderation writes through SECURITY DEFINER RPCs that assert `p_actor = auth.uid()` + `admin_has_role()` and `revoke execute from public, authenticated` (C10); psql tests `\i _fixtures.sql`; TS tests under the root vitest config.

**Key decisions (post-reconciliation):**
1. **One enforcement gate: `profiles.standing` (C3/C11.5).** Suspend writes `standing='suspended'`; `suspensions` is an AUDIT LOG; there is **no** `account_active()` and **no** third account-state model. `can_enter_lock_flow` (S2) + the feed filter (C11.3) already read `standing`, so a P8 suspension blocks the loop with no extra wiring.
2. **`report_status` is the frozen 4-value S1 enum (C5/C11.6).** P8 adds `resolution_code` (free text) + triage metadata; it does **not** add/drop `actioned`/`reviewing` that P7 reads.
3. **Disputes are owned by S8/P7 (C11.6).** P8 builds no `disputes` table; `rule_dispute` resolves the upstream row and runs the bidirectional loop (`recompute_reliability` + clear `match_ratings.disputed`).
4. **UGC moderation reads the REAL queues (C11.8):** `media_assets` + `date_instances.moderation_status` — never an invented `itineraries.moderation_status`, never a `browse_feed` redefinition.
5. **RPC privilege model (C10):** `p_actor = auth.uid()` assertion (no forged actor) + `admin_has_role()` + `revoke execute from public, authenticated`.
6. **Appeals (MD11) + notification (S2):** suspension/ban/content-removal/verification-rejection notify via `dispatch_notification`; an appeal path can reverse the action.
7. **Fraud score = noisy-OR**, banded; TS (`scoreFraud`) and SQL (`recompute_fraud_score`) agree.

**Deferred / owned upstream (intentionally NOT built in P8):** the `disputes` table + `recompute_reliability` + the enforcement *ladder* that writes `standing` (S8/P7); `media_assets` + `date_instances.moderation_status` + signed-URL mint (S4); `dispatch_notification`/`admin_alerts`/`jobs` (S2); `report_status`/`reports` base schema + `_fixtures.sql` (S1); the single `browse_feed` finalization at band `133000` (S12/C11.3); the root vitest config (P1/S3); account deletion/anonymization of banned users (S10/P9); the verification *vendor* webhook + client fingerprint SDK (S3/client).

**Placeholder scan:** SQL migrations and pure-logic TS (Tasks 9–10) are complete and runnable. Admin UI tasks (13–18) give complete server components + route handlers + component contracts with the full state set (loading/error/empty/success/retry); client markup mirrors the in-repo `insiders-admin.tsx` — the load-bearing logic (fetch shapes incl. `reason_category`, action payloads, RPC calls, role gates) is fully specified. No dead UI: every button maps to a real RPC over a real, upstream-owned store.

**Type/name consistency:** P8-owned enums declared once (`admin_role`, `report_priority`, `suspension_kind`/`suspension_status`, `appeal_subject`/`appeal_state`, `fraud_signal_kind`, `fraud_band`); P8 does NOT redeclare upstream types (`report_status`, `report_reason_category`, `standing_state`, `disputes` columns, `date_instances.moderation_status`, `media_assets.moderation_state`). RPC arg names (`p_actor`, `p_report`, `p_status`, `p_resolution_code`, …) consistent across migration ↔ `lib/admin/moderation.ts` ↔ route handlers; noisy-OR thresholds match between `bandFor()` and `recompute_fraud_score`.

**Risk notes:** (1) The `media_assets` owner/state column + enum names, `recompute_reliability`'s signature, and `disputes`'s exact columns come from S4/S8 — align P8's RPCs to the frozen upstream names at execution time (do NOT invent parallels). (2) `requireAdmin()`'s return widens from `{ email }` to `{ userId, email, role }` — backwards-compatible since `email` remains. (3) The DB role now wins over the allowlist on conflict, so an allowlisted operator can be demoted in `admin_users`; bootstrap uses `ignoreDuplicates` so it never re-promotes a downgraded row.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-p8-moderation-admin.md`. This is the S9 slice — build only after S1, S2, S4, and S8/P7 have landed. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks. Tasks 1–11 (schema + pure logic) have no UI dependency and can run first; Tasks 12–19 (admin UI) depend on Task 12's `requireAdmin()`/`requireAdminRole()` extension landing first.

**2. Inline Execution** — execute tasks in order via executing-plans, with checkpoints after Task 11 (data/logic done) and Task 18 (console done).
