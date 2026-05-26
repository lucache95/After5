# P8 — Moderation, Admin Tooling & Anti-Abuse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Trust & Safety operations layer for the dating loop — a database-backed **admin role model**, a **moderation state machine** for reports, an **admin console** (report triage, dispute resolution, verification review, UGC moderation, suspension tools, audit-log viewer) gated by the existing `requireAdmin()` pattern, and an **anti-abuse layer** (device fingerprinting, velocity limits reusing `rate_limits`, a fraud-scoring signal, and structural defenses against fake accounts, swipe farms, and the "honeypot date" harvest). Someone must be able to action reports and suspend bad actors on day one.

**Architecture:** Extend (never replace) P0's `reports`, `blocks`, `verifications`, `audit_log`, `locks`, `match_ratings`, `queue_entries`, `swipes`, `date_instances`, and `itineraries`. Three layers:

1. **Data/invariants in Postgres (migrations + RLS):** a DB admin role model (`admin_users`), report moderation lifecycle (status enum + assignment + resolution + action audit via `moderation_actions`), `disputes` (contested no-show/rating outcomes from P7), a `suspensions` table that is the single source of truth for "can this account act," UGC moderation state on dates, anti-abuse tables (`device_fingerprints`, `fraud_signals`, `fraud_scores`), and **SECURITY DEFINER** moderator RPCs that are the only write path into report/dispute/suspension transitions (each appends to `audit_log` / `moderation_actions`).
2. **Pure business logic (`@after5/business`, vitest):** fraud scoring (weighted signal → score), velocity/swipe-farm heuristics, and honeypot detection (a creator harvesting profiles via fake dates) — no I/O, runnable on Edge (Deno) and Node.
3. **Admin console (Next.js, `apps/web/app/admin/*` + `/api/admin/*`):** server components call `requireAdmin()` + `createAdminClient()`; interactive client components POST/PATCH to `/api/admin/*` route handlers that re-check `requireAdmin()` and call the moderator RPCs. Mirrors the existing `/admin/insiders` + `/api/admin/insiders` pattern exactly.

**Tech Stack:** Supabase Postgres, SQL migrations (`supabase/migrations/`), RLS with `auth.uid()`, SECURITY DEFINER moderator functions, the existing `set_updated_at()` trigger, the existing `audit_log` + `log_status_transition()` from P0, the existing `rate_limits` table + `rate_limit_check()` RPC from `20260522110000_rate_limits.sql`. Admin UI: Next.js App Router server components + route handlers, `requireAdmin()` (`apps/web/lib/auth/require-admin.ts`), `createAdminClient()` (`apps/web/lib/supabase/admin.ts`). Tests: psql `DO $$…END$$` invariant tests in `supabase/tests/` (clean exit = PASS, any RAISE = FAIL); pure logic in `@after5/business` via **vitest** (newly introduced in that package).

