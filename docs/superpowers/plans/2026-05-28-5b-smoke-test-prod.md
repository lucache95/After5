# 5b Task 10 Step 1 — Smoke-Test on Prod — Implementation Plan

> **Status (post-execution):** Smoke ran 2026-05-28 and PASSED. This plan was the original authoring artifact for the runbook scripts. After the live run surfaced literal-level corrections, **the runbook scripts in `scripts/5b-smoke-prod/` and the spec at `docs/superpowers/specs/2026-05-28-5b-smoke-test-design.md` are the source of truth.** This plan retains its original wording for historical reference; some inline SQL/shell here has the pre-correction literals. See `scripts/5b-smoke-prod/RUN-LOG.md` for the diff. Don't re-execute this plan verbatim — use the runbook files instead.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a one-shot happy-path smoke of the 5b match chain on prod with two synthesized users, then leave prod at baseline — proving the live stack works end-to-end before tester cohort.

**Architecture:** Two-phase plan. Phase A authors the 8-file runbook at `scripts/5b-smoke-prod/`. Phase B executes the runbook step-by-step on prod via Supabase MCP `execute_sql` for SQL and curl for edge functions, capturing observations into a runbook log committed alongside the scripts.

**Tech Stack:** PostgreSQL (via Supabase MCP `execute_sql`), curl, Deno edge functions, Supabase Auth PKCE (via deployed `/login`), bash for the chain shell script.

**Source spec:** `docs/superpowers/specs/2026-05-28-5b-smoke-test-design.md` (read this first).

**Resolved §10 unknowns** (used as literals throughout this plan):

- `match_ratings` insert body: `lock_id, rater_id, ratee_id, showed_up=true, on_time=true, cancelled_with_notice=false, unsafe_or_disrespectful=false`. RLS requires `rater_id = auth.uid()` AND the rater being a lock participant rating the counterparty.
- Shortlist analytics `event_type`: `match_shortlisted`.
- Storage bucket `profile-photos` exists (private). Owner-write policy keys on `<uid>/...` path prefix. For smoke, photo upload is skipped — `profiles.{clear_photo_url, blurred_photo_url}` are set to non-null stub strings, since `profiles_select_revealed` only checks RLS visibility (returns rows), not URL contents.
- Kelowna city UUID on prod: `06b7bad2-9918-44cf-8d45-b611e053fa27` (different from the local-dev UUID in `scripts/qa-feed-seed.sql`).
- B-complete cascade jobs after a *first* accept (no competing candidates): at minimum `rating_window`. `standby_roll` and `bulk_withdraw` fire only when competing candidates exist; smoke has none, so `jobs_enqueued >= 1` is the only floor.

---

## Phase A — Author the runbook

### Task A1: Create the runbook directory and README

**Files:**
- Create: `scripts/5b-smoke-prod/README.md`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p scripts/5b-smoke-prod
```

- [ ] **Step 2: Write the README**

Create `scripts/5b-smoke-prod/README.md` with this content verbatim:

````markdown
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
````

- [ ] **Step 3: Verify file exists**

Run: `ls -la scripts/5b-smoke-prod/README.md`
Expected: file present, ~3KB.

---

### Task A2: Create `0-baseline.sql`

**Files:**
- Create: `scripts/5b-smoke-prod/0-baseline.sql`

- [ ] **Step 1: Write the baseline snapshot**

Create `scripts/5b-smoke-prod/0-baseline.sql`:

```sql
-- 0-baseline.sql — pre-smoke row-count snapshot (service_role)
-- Capture the output and save into RUN-LOG.md. Used by the post-cleanup
-- check to confirm we leave prod at the same baseline.
select
  (select count(*) from public.profiles)              as profiles,
  (select count(*) from public.profiles_private)      as profiles_private,
  (select count(*) from public.verifications)         as verifications,
  (select count(*) from public.date_instances)        as date_instances,
  (select count(*) from public.swipes)                as swipes,
  (select count(*) from public.queue_entries)         as queue_entries,
  (select count(*) from public.offers)                as offers,
  (select count(*) from public.locks)                 as locks,
  (select count(*) from public.lock_participants)     as lock_participants,
  (select count(*) from public.match_ratings)         as match_ratings,
  (select count(*) from public.notifications)         as notifications,
  (select count(*) from public.jobs)                  as jobs,
  (select count(*) from public.analytics_events)      as analytics_events,
  (select count(*) from public.admin_alerts)          as admin_alerts,
  (select value::boolean from public.feature_config
    where key='match_v2_enabled')                     as match_v2_enabled;
```

- [ ] **Step 2: Verify file exists and is parseable SQL**

Run: `cat scripts/5b-smoke-prod/0-baseline.sql | grep -c 'select count'`
Expected: `14` (one for each table count).

---

### Task A3: Create `1-seed-profiles.sql`

**Files:**
- Create: `scripts/5b-smoke-prod/1-seed-profiles.sql`

- [ ] **Step 1: Write the profile fixup**

Create `scripts/5b-smoke-prod/1-seed-profiles.sql`:

```sql
-- 1-seed-profiles.sql — fix up the two smoke profiles AFTER real signup (service_role).
-- Real signup creates auth.users + (via trigger) a profiles row stuck at the age_gate
-- step. This script sets birthdate, age-gate via dating_enabled, verification, photos,
-- and city — everything the match-chain RPCs check before they'll proceed.
--
-- Variables to substitute (the executor pastes the resolved SQL into Supabase MCP):
--   :host_uid, :cand_uid — captured from real signup

