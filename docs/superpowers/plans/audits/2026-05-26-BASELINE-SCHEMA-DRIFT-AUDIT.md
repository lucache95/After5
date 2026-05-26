# Baseline Schema Drift Audit & Production-Parity Fix

**Date:** 2026-05-26
**Trigger:** S1's Task-13 `pnpm db:types` regenerated `packages/types/src/database.ts` from the **local** database and dropped columns/tables that exist only in **production**, breaking `pnpm typecheck`.
**Method:** read-only introspection of the live production schema via the Supabase MCP (OAuth, `execute_sql`/`list_tables`) — **schema only, no data pulled, no writes to production**. Migrations were written and applied **locally only**.
**Scope guardrail honored:** confirmed the complete drift surface before applying; included only the confirmed drifted objects; did not absorb any unrelated drift (there was none beyond the items below).

---

## 0. Root cause

The repo had **production schema drift**: objects were applied to the production database (via dashboard/SQL/branch) without ever being captured in a local migration. The committed `database.ts` on `main` had been generated from a production-connected state, so it *included* those objects and the app typechecked. When S1 regenerated types from the **local** stack (which the missing migrations could not reproduce), those objects vanished from `database.ts`, and the app code that depends on them failed to typecheck.

This was **not** an S1 product-design issue; S1 merely surfaced a pre-existing reproducibility gap.

---

## 1. Baseline parity migrations created

Placed in the **baseline band** (before the S1 `2026052512xxxx` migrations) because these objects pre-date the dating work and are baseline, not After5-dating features. Both are idempotent (`add column if not exists`, `create table if not exists`, `DO/EXCEPTION` policies, `create index if not exists`) so they are a **safe no-op** if ever applied to an environment that already has them (e.g. production).

- `supabase/migrations/20260522160000_baseline_insiders_schema.sql`
- `supabase/migrations/20260522160001_baseline_itineraries_is_featured.sql`

S1 migrations and tests were **not modified** — preserved exactly as-is.

---

## 2. Objects restored

Reproduced **faithfully from production introspection** (exact columns, types, defaults, CHECKs, FKs, indexes, RLS). Postgres' inline-constraint auto-naming reproduces production's constraint/index names exactly (verified).

**`profiles` (columns added):**
- `insider_role text` (nullable)
- `insider_points integer NOT NULL DEFAULT 0`
- `insider_approved_at timestamptz` (nullable)

**`insider_applications` (table):** `id` uuid PK, `created_at`, `email`/`first_name`/`motivation`/`best_date_spot` (NOT NULL), `instagram`, `status text NOT NULL DEFAULT 'pending'` CHECK in (pending/approved/rejected), `reviewed_at`, `reviewed_by → profiles(id)`, `notes`; index `idx_insider_apps_status`. RLS **enabled, no policies** (service-role-only writes — matches prod and the apply route).

**`insider_tasks` (table):** `id` uuid PK, `created_at`, `assigned_to → profiles(id)`, `task_type text NOT NULL` CHECK in (visit_venue/rate_date/improve_copy/business_outreach/take_photo), `title` (NOT NULL), `description`, `venue_id → places(id)`, `itinerary_id → itineraries(id)`, `points_reward integer NOT NULL DEFAULT 10`, `status text NOT NULL DEFAULT 'open'` CHECK in (open/assigned/submitted/approved/rejected), `submitted_at`, `submission_notes`, `submission_photo_url`, `completed_at`; index `idx_insider_tasks_assignee (assigned_to, status)`. RLS enabled with 2 policies: owner SELECT (`assigned_to = auth.uid()`), owner UPDATE while status in (assigned/submitted) — matches prod exactly.

**`itineraries.is_featured boolean NOT NULL DEFAULT false`** — editorial "spotlight on homepage" flag read by `components/ExploreDatesStrip.tsx` (`is_public AND is_featured`).

Grants: standard Supabase table grants (anon/authenticated/service_role) are auto-applied to public tables locally — matches prod; no explicit grants needed.

Verification (local, post-reset): all 6 objects present; constraint names = `insider_applications_status_check`, `insider_applications_reviewed_by_fkey`, `insider_tasks_status_check`, `insider_tasks_task_type_check`, `insider_tasks_{venue_id,assigned_to,itinerary_id}_fkey`; indexes/PKs and the 2 insider_tasks policies all match production.

