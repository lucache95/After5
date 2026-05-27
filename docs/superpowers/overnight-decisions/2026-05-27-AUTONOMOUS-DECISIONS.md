# Autonomous Overnight Decisions — 2026-05-27

Operating under the overnight autonomous mandate. Authority order: `INTEGRATION-CONTRACT.md` (v2.1) → `RECONCILED-MASTER-PLAN.md` → subordinate plans. Verified implementation reality may override subordinate plans.

Default loop: **resolve → document → verify → continue.** Hard stop only for *immediate irreversible production harm*.

Current stage context: **S3 (Identity / verification / onboarding)** — the S3-UI frontend. S1/S2/S3 backend migrations were applied to prod earlier this session (24 users preserved).

---

## DECISION-001 — Local magic-link auth: align `site_url`/redirect allow-list to dev hosts

**Problem discovered:** Browser magic-link login failed with "code verifier not found in storage." Root cause (proven via PKCE reproduction): `supabase/config.toml` had `site_url = http://127.0.0.1:3000` while the app is browsed on `http://localhost:3000`. GoTrue rejects a `redirect_to` whose host isn't allow-listed and falls back to `site_url`, so the PKCE verifier cookie (set on `localhost`) is never sent to the `127.0.0.1` callback.

**Why the original plan/contract was insufficient:** The contract governs DB/RPC shape, not local dev auth config. The local config shipped by `supabase init` defaults to `127.0.0.1`, which silently breaks the cookie-based PKCE SSR flow when developers browse `localhost`.

**Options considered:** (a) tell the dev to browse `127.0.0.1`; (b) switch the email login to token_hash (no PKCE); (c) align `site_url` + allow-list to both hosts.

**Decision chosen:** (c) `site_url = http://localhost:3000` and `additional_redirect_urls = ["http://localhost:3000/**","http://127.0.0.1:3000/**"]`.

**Why most rational:** No app-code change; keeps the standard, more-secure PKCE flow; works on either host; preserves the `next` param. Verified end-to-end with the real `@supabase/ssr` browser client driving the live `/auth/callback` (307 → /account, session cookie set) on both hosts.

**Systems/files affected:** `supabase/config.toml` ([auth] block). Local-stack only.

**Risks introduced:** `site_url=localhost` and the wildcard allow-list are **local-dev values**. They must NOT be pushed to prod auth (prod redirect URLs are managed in the Supabase dashboard). Guard: never run `supabase config push` as part of this session.

**Verification performed:** PKCE reproduction (before: redirect_to dropped → 127.0.0.1; after: honored → localhost); full E2E through the app callback. Local stack restart preserved data (24/24 prod, 12→16 local test users).

**Rollback difficulty:** Trivial (revert two config lines + restart).

**Human review recommended:** No (local-only), but see prod-safety guard in DECISION-003.

---

## DECISION-002 — `profiles_private` write: insert-then-update, not PostgREST upsert

**Problem discovered:** Onboarding Basics step "Continue" failed with a swallowed error. Root cause (proven via API matrix): the bio write used `supabase-js .upsert()` (PostgREST `Prefer: resolution=merge-duplicates`), which requires **table-level** INSERT+UPDATE. `profiles_private` intentionally has only **column-level** write grants (so `birthdate` stays non-self-settable — the age-gate integrity rule, contract C11.13). Plain INSERT (201) and PATCH UPDATE (204) work; upsert returns `403 / 42501 permission denied for table`.

**Why the original plan/contract was insufficient:** S3-UI plan Task 4 chose `.upsert()` ("no row is auto-created, so upsert not update"), not anticipating that PostgREST upsert is incompatible with the column-level grant design the same plan/contract mandates. Contract C11.13 is correct; the subordinate plan's write mechanism was wrong.

**Options considered:** (a) grant table-level INSERT/UPDATE to `authenticated` — REJECTED: reintroduces the age-gate bypass (user could self-set birthdate); (b) auto-create the `profiles_private` row in a trigger + always update — more blast radius (migration + backfill, touches the auth trigger); (c) app-side insert; fall back to update on `23505` conflict.

