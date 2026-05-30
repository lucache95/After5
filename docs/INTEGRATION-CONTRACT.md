# After5 — Integration Contract

> Canonical contract. Supersedes docs/superpowers/plans/2026-05-25-INTEGRATION-CONTRACT.md (archived). Verified against prod 2026-05-30 — see docs/CURRENT-PROD-REALITY.md.

**Date:** 2026-05-30 · **Prod ref:** `ufufmcpnysvwtutpbian`

This document records what is actually shipped and running. Where it conflicts with any plan doc, **this document wins.**

---

## 1. Key conventions

- Supabase Postgres; RLS on; all transition/admin logic is `SECURITY DEFINER`.
- Every public RPC asserts `p_actor = auth.uid()` (raises otherwise); internal helpers `revoke execute from public, authenticated`.
- Migrations numbered `YYYYMMDDHHMMSS_name.sql`. Version-key drift (apply-timestamp ≠ logical filename) is **documented and accepted** — do not "fix" with naive `db push`.

---

## 2. Match transition RPCs (C2 — shipped)

These are the only names callers may use.

| Function | Signature | Notes |
|---|---|---|
| shortlist | `match_shortlist(p_actor uuid, p_instance uuid, p_candidate uuid, p_rank int)` | creator only |
| make offer | `match_make_offer(p_actor uuid, p_instance uuid, p_candidate uuid, p_idem_key uuid)` → **jsonb** | see §3 |
| accept → lock | `match_accept_offer(p_actor uuid, p_offer uuid, p_idem_key uuid) returns uuid` | requires `chat_lock_ready(thread)` true (stub) |
| pass | `match_pass_offer(p_actor uuid, p_offer uuid)` | → `match_auto_roll` |
| expire | `match_expire_offer(p_offer uuid)` | idempotent |
| auto roll | `match_auto_roll(p_instance uuid)` | enqueues discrete `standby_roll` jobs |
| withdraw | `match_withdraw(p_actor uuid, p_instance uuid)` | |
| cancel lock | `match_cancel_lock(p_actor uuid, p_lock uuid, p_reason cancel_reason, p_idem_key uuid)` | |
| reciprocal resolve | `match_resolve_reciprocal(p_actor uuid, p_pair_id uuid, p_chosen_instance uuid, p_idem_key uuid)` | see §4 |
| reveal predicate | `match_reveal_allowed(p_viewer uuid, p_instance uuid) returns bool` | only reveal predicate |
| demand hint | `match_demand_hint(p_instance uuid) returns text` | only demand hint |

### Idempotency keys

All `p_idem_key` parameters are **`uuid`-typed**, not `text`. The client generates them via:

```ts
// apps/web/lib/after5/match.ts
const idempotencyKey = crypto.randomUUID();
```

---

## 3. `match_make_offer` return shape

`match_make_offer` returns a **JSONB discriminated union**, never a scalar UUID.

```ts
type MakeOfferResult =
  | { kind: 'offer';      offer_id: string }   // new offer created
  | { kind: 'reciprocal'; pair_id:  string }   // mutual interest detected
```

- The `reciprocal` branch **commits** a `reciprocal_pairs` row and returns `{ kind: 'reciprocal', pair_id }`.
- It does **NOT** `RAISE` error P5008 on the make-offer path (a raise would roll back the insert).
- Callers **must** branch on `result.kind`, not assume a UUID scalar.

---

## 4. `match_resolve_reciprocal`

Signature: `match_resolve_reciprocal(p_actor uuid, p_pair_id uuid, p_chosen_instance uuid, p_idem_key uuid)`

- `p_idem_key` is **`uuid`-typed** (not text).
- Resolves a `reciprocal_pairs` row by selecting one side.

---

## 5. Edge error envelope

All edge functions return errors in this shape:

```ts
{
  ok: false,
  code: '<string name>',   // branch on this
  message: string,
  detail?: string,          // plain string, not an object
  errcode?: 'P50xx'         // Postgres error code, optional
}
```

**Clients branch on the string `code` field, not `errcode`.** `errcode` is informational.

---

## 6. Enums (verified against prod)

### `cancel_reason`

Full enum (10 values, all verified on prod):

```
schedule_conflict, venue_issue, changed_mind, account_closed,
safety, misconduct, other, mutual, no_show, creator_pre_lock
```

- Matching / lock flow uses: `mutual`, `no_show`, `creator_pre_lock`, `safety`.
- Auto-roll on cancel (benign): `schedule_conflict`, `venue_issue`, `changed_mind`, `account_closed`, `other`.
- Freeze (no roll): `safety`, `misconduct`.

### `notification_type`

Has **20 values** on prod. Do not hardcode a subset. Do not reference the old docs' count of 15. Enum includes (non-exhaustive): `new_match`, `offer_received`, `offer_expiring`, `standby_promoted`, `date_reconfirm`, `safety_checkin`, `safety_alert`, `new_message`, `rating_request`, `moderation_action`, `account`, `verification_passed`, `verification_failed`, `appeal_resolved`, `offer_withdrawn`.

---

## 7. Feature flags (`feature_config`)

