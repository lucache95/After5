# 5b Match Chain Smoke — Prod Runbook

One-shot happy-path smoke of the 5b match chain on production. Source spec:
`docs/superpowers/specs/2026-05-28-5b-smoke-test-design.md`.

## When to run

Once per session. Before tester cohort (Task 10 Step 2). Repeat after major
match-system changes.

## Twilio note

Twilio is **not required** for this smoke. Step `1-seed-profiles.sql` sets
`profiles.verification='phone_verified'` directly via service_role. Real
phone-OTP onboarding is a Task 10 Step 2 prerequisite, separate from this work.

## Env-var contract

```bash
export SUPABASE_PROJECT_REF=ufufmcpnysvwtutpbian
export SUPABASE_URL=https://${SUPABASE_PROJECT_REF}.supabase.co
export SUPABASE_PUBLISHABLE_KEY=sb_publishable_obo6g7Epe5ciN99pzwvWVQ_Os479GOp

# Smoke identities — fresh +suffix per run because auth.users is left dormant
export HOST_EMAIL=lucas+smoke-host-1@breathefum.com
export CAND_EMAIL=lucas+smoke-cand-1@breathefum.com

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

After signing in via `/login` and landing on `/feed`, open DevTools Console
in the signed-in browser and run:

```js
JSON.parse(localStorage.getItem('sb-ufufmcpnysvwtutpbian-auth-token')).access_token
```

Copy that string. Repeat in a separate browser profile (or incognito) for the
second user. JWTs expire after 1h — complete the chain within that window or
re-extract.

## Execution order

| Step | File | How to run |
|---|---|---|
| 0 | `0-baseline.sql` | Supabase MCP `execute_sql` |
| 1 | `1-seed-profiles.sql` | Supabase MCP `execute_sql` (uses HOST_UID + CAND_UID) |
| 2 | `2-seed-date.sql` | Supabase MCP `execute_sql` → capture `RETURNING id` as INST_ID. **⚠️ Adjust the INSERT column list against the actual prod schema (`select column_name from information_schema.columns where table_schema='public' and table_name='date_instances'`) before pasting — the template is a best-guess and will error at insert time if prod has NOT NULL columns beyond the listed ones.** |
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

Each smoke run uses fresh `+suffix-N` emails because `auth.users` rows are
left dormant. Increment N on each run.

## Run log

A markdown file `RUN-LOG.md` is committed in this directory after the smoke
completes, capturing the actual observed values for each step (UIDs, JWTs
redacted, IDs, counts, durations, any divergences from the spec).
