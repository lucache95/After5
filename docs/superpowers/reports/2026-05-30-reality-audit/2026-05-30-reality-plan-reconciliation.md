# Reality ↔ Plan Reconciliation — After5 (Phase 5 PLAN RECONCILIATION)

**Date:** 2026-05-30
**Mode:** READ-ONLY. Authority order: implementation > tests > migrations > types > routes > edge-fns > docs > plans. Implementation reality wins.
**Verified against:** prod (Supabase `ufufmcpnysvwtutpbian`, live `pg_proc`/`pg_enum` introspection), local `supabase/migrations/**`, `supabase/functions/**`, the planning corpus, and the 2026-05-29/30 audit reports.

---

## Counts (headline)

- **STALE PLANS:** **8** forward plans last-touched 2026-05-25 with ZERO post-5b awareness: `p6-chat`, `p7-trust-safety-ratings`, `p8-moderation-admin`, `p9-account-lifecycle`, `p10-payments`, `p11-cross-cutting-polish`, plus the 2026-05-25 `RECONCILED-MASTER-PLAN` and `experience-first-dating-implementation-roadmap` (both pre-5b). The `INTEGRATION-CONTRACT` (2026-05-25, edited 05-26) is also pre-5b. The `architecture-overview-design` spec (2026-05-27) is stale on the post-127100 make-offer reality.
- **CONTRACT DRIFT (C1–C11 items diverged from reality):** **7** (C2 make_offer return shape; C2 cancel_reason taxonomy; C2 P5008-raise-vs-commit reciprocal flow; C2 `match_resolve_reciprocal` carries `p_idem_key`; C2 `match_accept_offer`/`match_cancel_lock` idem_key typed `uuid` not `text`; C1 notification_type +9 over the documented 11; C11.3 browse_feed finalization at band 133000 never applied).
- **BUILT BUT UNDOCUMENTED:** **6** clusters (5 RLS/contract migrations 127100–127700 + 127600 anon-revoke; the rebrand/entry-funnel sprint; cohort scripts `scripts/cohort-*.sql`/`seed-cohort-nights.sql`; `process-jobs` prod deploy + 127200 backfill RPCs; prod-only `126850_p5_cancel_reason_extend` with no local file; discriminated-jsonb make_offer return).
- **DOCUMENTED BUT NOT BUILT:** the entire backend of **S7/S8/S9/S10/S11** (p6–p11 deliverables) + the **6 forward-declared job RPCs** the runner dispatches (`match_stale_date_close`, `match_expire_pending`, `match_reconfirm_timeout`, `chat_purge_thread`, `process_deletion`, `analytics_relay_drain`) — none exist on prod/local.

---

## CONTRACT DRIFT (INTEGRATION-CONTRACT C1–C11 vs prod reality)

1. **C2 / overview §3 — `match_make_offer` return shape.** Documented `returns uuid` (`make_offer→uuid`, "scalar offer_uuid"). **Prod returns `jsonb`:** a discriminated union `{kind:'offer',offer_id}` OR `{kind:'reciprocal',pair_id}` (verified via `pg_get_functiondef`). Every doc that says scalar uuid — overview §3 table, the 2026-05-29 coherency audit's RED 4-a ("backend returns a bare uuid string"), and the D-plan wrapper — is now wrong. `127100_p5_reciprocal_pair_wire` rewrote this.
2. **C2 — reciprocal flow inverted from "raise" to "commit+return."** Overview §1A/§2.5 #12 and p5 say make_offer **raises `P5008 reciprocal_pending`** and creates **no** `reciprocal_pairs` row. Prod **does the opposite**: it `insert … on conflict (low_user,high_user)` UPSERTs the pair row, emits `reciprocal_detected` to both with `pair_id`+`pair_offer_id`, and `return jsonb_build_object('kind','reciprocal','pair_id',…)`. P5008 is no longer raised on the make-offer path. (Resolves coherency-audit RED 2-c open seam — but invalidates its conclusion.)
3. **C2 — cancel_reason taxonomy.** C2/§C2 enum lists benign `schedule_conflict,venue_issue,changed_mind,account_closed` + freeze `safety,misconduct`. Shipped `match_cancel_lock` body **only accepts** `mutual|no_show|creator_pre_lock|safety`; only `safety` freezes; `misconduct` is **enum-only, unwired**. The enum is a superset of both (10 values).
4. **C2 signatures — idem_key presence + type.** `match_resolve_reciprocal` ships **with** `p_idem_key uuid` (p5 §C11.4 explicitly says "carries NO `p_idem_key`"). `match_accept_offer`/`match_cancel_lock`/`match_make_offer` take `p_idem_key uuid`, not the C1/C2-implied `text`.
5. **C1 — notification_type drift.** Contract C1+C11.11 documents 15 values. Prod enum has **20**, adding `reciprocal_detected, offer_passed, offer_expired, lock_cancelled_frozen, lock_cancelled_rolled` (5b-emitted) on top. Enum is complete for 5b; the contract list is stale-low.
6. **C2 error envelope keying (unfixed since coherency audit).** `_shared/errcode.ts` puts the **string name** in `code` and `P5xxx` in `errcode`; overview §4.1 conflates them. Any client branching `code==='P5008'` silently falls through. Still unpinned.
7. **C11.3 — `browse_feed` finalization (band 133000) never applied.** The drop+create with the `account_state='active' AND standing NOT IN(...)` creator filter is mandated by C11.3/CV4; paused/suspended-creator-leak regression remains un-closed on prod.