-- 1a. Host: birthdate (must exist before dating_enabled flips true; trigger enforces age gate)
insert into public.profiles_private (user_id, birthdate)
values (:'host_uid'::uuid, '1992-04-12')
on conflict (user_id) do update set birthdate = excluded.birthdate;

-- 1b. Host: profile completion fixup
update public.profiles set
  first_name         = 'Maya (smoke host)',
  gender             = 'woman',
  gender_preferences = '{man,woman}'::text[],
  age_pref           = '[25,41)'::int4range,
  primary_city_id    = '06b7bad2-9918-44cf-8d45-b611e053fa27'::uuid,  -- Kelowna (prod)
  distance_pref_km   = 40,
  vibe_tags          = '{cozy,creative,nightlife}'::text[],
  clear_photo_url    = 'https://placeholder.smoke-test/host-clear.jpg',
  blurred_photo_url  = 'https://placeholder.smoke-test/host-blurred.jpg',
  verification       = 'phone_verified',
  dating_enabled     = true,
  onboarding_step    = 'done',
  onboarding_completed_at = now(),
  prompt_answers     = '{"smoke_test": true, "_marker": "smoke-host"}'::jsonb
where id = :'host_uid'::uuid;

-- 2a. Candidate: birthdate
insert into public.profiles_private (user_id, birthdate)
values (:'cand_uid'::uuid, '1995-09-21')
on conflict (user_id) do update set birthdate = excluded.birthdate;

-- 2b. Candidate: profile completion fixup
update public.profiles set
  first_name         = 'Jordan (smoke cand)',
  gender             = 'man',
  gender_preferences = '{woman}'::text[],
  age_pref           = '[28,40)'::int4range,
  primary_city_id    = '06b7bad2-9918-44cf-8d45-b611e053fa27'::uuid,  -- Kelowna (prod)
  distance_pref_km   = 40,
  vibe_tags          = '{nightlife,active,creative}'::text[],
  clear_photo_url    = 'https://placeholder.smoke-test/cand-clear.jpg',
  blurred_photo_url  = 'https://placeholder.smoke-test/cand-blurred.jpg',
  verification       = 'phone_verified',
  dating_enabled     = true,
  onboarding_step    = 'done',
  onboarding_completed_at = now(),
  prompt_answers     = '{"smoke_test": true, "_marker": "smoke-cand"}'::jsonb
where id = :'cand_uid'::uuid;

-- 3. Return a summary so the executor can confirm both rows look right
select
  id, first_name, gender, primary_city_id, dating_enabled, verification,
  onboarding_step, onboarding_completed_at is not null as onboarded
from public.profiles
where id in (:'host_uid'::uuid, :'cand_uid'::uuid)
order by first_name;
```

- [ ] **Step 2: Verify file exists**

Run: `cat scripts/5b-smoke-prod/1-seed-profiles.sql | grep -c 'update public.profiles'`
Expected: `2`.

---

### Task A4: Create `2-seed-date.sql`

**Files:**
- Create: `scripts/5b-smoke-prod/2-seed-date.sql`

- [ ] **Step 1: Verify what columns date_instances has on prod**

Run via Supabase MCP `execute_sql`:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='date_instances'
order by ordinal_position;
```

Capture the schema. Adjust the INSERT in step 2 below to match the actual required columns. Skip default-having columns.

- [ ] **Step 2: Write the date seed**

Create `scripts/5b-smoke-prod/2-seed-date.sql`. **The exact INSERT columns depend on the schema discovered in step 1** — the snippet below is the expected shape; adjust if columns differ:

```sql
-- 2-seed-date.sql — seed one date_instance owned by Host. Service_role bypasses RLS.
-- Variables to substitute:
--   :host_uid — Host UID
--
-- Adjust INSERT columns to match prod schema discovered in the prior step.
-- Anchor to an arbitrary existing place_id (any of the 182 places will do; the
-- match chain doesn't care which).

with chosen_place as (
  select id from public.places
  where city_id = '06b7bad2-9918-44cf-8d45-b611e053fa27'::uuid
  order by id
  limit 1
)
insert into public.date_instances (
  creator_id, place_id, starts_at, ends_at, status
  -- add or remove columns to match the actual schema (e.g., title, vibe_tags, etc.)
)
select
  :'host_uid'::uuid,
  cp.id,
  now() + interval '5 days',                              -- starts 5 days out
  now() + interval '5 days' + interval '2 hours',         -- ends 2h after start
  'published'                                             -- whatever the "live" status enum value is
from chosen_place cp
returning id, creator_id, place_id, starts_at, status;
```

