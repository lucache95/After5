# Infra Audit — §3 Database/Migrations + §9 Data Safety/Privacy

Date: 2026-05-30. READ-ONLY. Repo + live DB (prod ref `ufufmcpnysvwtutpbian`, MCP read-only) are authority.

---

## §3 Database / Migrations

### Does `supabase db reset` reproduce prod? **NO.**

Reset replays `supabase/migrations/**` by **filename**. Prod migration history (`mcp__supabase__list_migrations`) was applied via `apply_migration`, which records the **band/timestamp at apply time as the version** — not the filename. Result: massive version-vs-filename drift.

- **Local filenames** use logical band order: `20260527124550…126850…127700`.
- **Prod versions** for those same files are the apply timestamps: `20260528061128`, `20260528163524`, …, `20260530160224`. Several prod rows even store the filename *inside the name field* (e.g. `{"version":"20260528062431","name":"20260527126000_p5_lock_keys"}`), proving the version != filename.
- **Prod-only migration with no local file: `20260528163524 / 20260527126850_p5_cancel_reason_extend`.** There is **no `…126850…` file** in `supabase/migrations/`. A fresh `db reset` will NOT create it → the `cancel_reason` enum/extension it added is absent locally → **reset diverges from prod**.
- Prod also has legacy planner migrations (`20260420…` google_place_id, modifiers, group_voting, etc.) that exist on prod but several are folded into local "capture_full_schema"/"baseline_*" squashes rather than 1:1 files — ordering is logically consistent but not row-equivalent.

**Ordering:** Local files apply cleanly in lexical order (no duplicate timestamps, no obvious gap that breaks dependency order). The `z_chat_*` / `s5_*` files are intentionally ordered with `z_` / band prefixes. No out-of-band duplicate among local files. The drift is purely the missing `126850` + version-recording method.

**Verdict (reset reproduces prod):** **NO** — missing `126850` file + version!=filename means a from-scratch reset produces a schema that is *close but not identical* to prod and would re-diverge migration history.

### Production drift delta (after 127100–127700 applies)
All A/B/C/D-band files through `20260527127700_p5_reveal_hardening` ARE on prod (last prod version `20260530160224 p5_reveal_hardening`). So local→prod is now **synced on content** for the 127xxx band. Remaining delta: (1) prod-only `126850_p5_cancel_reason_extend` (no local file — **fix: backfill the file**); (2) systemic version-string drift (cosmetic but blocks `db push`/`reset` against prod — runbook already forbids both).

### Generated types match live? **YES (spot-check).**
`packages/types/src/database.ts`: `locks.rating_closed_at` present (lines ~1001/1013/1025), `reciprocal_pairs` table present (~2100), `match_make_offer` RPC present (~3061). Recently-changed objects are reflected.

### RLS enabled where required? **YES, one expected exception.**
Only `public` table with RLS OFF is **`spatial_ref_sys`** (PostGIS-owned, known/accepted). No other public table is RLS-off.

### SECURITY DEFINER functions safe? **YES for app funcs.**
All `match_*`, `admin_*`, `record_swipe`, `browse_feed_for_viewer`, `dispatch_notification`, `enforce_age_gate`, reveal helpers, job RPCs: **search_path pinned = true** AND **anon EXECUTE = false**. The only anon-executable / unpinned definer funcs are **PostGIS `st_estimatedextent`** (extension-owned, not app code) — accepted.

### Grants revoked on internal RPCs? **YES.** anon has no EXECUTE on any `match_*`/`admin_*`/internal RPC (confirmed via `has_function_privilege`). Hardening migrations `126650`, `127600`, `127700` are live.

### Seed/fixture safety
- **`scripts/cohort-unblock.sql` — PROD-DANGEROUS BY EFFECT.** It marks arbitrary uids phone/age/selfie `verified` with provider `cohort-bypass`, flips `dating_enabled`, sets `account_state=active`, bypassing all real Twilio/Persona checks. It has loud warnings + a `begin;` txn but **NO host/db guard** — nothing stops `psql <PROD_URL> -f`. If run on prod it silently certifies unverified people as identity-verified. Same risk profile for `scripts/seed-cohort-nights.sql`.
- **`scripts/qa-feed-seed.sql` — PROD-DANGEROUS.** Inserts directly into **`auth.users`** with a fixed UUID + placeholder bcrypt password, plus seed itineraries/date_instances. No env guard. On prod it creates a real loginable auth user.
- **`temp_race` leftover table EXISTS ON PROD** (confirmed, 1 row in information_schema.tables). Leftover from a race-condition test; should be dropped.
- None auto-run, but all rely on operator discipline only.