**Source docs:** spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§6 audit log, §7 lifecycle, §8 trust/safety/enforcement, §7.2 honeypot/reveal); roadmap `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (Phase 8 scope + 'Closes'); foundation `docs/superpowers/plans/2026-05-25-p0-data-model.md` (tables this builds on).

**Dependency note:** Depends on **P0** (all loop tables + `audit_log`), **P5** (matching state machine — `queue_entries`, `offers`, `locks`, the honeypot consent-on-shortlist disclosure), **P7** (structured ratings + enforcement ladder — `match_ratings`, no-show outcomes that feed disputes). P5/P7 detailed plans do not exist yet; this plan builds against the **P0 schema + spec-defined behaviors** and treats `match_ratings`/`locks` outcomes as inputs. Where P7's enforcement ladder is referenced (warning → cooldown → suspension), P8 owns the **suspension** end of that ladder and exposes it to admins; the automated escalation policy is P7's.

**Reconciliation note — admin role model.** The repo's current admin gate is an **env allowlist** (`ADMIN_EMAILS`, fail-closed) in `requireAdmin()`. That is fine for a tiny operator set but cannot express *roles* (a verification reviewer vs. a full T&S admin) or be audited. P8 adds a DB-backed `admin_users(user_id, role)` table as the **authoritative role model**, and `requireAdmin()` is extended to grant access if the user is on the env allowlist **OR** in `admin_users` (allowlist members are treated as `super_admin` and auto-bootstrap an `admin_users` row). This is additive: existing allowlist admins keep working, and per-action authorization (e.g. only `verification_reviewer`+ can approve verifications) reads `admin_users.role`. Roles: `super_admin` (everything, incl. managing admins), `ts_admin` (reports, disputes, suspensions, UGC), `verification_reviewer` (verification review only). **Out of scope for P8** (later phases): automated enforcement-ladder transitions (P7), notification delivery of moderation outcomes (P2), account deletion/anonymization of banned users (P9), the verification *vendor webhook* itself (P1 writes `verifications`; P8 only reviews/overrides).

**Conventions (follow exactly, from P0):** migration filenames `YYYYMMDDHHMMSS_snake_description.sql`; enable RLS on every table; create policies idempotently with `DO $$ BEGIN CREATE POLICY … EXCEPTION WHEN duplicate_object THEN NULL; END $$;`; attach `set_updated_at()` to tables with `updated_at`; `auth.uid()` in policies; uuid PKs via `gen_random_uuid()`. Moderation writes go through SECURITY DEFINER RPCs (no direct admin UPDATE policy on report/dispute/suspension tables); the console calls those RPCs with the service-role client after `requireAdmin()`. Admin pages: `export const dynamic = 'force-dynamic'`, server component does `await requireAdmin('/admin/<path>')` then `createAdminClient()`.

**Local test loop:** `supabase db reset` (applies all migrations + seeds) then run a test file with:
`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>`
psql tests use `DO $$ … END $$;` blocks that `RAISE EXCEPTION` on wrong behavior (clean exit = PASS). Put psql tests in `supabase/tests/`. For TypeScript: `pnpm --filter @after5/business test` (vitest, added in Task 9).

---

## File Structure

- `supabase/migrations/20260525130000_*.sql` … `20260525131100_*.sql` — one migration per data task (admin roles, helpers, report lifecycle, moderation actions, disputes, suspensions, UGC moderation, anti-abuse tables, fraud RPC, honeypot view, RLS).
- `supabase/tests/p8_*.sql` — one psql invariant/RLS test file per task that warrants it.
- `packages/business/src/anti-abuse/*.ts` — pure fraud-scoring / velocity / honeypot logic.
- `packages/business/src/anti-abuse/*.test.ts` — vitest unit tests (colocated).
- `packages/business/vitest.config.ts` + `packages/business/package.json` test script — vitest setup.
- `apps/web/lib/auth/require-admin.ts` — extend to read `admin_users` (DB role model) alongside the env allowlist.
- `apps/web/lib/admin/moderation.ts` — typed server helpers wrapping the moderator RPCs (called from route handlers).
- `apps/web/app/admin/layout.tsx` — add nav items (Reports, Disputes, Verify, Suspensions, Audit).
- `apps/web/app/admin/reports/{page.tsx,reports-queue.tsx}` — report triage queue.
- `apps/web/app/admin/disputes/{page.tsx,disputes-panel.tsx}` — dispute resolution.
- `apps/web/app/admin/verify/{page.tsx,verify-panel.tsx}` — verification review.
- `apps/web/app/admin/moderate/{page.tsx,moderate-panel.tsx}` — UGC moderation of dates.
- `apps/web/app/admin/suspensions/{page.tsx,suspensions-panel.tsx}` — suspension tools.
- `apps/web/app/admin/audit/page.tsx` — audit-log viewer (read-only).
- `apps/web/app/api/admin/{reports,disputes,verify,moderate,suspensions}/route.ts` — mutation route handlers (re-check `requireAdmin()`, call RPCs).
- `packages/types/src/database.ts` — regenerated at the end.

---

## Task 1: Admin role model (`admin_users`) + `is_admin()` / `admin_has_role()` helpers

**Files:**
- Create: `supabase/migrations/20260525130000_p8_admin_users.sql`
- Test: `supabase/tests/p8_admin_users.sql`

- [ ] **Step 1: Write the failing test** (table exists, RLS on, `is_admin()` and `admin_has_role()` exist and fail-closed for a non-admin)

```sql
-- supabase/tests/p8_admin_users.sql
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
  insert into profiles (id, first_name) values (u,'admin');
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
-- supabase/migrations/20260525130000_p8_admin_users.sql
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
git add supabase/migrations/20260525130000_p8_admin_users.sql supabase/tests/p8_admin_users.sql
git commit -m "P8: admin_users role model + is_admin()/admin_has_role() helpers (fail-closed)"
```

---

## Task 2: `suspensions` (single source of truth for "can this account act")

**Files:**
- Create: `supabase/migrations/20260525130100_p8_suspensions.sql`
- Test: `supabase/tests/p8_suspensions.sql`

- [ ] **Step 1: Write the failing test** (`account_active(user)` is true by default, false while an unexpired active suspension exists)

```sql
-- supabase/tests/p8_suspensions.sql
DO $$
DECLARE u uuid;
BEGIN
  PERFORM 1 FROM pg_proc WHERE proname='account_active';
  IF NOT FOUND THEN RAISE EXCEPTION 'account_active() missing'; END IF;

  insert into profiles (id, first_name) values (gen_random_uuid(),'u') returning id into u;
  IF NOT account_active(u) THEN RAISE EXCEPTION 'fresh account should be active'; END IF;

  -- permanent ban
  insert into suspensions (user_id, kind, reason, status)
    values (u, 'ban', 'fraud', 'active');
  IF account_active(u) THEN RAISE EXCEPTION 'banned account must be inactive'; END IF;

  -- lifting the ban reactivates
  update suspensions set status='lifted', lifted_at=now() where user_id=u;
  IF NOT account_active(u) THEN RAISE EXCEPTION 'lifted ban should reactivate'; END IF;

  -- an EXPIRED temporary suspension does not block
  insert into suspensions (user_id, kind, reason, status, expires_at)
    values (u, 'temp_suspend', 'cooldown', 'active', now() - interval '1 hour');
  IF NOT account_active(u) THEN RAISE EXCEPTION 'expired temp suspension should not block'; END IF;

  -- an active, unexpired temp suspension blocks
  insert into suspensions (user_id, kind, reason, status, expires_at)
    values (u, 'temp_suspend', 'cooldown', 'active', now() + interval '2 days');
  IF account_active(u) THEN RAISE EXCEPTION 'active temp suspension must block'; END IF;
  RAISE NOTICE 'suspensions OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "suspensions" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130100_p8_suspensions.sql
-- The enforcement ladder's terminal rungs live here (P7 owns automated escalation; P8 owns the state).
create type suspension_kind   as enum ('warning','offer_cooldown','temp_suspend','ban');
create type suspension_status as enum ('active','lifted','expired');

create table if not exists suspensions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  kind        suspension_kind not null,
  reason      text not null,
  status      suspension_status not null default 'active',
  imposed_by  uuid references profiles(id),      -- admin (null = automated/system)
  source      text not null default 'admin',     -- 'admin' | 'auto_enforcement' | 'anti_abuse'
  report_id   uuid,                              -- optional link to originating report
  expires_at  timestamptz,                       -- null = permanent (ban) or non-expiring
  lifted_by   uuid references profiles(id),
  lifted_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists suspensions_user_active_idx
  on suspensions(user_id) where status = 'active';
create trigger set_suspensions_updated_at before update on suspensions
  for each row execute function set_updated_at();

-- account_active(): false iff the user has an active suspension that blocks action
-- (a ban, OR a temp/cooldown that has not expired). Warnings never block.
create or replace function account_active(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from suspensions
     where user_id = p_user
       and status = 'active'
       and kind in ('ban','temp_suspend','offer_cooldown')
       and (expires_at is null or expires_at > now())
  );
$$;

alter table suspensions enable row level security;
do $$ begin
  -- a user may read their own suspension record (so the app can show "your account is paused");
  -- admins may read all.
  create policy "suspensions_self_or_admin_read" on suspensions for select
    using (user_id = auth.uid() or is_admin(auth.uid()));
exception when duplicate_object then null; end $$;
-- Writes go through impose_suspension()/lift_suspension() RPCs (Task 7). Default-deny direct writes.
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `suspensions OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130100_p8_suspensions.sql supabase/tests/p8_suspensions.sql
git commit -m "P8: suspensions table + account_active() (warning/cooldown/temp/ban; expiry-aware)"
```

---

## Task 3: Report moderation lifecycle (extend P0 `reports`) + state machine

**Files:**
- Create: `supabase/migrations/20260525130200_p8_reports_lifecycle.sql`
- Test: `supabase/tests/p8_reports_lifecycle.sql`

P0's `reports.status` is a free-text check (`open|reviewing|actioned|dismissed`). P8 formalizes it as the moderation **state machine** with assignment, priority, resolution, and a guard trigger that rejects illegal transitions.

- [ ] **Step 1: Write the failing test** (legal transition allowed; illegal transition rejected; resolution requires a code)

```sql
-- supabase/tests/p8_reports_lifecycle.sql
DO $$
DECLARE rid uuid; ok boolean := false; adm uuid;
BEGIN
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='reports' AND column_name='assigned_to';
  IF NOT FOUND THEN RAISE EXCEPTION 'reports.assigned_to missing'; END IF;

  insert into profiles (id, first_name) values (gen_random_uuid(),'rep') returning id into rid;
  insert into profiles (id, first_name) values (gen_random_uuid(),'adm') returning id into adm;
  insert into reports (id, reporter_id, target_type, target_id, reason, status)
    values (gen_random_uuid(), rid, 'user', rid, 'harassment', 'open') returning id into rid;

  -- legal: open -> triaged
  update reports set status='triaged' where id=rid;

  -- illegal: triaged -> open should be rejected
  BEGIN
    update reports set status='open' where id=rid;
  EXCEPTION WHEN others THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'illegal report transition triaged->open was allowed'; END IF;

  -- legal terminal transition: triaged -> resolved with a resolution code
  update reports set status='resolved', resolution='actioned', resolved_at=now() where id=rid;
  RAISE NOTICE 'reports lifecycle OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`reports.assigned_to missing`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130200_p8_reports_lifecycle.sql
-- Moderation state machine for reports:
--   open -> triaged -> investigating -> resolved
--   open|triaged|investigating -> dismissed (terminal, benign)
--   open|triaged|investigating -> escalated -> resolved
-- resolved/dismissed are terminal. Resolution code required to enter 'resolved'.
create type report_status     as enum ('open','triaged','investigating','escalated','resolved','dismissed');
create type report_resolution as enum ('actioned','dismissed_no_action','duplicate','insufficient_evidence');
create type report_priority   as enum ('low','normal','high','critical');

-- Migrate the old text status to the enum. Existing rows: open->open, reviewing->investigating,
-- actioned->resolved(actioned), dismissed->dismissed.
alter table reports
  add column if not exists assigned_to uuid references profiles(id),
  add column if not exists priority report_priority not null default 'normal',
  add column if not exists resolution report_resolution,
  add column if not exists resolution_note text,
  add column if not exists resolved_by uuid references profiles(id),
  add column if not exists resolved_at timestamptz,
  add column if not exists triaged_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- Convert status text -> enum via a new typed column to avoid a hard cast on bad values.
alter table reports add column if not exists status_v2 report_status;
update reports set status_v2 = case status
  when 'open' then 'open'::report_status
  when 'reviewing' then 'investigating'::report_status
  when 'actioned' then 'resolved'::report_status
  when 'dismissed' then 'dismissed'::report_status
  else 'open'::report_status end
  where status_v2 is null;
alter table reports drop column status;
alter table reports rename column status_v2 to status;
alter table reports alter column status set not null;
alter table reports alter column status set default 'open';

create index if not exists reports_status_priority_idx on reports(status, priority);
create index if not exists reports_assigned_idx on reports(assigned_to) where status not in ('resolved','dismissed');
create trigger set_reports_updated_at before update on reports
  for each row execute function set_updated_at();

-- Transition guard: enforce legal edges + require a resolution code to resolve.
create or replace function guard_report_transition() returns trigger
language plpgsql as $fn$
begin
  if (new.status = old.status) then return new; end if;
  -- terminal states cannot transition out
  if (old.status in ('resolved','dismissed')) then
    raise exception 'report % is terminal (%); cannot transition to %', old.id, old.status, new.status;
  end if;
  -- legal edges
  if not (
    (old.status = 'open'          and new.status in ('triaged','dismissed','escalated')) or
    (old.status = 'triaged'       and new.status in ('investigating','escalated','resolved','dismissed')) or
    (old.status = 'investigating' and new.status in ('escalated','resolved','dismissed')) or
    (old.status = 'escalated'     and new.status in ('resolved','dismissed'))
  ) then
    raise exception 'illegal report transition % -> %', old.status, new.status;
  end if;
  if (new.status = 'resolved' and new.resolution is null) then
    raise exception 'resolving report % requires a resolution code', old.id;
  end if;
  return new;
end $fn$;
create trigger guard_reports_transition before update on reports
  for each row execute function guard_report_transition();

-- Audit every report status change (reuse P0 generic logger).
create trigger audit_reports after insert or update on reports
  for each row execute function log_status_transition();
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `reports lifecycle OK`).

Note: P0's `reports` had no `select` policy (default-deny → admin/service-role read). That stays; admins read via the service-role client. Reporter-read of own report can be added in P7/P9; not required for the console.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130200_p8_reports_lifecycle.sql supabase/tests/p8_reports_lifecycle.sql
git commit -m "P8: report moderation state machine (status enum + transition guard + audit)"
```

---

## Task 4: `moderation_actions` (immutable record of every moderator action)

**Files:**
- Create: `supabase/migrations/20260525130300_p8_moderation_actions.sql`
- Test: `supabase/tests/p8_moderation_actions.sql`

- [ ] **Step 1: Write the failing test** (rows are insert-only — UPDATE is rejected)

```sql
-- supabase/tests/p8_moderation_actions.sql
DO $$
DECLARE adm uuid; aid uuid; ok boolean := false;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(),'adm') returning id into adm;
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
-- supabase/migrations/20260525130300_p8_moderation_actions.sql
-- Human-readable T&S action log: who did what to which entity, with structured detail.
-- Complements P0 audit_log (which captures state-machine status changes generically);
-- this records moderator intent (resolution codes, suspension reasons, dispute rulings).
create table if not exists moderation_actions (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references profiles(id),                 -- the admin/moderator (null = system)
  action      text not null,                                -- e.g. 'report_resolved','user_suspended','verification_approved','dispute_ruled','date_hidden'
  target_type text not null check (target_type in ('report','user','date_instance','message','lock','verification','dispute','admin_user')),
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
git add supabase/migrations/20260525130300_p8_moderation_actions.sql supabase/tests/p8_moderation_actions.sql
git commit -m "P8: moderation_actions (append-only T&S action log, admin-read)"
```

---

## Task 5: `disputes` (contested no-show / rating outcomes from P7)

**Files:**
- Create: `supabase/migrations/20260525130400_p8_disputes.sql`
- Test: `supabase/tests/p8_disputes.sql`

- [ ] **Step 1: Write the failing test** (one open dispute per (lock, opener); ruling requires an outcome)

```sql
-- supabase/tests/p8_disputes.sql
DO $$
DECLARE cre uuid; usr uuid; cid uuid; inst uuid; lk uuid; d1 uuid; ok boolean := false;
BEGIN
  insert into profiles (id,first_name) values (gen_random_uuid(),'c') returning id into cre;
  insert into profiles (id,first_name) values (gen_random_uuid(),'u') returning id into usr;
  insert into cities (slug,name,timezone,is_active) values ('p8d','p8d','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='p8d';
  insert into itineraries (id,user_id) values (gen_random_uuid(),cre);
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at)
    select i.id,cre,cid,now()-interval '1 day' from itineraries i where i.user_id=cre limit 1
    returning id into inst;
  insert into locks (date_instance_id,creator_id,matched_user_id,status)
    values (inst,cre,usr,'no_show') returning id into lk;

  insert into disputes (lock_id, opened_by, against_user, kind, claim)
    values (lk, usr, cre, 'no_show', 'they marked me a no-show but I was there')
    returning id into d1;

  -- a second OPEN dispute by the same opener on the same lock must be rejected
  BEGIN
    insert into disputes (lock_id, opened_by, against_user, kind, claim)
      values (lk, usr, cre, 'no_show', 'dup');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'duplicate open dispute allowed'; END IF;

  -- ruling requires an outcome
  ok := false;
  BEGIN
    update disputes set status='resolved' where id=d1;  -- no outcome set
  EXCEPTION WHEN others THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'resolving a dispute without an outcome was allowed'; END IF;

  update disputes set status='resolved', outcome='overturned', resolved_at=now() where id=d1;
  RAISE NOTICE 'disputes OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "disputes" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130400_p8_disputes.sql
-- A dispute contests a P7 outcome: a no-show flag, a reliability rating, or an unsafe/conduct flag.
-- Routed to T&S; ruling can overturn the contested signal (which P7 then re-derives the score from).
create type dispute_kind    as enum ('no_show','rating','conduct_flag','other');
create type dispute_status  as enum ('open','reviewing','resolved','rejected');
create type dispute_outcome as enum ('upheld','overturned','no_action','warning_issued');

create table if not exists disputes (
  id            uuid primary key default gen_random_uuid(),
  lock_id       uuid references locks(id) on delete set null,
  rating_id     uuid references match_ratings(id) on delete set null,
  opened_by     uuid not null references profiles(id) on delete cascade,
  against_user  uuid not null references profiles(id) on delete cascade,
  kind          dispute_kind not null,
  claim         text not null,
  status        dispute_status not null default 'open',
  outcome       dispute_outcome,
  assigned_to   uuid references profiles(id),
  resolved_by   uuid references profiles(id),
  resolution_note text,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- At most one OPEN/REVIEWING dispute per (lock, opener) prevents spam.
create unique index if not exists disputes_one_open_per_lock_opener
  on disputes (lock_id, opened_by) where status in ('open','reviewing');
create index if not exists disputes_status_idx on disputes(status);
create trigger set_disputes_updated_at before update on disputes
  for each row execute function set_updated_at();

-- Guard: resolving requires an outcome; resolved/rejected are terminal.
create or replace function guard_dispute_transition() returns trigger
language plpgsql as $fn$
begin
  if (new.status = old.status) then return new; end if;
  if (old.status in ('resolved','rejected')) then
    raise exception 'dispute % is terminal (%)', old.id, old.status;
  end if;
  if (new.status = 'resolved' and new.outcome is null) then
    raise exception 'resolving dispute % requires an outcome', old.id;
  end if;
  return new;
end $fn$;
create trigger guard_disputes_transition before update on disputes
  for each row execute function guard_dispute_transition();
create trigger audit_disputes after insert or update on disputes
  for each row execute function log_status_transition();

alter table disputes enable row level security;
do $$ begin
  -- parties to the dispute may read it; admins read all.
  create policy "disputes_party_or_admin_read" on disputes for select
    using (opened_by = auth.uid() or against_user = auth.uid() or is_admin(auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  -- a user may OPEN a dispute about a lock they participated in (opened_by = self).
  create policy "disputes_opener_insert" on disputes for insert
    with check (opened_by = auth.uid());
exception when duplicate_object then null; end $$;
-- Rulings (status/outcome changes) go through rule_dispute() RPC (Task 7). No update policy.
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `disputes OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130400_p8_disputes.sql supabase/tests/p8_disputes.sql
git commit -m "P8: disputes (contested no-show/rating/conduct) + ruling guard + audit"
```

---

## Task 6: UGC moderation state on dates (the "why" note, photos, ambient audio)

**Files:**
- Create: `supabase/migrations/20260525130500_p8_ugc_moderation.sql`
- Test: `supabase/tests/p8_ugc_moderation.sql`

The "why" note (`itineraries.why_note`), place photo, and ambient audio (`itineraries.ambient_sound_url`) are user-generated content that must be moderatable. A hidden date must not appear in the blind feed.

- [ ] **Step 1: Write the failing test** (a `date_instance` whose itinerary is `hidden` is excluded from `browse_feed`)

```sql
-- supabase/tests/p8_ugc_moderation.sql
DO $$
DECLARE cre uuid; cid uuid; it uuid; inst uuid; cnt int;
BEGIN
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='itineraries' AND column_name='moderation_status';
  IF NOT FOUND THEN RAISE EXCEPTION 'itineraries.moderation_status missing'; END IF;

  insert into profiles (id,first_name) values (gen_random_uuid(),'c') returning id into cre;
  insert into cities (slug,name,timezone,is_active) values ('p8u','p8u','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='p8u';
  insert into itineraries (id,user_id) values (gen_random_uuid(),cre) returning id into it;
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at,status)
    values (it,cre,cid,now()+interval '2 days','seeking') returning id into inst;

  -- visible while approved
  select count(*) into cnt from browse_feed where date_instance_id = inst;
  IF cnt <> 1 THEN RAISE EXCEPTION 'approved date should appear in feed (got %)', cnt; END IF;

  -- hide it
  update itineraries set moderation_status='hidden' where id=it;
  select count(*) into cnt from browse_feed where date_instance_id = inst;
  IF cnt <> 0 THEN RAISE EXCEPTION 'hidden date must NOT appear in feed (got %)', cnt; END IF;
  RAISE NOTICE 'ugc moderation OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`itineraries.moderation_status missing`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130500_p8_ugc_moderation.sql
create type ugc_moderation_status as enum ('approved','flagged','hidden','removed');

alter table itineraries
  add column if not exists moderation_status ugc_moderation_status not null default 'approved',
  add column if not exists moderated_by uuid references profiles(id),
  add column if not exists moderation_note text,
  add column if not exists moderated_at timestamptz;

create index if not exists itineraries_moderation_idx on itineraries(moderation_status)
  where moderation_status <> 'approved';

-- Rebuild browse_feed (from P0 Task 11) to exclude non-approved UGC.
-- Pre-lock privacy (coarse time, neighborhood only, no creator identity) preserved exactly.
create or replace view browse_feed
with (security_invoker = true) as
select
  di.id            as date_instance_id,
  di.city_id,
  date_trunc('hour', di.starts_at) as time_window_start,
  di.status,
  i.id             as itinerary_id,
  i.pay_setting,
  i.vibe_tags,
  i.why_note,
  i.ambient_sound_url,
  p.neighborhood   as venue_neighborhood
from date_instances di
join itineraries i on i.id = di.itinerary_id
left join places p on p.id = di.venue_id
where di.status = 'seeking'
  and i.moderation_status = 'approved';     -- NEW: hidden/removed UGC never surfaces

grant select on browse_feed to anon, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `ugc moderation OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130500_p8_ugc_moderation.sql supabase/tests/p8_ugc_moderation.sql
git commit -m "P8: UGC moderation_status on itineraries + browse_feed excludes hidden/removed dates"
```

---

## Task 7: Moderator RPCs (the only write path into report/dispute/suspension/UGC transitions)

**Files:**
- Create: `supabase/migrations/20260525130600_p8_moderator_rpcs.sql`
- Test: `supabase/tests/p8_moderator_rpcs.sql`

These SECURITY DEFINER functions take an explicit `p_actor uuid` (the route handler passes the verified admin's id), verify `admin_has_role()`, perform the transition, and append a `moderation_actions` row. Each is idempotent where it matters (resolving an already-resolved report is a no-op success).

- [ ] **Step 1: Write the failing test** (resolve_report by a non-admin is rejected; by an admin it resolves + logs an action)

```sql
-- supabase/tests/p8_moderator_rpcs.sql
DO $$
DECLARE adm uuid; usr uuid; rid uuid; nacts int; ok boolean := false;
BEGIN
  insert into profiles (id,first_name) values (gen_random_uuid(),'adm') returning id into adm;
  insert into profiles (id,first_name) values (gen_random_uuid(),'usr') returning id into usr;
  insert into admin_users (user_id, role) values (adm, 'ts_admin');
  insert into reports (id, reporter_id, target_type, target_id, reason, status)
    values (gen_random_uuid(), usr, 'user', usr, 'spam', 'open') returning id into rid;

  -- non-admin cannot resolve
  BEGIN
    PERFORM resolve_report(usr, rid, 'actioned', 'nope');
  EXCEPTION WHEN others THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'non-admin resolved a report'; END IF;

  -- admin resolves
  PERFORM resolve_report(adm, rid, 'actioned', 'banned the user');
  PERFORM 1 FROM reports WHERE id=rid AND status='resolved' AND resolution='actioned';
  IF NOT FOUND THEN RAISE EXCEPTION 'report not resolved by admin'; END IF;

  -- a moderation_action was logged
  select count(*) into nacts from moderation_actions
   where target_type='report' and target_id=rid and action='report_resolved';
  IF nacts < 1 THEN RAISE EXCEPTION 'resolve_report did not log a moderation_action'; END IF;

  -- impose_suspension bans the user and account_active() flips
  PERFORM impose_suspension(adm, usr, 'ban', 'fraud', null, rid);
  IF account_active(usr) THEN RAISE EXCEPTION 'impose_suspension did not deactivate account'; END IF;
  RAISE NOTICE 'moderator rpcs OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function resolve_report(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130600_p8_moderator_rpcs.sql

-- resolve_report: triage + resolve a report. Idempotent if already terminal.
create or replace function resolve_report(
  p_actor uuid, p_report uuid, p_resolution report_resolution, p_note text default null
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not admin_has_role(p_actor, 'ts_admin') then
    raise exception 'forbidden: actor % lacks ts_admin', p_actor;
  end if;
  update reports
     set status='resolved', resolution=p_resolution, resolution_note=p_note,
         resolved_by=p_actor, resolved_at=now()
   where id=p_report and status not in ('resolved','dismissed');
  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, 'report_resolved', 'report', p_report,
          jsonb_build_object('resolution', p_resolution, 'note', p_note));
end $fn$;

-- assign_report / dismiss_report: lighter transitions.
create or replace function set_report_status(
  p_actor uuid, p_report uuid, p_status report_status, p_note text default null
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not admin_has_role(p_actor, 'ts_admin') then
    raise exception 'forbidden'; end if;
  update reports set status=p_status, assigned_to=coalesce(assigned_to,p_actor),
         triaged_at=coalesce(triaged_at, now())
   where id=p_report;
  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, 'report_status_'||p_status, 'report', p_report, jsonb_build_object('note',p_note));
end $fn$;

-- impose_suspension: warning/cooldown/temp/ban. p_expires null = permanent.
create or replace function impose_suspension(
  p_actor uuid, p_user uuid, p_kind suspension_kind, p_reason text,
  p_expires timestamptz default null, p_report uuid default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare sid uuid;
begin
  if not admin_has_role(p_actor, 'ts_admin') then raise exception 'forbidden'; end if;
  insert into suspensions(user_id, kind, reason, status, imposed_by, source, report_id, expires_at)
  values (p_user, p_kind, p_reason, 'active', p_actor, 'admin', p_report, p_expires)
  returning id into sid;
  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, 'user_suspended', 'user', p_user,
          jsonb_build_object('kind',p_kind,'reason',p_reason,'expires_at',p_expires,'suspension_id',sid));
  return sid;
end $fn$;

-- lift_suspension: reactivates an account.
create or replace function lift_suspension(
  p_actor uuid, p_suspension uuid, p_note text default null
) returns void language plpgsql security definer set search_path = public as $fn$
declare uid uuid;
begin
  if not admin_has_role(p_actor, 'ts_admin') then raise exception 'forbidden'; end if;
  update suspensions set status='lifted', lifted_by=p_actor, lifted_at=now()
   where id=p_suspension and status='active' returning user_id into uid;
  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, 'suspension_lifted', 'user', uid, jsonb_build_object('suspension_id',p_suspension,'note',p_note));
end $fn$;

-- review_verification: approve/fail a verification (verification_reviewer or super_admin).
create or replace function review_verification(
  p_actor uuid, p_verification uuid, p_approve boolean, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $fn$
declare vuser uuid;
begin
  if not admin_has_role(p_actor, 'verification_reviewer') then raise exception 'forbidden'; end if;
  update verifications
     set state = case when p_approve then 'verified' else 'failed' end,
         verified_at = case when p_approve then now() else null end,
         failure_reason = case when p_approve then null else p_reason end
   where id=p_verification returning user_id into vuser;
  -- reflect on profile when approving the user's identity
  if p_approve then
    update profiles set verification='verified' where id=vuser;
  end if;
  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, case when p_approve then 'verification_approved' else 'verification_rejected' end,
          'verification', p_verification, jsonb_build_object('reason',p_reason));
end $fn$;

-- rule_dispute: T&S ruling on a contested outcome.
create or replace function rule_dispute(
  p_actor uuid, p_dispute uuid, p_outcome dispute_outcome, p_note text default null
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not admin_has_role(p_actor, 'ts_admin') then raise exception 'forbidden'; end if;
  update disputes set status='resolved', outcome=p_outcome, resolution_note=p_note,
         resolved_by=p_actor, resolved_at=now()
   where id=p_dispute and status not in ('resolved','rejected');
  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, 'dispute_ruled', 'dispute', p_dispute, jsonb_build_object('outcome',p_outcome,'note',p_note));
end $fn$;

-- moderate_date: hide/remove/restore UGC on an itinerary.
create or replace function moderate_date(
  p_actor uuid, p_itinerary uuid, p_status ugc_moderation_status, p_note text default null
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not admin_has_role(p_actor, 'ts_admin') then raise exception 'forbidden'; end if;
  update itineraries set moderation_status=p_status, moderated_by=p_actor,
         moderation_note=p_note, moderated_at=now()
   where id=p_itinerary;
  insert into moderation_actions(actor_id, action, target_type, target_id, detail)
  values (p_actor, 'date_'||p_status, 'date_instance', p_itinerary, jsonb_build_object('note',p_note));
end $fn$;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `moderator rpcs OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130600_p8_moderator_rpcs.sql supabase/tests/p8_moderator_rpcs.sql
git commit -m "P8: SECURITY DEFINER moderator RPCs (resolve/suspend/verify/dispute/moderate) w/ role checks + action log"
```

---

## Task 8: Anti-abuse tables — `device_fingerprints`, `fraud_signals`, `fraud_scores`

**Files:**
- Create: `supabase/migrations/20260525130700_p8_anti_abuse.sql`
- Test: `supabase/tests/p8_anti_abuse.sql`

- [ ] **Step 1: Write the failing test** (a fingerprint shared by N distinct users is queryable; fraud_signals append; one current fraud_score per user)

```sql
-- supabase/tests/p8_anti_abuse.sql
DO $$
DECLARE u1 uuid; u2 uuid; shared int;
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='device_fingerprints';
  IF NOT FOUND THEN RAISE EXCEPTION 'device_fingerprints missing'; END IF;
  PERFORM 1 FROM pg_tables WHERE tablename='fraud_signals';
  IF NOT FOUND THEN RAISE EXCEPTION 'fraud_signals missing'; END IF;

  insert into profiles (id,first_name) values (gen_random_uuid(),'u1') returning id into u1;
  insert into profiles (id,first_name) values (gen_random_uuid(),'u2') returning id into u2;

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
-- supabase/migrations/20260525130700_p8_anti_abuse.sql

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
git add supabase/migrations/20260525130700_p8_anti_abuse.sql supabase/tests/p8_anti_abuse.sql
git commit -m "P8: anti-abuse tables (device_fingerprints, fraud_signals, fraud_scores) admin-read"
```

---

## Task 9: Vitest setup in `@after5/business` + fraud-scoring pure logic

**Files:**
- Create: `packages/business/vitest.config.ts`
- Modify: `packages/business/package.json` (add `test` script + vitest devDep)
- Create: `packages/business/src/anti-abuse/fraud-score.ts`
- Create: `packages/business/src/anti-abuse/fraud-score.test.ts`

Pure, I/O-free fraud scoring so the same code runs in the Edge Function (Deno) and Next.js (Node), per the spec's shared-package rule.

- [ ] **Step 1: Add vitest to the package**

`packages/business/package.json` — add to `scripts` and `devDependencies`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.0"
  }
}
```

`packages/business/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

Run `pnpm install` at the repo root to fetch vitest.

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

Run: `pnpm --filter @after5/business test`

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

- [ ] **Step 5: Run test, expect PASS.** (`pnpm --filter @after5/business test`)

- [ ] **Step 6: Commit**

```bash
git add packages/business/vitest.config.ts packages/business/package.json packages/business/src/anti-abuse/fraud-score.ts packages/business/src/anti-abuse/fraud-score.test.ts
git commit -m "P8: vitest in @after5/business + pure fraud-scoring (noisy-OR, banded)"
```

---

## Task 10: Velocity limits (reuse `rate_limits`) + swipe-farm + honeypot heuristics (pure logic) + score recompute RPC

**Files:**
- Create: `packages/business/src/anti-abuse/velocity.ts`
- Create: `packages/business/src/anti-abuse/velocity.test.ts`
- Create: `supabase/migrations/20260525130800_p8_fraud_recompute.sql`
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

- [ ] **Step 2: Run it, expect FAIL** (`Cannot find module './velocity'`).

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

- [ ] **Step 4: Run TS test, expect PASS.** (`pnpm --filter @after5/business test`)

- [ ] **Step 5: Write the failing test (SQL — recompute_fraud_score aggregates signals)**

```sql
-- supabase/tests/p8_fraud_recompute.sql
DO $$
DECLARE u uuid; b fraud_band;
BEGIN
  PERFORM 1 FROM pg_proc WHERE proname='recompute_fraud_score';
  IF NOT FOUND THEN RAISE EXCEPTION 'recompute_fraud_score() missing'; END IF;

  insert into profiles (id,first_name) values (gen_random_uuid(),'u') returning id into u;
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
-- supabase/migrations/20260525130800_p8_fraud_recompute.sql
-- Recompute a user's fraud score from their signals (noisy-OR, matching fraud-score.ts),
-- then upsert fraud_scores. Service-role / job invoked. Band thresholds match bandFor().
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
```

- [ ] **Step 8: Apply + run SQL test, expect PASS** (prints `fraud recompute OK`).

- [ ] **Step 9: Commit**

```bash
git add packages/business/src/anti-abuse/velocity.ts packages/business/src/anti-abuse/velocity.test.ts supabase/migrations/20260525130800_p8_fraud_recompute.sql supabase/tests/p8_fraud_recompute.sql
git commit -m "P8: velocity caps + swipe-farm/honeypot heuristics (TS) + recompute_fraud_score RPC (noisy-OR)"
```

---

## Task 11: Honeypot creator review view (admin signal)

**Files:**
- Create: `supabase/migrations/20260525130900_p8_honeypot_view.sql`
- Test: `supabase/tests/p8_honeypot_view.sql`

A SQL view (admin-only) surfacing the honeypot pattern from real loop data: creators whose dates attract right-swipes but who almost never extend offers / complete locks. This is the data side of `isHoneypotCreator`; admins triage from it.

- [ ] **Step 1: Write the failing test** (the view exists, exposes the advancement ratio, and is gated to admins)

```sql
-- supabase/tests/p8_honeypot_view.sql
DO $$
BEGIN
  PERFORM 1 FROM information_schema.views WHERE table_name='honeypot_candidates';
  IF NOT FOUND THEN RAISE EXCEPTION 'honeypot_candidates view missing'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='honeypot_candidates' AND column_name='advancement_ratio';
  IF NOT FOUND THEN RAISE EXCEPTION 'advancement_ratio column missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`honeypot_candidates view missing`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130900_p8_honeypot_view.sql
-- Per-creator funnel: swipers attracted vs. offers/locks made. Low advancement +
-- meaningful inbound interest = candidate honeypot (profile-harvesting via fake dates).
-- security_invoker so RLS/identity rules of the underlying tables apply; admin-only via grant.
create or replace view honeypot_candidates
with (security_invoker = true) as
with attracted as (
  select s.creator_id, count(*) filter (where s.direction='right') as swipers_attracted
  from swipes s group by s.creator_id
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
  coalesce(a.swipers_attracted,0) as swipers_attracted,
  coalesce(o.offers_made,0)       as offers_made,
  coalesce(k.locks_completed,0)   as locks_completed,
  round(
    (coalesce(o.offers_made,0) + coalesce(k.locks_completed,0))::numeric
    / greatest(coalesce(a.swipers_attracted,0),1), 4
  ) as advancement_ratio
from created c
left join attracted a on a.creator_id = c.creator_id
left join offered  o on o.creator_id = c.creator_id
left join locked   k on k.creator_id = c.creator_id
where c.dates_created >= 3
  and coalesce(a.swipers_attracted,0) >= 50;

-- Admin-only: revoke from the broad roles, grant to service-role/authenticated-admins via RLS-backed
-- queries (the console uses the service-role client). Default: no broad grant.
revoke all on honeypot_candidates from anon, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130900_p8_honeypot_view.sql supabase/tests/p8_honeypot_view.sql
git commit -m "P8: honeypot_candidates view (per-creator advancement funnel, admin-only)"
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

  let role = (row?.role as AdminRole | undefined) ?? undefined;

  if (!role && onAllowlist) {
    // Bootstrap an allowlist admin as super_admin (idempotent).
    await admin.from('admin_users').upsert(
      { user_id: user.id, role: 'super_admin' },
      { onConflict: 'user_id' },
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
import { createAdminClient } from '@/lib/supabase/admin';

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>;

export async function resolveReport(actor: string, reportId: string, resolution: string, note?: string) {
  const admin = createAdminClient() as unknown as { rpc: Rpc };
  return admin.rpc('resolve_report', { p_actor: actor, p_report: reportId, p_resolution: resolution, p_note: note ?? null });
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
export async function ruleDispute(actor: string, disputeId: string, outcome: string, note?: string) {
  const admin = createAdminClient() as unknown as { rpc: Rpc };
  return admin.rpc('rule_dispute', { p_actor: actor, p_dispute: disputeId, p_outcome: outcome, p_note: note ?? null });
}
export async function moderateDate(actor: string, itineraryId: string, status: string, note?: string) {
  const admin = createAdminClient() as unknown as { rpc: Rpc };
  return admin.rpc('moderate_date', { p_actor: actor, p_itinerary: itineraryId, p_status: status, p_note: note ?? null });
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
<NavItem href="/admin/audit" label="Audit" />
```

- [ ] **Step 2: Server component — fetch the open report queue** (newest-first, open/triaged/investigating first, ordered by priority).

```tsx
// apps/web/app/admin/reports/page.tsx
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/require-admin';
import { ReportsQueue } from './reports-queue';

export const dynamic = 'force-dynamic';

export interface ReportRow {
  id: string; reporter_id: string | null; target_type: string; target_id: string;
  reason: string; detail: string | null; status: string; priority: string;
  assigned_to: string | null; resolution: string | null; created_at: string;
}

export default async function AdminReportsPage() {
  await requireAdmin('/admin/reports');
  const admin = createAdminClient();
  const { data } = await (admin as unknown as {
    from: (t: string) => { select: (c: string) => { order: (col: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: ReportRow[] | null }> } } };
  }).from('reports')
    .select('id, reporter_id, target_type, target_id, reason, detail, status, priority, assigned_to, resolution, created_at')
    .order('created_at', { ascending: false })
    .limit(300);
  return <ReportsQueue reports={(data ?? []) as ReportRow[]} />;
}
```

- [ ] **Step 3: Client component — triage UI** (assign/investigate, resolve with a resolution code, dismiss; "ban reporter target" shortcut posts to the suspensions route). Mirror `insiders-admin.tsx` structure (tabs: Open / Resolved; per-row action buttons → `fetch('/api/admin/reports', { method: 'PATCH', ... })`).

```tsx
// apps/web/app/admin/reports/reports-queue.tsx  (shape — full UI mirrors insiders-admin.tsx)
'use client';
import { useState } from 'react';
import type { ReportRow } from './page';

const RESOLUTIONS = ['actioned','dismissed_no_action','duplicate','insufficient_evidence'] as const;

export function ReportsQueue({ reports }: { reports: ReportRow[] }) {
  const [rows, setRows] = useState(reports);
  const [busy, setBusy] = useState<string | null>(null);
  const open = rows.filter((r) => !['resolved','dismissed'].includes(r.status));

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
  // render: header "Report triage", count of `open`, per-row reason/target/reporter,
  // a <select> of RESOLUTIONS, Resolve / Dismiss / Investigate buttons calling act().
  // (Tailwind classes copied from insiders-admin.tsx for visual consistency.)
  return null; // full markup per the existing admin page style
}
```

- [ ] **Step 4: Mutation route handler** — re-check `requireAdmin()`, then call the RPC wrapper. Validate inputs like `/api/admin/insiders/route.ts` does.

```ts
// apps/web/app/api/admin/reports/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { resolveReport, setReportStatus } from '@/lib/admin/moderation';

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
    const resolution = body.resolution;
    if (typeof resolution !== 'string')
      return NextResponse.json({ error: 'missing_resolution' }, { status: 400 });
    const { error } = await resolveReport(ctx.userId, reportId, resolution, body.note as string | undefined);
    if (error) return NextResponse.json({ error: 'rpc_failed' }, { status: 400 });
    return NextResponse.json({ ok: true, status: 'resolved' });
  }
  if (body.action === 'set_status' && typeof body.status === 'string') {
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

- [ ] **Step 1: Server component** — fetch open disputes (`status in ('open','reviewing')` first), join the contested lock + parties for context. Follow the `reports/page.tsx` fetch shape; `await requireAdmin('/admin/disputes')`.

- [ ] **Step 2: Client panel** — show the claim, the contested outcome (no_show / rating / conduct), both parties, and an outcome `<select>` (`upheld | overturned | no_action | warning_issued`) + a note field; PATCH to `/api/admin/disputes`.

- [ ] **Step 3: Route handler** — re-check `requireAdmin()`, validate `dispute_id` + `outcome`, call `ruleDispute(ctx.userId, id, outcome, note)`. Same structure as Task 13's route.

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

## Task 16: UGC moderation page + route (dates: why-note, photo, audio)

**Files:**
- Create: `apps/web/app/admin/moderate/page.tsx`
- Create: `apps/web/app/admin/moderate/moderate-panel.tsx`
- Create: `apps/web/app/api/admin/moderate/route.ts`

- [ ] **Step 1: Server component** — `await requireAdmin('/admin/moderate')`. Two data sources: (a) itineraries with `moderation_status='flagged'` (or all `seeking` instances for spot-checks), showing `why_note`, place photo, `ambient_sound_url`; (b) the `honeypot_candidates` view for proactive harvest detection. Join creator profile for context.

- [ ] **Step 2: Client panel** — render each date's UGC (the "why" note text, an `<img>` of the place photo, an `<audio controls>` for `ambient_sound_url`). Actions: Approve / Flag / Hide / Remove (+ optional note). A "honeypot watch" tab lists `honeypot_candidates` rows with `advancement_ratio` and a "suspend creator" shortcut (POSTs to `/api/admin/suspensions`). PATCH to `/api/admin/moderate`.

- [ ] **Step 3: Route handler** — re-check `requireAdmin()`, validate `itinerary_id` + `status` ∈ `approved|flagged|hidden|removed`, call `moderateDate(ctx.userId, itineraryId, status, note)`.

- [ ] **Step 4: Typecheck + smoke** (`/admin/moderate`; verify audio + photo render, hiding a date removes it from the feed via the Task 6 view).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/moderate apps/web/app/api/admin/moderate
git commit -m "P8: UGC moderation page (why-note/photo/audio + honeypot watch) + moderate route"
```

---

## Task 17: Suspension tools page + route

**Files:**
- Create: `apps/web/app/admin/suspensions/page.tsx`
- Create: `apps/web/app/admin/suspensions/suspensions-panel.tsx`
- Create: `apps/web/app/api/admin/suspensions/route.ts`

- [ ] **Step 1: Server component** — `await requireAdmin('/admin/suspensions')`. Fetch active suspensions joined to the user, plus a user-lookup (by email/id) so an admin can search someone to suspend. Also surface that user's current `fraud_scores.band` for context.

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

- [ ] **Step 4: Typecheck + smoke** (`/admin/suspensions`; impose then confirm `account_active()` flips for that user).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/suspensions apps/web/app/api/admin/suspensions
git commit -m "P8: suspension tools page (impose/lift) + route (impose_suspension/lift_suspension RPCs)"
```

---

## Task 18: Audit-log viewer (read-only)

**Files:**
- Create: `apps/web/app/admin/audit/page.tsx`

- [ ] **Step 1: Server component** — `await requireAdmin('/admin/audit')`. Read-only. Fetch from both P0 `audit_log` (status transitions) and `moderation_actions` (moderator intent), merged and sorted by time, newest first, with simple filters (entity type, actor). Use `createAdminClient()` (bypasses RLS for the read). No mutations, no client component needed beyond optional filter state.

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

- [ ] **Step 3: Run the business vitest suite** — `pnpm --filter @after5/business test`. Expected: all anti-abuse tests pass.

- [ ] **Step 4: Typecheck the app + packages** — `pnpm turbo run typecheck`. Expected: passes.

- [ ] **Step 5: Regenerate TypeScript types** — `pnpm db:types`. Expected: `packages/types/src/database.ts` gains `admin_users`, `suspensions`, `moderation_actions`, `disputes`, `device_fingerprints`, `fraud_signals`, `fraud_scores`, `honeypot_candidates`, and the new `reports` columns + enums.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P8: regenerate database types for moderation/admin + anti-abuse schema"
```

---

## Self-Review

**Spec coverage (vs roadmap P8 'Delivers' / 'Closes'):**
- T&S/admin console → admin pages Tasks 13–18 + layout nav. ✅
- Report triage queue → Task 13 (page + route) reading/actioning P0 `reports` via the Task 3 state machine. ✅
- Dispute resolution (contested no-shows/ratings from P7) → Task 5 (`disputes`) + Task 14 (UI/route). ✅
- Verification review → Task 15, gated to `verification_reviewer`, calling `review_verification` over P0 `verifications`. ✅
- UGC moderation of dates (why-note, photos, ambient audio) → Task 6 (`moderation_status` + feed exclusion) + Task 16 (UI renders text/photo/audio + actions). ✅
- Suspension tools → Task 2 (`suspensions` + `account_active()`) + Task 7 (`impose/lift` RPCs) + Task 17 (UI/route). ✅
- Audit-log viewer (P0 `audit_log`) → Task 18, merging `audit_log` + `moderation_actions`. ✅
- Anti-abuse: device fingerprinting → Task 8 (`device_fingerprints`) + Task 19 (capture). ✅
- Velocity limits (reuse `rate_limits`) → Task 10 (`VELOCITY_LIMITS`) + Task 19 (`checkVelocity` over `rate_limit_check()`). ✅
- Fraud-scoring signal → Task 8 (`fraud_signals`/`fraud_scores`) + Task 9 (pure `scoreFraud`) + Task 10 (`recompute_fraud_score` RPC mirroring the TS model). ✅
- Fake accounts → Task 8 shared-device detection + Task 19 ≥3-users-per-fingerprint signal. ✅
- Swipe farms → Task 10 `isSwipeFarm` + velocity caps. ✅
- Honeypot date pattern (creator harvesting profiles) → Task 10 `isHoneypotCreator` + Task 11 `honeypot_candidates` view + Task 16 honeypot watch tab. ✅
- Moderation state machine for reports → Task 3 (status enum + transition guard). ✅
- Admin role model → Task 1 (`admin_users` + `is_admin`/`admin_has_role`) + Task 12 (`requireAdmin()` reads it). ✅

**Builds on P0 (no parallel tables):** extends `reports` (Task 3), reuses `audit_log`/`log_status_transition()` (Tasks 3,5), `verifications` (Task 7/15), `itineraries`+`browse_feed` (Task 6), `locks`/`match_ratings` (Task 5 disputes), `swipes`/`offers`/`date_instances` (Task 11 honeypot view), and the existing `rate_limits`+`rate_limit_check()` (Task 19). No duplicate tables.

**Follows the existing admin pattern:** every page does `await requireAdmin('/admin/<x>')` + `createAdminClient()`; every interactive surface is a client component POSTing to `/api/admin/<x>` route handlers that re-check `requireAdmin()` — identical to `/admin/insiders` ↔ `/api/admin/insiders`. The env allowlist is preserved and extended (not replaced) by `admin_users`.

**Conventions:** migration filenames timestamped + snake; RLS on every new table; idempotent `DO $$ … duplicate_object` policies; `set_updated_at()` attached to `updated_at` tables; `auth.uid()` in policies; all moderation writes through SECURITY DEFINER RPCs with `admin_has_role()` checks (no direct admin write policies); psql tests in `supabase/tests/`, TS tests via vitest.

**Key decisions:**
1. **Admin role model = DB `admin_users` layered over the env allowlist.** Additive, fail-closed, auditable; allowlist members bootstrap as `super_admin`. Roles: `super_admin`, `ts_admin`, `verification_reviewer`.
2. **Moderation writes are RPC-only.** Tables have read RLS for admins but no write policy; all transitions go through SECURITY DEFINER functions that verify role and append to `moderation_actions` (append-only) — so the console never holds a write capability the DB doesn't gate.
3. **`suspensions` + `account_active()` is the single enforcement source of truth** (P8 owns the terminal rungs of P7's enforcement ladder; expiry-aware so temp suspensions self-clear).
4. **Fraud score = noisy-OR of weighted signals**, banded `clear/watch/review/block`; implemented identically in pure TS (`scoreFraud`, shared/Edge-safe) and SQL (`recompute_fraud_score`) so client and DB agree.
5. **Honeypot defense is two-pronged:** behavioural detection (`isHoneypotCreator` + the `honeypot_candidates` advancement-ratio view) on top of P5's reveal-on-shortlist consent, so harvest both fails structurally and is flagged for review.
6. **Velocity reuses `rate_limit_check()`** rather than a new mechanism — `VELOCITY_LIMITS` just supplies per-endpoint caps.

**Deferred to later phases (intentionally NOT in P8):** automated enforcement-ladder transitions (P7 owns the escalation; P8 exposes the suspension state it lands in); notification delivery of moderation outcomes (P2); banned-user data retention / anonymization on deletion (P9); the verification *vendor* webhook and the client fingerprint-collection SDK wiring (P1/client); cron job that periodically recomputes fraud scores in bulk (P2 scheduler — P8 ships the `recompute_fraud_score` RPC it will call).

**Placeholder scan:** SQL migrations and the pure-logic TS (Tasks 9–10) are complete and runnable. Admin UI tasks (13–18) give complete server components + route handlers + component contracts; the client-component *markup* is described as "mirror `insiders-admin.tsx` style" rather than reproduced verbatim, because the visual shell is a 1:1 copy of an existing, in-repo component (`apps/web/app/admin/insiders/insiders-admin.tsx`) — the load-bearing logic (fetch shapes, action payloads, RPC calls, role gates) is fully specified.

**Type/name consistency:** enums declared once before use (`admin_role`, `report_status`, `report_resolution`, `report_priority`, `suspension_kind/status`, `dispute_kind/status/outcome`, `ugc_moderation_status`, `fraud_signal_kind`, `fraud_band`); RPC arg names (`p_actor`, `p_report`, …) consistent across the migration and the `lib/admin/moderation.ts` wrappers and the route handlers; the noisy-OR thresholds match between `bandFor()` and `recompute_fraud_score`.

**Risk notes:** (1) `reports.status` migration from text→enum (Task 3) rewrites a P0 column — safe because P0 ships no production data and the test exercises the conversion; in a live DB this would need a backfill window. (2) `requireAdmin()`'s return type widens from `{ email }` to `{ userId, email, role }` — backwards-compatible since `email` remains; Task 12 notes all existing callers stay valid. (3) The psql tests insert directly into `profiles` (bypassing `auth.users`) to exercise DB-level behavior, consistent with P0's approach; RLS `auth.uid()` behavior is verified by app integration/smoke checks, not these structural tests.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-p8-moderation-admin.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks. Tasks 1–11 (schema + pure logic) have no UI dependency and can run first; Tasks 12–19 (admin UI) depend on Task 12's `requireAdmin()` extension landing first.

**2. Inline Execution** — execute tasks in order in this session via executing-plans, with checkpoints after Task 11 (data/logic done) and Task 18 (console done).
