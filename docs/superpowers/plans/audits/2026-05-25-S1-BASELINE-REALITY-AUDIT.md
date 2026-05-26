# S1 / P0 Baseline Reality Audit

**Date:** 2026-05-25
**Auditor scope:** verify the S1 (P0 — schema spine & fixtures) implementation plan against the **actual live database and repo**, not against prior planning documents.
**Method:** direct introspection of the running local Postgres (`supabase start`, `127.0.0.1:54322`) via `psql`, plus reading the existing migrations, `package.json`, and the P0 plan. Two findings were **empirically validated** by running the candidate fixtures inside rolled-back transactions against the real schema.
**Rule observed:** no product/application code written; no implementation performed; no values guessed (every column/constraint/trigger fact below comes from `information_schema` / `pg_catalog`).

**Authoritative inputs audited:**
- Plan: `docs/superpowers/plans/2026-05-25-p0-data-model.md` (S1 slice)
- Governing: `INTEGRATION-CONTRACT.md` v2.1, `RECONCILED-MASTER-PLAN.md`
- Live DB: baseline migrations `20260419193959_initial_schema` … `20260522150001_*` (10 migrations, collision already fixed)

---

## 1. Critical Baseline Mismatches

| # | Severity | Mismatch | Evidence | Status |
|---|---|---|---|---|
| **M1** | **BLOCKER (for S1 invariant tests)** | Plan's `mk_itinerary()` fixture inserts only `(id, user_id)` into `itineraries`, but baseline `itineraries` has **`inputs jsonb NOT NULL`** and **`stops jsonb NOT NULL`** with no default and no CHECK. As written, `mk_itinerary` throws `null value in column "inputs" … violates not-null constraint`, aborting every test that depends on it (Tasks 7, 8, 12 — i.e., **both flagship invariants never get exercised**). | `initial_schema.sql:123-124`; live introspection (NOT-NULL-no-default on itineraries = `inputs`, `stops`); **empirically reproduced** the failure and **validated** the fix in a rolled-back txn. | **Fix known & pre-validated** (see §7, F1). Converts verdict to GREEN. |

No other blocking mismatch was found. The remaining items (§5, §6) are non-blocking notes/cautions.

---

## 2. Tables Touched by S1/P0

### 2A. EXISTING tables (mismatch risk lives here)

#### `auth.users` (FK target + fixture insert via `mk_user`)
**Existing Shape (relevant):** 35 columns. **Only `id uuid` is NOT NULL without a default**; `is_sso_user`/`is_anonymous` are NOT NULL **with** default `false`; everything else nullable or defaulted. No insert triggers (see §6). PK on `id`.
**Plan Assumptions:** `mk_user` inserts `(id, instance_id, aud, role, email, created_at, updated_at)` and relies on an *explicit* `profiles` insert afterward (i.e., assumes **no** auto-create trigger).
**Compatibility Findings:** **COMPATIBLE.** The provided columns are a strict superset of what's required (`id`). No `handle_new_user`/signup trigger exists, so the subsequent explicit `profiles` insert will **not** collide. Generated per-call email (`<label>_<uid8>@test.local`) avoids any unique-email collision.
**Required Fix:** none.