### Rollback strategy
Runbook `docs/superpowers/plans/5b-prod-migration-rollout.md` is **strong**: per-migration apply→verify→advisor→commit discipline, explicit **per-migration Rollback SQL** for nearly every step (drop function/table/column, restore-prior-body with pre-capture). Honest caveats: enum-value additions are one-way (documented). Gap: a couple of "restore prior body" rollbacks depend on the operator capturing the old body into the apply log *before* applying — not pre-baked.

---

## §9 Data Safety / Privacy

### PII map — **`profiles` leaks PII to revealed counterparts.**
`profiles_select_revealed` policy = `id=auth.uid() OR match_reveal_allowed_pair(auth.uid(), id)` and grants SELECT on the **entire row** (no column projection). PII columns on `profiles` exposed to a revealed match:
- **`email`** — CONFIRMED leak (Y3). Real email handed to counterpart.
- **`first_name`**, `city`, `neighborhood` — also on `profiles`, also revealed (first_name is presumably intended; raw `email` is not).
- No phone / DOB / full_name / instagram on `profiles` — those are correctly on **`profiles_private`**.

`profiles_private` holds (owner-locked): `full_name`, `phone`, `birthdate`, `bio`, `instagram_handle`, `emergency_contact (jsonb)`. **Fix for email leak: move `email` off `profiles` to `profiles_private`, or add a column-projected reveal view that excludes email.**

### DOB / birthdate
Stored as `profiles_private.birthdate` (date, owner-only). `enforce_age_gate` trigger requires it before `dating_enabled` flips; `resync_age_on_birthdate` derives `profiles.age` (int, not DOB) — only coarse age is public. Writer is the age-verification flow (Persona webhook per spec; cohort script can also write it as a bypass).

### Persona payload
**Not found as a stored raw-payload column** on `verifications` (the table exposes verification rows but no `payload/raw_response` column surfaced). Verification state is rolled up via `verifications` (kind/state/provider/verified_at). If Persona raw payloads are persisted it is not in the public schema inspected — appears **not retained in DB** (good for minimization; confirm webhook doesn't log payload elsewhere).

### reports / disputes / blocks RLS
Tables have RLS enabled (none appear in the RLS-off list). Policy bodies for these did not surface in the truncated query — **NOT fully verified this pass**; flagged for follow-up to confirm only parties/admin can read.

### audit_log
RLS enabled. Captures status transitions / actor+target uids (per `log_status_transition` definer). PII content low (ids, not free-text PII). Read access not confirmed-restricted this pass — follow-up.

### Retention / deletion / GDPR — **NOT READY.**
No `delete_account` / `export` / `gdpr` / `erase` / `purge_user` function exists in `public` (confirmed via pg_proc search: zero matches). S10 account-lifecycle is unbuilt. **There is NO deletion or data-export path.** GDPR/CCPA erasure & portability are unmet. PII (`profiles_private` phone/birthdate/emergency_contact, `profiles.email`) has no programmatic delete/export.

---

## Mini-verdicts
- **§3 reset reproduces prod:** NO (missing `126850` file + version!=filename drift).
- **Migration ordering:** local files clean/ordered; drift is recording-method + one missing file.
- **Prod drift now:** 127xxx band synced; residual = prod-only `126850` + cosmetic version drift + `temp_race` leftover.
- **Types:** match live (spot-check pass).
- **RLS-off public table:** only `spatial_ref_sys` (accepted).
- **Unsafe DEFINER/grant:** none in app code (only PostGIS `st_estimatedextent`).
- **PII leak surface:** `profiles.email` (+row-level reveal of first_name/city) to counterparts — real, unfixed.
- **Seed danger:** `cohort-unblock.sql`, `seed-cohort-nights.sql`, `qa-feed-seed.sql` all prod-dangerous (no env guard); `temp_race` should be dropped.
- **Rollback:** strong per-migration runbook; minor reliance on operator pre-capture; enum adds one-way.
- **GDPR/deletion:** NONE — no export or delete path; S10 unbuilt.
