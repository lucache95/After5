# S1 Exit Audit & S2 Readiness Gate

**Date:** 2026-05-26
**Method:** read-only verification against the actual repo, the live local DB (fresh `supabase db reset`), the committed branch diff, `INTEGRATION-CONTRACT.md` v2.1, `RECONCILED-MASTER-PLAN.md`, the P0/S1 slice, and the S1 audit reports. No files modified except this report; no product code written; no fixes made.

> **Reality reconciliation (important):** the prompt's premise says "work is on feature branch, not main." That is **stale** — S1 was already merged to `main` (`--no-ff` merge `257a305`) and pushed to `origin/main` per prior explicit instructions. This audit therefore evaluates the **post-merge** state; §10's merge recommendation is retrospective.

---

## 1. Branch Hygiene — PASS (one housekeeping item)

- **Current state:** on `main`, at merge `257a305`; `origin/main` is in sync (0 ahead). Working tree clean **except** `apps/web/tsconfig.tsbuildinfo` (modified, see §8).
- **Change scope (range `771b3f0..257a305`, the full pushed set):** the **only** product-code files touched are `apps/web/components/ExploreDatesStrip.tsx` (the authorized stale-types workaround removal) and `packages/types/src/database.ts` (regenerated). Everything else is `supabase/migrations` (14), `supabase/tests` (10), `docs/` (planning + audits), `package.json` (db:test script), `supabase/config.toml` (Colima analytics-disable). **No accidental or unrelated product changes.**
- **Committed:** all 13 S1 migrations + 2 baseline-parity migrations + the collision-fix rename; all 10 psql tests; regenerated `database.ts`; all audit reports. ✓
- **Artifact issue:** `tsconfig.tsbuildinfo` is **tracked in git AND not gitignored** → it will perpetually show as dirty and risks an accidental commit. (Classified in §8.)

## 2. S1 Contract Compliance (v2.1) — PASS

| Contract item | Finding |
|---|---|
| Migration bands (C6) — S1 in `2026052512xxxx` | ✓ all 11 S1 migrations in `120000–121100`. Baseline parity (insiders/is_featured) sits in `2026052216xxxx` **outside** the dating bands — correct, it's pre-existing baseline, not an After5 dating phase. |
| Table ownership | ✓ S1 owns the schema-spine tables only; built nothing owned by S2/S6/S12. |
| Enum ownership/values | ✓ `report_status`=`open,reviewing,actioned,dismissed`; `standing_state`=C3 7-value; `account_lifecycle`=`active,paused,deletion_pending,deleted` (no `suspended`); `cancel_reason` per C2; `payment_preference`/`verification_state`/`date_match_status`/`swipe_direction`/`queue_status`/`offer_status`/`lock_status` present. No enum collisions. |
| reports/disputes DDL (C5/C11.6) | ✓ `report_status` 4-value frozen (incl. `actioned`/`reviewing`); `resolution_code text`; polymorphic `target_id`; `disputes` verbatim with documented `raised_by` RESTRICT (S10 obligation noted). |
| profile / private split | ✓ `profiles` dating cols + owner-only `profiles_private`. |
| devices / baseline parity | ✓ `devices` is S2 (correctly absent). Baseline parity (insiders + `is_featured`) reconciled. |
| audit_log ownership | ✓ append-only `audit_log` + `log_status_transition` on locks/offers/queue_entries/date_instances; RLS on, no policies (admin/service read). |
| account_state / standing model (C3/C11.5) | ✓ two-axis `standing` + `account_state` + `rollover_frozen`; **no** `account_status`. |
| birthdate write-lock (C11.13) | ✓ enforced via column-grant revoke (see §5). |
| trigger helper permissions (C10) | ✓ SECURITY DEFINER helpers have EXECUTE revoked (see §5). |
| browse_feed deferral (C4/C11.3) | ✓ no `browse_feed` view in DB or migrations. |

## 3. Database Reproducibility — PASS