---

## 3. Types regenerated

`pnpm db:types` re-run from the local stack (now reproducing production + the S1 dating schema). `packages/types/src/database.ts` now contains:
- `insider_role` / `insider_points` / `insider_approved_at` on `profiles`
- `insider_applications`, `insider_tasks` tables
- `itineraries.is_featured`
- **and** all S1 dating tables (`date_instances`, `offers`, `locks`, `lock_participants`, `queue_entries`, `swipes`, `match_ratings`, `reports`, `disputes`, `blocks`, `audit_log`, `cities`, `profiles_private`, `verifications`).

`database.ts` is now aligned with both production-backed app usage and the new S1 schema.

---

## 4. Temporary workarounds removed or kept

**Removed (safe after regeneration):** `apps/web/components/ExploreDatesStrip.tsx` previously cast `supabase.from('itineraries')` through `as unknown as {…}` with a comment "generated DB types are stale … Column exists in prod." With `is_featured` now in the regenerated types, the cast (and its now-false comment) were removed in favor of the plain typed query; the dead local `Row` interface it fed was also removed. Typecheck re-verified green after removal. This is the only application-code change and was explicitly authorized as a safe post-parity cleanup.

**Kept:** none outstanding for this drift.

---

## 5. Remaining production drift

**None.** A full prod-vs-local diff was performed at both granularities:
- **Table level:** production `public` has exactly two tables not in local — `insider_applications`, `insider_tasks` — both now restored.
- **Column level:** across all 20 shared tables (including the 70+ column `places` table), the only production columns missing locally were the three `profiles.insider_*` columns and `itineraries.is_featured` — all now restored.
- No enums, sequences, or triggers were involved in the drift.

No unrelated drift was absorbed. (Column *types/defaults* were compared for the drifted objects; the matching-name columns across shared tables were diffed by name — a strong parity signal.)

---

## 6. S1 status

**Green.** S1 migrations/tests untouched. After adding the baseline migrations, a full `supabase db reset` applies cleanly and all S1 invariant/structure tests pass:
`p0_cities`, `p0_profiles_private` (incl. C11.13 birthdate write-lock), `p0_date_instances` (time_range value), `p0_swipes`, `p0_offer_invariant` (+ re-activation), `p0_lock_overlap` (+ UPDATE + slot-freeing), `p0_match_ratings`, `p0_blocks` (+ self-block CHECK), `p0_audit_log` (insert + status_change). Both flagship invariants still fire.

---

## 7. Typecheck status

**Green — `pnpm typecheck`: 5/5 packages pass** (`@after5/web`, `@after5/api-client`, `@after5/business`, `@after5/types`). The prior insider_* errors are resolved.

`pnpm lint` is **not evaluable**: `apps/web` has no committed ESLint config, so `next lint` drops into an interactive setup prompt and fails in a non-TTY shell. This is a **pre-existing** condition unrelated to this fix (and to S1). Recommend configuring ESLint as separate repo housekeeping.

---

## 8. Final verdict

**BASELINE DRIFT VERDICT: 🟢 GREEN** — local migrations now faithfully reproduce the production schema the app depends on, and typecheck passes.

- **Can local migrations now faithfully reproduce the production schema required by the app?** Yes. `supabase db reset` from a clean state reproduces the insiders schema, `itineraries.is_featured`, and all baseline + S1 objects the app references.
- **Is `database.ts` now aligned with actual production-backed app usage?** Yes — it contains the insiders objects, `is_featured`, and the S1 dating schema; the stale-types workaround was removed and typecheck is green.
- **Is S1 still green?** Yes — untouched; all migrations apply and all tests pass.
- **Is the repo now safe for future Superpowers implementation stages?** Yes. The reproducibility gap that would have re-bitten on every `db:types` regeneration is closed. **No contract or master-plan amendment is required** — the insiders program and `is_featured` are pre-existing baseline, outside the After5 dating contract, and were reproduced (not redesigned).

**Recommended (non-blocking) follow-ups:** (1) configure ESLint in `apps/web` so `pnpm lint` is runnable in CI; (2) treat `supabase db pull` parity as a periodic check to catch future out-of-band production changes early.
