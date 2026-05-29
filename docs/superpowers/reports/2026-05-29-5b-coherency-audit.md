# 5b Coherency Audit — planning artifacts vs shipped backend vs prod reality

**Date:** 2026-05-29
**Scope:** Read-only. No code/plan changes. Verified against real migration files (`supabase/migrations/`), edge functions (`supabase/functions/match-*`, `_shared/`), and **prod** DB (ref `ufufmcpnysvwtutpbian`) via Supabase MCP.
**Verdict legend:** GREEN = coherent · YELLOW = minor / doc-only · RED = will cause wrong implementation.

---

## Check 1 — Roadmap ↔ reality (Tasks 5–11 + stale checkboxes)

**Verdict: GREEN (with one YELLOW doc note).**

- Tasks 0–4 (Z/A/B/C) checkboxes match reality: all Z/A/B/C migration files exist locally AND are recorded on prod; all 8 `match-*` edge functions exist and are deployed. C's TS-types + Deno tests gap is marked closed and the files exist.
- Task 5 (D): correctly all-unchecked (spec+plan written, not built). No D route files exist under `apps/web/app/dates/.../interested` or `apps/web/app/reciprocal` (only the plan embeds the source). Correct.
- Tasks 6–9 (E/F/G/H): correctly all-unchecked. No E/F/G/H artifacts exist. Correct.
- Task 10 Step 1: checked + accurate (smoke-test ran, baseline restored). Steps 2–3 correctly open.
- Task 11: correctly open.

**YELLOW 1-a — Roadmap Task 3/4 file lists omit the prod-only `126850` cancel-reason migration.** Task 3 lists `match_cancel_lock` with reason taxonomy but neither Task 3 nor Task 4 references `20260527126850_p5_cancel_reason_extend`, which is on prod and has **no local file** (see Check 3). Doc-only; the migration is real and applied.

---

## Check 2 — Overview spec ↔ shipped backend (contract surface for E/F/G/H)

**Verdict: RED** (several divergences beyond the known F-1 that will bite E/F/G/H planning).

Confirmed-present backend objects (all GREEN):
- RPC signatures on prod:
  - `match_shortlist(p_actor, p_instance, p_candidate, p_rank int)` — **no `idem_key`** (overview/§3 implies a rank-carrying call; matches).
  - `match_make_offer(p_actor, p_instance, p_candidate, p_idem_key)` → **returns `uuid`** (scalar).
  - `match_accept_offer(p_actor, p_offer, p_idem_key)` → returns `uuid` (scalar lock id).
  - `match_withdraw(p_actor, p_instance)` — candidate-side (operates on `candidate_id=p_actor`). Confirms **F-1**.
  - `match_cancel_lock(p_actor, p_lock, p_reason text, p_idem_key)`.
  - `match_resolve_reciprocal(p_actor, p_pair_id, p_chosen_instance, p_idem_key)` → returns `uuid` (lock id).
  - `match_demand_hint(p_instance)` → returns `text`.
- `match_reveal_allowed` + `match_reveal_allowed_pair` + `profiles_select_revealed` policy: present (A.6/A.7). E/F reveal path is backed.
- Notification enum on prod contains **all** types G/A/B reference: `offer_received, new_match, reciprocal_detected, offer_passed, offer_expired, standby_promoted, offer_withdrawn, lock_cancelled_frozen, lock_cancelled_rolled, offer_expiring, rating_request, new_message` (overview §5.1 seam 13 closed). GREEN.
- `feature_config` has both `match_v2_enabled` and `offer_window_hours` — D/E expiry-preview source is valid. GREEN.