- [ ] **Step 3: Verify file exists**

Run: `cat scripts/5b-smoke-prod/2-seed-date.sql | grep -c 'insert into public.date_instances'`
Expected: `1`.

---

### Task A5: Create `3-flag-on.sql`

**Files:**
- Create: `scripts/5b-smoke-prod/3-flag-on.sql`

- [ ] **Step 1: Write the flag-on flip**

Create `scripts/5b-smoke-prod/3-flag-on.sql`:

```sql
-- 3-flag-on.sql — flip match_v2_enabled true (service_role).
update public.feature_config
set value = 'true'::jsonb, updated_at = now()
where key = 'match_v2_enabled'
returning key, value, updated_at;
```

- [ ] **Step 2: Verify file exists**

Run: `cat scripts/5b-smoke-prod/3-flag-on.sql | grep -c "value = 'true'"`
Expected: `1`.

---

### Task A6: Create `4-chain.sh`

**Files:**
- Create: `scripts/5b-smoke-prod/4-chain.sh`

- [ ] **Step 1: Write the chain shell script**

Create `scripts/5b-smoke-prod/4-chain.sh`:

```bash
#!/usr/bin/env bash
# 4-chain.sh — runs steps 2–7 of the match chain via curl against prod edge
# functions. Steps 0, 1, 3, 5 are SQL (run via Supabase MCP separately).
#
# Required env vars (see README.md):
#   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
#   HOST_JWT, CAND_JWT, HOST_UID, CAND_UID
#   INST_ID
#
# Captures (printed at end for the executor to capture into env):
#   OFFER_ID, LOCK_ID

set -euo pipefail

req() {
  local jwt="$1" path="$2" body="$3"
  curl -sS -X POST "${SUPABASE_URL}/functions/v1/${path}" \
    -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
    -H "Authorization: Bearer ${jwt}" \
    -H 'Content-Type: application/json' \
    -d "${body}" \
    -w '\n[http=%{http_code}]\n'
}

rest() {
  local jwt="$1" path="$2"
  curl -sS "${SUPABASE_URL}/rest/v1/${path}" \
    -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
    -H "Authorization: Bearer ${jwt}" \
    -w '\n[http=%{http_code}]\n'
}

echo '=== STEP 2: host discovery probe (queue_entries via PostgREST) ==='
rest "$HOST_JWT" "queue_entries?date_instance_id=eq.${INST_ID}&status=eq.interested&select=*"

echo '=== STEP 3: host match-shortlist ==='
req "$HOST_JWT" 'match-shortlist' \
  "{\"instance\":\"${INST_ID}\",\"candidate\":\"${CAND_UID}\",\"rank\":1}"

echo '=== STEP 4: host match-make-offer (capture offer_id) ==='
OFFER_RESP=$(req "$HOST_JWT" 'match-make-offer' \
  "{\"instance\":\"${INST_ID}\",\"candidate\":\"${CAND_UID}\"}" \
  | sed '/^\[http=/d')
echo "$OFFER_RESP"
OFFER_ID=$(echo "$OFFER_RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["offer_id"])')
echo "OFFER_ID=$OFFER_ID"

echo '=== STEP 5: candidate match-accept-offer (capture lock_id) ==='
LOCK_RESP=$(req "$CAND_JWT" 'match-accept-offer' \
  "{\"offer\":\"${OFFER_ID}\"}" \
  | sed '/^\[http=/d')
echo "$LOCK_RESP"
LOCK_ID=$(echo "$LOCK_RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["lock_id"])')
echo "LOCK_ID=$LOCK_ID"

echo '=== STEP 6: both read profiles_select_revealed ==='
echo '--- HOST reads CANDIDATE ---'
rest "$HOST_JWT" "profiles_select_revealed?id=eq.${CAND_UID}&select=id,first_name,clear_photo_url"
echo '--- CANDIDATE reads HOST ---'
rest "$CAND_JWT" "profiles_select_revealed?id=eq.${HOST_UID}&select=id,first_name,clear_photo_url"

echo '=== STEP 7: both insert match_ratings ==='
RATING_BODY_HOST="{\"lock_id\":\"${LOCK_ID}\",\"rater_id\":\"${HOST_UID}\",\"ratee_id\":\"${CAND_UID}\",\"showed_up\":true,\"on_time\":true,\"cancelled_with_notice\":false,\"unsafe_or_disrespectful\":false}"
RATING_BODY_CAND="{\"lock_id\":\"${LOCK_ID}\",\"rater_id\":\"${CAND_UID}\",\"ratee_id\":\"${HOST_UID}\",\"showed_up\":true,\"on_time\":true,\"cancelled_with_notice\":false,\"unsafe_or_disrespectful\":false}"

echo '--- HOST rates CAND ---'
curl -sS -X POST "${SUPABASE_URL}/rest/v1/match_ratings" \
  -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
  -H "Authorization: Bearer ${HOST_JWT}" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d "$RATING_BODY_HOST" \
  -w '\n[http=%{http_code}]\n'

echo '--- CAND rates HOST ---'
curl -sS -X POST "${SUPABASE_URL}/rest/v1/match_ratings" \
  -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
  -H "Authorization: Bearer ${CAND_JWT}" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d "$RATING_BODY_CAND" \
  -w '\n[http=%{http_code}]\n'

echo
echo "=== CAPTURED ==="
echo "OFFER_ID=$OFFER_ID"
echo "LOCK_ID=$LOCK_ID"
echo "Paste these into your env before running 5-verify.sql."
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/5b-smoke-prod/4-chain.sh
```