#### `profiles` (ALTER + fixture insert via `mk_user`)
**Existing Shape:** `id uuid PK NOT NULL` (no default), `first_name text`, `email text`, `city text`, `neighborhood text`, `created_at timestamptz NOT NULL default now()`, `updated_at timestamptz NOT NULL default now()`. FK `profiles.id → auth.users(id) ON DELETE CASCADE`. Trigger: `profiles_updated_at` (BEFORE UPDATE → `set_updated_at`). No CHECK constraints. RLS enabled, **not forced**.
**Plan Assumptions:** `mk_user` inserts `(id, first_name)`; Task 2 `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for 15 dating/standing/account columns + enums; creates `profiles_private`.
**Compatibility Findings:** **COMPATIBLE.** Only `id` is required (provided). **None** of the 15 columns the plan adds (`primary_city_id`, `dating_enabled`, `age`, `vibe_tags`, `age_pref`, `gender`, `gender_preferences`, `distance_pref_km`, `blurred_photo_url`, `clear_photo_url`, `reliability_score`, `verification`, `standing`, `account_state`, `rollover_frozen`) pre-exist → no silent `IF NOT EXISTS` skip, no type mismatch. `mk_user` insert empirically succeeds.
**Required Fix:** none. (Informational note N1 re: `profiles.city text` vs new `primary_city_id`.)

#### `itineraries` (ALTER + fixture insert via `mk_itinerary`)
**Existing Shape:** 26 columns. **NOT-NULL without default: `inputs jsonb`, `stops jsonb`** (and `is_public`/`loved_count`/`generated_at` which *have* defaults). `id uuid PK default gen_random_uuid()`. `user_id uuid` **nullable** → `auth.users(id) ON DELETE SET NULL`. `template_id text` **nullable** → `templates(id)`. `modifier_id text` **nullable** → `modifiers(id)`. **No CHECK constraints.** **No insert/update triggers** (uses `generated_at`, not `updated_at`). RLS enabled, not forced.
**Plan Assumptions:** `mk_itinerary` inserts `(id, user_id)` only; Task 4 `ALTER … ADD COLUMN IF NOT EXISTS` for `city_id`, `is_evergreen`, `match_status`, `pay_setting`, `ambient_sound_url`, `why_note`, `vibe_tags`.
**Compatibility Findings:** **INCOMPATIBLE (M1).** The `(id, user_id)` insert violates `inputs`/`stops` NOT-NULL. The 7 ALTER columns themselves are fine (none pre-exist; nullable FKs to `templates`/`modifiers` don't block because they're omitted/NULL).
**Required Fix:** **F1** — `mk_itinerary` must also set `inputs => '{}'::jsonb, stops => '[]'::jsonb`. These are the **minimal valid values of the correct JSON type** (object / array); confirmed there is **no DB constraint, CHECK, or trigger** that reads or shape-validates them, and fixture rows are never read by application code. **Empirically validated** (fixed version returns a uuid). No contract amendment needed.

#### `places` (FK target for `date_instances.venue_id`)
**Existing Shape:** `id uuid PK default gen_random_uuid()`; `slug` unique; `places_updated_at` trigger. RLS enabled, not forced.
**Plan Assumptions:** `date_instances.venue_id uuid REFERENCES places(id)` (nullable).
**Compatibility Findings:** **COMPATIBLE.** `places.id` is `uuid` PK; `venue_id` is nullable and omitted by fixtures.
**Required Fix:** none.

### 2B. NEW tables created by S1 (greenfield — no baseline to mismatch)

`cities`, `profiles_private`, `verifications`, `date_instances`, `swipes`, `queue_entries`, `offers`, `locks`, `lock_participants`, `match_ratings`, `blocks`, `reports`, `disputes`, `audit_log` — **none exist yet** (introspection confirms 0 rows in the "already exists" check). They cannot conflict with the baseline. Their **internal** fixture/test-insert compatibility was checked statically against the plan DDL:

- `mk_instance` → `date_instances(itinerary_id, creator_id, city_id, starts_at)` sets every NOT-NULL-no-default column (`duration_min` default 150, `status` default, `time_range` generated, `id`/timestamps default). **OK** (after Task 1 Kelowna seed + Task 4 table exist).
- `p0_offer_invariant` → `offers(date_instance_id, candidate_id, creator_id, status, expires_at)` sets all required. **OK.**
- `p0_lock_overlap` → `locks(date_instance_id, creator_id, matched_user_id, status)` sets all required; uses **two distinct instances** so `unique(date_instance_id)` is not tripped; sync trigger reads generated `time_range`. **OK.**
- `p0_audit_log` → insert+update `locks` triggers `log_status_transition`. **OK.**

---

## 3. Constraint Compatibility Matrix

| Constraint class | Baseline reality | S1 plan interaction | Verdict |
|---|---|---|---|
| NOT-NULL no-default (`auth.users`) | only `id` | `mk_user` provides id + 6 extras | ✅ compatible |
| NOT-NULL no-default (`profiles`) | only `id` | `mk_user` provides `(id, first_name)` | ✅ compatible |
| NOT-NULL no-default (`itineraries`) | `inputs`, `stops` | `mk_itinerary` omits both | ❌ **M1 / fix F1** |
| CHECK (profiles/itineraries/places) | **none** | fixtures insert minimal rows | ✅ no shape gate |
| FK (`profiles.id→auth.users`) | ON DELETE CASCADE | auth.users seeded first | ✅ compatible |
| FK (`itineraries.user_id→auth.users`) | nullable, SET NULL | set to real user | ✅ compatible |
| FK (`itineraries.template_id/modifier_id`) | nullable | omitted (NULL) | ✅ not blocking |
| UNIQUE (`places.slug`) | exists | unrelated to fixtures | ✅ n/a |
| Generated column | none on baseline | S1 adds `date_instances.time_range` (generated) — fixtures never write it | ✅ correct |
| Enum types (12 S1 creates) | **none pre-exist** | `CREATE TYPE` on clean reset | ✅ no collision (caution R1) |

---

## 4. Fixture Helper Compatibility Matrix

| Helper | Inserts into | Missing NOT-NULL? | Invalid enum? | FK-before-parent? | Blocked by RLS? | CHECK violation? | Trigger needs missing dep? | Verdict |
|---|---|---|---|---|---|---|---|---|
| `mk_user(label)` | `auth.users`, `profiles` | No | No | No (users→profiles in order) | No (postgres bypasses, RLS not forced) | No | No (no insert triggers) | ✅ **OK (empirically passes)** |
| `mk_itinerary(user)` **as written** | `itineraries` | **YES — `inputs`,`stops`** | No | No | No | No | No | ❌ **FAILS (empirically) → F1** |
| `mk_itinerary(user)` **fixed** | `itineraries` | No | No | No | No | No | No | ✅ **OK (empirically passes)** |
| `mk_instance(itin,creator,starts)` | `date_instances` | No | No | No (parents exist after Tasks 1+4) | No | No | sync/audit triggers OK | ✅ OK (post Task 4) |

**Conclusion:** exactly **one** fixture helper (`mk_itinerary`) has the missing-NOT-NULL bug. The other two are clean. No invalid-enum, no FK-ordering, no RLS-block, no CHECK, no stale-signature issues were found in any helper or in the three invariant test files.

---

## 5. Migration Compatibility Risks

- **R1 — `CREATE TYPE` is not idempotent (non-blocking).** The plan's enum creations use bare `CREATE TYPE … AS ENUM` (Postgres has no `IF NOT EXISTS` for this). On the project's standard `supabase db reset` (full rebuild on empty DB) this is **safe** — confirmed none of the 12 S1 enum names collide with the 8 pre-existing enums (`place_type`, `effort_level`, `energy_level`, `price_tier`, `weather_works_in`, `occasion`, `modifier_difficulty`, `place_approval_status`). Risk only materializes if a single migration is re-applied **without** a reset. Enum-before-use ordering across the `120000–1211xx` band is correct (`payment_preference`/`verification_state` at `120100` precede their use at `120200`/`120300`).
- **R2 — migration ordering vs baseline (non-blocking, already mitigated).** New band `20260525120000+` sorts strictly after the latest baseline (`20260522150001`). A pre-existing duplicate-version collision (`20260522150000` ×2) was **already fixed** (renamed to `…150001`) and committed; without that fix `supabase start`/`db reset` crashes on `schema_migrations_pkey`.
- **R3 — `pnpm db:types` target confirmed.** Script exists (`supabase gen types typescript --local > packages/types/src/database.ts`) and the target file is present (40 KB). Task 13 will regenerate cleanly.
- **No `browse_feed` in S1.** Confirmed the plan ships **no** view (correctly deferred to S12); there are **no existing views** on `profiles`/`itineraries`/`places` that an `ALTER TABLE ADD COLUMN` could break.

---

## 6. RLS / Trigger / Function Risks

- **Triggers on `auth.users`: NONE.** No `handle_new_user` / signup auto-insert. → `mk_user`'s explicit `profiles` insert is correct and won't double-insert. (This was the single highest-risk hidden assumption; it checks out.)
- **Triggers on `profiles`/`places`: only `*_updated_at` BEFORE UPDATE.** **`itineraries` has no row trigger at all.** No insert-side trigger requires any dependency for fixture rows.
- **Functions inserting into `profiles`: NONE** (scanned all `public`/`auth` function bodies).
- **Name collisions: NONE.** Of `mk_user/mk_itinerary/mk_instance/sync_lock_participants/log_status_transition`, only `set_updated_at` exists (which S1 reuses, not redefines). S1 functions use `CREATE OR REPLACE` anyway.
- **RLS force state: `relforcerowsecurity = false`** on profiles/itineraries/places (and will be on new tables by default). Because psql connects as the `postgres` superuser, **RLS is bypassed for fixtures/tests** — this is what allows the invariant tests to insert directly into `offers`/`locks` (which deliberately have no INSERT policy) and actually hit the unique index / GiST exclusion. **Implication (by design, not a defect):** these psql tests do **not** verify RLS *denial*; that is correctly deferred to app-level integration tests in later stages.

---

## 7. Required S1 Fixes

- **F1 (REQUIRED, pre-validated) — fix `mk_itinerary` in `supabase/tests/_fixtures.sql`:**
  ```sql
  create or replace function mk_itinerary(p_user uuid) returns uuid language plpgsql as $$
  declare iid uuid;
  begin
    insert into itineraries (id, user_id, inputs, stops)
    values (gen_random_uuid(), p_user, '{}'::jsonb, '[]'::jsonb) returning id into iid;
    return iid;
  end $$;
  ```
  Apply when Task 0 is written. `mk_user` and `mk_instance` stay **exactly** as the plan specifies. This is the **only** code change required for baseline compatibility.

- **F2 (housekeeping, already done):** duplicate migration version fixed (`20260522150001`); local analytics disabled for Colima. Both committed on `feat/dating-s1-schema-spine`.

---

## 8. Required Contract or Plan Amendments

- **None required.** F1 is a fixture-body correction fully inside P0/S1's own ownership (C8 fixtures), not a change to any shared contract surface. The `INTEGRATION-CONTRACT.md` and `RECONCILED-MASTER-PLAN.md` need no edits for S1.
- **Recommended (optional) doc note:** update the P0 plan's Task 0 `mk_itinerary` body to include `inputs`/`stops` so the plan document matches reality (prevents a future reader re-introducing the bug). Low priority; the fix will be baked into the implemented `_fixtures.sql` regardless.

### Informational notes (no action needed for S1)
- **N1:** `profiles` already has `email`, `city`, `neighborhood` (text). The dating model adds `primary_city_id uuid` + uses the `cities` table. Two city representations will coexist; later phases should standardize reads. Not an S1 conflict.
- **N2:** `auth.users` inserts bypass GoTrue (standard for DB fixtures); fine because tests never exercise the auth API.

---

## 9. S1 Go / No-Go Verdict

The plan is **structurally sound and overwhelmingly compatible** with the live baseline: no hidden signup trigger, no enum/type collisions, no dependent views, no CHECK landmines, correct FK ordering, working `db:types`, and the RLS-bypass behavior that the invariant tests rely on is real. **Exactly one** real incompatibility exists — the `mk_itinerary` missing-NOT-NULL bug — and it is now **reproduced and its fix empirically validated** against the running database. It is a one-line fixture correction with **no** contract impact.

Because the plan **as written** still contains that defect (it would fail at Task 7/8 test time), the strict verdict is YELLOW pending F1, which flips to GREEN the moment F1 is incorporated into Task 0 (i.e., S1 can start immediately with the corrected fixture).

**S1 VERDICT: 🟡 YELLOW — apply fix F1 (pre-validated) in Task 0, then proceed. Post-F1 state is GREEN.**

- No RED conditions: the plan **does** match the baseline schema everywhere except F1.
- Confidence: **HIGH** — findings are from live-DB introspection + executed probes, not document review.
