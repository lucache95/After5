# 5b Matching — Adversarial Security Pass (Access Control)

Date: 2026-05-29
Scope: READ-ONLY probing. Local Postgres (`127.0.0.1:54322`) + read-only prod checks (ref `ufufmcpnysvwtutpbian`).
Method: probes run as a hostile authenticated user (`set role authenticated; set request.jwt.claims …`), as `anon`, and via cross-tenant RPC calls. No data/schema changed.

## Verdict

**CONDITIONAL GO** for the tester cohort on access control. No RED (no PII leak, no auth bypass, no cross-tenant data access). Two YELLOW hardening items should be fixed before/at launch; neither leaks PII to a stranger. Note prod ships with `match_v2_enabled = false`, so the feature is gated off in prod until the cohort flip — this further de-risks launch.

Prod and local RLS policies, function grants, and the PII column layout are **identical** (verified). The only intended difference: `match_v2_enabled` is `true` locally, `false` on prod.

---

## RED — exploitable leak / bypass

None found. All cross-tenant RPC abuse, stranger reads, and impersonation attempts were denied (see GREEN list).

## YELLOW — hardening

### Y1. The two new DEFINER helpers are anon-executable → unauthenticated relationship oracle
- **Surface:** `match_host_can_see_candidate(uuid,uuid)` and `match_offer_recipient_can_see_instance(uuid,uuid)` (migrations 127400 / 127500).
- **Attack (confirmed, anon, no JWT):**
  `set role anon; select match_host_can_see_candidate('<creator>','<candidate>');` → returns `t`.
  `select match_offer_recipient_can_see_instance('<candidate>','<instance>');` → returns `t`.
  A non-relationship pair returns `f`, confirming it is a true oracle, not a constant.