- [ ] **Step 3: Lint with shellcheck (optional but recommended)**

```bash
which shellcheck >/dev/null && shellcheck scripts/5b-smoke-prod/4-chain.sh || echo "shellcheck not installed; skipping lint"
```

Expected: no errors. (If shellcheck not present, skip.)

---

### Task A7: Create `5-verify.sql`

**Files:**
- Create: `scripts/5b-smoke-prod/5-verify.sql`

- [ ] **Step 1: Write the final-state verification**

Create `scripts/5b-smoke-prod/5-verify.sql`:

```sql
-- 5-verify.sql — final-state assertion (service_role). Returns one row.
-- Compare each column against the "expected" annotation. Hard fail: admin_alerts_count > 0.
--
-- Variables to substitute:
--   :inst, :host_uid, :cand_uid, :smoke_started_at
select
  (select count(*) from public.queue_entries
    where date_instance_id = :'inst'::uuid)                                                      as queue_entries_count,        -- expect 1
  (select status::text from public.queue_entries
    where date_instance_id = :'inst'::uuid limit 1)                                              as queue_status,               -- expect 'interested'
  (select rank from public.queue_entries
    where date_instance_id = :'inst'::uuid limit 1)                                              as queue_rank,                 -- expect 1
  (select count(*) from public.offers
    where date_instance_id = :'inst'::uuid)                                                      as offers_count,               -- expect 1
  (select status::text from public.offers
    where date_instance_id = :'inst'::uuid limit 1)                                              as offer_status,               -- expect 'accepted'
  (select count(*) from public.locks
    where date_instance_id = :'inst'::uuid)                                                      as locks_count,                -- expect 1
  (select count(*) from public.lock_participants lp
    join public.locks l on l.id = lp.lock_id
    where l.date_instance_id = :'inst'::uuid)                                                    as lock_participants_count,    -- expect 2
  (select count(*) from public.match_ratings mr
    join public.locks l on l.id = mr.lock_id
    where l.date_instance_id = :'inst'::uuid)                                                    as ratings_count,              -- expect 2
  (select count(*) from public.profiles_select_revealed
    where id in (:'host_uid'::uuid, :'cand_uid'::uuid))                                          as reveal_visible_count,       -- expect 2
  (select array_agg(distinct type::text order by type::text)
    from public.notifications
    where user_id in (:'host_uid'::uuid, :'cand_uid'::uuid)
      and created_at > :'smoke_started_at'::timestamptz)                                         as notification_types,         -- expect superset of {offer_received, new_match}
  (select array_agg(distinct event_type order by event_type)
    from public.analytics_events
    where actor_id in (:'host_uid'::uuid, :'cand_uid'::uuid)
      and created_at > :'smoke_started_at'::timestamptz)                                         as analytics_event_types,      -- expect superset of {match_shortlisted, match_offer_made, match_lock_created}
  (select count(*) from public.jobs
    where created_at > :'smoke_started_at'::timestamptz
      and (payload->>'instance' = :'inst'
        or payload->>'lock_id' in (select id::text from public.locks where date_instance_id = :'inst'::uuid)))
                                                                                                 as jobs_enqueued,              -- expect >= 1 (rating_window)
  (select count(*) from public.admin_alerts
    where created_at > :'smoke_started_at'::timestamptz)                                         as admin_alerts_count,         -- HARD FAIL if > 0
  (select (value)::boolean from public.feature_config
    where key='match_v2_enabled')                                                                as flag_state;                 -- expect false (only after 6-flag-off)
```

- [ ] **Step 2: Verify file exists**

Run: `cat scripts/5b-smoke-prod/5-verify.sql | grep -c 'expect'`
Expected: `14` (13 column-level `-- expect` annotations + 1 in the header comment mentioning "the \"expected\" annotation").

---

### Task A8: Create `6-flag-off.sql`

**Files:**
- Create: `scripts/5b-smoke-prod/6-flag-off.sql`

- [ ] **Step 1: Write the flag-off flip**

Create `scripts/5b-smoke-prod/6-flag-off.sql`:

```sql
-- 6-flag-off.sql — flip match_v2_enabled back to false (service_role).
-- Run only after the chain has completed AND no halt conditions fired.
-- If a halt fired, do NOT run this; leave the flag on for debugging.
update public.feature_config
set value = 'false'::jsonb, updated_at = now()
where key = 'match_v2_enabled'
returning key, value, updated_at;
```

- [ ] **Step 2: Verify file exists**

Run: `cat scripts/5b-smoke-prod/6-flag-off.sql | grep -c "value = 'false'"`
Expected: `1`.