### RED 2-a — Cancel-reason taxonomy: overview spec vs shipped `match_cancel_lock` DISAGREE.
- Overview §1 B + §2.3 list benign reasons `schedule_conflict, venue_issue, changed_mind, account_closed` and "safety/misconduct".
- Shipped `match_cancel_lock` body **only accepts** `('mutual','no_show','creator_pre_lock','safety')` (raises `22023 bad_reason` otherwise). Source: `20260527126900_p5_b_complete.sql` lines ~185-188.
- The `cancel_reason` enum on prod is a **superset**: `schedule_conflict, venue_issue, changed_mind, account_closed, safety, misconduct, other, mutual, no_show, creator_pre_lock`. So the enum holds the overview's values but the RPC rejects them.
- Only `safety` triggers the freeze branch; the other three are "benign auto-roll." There is **no `misconduct` path** in the RPC despite §2.5 #11 / §1 B mentioning "safety/misconduct → freeze."
- **Impact on F/D:** F (and D's `CancelWithReasonPicker`, which the D plan already aligned to `mutual/no_show/creator_pre_lock/safety`) must use the RPC's 4 values, not the overview's. The D plan is correct here; the **overview spec is stale**.
- **Reconcile:** amend overview §1 B + §2.3 to the shipped 4-reason set (`mutual`/`no_show`/`creator_pre_lock`/`safety`); note `misconduct` is enum-only / not wired.

### RED 2-b — Error envelope `code` is the STRING name, not `P5xxx`.
- `_shared/errcode.ts` `pgErrorToResponse` maps the PG errcode (`P5008`) to a body whose `code` field is the **human string** (`'reciprocal_pending'`), with the raw `P5xxx` only in `errcode`.
- The overview §4.1 table conflates "Errcode" and "UI string" columns; any E/F/G client wrapper that branches on `code === 'P5xxx'` will never match. (The D plan's `MatchError`/`messageForCode` keys on `P5xxx` and only passes because its unit tests mock `code: 'P5008'`. Against the real envelope it breaks — see Check 4 RED 4-a.)
- **Reconcile:** future UI plans must branch on `body.code` string names (`reciprocal_pending`, `account_gated`, …) OR on `body.errcode` (`P5008`). Pick one and pin it in the overview §4.1 as the canonical client contract.

### RED 2-c — P5008 carries an OFFER id in `detail`, and no `reciprocal_pairs` row exists yet at make-offer time.
- `match_make_offer` raises P5008 with `detail = reciprocal_offer::text` (the counter-party's **offer uuid**) and emits `reciprocal_detected` with payload key `pair_offer_id`. It does **not** create a `reciprocal_pairs` row and does **not** surface a `pair_id`.
- `reciprocal_pairs` (columns: `id, low_user, high_user, status, resolved_at, created_at`) is only read/locked by `match_resolve_reciprocal`; nothing in the shipped happy path inserts it. **Where pair rows get created is unverified/unclear** — `match_make_offer` raises before creating one.
- **Impact:** the overview's "P5008 → redirect to reciprocal chooser by pair_id" flow has no pair_id to redirect with. The chooser route keyed on `[pairId]` cannot be reached from a make-offer P5008 as currently shipped.
- **Reconcile (E/F/D carry-forward):** the reciprocal-chooser entry must be driven by the `reciprocal_detected` notification, and someone must own `reciprocal_pairs` row creation. Confirm whether a trigger/job creates the pair row, or whether `match_resolve_reciprocal`'s `p_pair_id` is expected to be derivable another way. This is a genuine open seam, not just a doc fix.

### YELLOW 2-d — `match_shortlist` takes no `idem_key`.
- Overview §3 "Idempotent replay semantics (every C2 RPC accepting idem_key)" implies shortlist is idempotent; shipped signature has no idem_key. The D plan correctly calls `shortlist(instance, candidate, rank)` with no idem_key. Doc-only; pin that shortlist is non-idempotent.

### YELLOW 2-e — `match_make_offer` does NOT pre-check `chat_lock_ready`; accept does.
- Matches §2.5 #10 (ready checked at accept). No action; noted so E doesn't expect a make-offer ready gate.

---

## Check 3 — Migration-history reconciliation (local files vs prod)

**Verdict: RED** (real drift; characterized below).

Comparison method: `ls supabase/migrations/` vs prod `supabase_migrations.schema_migrations` (MCP `list_migrations`, plus the `name` column).

**Finding 3-a (RED) — Prod records 5b/Z/A/B/C migrations under APPLIED-TIME `version`s, not the local logical filename prefixes.** Example: local `20260527124551_z_chat_lock_ready_5b_launch.sql` is on prod as `version=20260528061128, name=20260527124551_z_chat_lock_ready_5b_launch`. Every 5b migration shows this pattern (prod versions cluster `20260528061128`–`20260528163836`). The **names match**, but the version ordering keys differ from the filenames. A future `supabase db push`/`migration repair` could see these as mismatched. This is the "migration-history reconciliation gap" from project memory.

**Finding 3-b (RED) — Prod-only migration with NO local file:** `20260527126850_p5_cancel_reason_extend` (prod version `20260528163524`). It sits between local `126800` and `126900` and is what extended the `cancel_reason` enum (Check 2-a). **No file exists in `supabase/migrations/`.** A fresh `db reset` locally will NOT reproduce prod's cancel_reason enum → local `match_cancel_lock` tests for `mutual/no_show/creator_pre_lock` would fail on a clean local DB unless those values are added elsewhere. **Reconcile:** export the prod migration body to a local `20260527126850_*.sql` file.

**Finding 3-c (YELLOW) — S5/S4 band name + file divergence (5a-loop reconciliation residue):**
- Local files: `20260527120000_s4_date_instances_feed_columns`, `..120100_s5_record_swipe`, `..120200_s5_post_night`, `..120300_s5_browse_feed`, `..120400_s5_browse_feed_drop_itinerary_id`.
- Prod names: `s4_date_instances_feed_columns`, `s5_record_swipe`, `s5_post_night`, `s5_browse_feed_for_viewer` (NOT `s5_browse_feed`), `restore_p5_s5_swipe_hook`.
- So: local `s5_browse_feed` + `s5_browse_feed_drop_itinerary_id` have no exact prod name match; prod `s5_browse_feed_for_viewer` + `restore_p5_s5_swipe_hook` have no local file. This is the "5a-loop migration gap closed mid-run" residue (per memory). Backend-functionally reconciled (Task 10 smoke passed), but the file/history sets are not 1:1. Not 5b-blocking; flag for an eventual `migration repair` pass.

**Net:** all 5b (Z/A/B/C) *logical* migrations are applied to prod, in correct dependency order, with one prod-only file (3-b) to backfill locally and a version-key vs filename divergence (3-a) to reconcile.

---

## Check 4 — D spec ↔ D plan ↔ backend

**Verdict: RED** (the D plan hard-codes a make-offer return shape and an error shape that do not match the shipped edge functions).

Spec §8 acceptance criteria coverage by the plan: **complete** — every §8 / roadmap-Task-5 criterion maps to a plan task (host 403 → Task 8; drag-rank → Task 7; expiry preview → Tasks 6+8; reciprocal → Tasks 9+10; realtime → Tasks 3+7; flag-off banner → Tasks 4+8; a11y → Task 11; CancelWithReasonPicker → Task 5; F-1 un-shortlist → Tasks 2/7). GREEN on coverage.

Request-body shapes: D plan's edge invocations match the edge functions' destructured keys (`instance/candidate/rank`, `instance/candidate/idem_key`, `lock/reason/idem_key`, `pair_id/chosen_instance/idem_key`, `instance` for withdraw/demand-hint). Edge fns map these to `p_*` correctly. GREEN.

### RED 4-a — `makeOffer` wrapper expects `data.offer_id`; backend returns a bare uuid string.
- Shipped `match_make_offer` `returns uuid` → edge `callRpcAndRespond` wraps it as `{ ok: true, data: "<uuid-string>" }` (the `ok()` helper sets `data` to the raw RPC return).
- D plan Task 2 `makeOffer`: `const res = await call<{ offer_id: string }>('match-make-offer', …); return res.offer_id;` → against the real envelope `res` is a **string**, so `res.offer_id` is `undefined`.
- The make-offer edge fn's own header comment also wrongly claims `Returns: { ok: true, data: { offer_id } }`.
- The unit test passes only because it mocks `data: { offer_id: 'off-9' }`. **Production returns undefined.**
- **Reconcile:** either (a) change the D wrapper to treat make-offer `data` as the uuid string, or (b) wrap the RPC result server-side into `{ offer_id }`. Same applies to `accept_offer` (returns scalar lock uuid) and `resolve_reciprocal` (returns scalar lock uuid) for E/F — flag now so E/F wrappers don't repeat the mistake.

### RED 4-b — `MatchError` code/detail shape mismatch (instance of 2-b/2-c).
- D's `call()` builds `MatchError(data.code, data.detail)` and routes on `e.code === 'P5008'` / reads `e.detail.pair_id`. Real envelope: `code='reciprocal_pending'` (string), `detail='<offer-uuid-string>'`. So `e.code` is never `'P5008'` and `e.detail.pair_id` is `undefined`.
- Net effect: the P5008 → `/reciprocal/[pairId]` redirect (MakeOfferModal) and every `messageForCode(e.code)` toast silently fall through to the generic path against the real backend.
- The D plan's "reciprocal derivation" note (Task 10) correctly observed `reciprocal_pairs` has no instance columns and derives instances from the two active offers — **that part is sound and verified**. The *entry into* the chooser (RED 2-c) and the error-code keying (here) are the breaks.
- **Reconcile:** key `MatchError` on `body.errcode` (`P5xxx`) not `body.code`; treat `detail` as an opaque string; resolve the pair-id sourcing per RED 2-c before D's reciprocal path can work end-to-end.

### GREEN 4-c — `reciprocal_pairs` schema note in the D plan is correct.
Verified live: `reciprocal_pairs(id, low_user, high_user, status, resolved_at, created_at)`. The plan's Task-10 derivation respects this.

---

## Check 5 — Cross-cutting naming

**Verdict: YELLOW.**

- Errcodes `P5000–P5009`: consistent across overview §4.1, `_shared/errcode.ts`, and RPC `raise … using errcode`. (`P5005 chat_not_ready` never raised at 5b launch — expected.) GREEN.
- RPC names: consistent (`match_*`) across overview §3, migrations, edge fns, D plan. GREEN.
- notification_type values: consistent; all referenced values exist in the prod enum. GREEN.
- Edge function names: 8, names match overview §3 exactly. GREEN.
- **YELLOW 5-a:** the dual identity of a P5 error (raw `P5xxx` in `errcode` vs string name in `code`) is not pinned anywhere as the client contract — the root cause of RED 2-b and 4-b. Pin it in overview §4.1.
- **YELLOW 5-b:** reciprocal payload naming drift: notification payload uses `pair_offer_id`, P5008 detail is an offer uuid, the route param is `pairId`, the RPC arg is `p_pair_id` (a `reciprocal_pairs.id`). Four different identifiers around one flow. Pin a single source of the chooser's `pair_id`.

---

## Carry-forward for E/F/G/H planning (backend facts the plans MUST respect)

1. **RPC returns are bare scalars.** `match_make_offer`/`match_accept_offer`/`match_resolve_reciprocal` → `uuid` (string); `match_demand_hint` → `text`. The edge envelope is `{ ok: true, data: <scalar> }` — `data` is NOT an object. Do not read `.offer_id`/`.lock_id` off it.
2. **Error envelope contract:** `{ ok: false, code: <string-name>, message, detail?: <string>, errcode: <P5xxx> }`. Branch on `errcode` for `P5xxx`, or on the string `code`. `detail` is always a string (never an object).
3. **Cancel reasons are exactly** `mutual | no_show | creator_pre_lock | safety`. Only `safety` freezes (standing→`warned` + admin_alert + `bulk_withdraw` job). `misconduct` is enum-only, not wired. F's cancel UI must use these 4.
4. **`match_withdraw(p_actor, p_instance)` is candidate self-withdraw** (F-1). Belongs in E, not D. There is no host-removes-candidate RPC.
5. **Reveal:** `match_reveal_allowed` + `profiles_select_revealed` RLS are live; F reads profiles directly and lets RLS gate. Reveal predicate covers offer (active/accepted) + lock (active/completed) parties + creator.
6. **Reciprocal entry is unresolved (RED 2-c):** P5008 gives an *offer* uuid, not a `reciprocal_pairs.id`; no pair row is created on the make-offer path. Before E/F/D build the chooser, confirm who creates `reciprocal_pairs` rows and how the UI obtains `p_pair_id` (likely via the `reciprocal_detected` notification, but the row source is unverified).
7. **Accept success navigation:** `match_accept_offer` returns the lock uuid string — F's `/matches/[lockId]` must take the returned string directly.
8. **`rating_window` job** fires at `lock.time_range_end + 2h` (`upper(time_range) + interval '2 hours'`); F's rating UI gate should derive `rating_visible_at` from that, not a stored column.
9. **feature_config keys present:** `match_v2_enabled`, `offer_window_hours`. Every C2 RPC raises `P5000` when the flag is off — D/E/F/G must render the flag-off state.
10. **Notification enum is complete** for G — all 5b types exist on prod; G need not extend it.
11. **Local DB will not reproduce prod's cancel_reason enum** until prod-only migration `126850` is backfilled to a local file (RED 3-b) — H's `db reset`-based run-all and any local F cancel tests depend on this.