| key | type | prod value | notes |
|---|---|---|---|
| `match_v2_enabled` | jsonb (`bool`) | `false` | **Global flag only** — no cohort/user/city targeting column. Flipping ON exposes all users. |
| `offer_window_hours` | jsonb (`int`) | `24` | DST-safe; clamped 12–72h by `offer_expires_at()`. |

`match_v2_enabled` has no targeting granularity. Cohort enablement (R1.3) must bypass verification checks per-UUID or add targeting before flipping.

---

## 8. Phantom columns — do NOT reference

These columns **do not exist** on prod. Any code or doc referencing them is wrong:

| Column | Table | Notes |
|---|---|---|
| `bio` | `profiles` | Does not exist. |
| `photos[]` | `profiles` | Does not exist. |
| `expectations[]` | `profiles` | Does not exist. |

Profile reveal tiers are real. The privacy gap: `profiles.email` is currently readable to a revealed match via `profiles_select_revealed`. This is a **known privacy leak** — fix is scoped to R5 / before-public.

---

## 9. `browse_feed_for_viewer`

- Returns feed results with `distance_m`, keyset-paginated.
- Creator account-state filter (`account_state='active' AND standing NOT IN ('suspended','locked_ban')`) is a **known reconciliation gap**: as of this branch the live migration may not fully enforce it. Note when querying: a paused/suspended creator's night could appear in the feed. Fix is tracked in the plan-reconciliation audit.

---

## 10. Chat

`chat_lock_ready` is a **stub that returns `open: true`**. Chat is not a real product surface. The UI shows a "coming soon" placeholder. Do not build features that depend on real chat delivery.

---

## 11. Ratings

`RatingForm` inserts a `match_ratings` row. There is **no downstream processing**: no reliability score update, no standing change, no enforcement. This is not a trust system. It is a data-collection stub.

---

## 12. Job RPCs — six do not exist on prod

The following RPCs are referenced by `process-jobs` handlers but **do not exist on prod** as of this branch:

| Job type | Callee RPC | Status |
|---|---|---|
| `stale_date_close` | `match_stale_date_close` | missing on prod |
| `pending_expiry` | `match_expire_pending` | missing on prod |
| `reconfirm_timeout` | `match_reconfirm_timeout` | missing on prod |
| `chat_purge` | `chat_purge_thread` | missing on prod |
| `deletion_process` | `process_deletion` | missing on prod |
| `analytics_relay` | `analytics_relay_drain` | missing on prod |

**`process-jobs` behavior:** v1 (currently on prod) silently completes on a missing RPC. The R0.2 fail-closed guard (local, not yet deployed) will cause `process-jobs` to **fail closed** and raise a `job_missing_rpc` admin alert instead. Implementing the missing RPCs is future-phase work (R5).

---

## 13. `process-jobs` auth chain

- Vercel cron caller passes `CRON_SECRET` as the bearer.
- The `process-jobs` edge function expects `x-jobs-secret` to equal `JOBS_RUNNER_SECRET`.
- **These must match.** As of 2026-05-30: `CRON_SECRET` is set on Vercel; `JOBS_RUNNER_SECRET` is **not present** in Supabase edge secrets. **Verify before relying on this chain.** This is a live operational gap (R1.2 / R3).

---

## 14. Account state model

Two orthogonal fields on `profiles`:

- `standing standing_state` — moderation gate. Values: `good, warned, cooldown, throttled, reconfirm_required, locked_ban, suspended`.
- `account_state account_lifecycle` — lifecycle. Values: `active, paused, deletion_pending, deleted`. Note: `suspended` is **not** in `account_lifecycle` — suspension lives in `standing`.

`can_enter_lock_flow(p_user)` returns `true` iff `account_state='active'` AND `standing NOT IN ('cooldown','locked_ban','suspended')`.

---

## 15. Edge functions (16 active on prod)

All deployed. Entrypoints are laptop-local paths — no fn→SHA map exists yet (R1.2 / R5). Treat deployed code as possibly ahead/behind the repo.

| slug | verify_jwt |
|---|---|
| `generate-plan`, `classify-photos`, `generate-cover`, `generate-blur` | false |
| `match-shortlist`, `match-make-offer`, `match-accept-offer`, `match-pass-offer`, `match-withdraw`, `match-cancel-lock`, `match-resolve-reciprocal`, `match-demand-hint`, `start-verification`, `confirm-phone` | true |
| `persona-webhook`, `process-jobs` | false |

---

## 16. Known privacy and safety gaps

| Gap | Severity | Fix |
|---|---|---|
| `profiles.email` readable to revealed match via `profiles_select_revealed` | High | Scoped to R5 / before-public |
| `admin_alerts` and `audit_log` are write-only — no reader, no UI | High | R0.3 (admin alerts reader added this branch, not deployed) |
| `PERSONA_WEBHOOK_SECRET` is blank on prod | High | R1 blocker for organic verification |
| `JOBS_RUNNER_SECRET` absent from edge secrets | Medium | R1.2 / R3 |
| `process-jobs` v1 silently completes on missing RPCs | Medium | R1.2 redeploy (fail-closed guard built locally) |