- Fresh `supabase db reset` succeeds; **23 migrations apply in order** (baseline → `150001` collision-fix → `160000/160001` parity → S1 `120000–121100`).
- Production parity drift resolved **only for confirmed baseline objects** (3 `profiles.insider_*` cols, `insider_applications`, `insider_tasks`, `itineraries.is_featured`); full prod-vs-local diff showed nothing else. **No production data pulled** (schema-only MCP introspection).
- `database.ts` regenerated from local; matches local schema; reproducible purely from migrations. No remaining known prod/local drift affects current app usage.

## 4. Invariant Verification — PASS (all proven by executing tests)

`pnpm db:test` NOTICEs:
- one-active-offer per instance + **re-activation after resolution** (proves the index is partial). ✓
- no-overlap lock invariant + **`locks.updated_at` UPDATE** + **slot-freeing after completion**. ✓
- swipe blind-browse leak closed (insert policy validates `creator_id` vs `date_instances` — confirmed in `pg_policies`). ✓
- `match_ratings` self-rating CHECK + participation guard (confirmed in policy `with_check`). ✓
- C11.13 birthdate write-lock (insert as `authenticated` denied). ✓
- audit_log captures both `insert` and `status_change`; `date_instances.time_range` value correct. ✓

## 5. Security / RLS / Grants — PASS (no leak vectors found)

- **RLS enabled on all 16** S1+insider tables. `relforcerowsecurity=false` → only the `postgres` superuser/service-role bypass (test-only + service paths); `anon`/`authenticated` ARE subject to RLS.
- **Default-deny (no policy):** `audit_log`, `disputes`, `insider_applications` → admin/service-role only. ✓
- **Read-restricted:** `reports` INSERT-only (filer can't read others' reports); lifecycle tables `offers`/`locks`/`lock_participants`/`queue_entries` SELECT-only (no write policy → RPC-only, C7). ✓
- **Write policies all gate on `auth.uid()`** and validate cross-refs: `swipes` (creator_id vs date_instances), `match_ratings` (lock participation + counterparty), `blocks`/`date_instances`/`profiles_private` (owner), `reports` (reporter self). ✓
- **SECURITY DEFINER:** `sync_lock_participants`, `log_status_transition` — both `SET search_path=public` and EXECUTE **revoked** from PUBLIC/anon/authenticated. `set_updated_at`/`tstzrange_from_start_duration` are not SECURITY DEFINER (pure/trigger helpers) — fine. ✓
- **Private data:** `profiles_private` owner-only ALL; `birthdate` write revoked for anon/authenticated (REFERENCES/SELECT only). ✓
- **No vector** to leak blind-browse identities, private profile data, report/dispute, or moderation/audit data was found.

## 6. Fixture / Test Safety — PASS

- `mk_user` seeds `auth.users` then `profiles` (no `handle_new_user` trigger to collide); `mk_itinerary` sets the required `inputs`/`stops` NOT-NULL jsonb; `mk_instance` sets all NOT-NULL FKs + relies only on real defaults. No NOT-NULL/FK/CHECK violations (tests execute their assertions, proven by NOTICEs).
- No stale RPC signatures (S1 has no transition RPCs; those are S6).
- **RLS bypass caveat (acceptable, by design):** psql tests run as `postgres` (RLS bypassed), so they validate constraints/indexes/triggers/CHECKs, not RLS *denial*. RLS denial for `auth.uid()` paths is validated where cheaply possible (the C11.13 test sets role `authenticated`) and otherwise deferred to app-level integration tests in later stages. Production client code uses `anon`/`authenticated` and cannot bypass RLS.
- No fixture/test depends on production-only schema (baseline parity migrations now represent it locally).

## 7. Generated Types Safety — PASS

- `database.ts` includes **both** baseline-parity objects (`insider_*`, `insider_applications`, `insider_tasks`, `itineraries.is_featured`) **and** all S1 dating objects.
- No legitimate production-backed app usage loses type support (typecheck 5/5).
- The removed workaround (`ExploreDatesStrip` `as unknown as {…}`) is genuinely safe to remove — typecheck verified green after removal; the dead `Row` interface was also removed.
- **No `unknown`/`any` casts were added** to hide schema problems — one was *removed*. (Grep note: the elaborate cast is gone.)

## 8. Tooling Caveats