---

### Task A9: Create `7-cleanup.sql`

**Files:**
- Create: `scripts/5b-smoke-prod/7-cleanup.sql`

- [ ] **Step 1: Write the cleanup**

Create `scripts/5b-smoke-prod/7-cleanup.sql`:

```sql
-- 7-cleanup.sql — wipe smoke-scoped rows in FK order. Service_role. Idempotent.
-- Variables to substitute:
--   :inst, :host_uid, :cand_uid, :smoke_started_at
--
-- auth.users rows are left dormant; tagged by the `lucas+smoke-…` email pattern.
-- Re-runs of the smoke MUST use a fresh `+suffix-N` because Supabase Auth
-- blocks re-signup on existing emails.

-- 1. ratings + locks (child rows of locks/date_instance)
delete from public.match_ratings
  where lock_id in (select id from public.locks where date_instance_id = :'inst'::uuid);
delete from public.lock_participants
  where lock_id in (select id from public.locks where date_instance_id = :'inst'::uuid);
delete from public.locks
  where date_instance_id = :'inst'::uuid;

-- 2. offers + queue_entries (child rows of date_instance)
delete from public.offers
  where date_instance_id = :'inst'::uuid;
delete from public.queue_entries
  where date_instance_id = :'inst'::uuid;

-- 3. jobs created during the smoke targeting the smoke instance/lock/offer
delete from public.jobs
  where created_at > :'smoke_started_at'::timestamptz
    and (
      payload->>'instance' = :'inst'
      or payload->>'lock_id' in (select id::text from public.locks where date_instance_id = :'inst'::uuid)
      or payload->>'offer_id' in (select id::text from public.offers where date_instance_id = :'inst'::uuid)
    );

-- 4. notifications + analytics for the two smoke users, scoped to the smoke window
delete from public.notifications
  where user_id in (:'host_uid'::uuid, :'cand_uid'::uuid)
    and created_at > :'smoke_started_at'::timestamptz;
delete from public.analytics_events
  where actor_id in (:'host_uid'::uuid, :'cand_uid'::uuid)
    and created_at > :'smoke_started_at'::timestamptz;

-- 5. the seeded date itself
delete from public.date_instances
  where id = :'inst'::uuid;

-- 6. smoke profile rows + private + verifications (auth.users untouched)
delete from public.verifications
  where user_id in (:'host_uid'::uuid, :'cand_uid'::uuid);
delete from public.profiles_private
  where user_id in (:'host_uid'::uuid, :'cand_uid'::uuid);
delete from public.profiles
  where id in (:'host_uid'::uuid, :'cand_uid'::uuid);
```

- [ ] **Step 2: Verify file exists**

Run: `cat scripts/5b-smoke-prod/7-cleanup.sql | grep -c '^delete from public\.'`
Expected: `12` (match_ratings, lock_participants, locks, offers, queue_entries, jobs, notifications, analytics_events, date_instances, verifications, profiles_private, profiles).

---

### Task A10: Commit Phase A

- [ ] **Step 1: Stage the runbook**

```bash
git add scripts/5b-smoke-prod/
```

- [ ] **Step 2: Verify staged files**

Run: `git status --short scripts/5b-smoke-prod/`
Expected: 9 files added (README.md + 0..7 .sql and .sh).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(5b-smoke): runbook scripts for Task 10 Step 1 prod smoke

Eight files at scripts/5b-smoke-prod/ implementing the smoke design spec
(docs/superpowers/specs/2026-05-28-5b-smoke-test-design.md):

- README.md          env contract, JWT extraction, execution order, halt protocol
- 0-baseline.sql     pre-smoke row-count snapshot
- 1-seed-profiles.sql  fixup verification/dating_enabled/onboarding/photos for two real-signup users
- 2-seed-date.sql    one date_instance owned by Host, anchored to a Kelowna place
- 3-flag-on.sql      flip match_v2_enabled=true
- 4-chain.sh         curl sequence for shortlist → make-offer → accept → reveal-read → rating
- 5-verify.sql       final-state assertion with superset semantics for notification/event types
- 6-flag-off.sql     flip match_v2_enabled=false
- 7-cleanup.sql      FK-ordered wipe of smoke-scoped rows, leaves auth.users dormant

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase B — Execute the smoke

This phase runs the runbook against prod. Each task is one step in the spec's §5 chain.

### Task B1: Real-signup HOST + CAND via deployed `/login`

**Files:**
- None modified — interactive via browser.

- [ ] **Step 1: Capture SMOKE_STARTED_AT before anything else**

```bash
export SMOKE_STARTED_AT=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
echo "SMOKE_STARTED_AT=$SMOKE_STARTED_AT"
```

Expected: ISO-8601 timestamp string.

- [ ] **Step 2: Set the smoke identity emails**

```bash
export HOST_EMAIL=lucas+smoke-host-1@breathefum.com
export CAND_EMAIL=lucas+smoke-cand-1@breathefum.com
# If you've run this smoke before, increment the -1 suffix to avoid auth.users collisions.
```