- **Exposed:** a boolean confirming "is user X an interested/shortlisted candidate on date Y" or "does user X hold an offer/lock on instance Y". Requires the attacker to already know both UUIDs (not enumerable from anon — `date_instances`, `queue_entries`, `offers` all deny anon reads). No PII, no row data. Reachable over PostgREST: `/rest/v1/rpc/match_host_can_see_candidate` with the anon key.
- **Why it doesn't yield row reads:** the RLS policies that consume these helpers hardcode `auth.uid()` as `p_viewer`. Passing a forged viewer to the helper returns a bool but the policy still substitutes the caller's real uid, so an attacker reads **0 rows** (verified Probe 6). The leak is metadata-only.
- **Flagged by:** Supabase security advisor, lint `0028_anon_security_definer_function_executable` (both functions, WARN, on prod).
- **Fix:** `revoke all on function public.match_host_can_see_candidate(uuid,uuid) from public, anon;` and same for `match_offer_recipient_can_see_instance(uuid,uuid)`. Keep `authenticated` (the RLS policies need EXECUTE in the caller's privilege context — same constraint documented in migration 126650 for `match_reveal_allowed_pair`; do NOT revoke from authenticated or RLS SELECTs will crash, see Y2). The earlier hardening migration (126650) revoked anon from the older helpers but the two newer ones (127400/127500) shipped without the anon revoke.

### Y2. Time-expired-but-status-active offer retains full reveal until the async job fires
- **Surface:** `match_reveal_allowed` / `match_reveal_allowed_pair` / `match_offer_recipient_can_see_instance` key on `offers.status in ('active','accepted')`, NOT on `expires_at`.
- **Attack (confirmed):** an offer with `expires_at < now()` but `status='active'` (expiry job not yet run) still grants the candidate read of the creator's `profiles` row (incl. **email**) and the `date_instances` row (Probe 18). `match_reveal_allowed(cand,inst)` returns `t` for such an offer (Probe 19). Local data contains several such rows.
- **Exposed:** reveal access (and its column-leak, see Y3) persists for the window `(expires_at, offer_expiry job runtime)`. The 126500 migration comment claims "revocation is automatic when offer expires" — that is only true once the `offer_expiry` job flips status; it is not time-based.
- **Risk level:** bounded — only a real counterpart who legitimately had reveal, for a short extra window. Not a stranger leak. Severity depends on job-runner latency/liveness.
- **Fix (defense-in-depth):** add `and o.expires_at > now()` to the `active` branch of the three predicates so reveal revokes at the timestamp regardless of job lag, OR guarantee the `offer_expiry` job runs on a tight interval and monitor its lag. The status check stays as the authoritative state; the time check just closes the lag window.

### Y3. Residual column-leak on `profiles` (email) — documented/accepted, now quantified
- **Surface:** `profiles_select_revealed` (126600) and `profiles_select_host_queue` (127400) open the whole `profiles` row once the relationship predicate is true. RLS is row-level, not column-level.
- **Quantified (confirmed Probe 2):** a date creator reading a queued candidate (or a revealed counterpart) can `select email from profiles where id=<peer>` and read **`email`** plus `first_name, city, neighborhood, age, gender, vibe_tags, age_pref, gender_preferences, distance_pref_km, blurred/clear_photo_url, reliability_score, verification, standing, dealbreakers, prompt_answers, onboarding_*`. Returned `rls_cand_6c2e7413@test.local` in the probe.
- **What is SAFE:** the sensitive PII — `phone, birthdate, full_name, instagram_handle, emergency_contact, bio` — lives on `profiles_private`, which has a single owner-only policy (`user_id = auth.uid()`) and is **NOT reachable** by a counterpart (verified). So phone / raw birthdate / emergency contact do NOT leak. The only PII bleeding through the reveal is **`email`**.
- **Risk level:** bounded to relationship-gated counterparts (a creator the candidate swiped into, or a matched party), not any authenticated user, not anon. This is the accepted A.7 risk class.
- **Fix (Phase 7 / S10 per existing plan):** a `profiles_revealed_view` or column-level projection, or move `email` off `public.profiles` into `profiles_private` / read it from `auth.users` server-side. For the cohort, the app paths project only Tier-3, so the practical exposure is a determined counterpart running a raw query against email — acceptable for a small trusted tester cohort, but should be closed before public launch.

---

## GREEN — verified safe (controls held)

1. **Stranger (authenticated, no relationship) reads nothing:** `profiles`, `queue_entries`, `offers`, `locks`, `notifications`, `date_instances` all returned 0 rows for an unrelated user (Probe 1).
2. **Cross-tenant profile reads denied:** a creator of a *different* instance cannot read another creator's candidate profile or queue rows (Probe 3). A creator cannot read a profile not in their queue (Probe 20).
3. **Host-queue is correctly scoped:** `profiles_select_host_queue` grants only to the instance OWNER, only for candidates in `interested/shortlisted/standby/offer_active` (pre/active), not terminal statuses (Probe 21). One-directional: a pre-offer candidate cannot read the creator's profile (Probe 4).
4. **`match_*` RPC auth boundary holds.** Forged `p_actor`:
   - accept others' offer → `not_offer_holder` (42501) (Probe 8)
   - accept with `p_actor`≠`auth.uid()` → `auth_mismatch` (P5001) (Probe 9)
   - pass others' offer → `not_offer_holder` (Probe 10)
   - cancel others' lock → `not_lock_party` (42501) (Probe 11)
   - shortlist onto non-owned instance → `not_creator` (42501) (Probe 12)
   - make_offer as non-creator → `account_gated` / denied (Probe 13)
5. **anon cannot call any match RPC.** Grant audit (local + prod): all `match_make_offer/accept/shortlist/pass/withdraw/cancel_lock/resolve_reciprocal` are `authenticated,service_role` only. All internal helpers (`match_ingest_interest, match_next_standby, match_auto_roll, match_idem_*, match_expire_offer, autoclose/autowithdraw`), admin tools (`admin_force_*`, `prune_idempotency_ledger`), and `match_demand_hint` are `service_role` only.
6. **`feature_config`:** holds only non-secret keys (`match_v2_enabled`, `offer_window_hours`) — no secrets. SELECT-only for anon/authenticated; authenticated `update` affected 0 rows and `insert` was blocked by RLS (Probe 14).
7. **`profiles_private` PII is locked** to owner-only; counterparts cannot read phone/birthdate/full_name/instagram/emergency_contact (schema + policy verified).
8. **`reciprocal_pairs`** has self-read-only RLS (`low_user/high_user = auth.uid()`); a stranger sees 0 rows (Probe 16).
9. **Notifications / locks / queue** are party-scoped (`user_id`/`creator_id`/`matched_user_id`/`candidate_id = auth.uid()`); a non-party reads 0 (Probe 1).
10. **`match_reveal_allowed_pair` (the older helper) is already anon-revoked** and correctly kept authenticated-executable for the RLS policy.

---

## Prod vs local

- RLS policies on `profiles` and `date_instances`, all function EXECUTE grants, and the `profiles`/`profiles_private` column split are **byte-identical** prod↔local.
- `match_v2_enabled` = **false on prod** (feature gated off), true on local. RPCs raise `P5000 feature_disabled` on prod until the cohort flip — an extra safety layer.
- Y1 (anon-executable helpers) and Y3 (email column-leak) exist on **prod** too; Y1 is in the prod security advisor as two `0028` WARNs.

## Note (operational, not a 5b finding)
The DB crashed into recovery when `anon` called `match_reveal_allowed` (a DEFINER fn anon lacks EXECUTE on) — the known Supabase-build PG quirk documented in migration 126650. It self-recovered in ~1s. Not exploitable for data access, but anon-callable DEFINER fns with revoked EXECUTE can be a DoS vector on this build; the Y1 revoke pattern (revoke from anon, keep authenticated) is the correct posture and avoids it for the helpers that RLS doesn't depend on at the anon layer.