| Caveat | Classification | Notes |
|---|---|---|
| `pnpm lint` interactive/unconfigured (`apps/web` has no ESLint config; `next lint` prompts to set up) | **DOES NOT BLOCK S1 MERGE; SHOULD FIX BEFORE S2** | A deterministic, non-interactive lint gate matters for subagent-driven S2 work (subagents can't answer the prompt; CI can't enforce it). Low effort: add an ESLint config (`eslint-config-next`) + a non-interactive `lint` script. |
| `apps/web/tsconfig.tsbuildinfo` tracked + not gitignored + perpetually modified | **NON-BLOCKING HOUSEKEEPING** | Worse than "uncommitted": it's *tracked*, so it stays dirty and could be committed accidentally. Fix: `git rm --cached apps/web/tsconfig.tsbuildinfo` + add `*.tsbuildinfo` to `.gitignore`. |

Neither is a "MUST FIX IMMEDIATELY" / merge blocker. The lint gap is the one worth closing **before** S2 starts.

## 9. S2 Readiness

S2 = async/config/notify/chat-core spine (jobs+runner, notifications/devices/`register_device`/`dispatch_notification`, `feature_config`+`offer_expires_at()`, `analytics_events`, `admin_alerts`, `can_enter_lock_flow`, chat-core primitives).

- **S1 dependencies S2 needs exist:** `profiles.standing` + `account_state` + `rollover_frozen` (read by `can_enter_lock_flow`), the full schema spine, and `set_updated_at()`. ✓
- **S2-owned objects correctly absent:** `jobs`, `notifications`, `devices`, `feature_config`, `analytics_events`, `admin_alerts`, `chat_threads`, `can_enter_lock_flow` — none exist yet (S1 didn't overreach). ✓
- **No S1 ambiguity blocks S2.** S2 can start without reworking S1; it adds new tables + the `can_enter_lock_flow` gate that reads existing S1 columns.
- **Baseline compatibility for S2:** S2's objects are greenfield (absent in production), so no prod-drift reconciliation is needed for them. Recommend a quick targeted prod check only if S2 ever ALTERs an existing/baseline table.
- **Stale-doc risk:** S2 agents must read `INTEGRATION-CONTRACT.md` v2.1 + `RECONCILED-MASTER-PLAN.md` as authority; the 12 P-files are subordinate slices, and `2026-04-23-date-engine-v2` is superseded — don't let an S2 agent treat those as authoritative.
- **One pre-S2 quality item:** establish the deterministic lint gate (§8) so the S2 subagent loop has spec→typecheck→lint gates.

## 10. Merge Recommendation (retrospective — merge already executed)

- **What happened:** `--no-ff` merge of `feat/dating-s1-schema-spine` into `main` (`257a305`), pushed to `origin/main`. Post-merge `main` verified: clean `db reset`, all tests pass, typecheck green.
- **Assessment:** the executed **normal `--no-ff` merge was the right choice** — it preserves the granular, well-messaged S1 commit history (each task + each review fix) as an auditable trail and gives a single milestone/revert point. A **squash** would have been *wrong* here (it would discard the valuable per-task/review history). Keeping the **baseline-drift commit separate** (`8764521`) was correct and is preserved.
- **No rework needed** on the merge itself.
- **For S2:** create a **fresh `S2` branch from `main`** (`git checkout main && git pull && git checkout -b feat/dating-s2-async-spine`). Delete the now-fully-merged `feat/dating-s1-schema-spine` when convenient.

## 11. Final Verdict

**S1 EXIT VERDICT: 🟢 GREEN — S1 is safe (and already merged soundly).** Contract-compliant, reproducible, invariants proven, security posture clean, types aligned, scope-disciplined. No blockers.

**S2 READINESS VERDICT: 🟡 YELLOW — one low-effort pre-S2 fix recommended.** S1 fully supports S2 and there is no functional blocker, but before kicking off subagent-driven S2 work, establish a **deterministic, non-interactive lint command** (configure ESLint in `apps/web`) and, as housekeeping, **untrack `tsconfig.tsbuildinfo`** + gitignore it. With those done, S2 is GREEN to start from a fresh branch off `main`.

*No fixes were made during this audit.*