**Decision chosen:** (c). Insert the row; on unique-violation (revisit), update. Also log the real error (`console.error`) instead of swallowing it, since Supabase `PostgrestError` is not a JS `Error` instance and its `.message` was being dropped.

**Why most rational:** Preserves the contract's column-grant security (birthdate protected), no DB/prod change, no auth-trigger blast radius, both paths proven (201 fresh / 204 revisit, bio persists). The DB design is correct; only the app's write mechanism was wrong.

**Systems/files affected:** `apps/web/app/onboarding/steps/BasicsStep.tsx`; test updated + regression test added (`__tests__/BasicsStep.test.tsx`).

**Risks introduced:** Two round-trips on first visit (insert→update only on conflict). Negligible for onboarding. No other site writes `profiles_private` (verified), so no other upsert landmines.

**Verification performed:** API matrix (insert 201, patch 204, upsert 403); end-to-end with a real JWT (fresh insert 201; revisit insert→conflict→update 204; bio persisted). Unit tests: 5/5 BasicsStep pass; full suite 76/76.

**Rollback difficulty:** Trivial (revert one file).

**Human review recommended:** No.

---

## DECISION-003 — SMS phone verify: `enable_confirmations=true` + local test OTP (prod-safety quarantine)

**Problem discovered:** Onboarding phone step (S3) dead-ended locally: `updateUser({phone})` advanced the UI to the code field, but `verifyOtp({type:'phone_change'})` returned `otp_expired / "User not found."` Root cause: `[auth.sms] enable_confirmations=false` sets `GOTRUE_SMS_AUTOCONFIRM=true`, which confirms the phone instantly with no OTP — so the subsequent verify has nothing to verify. Also no SMS provider locally, so no code is deliverable.

**Why the original plan/contract was insufficient:** Local config default autoconfirms SMS; the S3-UI phone step is a real send-code → enter-code flow (the contract/prod expects phone confirmation). Local config diverged from the intended (prod) behavior.

**Options considered:** (a) bypass the phone step via service-role; (b) keep autoconfirm and change the app — REJECTED, the app is correct for prod; (c) set `enable_confirmations=true` (autoconfirm off) + add `[auth.sms.test_otp]` so a fixed code verifies without a real SMS provider.

**Decision chosen:** (c). `enable_confirmations=true` (correct for prod too) + local `test_otp` mapping `{3065719041,13065719041,15551234567} = "123456"`.

**Why most rational:** Makes local match the intended OTP flow; lets the phone step be exercised end-to-end locally without Twilio. Verified: `updateUser(phone)` → `verifyOtp(phone_change, "123456")` → HTTP 200 + session.

**Systems/files affected:** `supabase/config.toml` ([auth.sms]).

**Risks introduced — IMPORTANT (prod-safety):** A committed `test_otp` is a **critical vuln if ever pushed to prod auth** (anyone could verify any phone with `123456`). Mitigation: `test_otp` is **NOT committed** to any branch headed for main; it stays in the local working tree only. `enable_confirmations=true` IS safe/correct for prod and may be committed. Hard guard: never run `supabase config push`.

**Verification performed:** API phone_change flow with the fixed code → 200 + session (throwaway number, no account touched; cleaned up after).

**Rollback difficulty:** Trivial.

**Human review recommended:** Yes — confirm prod auth has SMS confirmations ON and a real provider before any dating launch; confirm `test_otp` never reaches prod.

---

## DECISION-004 — Vibe tags backlog captured (not built tonight)

**Problem discovered:** Vibe tags are free-text comma input → unmatchable data ("coffee" vs "third-wave coffee").

**Decision chosen:** Documented a curated-chip-selector recommendation as Future Work in the S3-UI plan; did NOT build it tonight (out of S3 scope; needs a taxonomy + product input).

**Why most rational:** Matchability matters for After5, but a taxonomy is a product decision and a new build slice, not an S3 completion item. Capturing > half-building.

**Systems/files affected:** `docs/superpowers/plans/2026-05-26-s3-ui-onboarding.md` (Future Work section).

**Risks/Rollback:** None / trivial. **Human review:** Yes, when prioritizing the next profile slice.