## STALE PLANS — specific dangerous assumptions (per file)

- **`p7-trust-safety-ratings.md` (2026-05-25):** assumes it must BUILD ratings UI/flow. Reality: **F already shipped a `RatingForm` + `/matches/[lockId]/rate`** doing a raw RLS insert into `match_ratings` with **zero downstream** (no `recompute_reliability`, no `standing` write, no ladder). p7's `reliability_config()`/`recompute_reliability`/enforcement-ladder all UNBUILT — p7 has no idea F front-ran it.
- **`p6-chat.md`:** assumes `chat_lock_ready` will become the min-rapport gate (≥2 msgs each). Reality: prod `chat_lock_ready` returns `state='open'` **unconditionally true**; F renders a `Phase7Placeholder` ("messages coming with phase 7"). No `chat_messages`/`send_message` on prod.
- **`architecture-overview-design.md` (2026-05-27):** §3 `make_offer→uuid`, §2.5 #12 "raises P5008, no pair row," §4.1 P5008→chooser-by-pair_id — **all contradicted by the shipped 127100 jsonb/commit behavior** (drift #1/#2). Also still cites `match_withdraw` as B/host-side; reality is candidate-self-withdraw.
- **`p5` reciprocal contract:** §1361 detects reciprocal at **shortlist** time via `match_detect_reciprocal`; prod detects at **make_offer** time inline. The original `reciprocal_pairs`-insert-on-shortlist path is **non-functional/superseded**.
- **F-plan field shape — CORRECT, not stale:** F reads only `first_name, age, city, neighborhood, clear_photo_url, vibe_tags` and explicitly asserts `profiles.bio` does NOT exist. The overview spec's Tier-3 list (`photos[], bio, expectations[]`, §1F/§3 boundary) names columns that **don't exist** — the **overview is stale**, F is right.
- **`p9-account-lifecycle`/`p10-payments`/`p11-polish`:** unbuilt; p11 still owns `analytics_relay` drain (events written, never drained) and the browse_feed finalization, neither applied.
- **`RECONCILED-MASTER-PLAN` + roadmap (2026-05-25):** describe a clean S1→S12 banded order; reality has prod-only migrations, version-vs-filename divergence, and a make_offer rewrite the plan never anticipated.

## BUILT BUT UNDOCUMENTED

- Migrations **127100–127700** (reciprocal-pair wire, job-rpc backfill, feature_config read policy, host pre-offer disclosure, offer-recipient date read, anon-execute revoke, reveal hardening) — post-date all 2026-05-25 plans; the master roadmap's band map stops well before them.
- **Rebrand/entry-funnel sprint** (`2026-05-29-rebrand-entry-funnel`, auth email templates, landing/sign-in) — built, not in any S-stage; templates edited but **not wired in `config.toml`, not deployed**.
- **Cohort scripts** (`scripts/cohort-unblock.sql`, `scripts/seed-cohort-nights.sql`) — service-role RLS-bypass tooling, in no plan; only ever dry-run locally.
- **`process-jobs` prod deploy + 127200 backfill RPCs** (`close_rating_window`, `match_bulk_withdraw`, `match_auto_roll`, `match_expire_offer`) — live; the 2026-05-29 deploy-audit's "127200 pending / process-jobs not deployed" is itself stale (closed in `1d013d8`).
- **Prod-only `126850_p5_cancel_reason_extend`** — applied to prod, **no local file**; a clean `db reset` won't reproduce the cancel_reason enum.

## DOCUMENTED BUT NOT BUILT

