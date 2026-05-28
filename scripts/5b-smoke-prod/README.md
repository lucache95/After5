# 5b Match Chain Smoke — Prod Runbook

One-shot happy-path smoke of the 5b match chain on production. Source spec:
`docs/superpowers/specs/2026-05-28-5b-smoke-test-design.md`.

## When to run

Once per session. Before tester cohort (Task 10 Step 2). Repeat after major
match-system changes.

## Twilio note

Twilio is **not required** for this smoke. Step `1-seed-profiles.sql` sets
`profiles.verification='verified'` directly via service_role. Real phone-OTP
onboarding is a Task 10 Step 2 prerequisite, separate from this work.

## Env-var contract

```bash
export SUPABASE_PROJECT_REF=ufufmcpnysvwtutpbian
export SUPABASE_URL=https://${SUPABASE_PROJECT_REF}.supabase.co
export SUPABASE_PUBLISHABLE_KEY=sb_publishable_obo6g7Epe5ciN99pzwvWVQ_Os479GOp

# Smoke identities — use Gmail with +suffix so Gmail MCP can read magic links
# (a Workspace inbox you control also works as long as Gmail MCP is bound to it).
export HOST_EMAIL=lucache95+smoke-host-1@gmail.com
export CAND_EMAIL=lucache95+smoke-cand-1@gmail.com

# Captured after signup completes:
export HOST_UID=...
export CAND_UID=...
export HOST_JWT=...
export CAND_JWT=...

# Captured from 2-seed-date.sql:
export INST_ID=...

# Captured at the very top of step 0:
export SMOKE_STARTED_AT=$(date -u +'%Y-%m-%dT%H:%M:%SZ')

# Captured after step 5 (match-make-offer):
export OFFER_ID=...

# Captured after step 6 (match-accept-offer):
export LOCK_ID=...
```

## JWT extraction

Modern Supabase SSR (`@supabase/ssr`) stores the session in a **cookie** named
`sb-<projectref>-auth-token`, not localStorage. The cookie's value is
`base64-<base64-encoded JSON session>`. After signing in via `/login` and
landing on the redirect target, open DevTools Console in the signed-in browser
and run:

```js
(() => {
  const raw = document.cookie
    .split(';').map(s => s.trim())
    .find(c => c.startsWith('sb-ufufmcpnysvwtutpbian-auth-token='))
    .split('=').slice(1).join('=');
  const json = JSON.parse(atob(decodeURIComponent(raw).replace(/^base64-/, '')));
  return { uid: json.user.id, jwt: json.access_token };
})();
```

Copy `uid` and `jwt` into your shell. Repeat in a separate browser profile (or
incognito) for the second user. JWTs expire after 1h — complete the chain
within that window or re-extract.

## Execution order

| Step | File | How to run |
|---|---|---|
| 0 | `0-baseline.sql` | Supabase MCP `execute_sql` |
| 1 | `1-seed-profiles.sql` | Supabase MCP `execute_sql` (uses HOST_UID + CAND_UID) |
| 2 | `2-seed-date.sql` | Supabase MCP `execute_sql` → capture `RETURNING id` as INST_ID. Creates an `itineraries` row (host-owned) + a `date_instances` row referencing it. |
| 3 | `3-flag-on.sql` | Supabase MCP `execute_sql` |
| 4 | (Candidate UI swipe) | Browser → 5a feed → tap "interested" on Host's date |
| 5 | `4-chain.sh` | `bash 4-chain.sh` from local terminal |
| 6 | `6-flag-off.sql` | Supabase MCP `execute_sql` |
| 7 | (negative test) | curl match-shortlist with flag off → expect `feature_disabled` |
| 8 | `5-verify.sql` | Supabase MCP `execute_sql` → check PASS criteria. Run AFTER flag-off so `flag_state` correctly reads `false`. |
| 9 | `7-cleanup.sql` | Supabase MCP `execute_sql` |
| 10 | (post-cleanup baseline check) | Re-run `0-baseline.sql` → counts match pre-run |

## Halt protocol

If any halt condition fires (see spec §8), **do not flip the flag back to
`false`**. Leave it on so debugging queries can simulate retry mid-chain.
There are no real users to harm. Flip it back manually only after the bug is
understood.

## Re-run hygiene

`7-cleanup.sql` deletes `auth.users` for the smoke users at the end, freeing
the `+suffix-N` emails for re-use. You can re-run with the same emails next
time — no need to bump the suffix unless cleanup was skipped (e.g., halt mid-run).

## Run log

A markdown file `RUN-LOG.md` is committed in this directory after the smoke
completes, capturing the actual observed values for each step (UIDs, JWTs
redacted, IDs, counts, durations, any divergences from the spec).