- [ ] **Step 3: Sign up HOST**

Open `https://<deployed-prod-url>/login` in your primary browser. Sign in with `$HOST_EMAIL` via the magic-link PKCE flow. Open the email in your inbox, click the link. You should land on `/feed` (or wherever post-onboarding lands; if it lands somewhere else, that's fine — the user is created).

- [ ] **Step 4: Capture HOST_UID and HOST_JWT**

In the signed-in browser, DevTools Console:

```js
const auth = JSON.parse(localStorage.getItem('sb-ufufmcpnysvwtutpbian-auth-token'));
console.log('HOST_UID=' + auth.user.id);
console.log('HOST_JWT=' + auth.access_token);
```

Copy both into your shell:

```bash
export HOST_UID=<paste>
export HOST_JWT=<paste>
echo "HOST_UID=$HOST_UID"
echo "HOST_JWT=${HOST_JWT:0:20}..."  # truncated echo for safety
```

- [ ] **Step 5: Sign up CAND (separate browser / incognito)**

Open the deployed `/login` in a *separate browser profile or incognito window*. Sign in with `$CAND_EMAIL`. Click the magic link. Land on `/feed`.

- [ ] **Step 6: Capture CAND_UID and CAND_JWT**

Same DevTools snippet, capture into:

```bash
export CAND_UID=<paste>
export CAND_JWT=<paste>
echo "CAND_UID=$CAND_UID"
echo "CAND_JWT=${CAND_JWT:0:20}..."
```

- [ ] **Step 7: Sanity-check the JWTs auth against PostgREST**

```bash
curl -sS "${SUPABASE_URL:-https://ufufmcpnysvwtutpbian.supabase.co}/rest/v1/profiles?id=eq.${HOST_UID}&select=id" \
  -H "apikey: sb_publishable_obo6g7Epe5ciN99pzwvWVQ_Os479GOp" \
  -H "Authorization: Bearer ${HOST_JWT}"
```

Expected: `[{"id":"<HOST_UID>"}]`. If empty array → RLS issue. If `401 invalid JWT` → JWT extraction wrong.

---

### Task B2: Run baseline + record into RUN-LOG

**Files:**
- Create: `scripts/5b-smoke-prod/RUN-LOG.md`

- [ ] **Step 1: Run 0-baseline.sql via Supabase MCP**

Paste the contents of `scripts/5b-smoke-prod/0-baseline.sql` into Supabase MCP `execute_sql`. Capture the one-row result.

- [ ] **Step 2: Create RUN-LOG.md with the baseline**

Create `scripts/5b-smoke-prod/RUN-LOG.md`:

```markdown
# 5b Smoke Run Log — 2026-05-28

## Identities (UIDs only; JWTs redacted)

- SMOKE_STARTED_AT: <paste>
- HOST_EMAIL: lucas+smoke-host-1@breathefum.com
- HOST_UID: <paste>
- CAND_EMAIL: lucas+smoke-cand-1@breathefum.com
- CAND_UID: <paste>

## Step 0 — pre-smoke baseline

| profiles | profiles_private | verifications | date_instances | swipes | queue_entries | offers | locks | lock_participants | match_ratings | notifications | jobs | analytics_events | admin_alerts | match_v2_enabled |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| <n> | <n> | <n> | <n> | <n> | <n> | <n> | <n> | <n> | <n> | <n> | <n> | <n> | <n> | false |
```

---

### Task B3: Run seed-profiles + verify both profiles are ready

- [ ] **Step 1: Resolve the SQL with substitutions and run via Supabase MCP**

Take `scripts/5b-smoke-prod/1-seed-profiles.sql`. Replace `:'host_uid'::uuid` with `'${HOST_UID}'::uuid` and `:'cand_uid'::uuid` with `'${CAND_UID}'::uuid` (or paste the resolved SQL directly). Run via Supabase MCP `execute_sql`.

- [ ] **Step 2: Verify the returned summary row**

Expected: 2 rows with `dating_enabled=true`, `verification='phone_verified'`, `onboarding_step='done'`, `onboarded=true`, `primary_city_id='06b7bad2-...'`.

- [ ] **Step 3: Append to RUN-LOG.md**

Add a "## Step 1 — seed profiles" section showing the returned summary rows.

---

### Task B4: Run seed-date + capture INST_ID

- [ ] **Step 1: Discover date_instances column shape**

Per Task A4 Step 1, query the actual prod schema if you haven't already. Adjust `2-seed-date.sql` if columns differ from the template.

- [ ] **Step 2: Run the resolved seed-date SQL via Supabase MCP**

Replace `:'host_uid'::uuid` with `'${HOST_UID}'::uuid`. Run via Supabase MCP.

- [ ] **Step 3: Capture INST_ID from the RETURNING clause**

```bash
export INST_ID=<paste>
echo "INST_ID=$INST_ID"
```

- [ ] **Step 4: Append to RUN-LOG.md**

Add a "## Step 2 — seed date" section with the returned row.

---

### Task B5: Flip flag on

- [ ] **Step 1: Run 3-flag-on.sql via Supabase MCP**

- [ ] **Step 2: Verify**

The RETURNING clause should show `value: true`. If it shows `value: false`, the UPDATE didn't take. Halt.

- [ ] **Step 3: Append to RUN-LOG.md**

Add a "## Step 3 — flag on" section with the returned row.

---

### Task B6: Candidate swipes via 5a feed UI + verify queue_entries

- [ ] **Step 1: In the CAND browser, navigate to the feed**

Open the deployed app in the CAND browser. Navigate to `/feed`. The feed should show the Host's seeded date (Kelowna, 5 days out).

- [ ] **Step 2: Tap "interested"**

Use the swipe UI (or whatever the "interested" affordance is) to swipe interested on Host's date.

- [ ] **Step 3: Verify queue_entries row via Supabase MCP**

```sql
select id, candidate_id, date_instance_id, status, rank, created_at
from public.queue_entries
where candidate_id = '${CAND_UID}'::uuid and date_instance_id = '${INST_ID}'::uuid;
```

Expected: one row, `status='interested'`, `rank=null`, `created_at` recent.

- [ ] **Step 4: Verify analytics_events**

```sql
select event_type, payload, created_at
from public.analytics_events
where actor_id = '${CAND_UID}'::uuid
  and created_at > '${SMOKE_STARTED_AT}'::timestamptz
order by created_at desc;
```

Expected: at least one row with `event_type='match_interest_ingested'` (or whatever the swipe-hook RPC emits — verify name on first run).

- [ ] **Step 5: Append to RUN-LOG.md**

Add a "## Step 4 — candidate swipe" section with the queue_entries row + the analytics events.

---

### Task B7: Run the chain shell script (host discovery → shortlist → make-offer → accept → reveal → rating)

- [ ] **Step 1: Source the env vars**

All of `HOST_JWT`, `CAND_JWT`, `HOST_UID`, `CAND_UID`, `INST_ID`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` must be exported. Verify:

```bash
echo "INST_ID=$INST_ID"
echo "HOST_UID=$HOST_UID"
echo "CAND_UID=$CAND_UID"
echo "HOST_JWT prefix: ${HOST_JWT:0:20}..."
echo "CAND_JWT prefix: ${CAND_JWT:0:20}..."
```

- [ ] **Step 2: Run the chain**

```bash
bash scripts/5b-smoke-prod/4-chain.sh 2>&1 | tee /tmp/4-chain.out
```

Expected: each step prints `{"ok":true,...}` (or similar) and `[http=200]`. The script ends with `OFFER_ID=...` and `LOCK_ID=...`.

- [ ] **Step 3: Capture OFFER_ID and LOCK_ID**

```bash
export OFFER_ID=$(grep '^OFFER_ID=' /tmp/4-chain.out | head -1 | cut -d= -f2)
export LOCK_ID=$(grep '^LOCK_ID=' /tmp/4-chain.out | head -1 | cut -d= -f2)
echo "OFFER_ID=$OFFER_ID"
echo "LOCK_ID=$LOCK_ID"
```

- [ ] **Step 4: Spot-check reveal output**

In the chain output, both `--- HOST reads CANDIDATE ---` and `--- CANDIDATE reads HOST ---` blocks must show a JSON object with a non-null `clear_photo_url` (the smoke stub URL is fine). If either returns `[]`, the reveal RLS is broken. **Halt.**

- [ ] **Step 5: Spot-check rating responses**

Both rating POSTs should return `201 Created` (or `200` if `Prefer: return=representation` echoes the row). If either returns `403`, the RLS policy rejected — inspect (rater is auth.uid()? lock participant? rating counterparty? all required by `match_ratings_rater_insert`).

- [ ] **Step 6: Copy full chain output into RUN-LOG.md**

Add a "## Step 5 — chain execution" section. Paste `/tmp/4-chain.out` as a fenced code block (redact JWTs if any leaked).

---

### Task B8: Flip flag off

- [ ] **Step 1: Run 6-flag-off.sql via Supabase MCP**

- [ ] **Step 2: Verify**

RETURNING shows `value: false`. If `true`, the UPDATE didn't take. Halt.

- [ ] **Step 3: Append to RUN-LOG.md**

---

### Task B9: Negative test — confirm flag-off rejects calls

- [ ] **Step 1: Call match-shortlist with flag off**

```bash
curl -sS -X POST "${SUPABASE_URL}/functions/v1/match-shortlist" \
  -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
  -H "Authorization: Bearer ${HOST_JWT}" \
  -H 'Content-Type: application/json' \
  -d "{\"instance\":\"${INST_ID}\",\"candidate\":\"${CAND_UID}\",\"rank\":2}" \
  -w '\n[http=%{http_code}]\n'
```

- [ ] **Step 2: Verify expected rejection**

Expected response body: `{"ok":false,"code":"feature_disabled",...}` (P5000). The HTTP code is likely `200` (edge-layer translates the SQL exception into an `ok:false` body). If the call succeeds with `ok:true`, the flag isn't actually enforced — real bug. **Halt.**

- [ ] **Step 3: Append to RUN-LOG.md**

---

### Task B10: Run final-state verification

- [ ] **Step 1: Resolve and run 5-verify.sql via Supabase MCP**

Substitute `:'inst'` → `'${INST_ID}'`, `:'host_uid'` → `'${HOST_UID}'`, `:'cand_uid'` → `'${CAND_UID}'`, `:'smoke_started_at'` → `'${SMOKE_STARTED_AT}'`.

- [ ] **Step 2: Check each expected value**

Match each column against the inline `expect` annotation in the file:

| Column | Expect |
|---|---|
| `queue_entries_count` | `1` |
| `queue_status` | `'interested'` |
| `queue_rank` | `1` |
| `offers_count` | `1` |
| `offer_status` | `'accepted'` |
| `locks_count` | `1` |
| `lock_participants_count` | `2` |
| `ratings_count` | `2` |
| `reveal_visible_count` | `2` |
| `notification_types` | superset of `{offer_received, new_match}` |
| `analytics_event_types` | superset of `{match_shortlisted, match_offer_made, match_lock_created}` |
| `jobs_enqueued` | `>= 1` |
| `admin_alerts_count` | `0` **— HARD FAIL if > 0** |
| `flag_state` | `false` |

- [ ] **Step 3: Append the verification row to RUN-LOG.md**

Add a "## Step 6 — final-state verification" section. Paste the result. Mark PASS or FAIL per-column.

- [ ] **Step 4: If any FAIL — halt and document**

Do not proceed to cleanup. The runbook log captures the failure for post-mortem.

---

### Task B11: Run cleanup

- [ ] **Step 1: Resolve and run 7-cleanup.sql via Supabase MCP**

Substitute the four variables as in Task B10. Run via MCP.

- [ ] **Step 2: Re-run baseline (0-baseline.sql)**

Run via MCP.

- [ ] **Step 3: Compare to pre-smoke baseline**

Every count must match the Step 0 baseline. Acceptable drift: +0 to +2 on `analytics_events` if a delete-trigger logs the cleanup itself. Other counts must match exactly.

If `profiles` or `date_instances` or `locks` (etc.) doesn't match: cleanup leaked. Inspect and fix manually.

- [ ] **Step 4: Append to RUN-LOG.md**

Add a "## Step 7 — cleanup" section. Paste pre-cleanup baseline + post-cleanup baseline side by side, marking any deltas.

---

### Task B12: Commit RUN-LOG.md

- [ ] **Step 1: Stage the run log**

```bash
git add scripts/5b-smoke-prod/RUN-LOG.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore(5b-smoke): RUN-LOG for 2026-05-28 prod smoke

Documents the actual values observed during the Task 10 Step 1 smoke run.
Baseline counts pre/post match; chain completed without admin_alerts; flag
restored to false; profiles/date wiped.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 3: Mark master roadmap Task 10 Step 1 checkbox**

Open `docs/superpowers/plans/2026-05-27-5b-master-roadmap.md`, find Task 10 Step 1, check its box. Commit:

```bash
git add docs/superpowers/plans/2026-05-27-5b-master-roadmap.md
git commit -m "docs(5b-roadmap): mark Task 10 Step 1 complete

Backend smoke on prod passed (see scripts/5b-smoke-prod/RUN-LOG.md).
Task 10 Step 2 (tester cohort) remains blocked on Twilio account verification.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-review against the spec

**Spec coverage (spec § → plan task):**

- §1 Goal → covered by overall plan
- §2 strategy decisions → captured as plan literals (no override, happy-only, curl-edge-funcs, real-signup-plus-fixup, SQL-seed-date, 5a-UI-swipe, profiles_select_revealed, immediate-reveal, ratings-via-PostgREST, no-Twilio)
- §3 prod baseline → Task B2 captures into RUN-LOG; comparison in Task B11 Step 3
- §4 architecture → reflected in the file structure + execution order
- §5 the chain → Tasks B5–B7 + B9 (negative test)
- §6 final-state verification → Task A7 (file) + Task B10 (execution)
- §7 cleanup → Task A9 (file) + Task B11 (execution)
- §8 failure modes → reflected in halt instructions throughout B5–B11
- §9 runbook layout → Tasks A1–A10 (every file accounted for)
- §10 verify-at-execution → resolved up-front in this plan's header
- §11 out of scope → none of these appear as tasks (correctly)
- §12 acceptance criteria → all six covered by Tasks A10 + B7 + B10 + B11 + B12

**Placeholder scan:** No `TBD` / `implement later` / vague-error-handling. One deliberate "verify at runtime" remains: `date_instances` column shape in Task A4 Step 1 — that's intentional, the prod schema may differ from the template and the executor confirms it before writing the INSERT.

**Type consistency:** UID and ID variable names consistent (`HOST_UID`, `CAND_UID`, `INST_ID`, `OFFER_ID`, `LOCK_ID`) across plan and runbook scripts. Notification types (`offer_received`, `new_match`) and event types (`match_shortlisted`, `match_offer_made`, `match_lock_created`) match the migration source.