- **S7 chat backend** (p6): no `chat_messages`/`send_message`/Realtime message channel; `chat_lock_ready` is a forward stub.
- **S8 trust&safety** (p7): no reliability formula, no enforcement ladder writing `standing`, no `file_report`/`block_user`/check-in/dispute RPCs. `reports`/`disputes`/`blocks` tables exist, empty, unwired.
- **S9 moderation/admin** (p8): only legacy planner admin exists; no dating queue/resolution/appeal/suspension.
- **S10 lifecycle** (p9): enum/column reserved; no pause/delete/export/legal-hold; `process_deletion` RPC absent.
- **S11 payments** (p10): nothing; `payment_dispute` is an unused enum value.
- **6 forward-declared job RPCs** the runner dispatches (`match_stale_date_close`, `match_expire_pending`, `match_reconfirm_timeout`, `chat_purge_thread`, `process_deletion`, `analytics_relay_drain`) — referenced in `process-jobs/handlers.ts`, exist on **neither** prod nor local → latent poison-loop if ever enqueued.

## PLAN DRIFT (roadmap checkboxes vs reality)

- 5b roadmap Tasks 5–9 (D/E/F/G/H) checkboxes read "unbuilt"; **all are built and on `main`** (the 2026-05-30 roadmap-status audit confirms the routes/specs exist). `main` is **+78 ahead of origin → NOT pushed → NOT on Vercel.**
- Roadmap Task 3/4 file lists omit prod-only `126850`.
- G checkboxes "open" but in-app center shipped; the email half (Resend domain, `notification-dispatcher`, templates) is genuinely unbuilt — partial, mislabeled either way.

---

## Most DANGEROUS stale assumptions (would mislead a future executor)

1. **make_offer returns `jsonb` discriminated union, NOT a uuid** — every doc/wrapper reading `.offer_id` off a string (or expecting a scalar) breaks in prod; the reciprocal branch returns `{kind:'reciprocal',pair_id}` with no offer at all.
2. **Reciprocal no longer raises P5008** — it commits the pair row + returns; any UI waiting to catch P5008 to enter the chooser will never fire. The entry is the `reciprocal_detected` notification (`pair_id` in payload).
3. **`chat_lock_ready` is unconditionally TRUE** — p6's rapport gate doesn't exist; anyone can lock instantly. Ghosting risk is live, not gated.
4. **F's RatingForm has NO downstream** — p7 executor will assume ratings flow into reliability/standing; they don't. Submitting a rating today changes nothing about reputation or enforcement.
5. **cancel_reason is `mutual|no_show|creator_pre_lock|safety` only** (not the contract's benign-4 + misconduct); `misconduct` is enum-only/unwired.
6. **`profiles.bio`/`photos[]`/`expectations[]` don't exist** — the overview's reveal data shape names phantom columns; only `first_name,age,city,neighborhood,clear_photo_url,vibe_tags` are real.
7. **Local `db reset` ≠ prod** — prod-only `126850` + version/filename drift mean a clean local build lacks prod's cancel_reason enum.

---

## Verdict — are p6–p11 / S7–S11 safe to execute as-is?

**No.** Concretely:

- **They predate 5b entirely (2026-05-25) and encode a contract that shipped differently.** p7 will re-build a rating flow F already shipped (and will miss that F's insert is consequence-free, so the *real* gap is the recompute/ladder, not the UI). p6 assumes it owns a `chat_lock_ready` rapport gate that is currently a hardcoded `true` stub. The overview spec (the seam doc all sub-projects consume) is wrong on the single most load-bearing contract item — the make_offer return shape and reciprocal flow.
- **Shared-object reality drifted from the contract** the plans treat as authoritative: notification_type (+9), cancel_reason (different set), idem_key typing (`uuid`), the jsonb return — an executor "conforming to the contract" would write code that the deployed RPCs reject or mis-shape.
- **Forward-declared dependencies are vapor.** p9/p10/p11 reference RPCs (`process_deletion`, `analytics_relay_drain`, etc.) that exist nowhere; the job runner already dispatches to 6 of them, so a stray enqueue poison-loops.
- **The feed-finalization invariant (C11.3) the master plan defers to S12 is unapplied**, so a paused/suspended creator still leaks into browse — a privacy/lifecycle assumption p9/p11 rely on but that isn't true on prod.

**Required before executing any of p6–p11:** re-baseline the INTEGRATION-CONTRACT and architecture-overview against prod (drift items 1–7 above), rewrite p6's `chat_lock_ready` ownership and p7's "build ratings" framing to "wire F's existing RatingForm into reliability/standing," backfill `126850` locally, and add a runner guard for the 6 missing job RPCs. Executing the 2026-05-25 plans verbatim would re-implement shipped work, target phantom columns/RPCs, and code against a make_offer/reciprocal contract that no longer exists.
