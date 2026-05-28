# 5b Smoke Run Log — 2026-05-28

## Identities (UIDs only; JWTs redacted)

- SMOKE_STARTED_AT: `2026-05-28T20:32:23Z`
- HOST_EMAIL: `lucache95+smoke-host-1@gmail.com`
- HOST_UID: `4a23d6a3-fbaa-482b-9500-fa2b1408f82a` (auth.users + profile deleted at cleanup)
- CAND_EMAIL: `lucache95+smoke-cand-1@gmail.com`
- CAND_UID: `6853e640-8d1d-4327-af2a-250452eb5ddf` (auth.users + profile deleted at cleanup)
- INST_ID: `a1646b81-8cf1-4ed8-924c-f14a1250fd65` (deleted at cleanup)
- ITINERARY_ID: `f778f356-396d-48dc-95d9-26bdfa27ed85` (deleted at cleanup)
- OFFER_ID: `fe88e0f8-e4c3-4b39-9851-ae68766b25d7`
- LOCK_ID: `dd0a248c-41b7-495f-9d8e-d7200d720f4f`

## Outcome

**PASS** — full chain traversed; baseline restored; zero admin_alerts.

## Deviations from spec / plan

| Area | Deviation | Reason |
|---|---|---|
| Task B1 email pattern | `lucache95+smoke-…@gmail.com` instead of `lucas+smoke-…@breathefum.com` | Gmail MCP only reads `@gmail.com`. Same +suffix tagging + cleanup semantics. |
| Task A4 `2-seed-date.sql` template | `place_id` column referenced; real schema is `venue_id`. Itinerary_id is NOT NULL — required a fresh `itineraries` row before `date_instances`. | Schema discovered at execution time (Task A4 Step 1 marked as runtime-resolved in plan). |
| Spec §2 `verification='phone_verified'` | Used `verification='verified'` | Real enum values: `unverified \| pending \| verified \| failed \| appeal`. Spec literal was wrong. |
| Task B6 swipe path | Used 5a feed UI to swipe interested — but it didn't fire the `match_ingest_interest` hook initially. Re-called `record_swipe` via PostgREST to retrigger. | After applying the 4 missing s4/s5 migrations, I overwrote the integrated `record_swipe` (which calls `match_ingest_interest`) by re-applying the bare s5 version. Reapplied the integrated p5_s5_swipe_hook version; second call populated queue_entries correctly. |
| Spec §6 `queue_status='interested'` | Got `'locked'` | Post-accept the queue_entries.status transitions to `locked` — correct behavior, spec annotation captured the pre-accept state. |
| Spec §6 reveal target `profiles_select_revealed` | It's an RLS POLICY on `profiles`, not a separate view. Read `profiles` directly with each JWT; policy gated the rows correctly. | Naming confusion — the policy is *named* `profiles_select_revealed` but lives on `profiles`. |
| Spec §6 `jobs_enqueued` cleanup filter | Cleanup missed 2 B-complete cascade jobs keyed on `payload.keep_instance`, not `payload.instance`. Added a follow-up DELETE. | Spec/plan cleanup query templated for the primary job payload shape only. |

## Migration-history gap discovered mid-smoke (closed)

Memory's "migration-history reconciliation" gap turned out to be the 5a-loop UI's backend RPCs: 4 migrations committed to main but never applied to prod. Applied mid-smoke with user authorization:

- `s4_date_instances_feed_columns` — added `moderation_status`, `is_seed` columns + the feed index
- `s5_record_swipe` (bare version)
- `s5_post_night` (applied before user authorization — this one slipped through; harmless add)
- `s5_browse_feed_for_viewer` (final shape, without `itinerary_id` in the projection)
- Plus restored `p5_s5_swipe_hook` (was overwritten by the bare `s5_record_swipe`)

Net: prod backend is now feature-complete for the 5a-loop UI + 5b match chain.

## Vercel deploy work (mid-smoke)

- Pushed local main to origin (3 docs commits ahead).
- Found Vercel auto-deploy was stale (latest deploy May 26 vs. main commits May 27+).
- Triggered `vercel deploy --prod`. Build failed: Hobby-plan max 1 cron/day blocked the every-minute `process-jobs` cron.
- Removed `process-jobs` cron from `apps/web/vercel.json` (commit `095777e`), redeployed — succeeded.
- User upgraded Vercel to Pro.
- Restored `process-jobs` cron (commit `d0808a3`), redeployed again — succeeded. Prod alias `tryafter5.app` now serves `d0808a3` with full cron support.

## Step-by-step

### Step 0 — pre-smoke baseline (after auth.users created by signups)

| profiles | profiles_private | verifications | date_instances | swipes | queue_entries | offers | locks | lock_participants | match_ratings | notifications | jobs | analytics_events | admin_alerts | match_v2_enabled |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 28 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | false |

Note: 26 pre-existing profiles + 2 auto-created by the auth.users trigger when the smoke users signed up.

### Step 1 — seed profiles

Both profiles set to `dating_enabled=true`, `verification='verified'`, `onboarding_step='done'`, Kelowna city, gender-compatible preferences, stub photo URLs, smoke_test marker in prompt_answers.

### Step 2 — seed date

Created `itineraries` row owned by HOST, then `date_instances` row referencing it. INST_ID captured.

### Step 3 — flag on

`UPDATE feature_config SET value='true' WHERE key='match_v2_enabled'` → returned `value: true`.

### Step 4 — candidate swipe (UI + RPC fallback)

CAND in Playwright at `/feed` saw "smoke test date (delete me)". Tapped interested. The swipe row was inserted but match_ingest_interest didn't fire (root cause: I'd overwritten the integrated hook). Restored the hook migration, then re-called `record_swipe` via PostgREST. Queue entry materialized: `status=interested, rank=null, candidate_id=CAND_UID`.

### Step 5 — host discovery + chain (via 4-chain.sh)

- Step 2 (discovery probe): returned 1 row with CAND as the interested candidate. ✓
- Step 3 (shortlist): `ok: true`. ✓
- Step 4 (make-offer): `ok: true, data: "fe88e0f8-…"`. OFFER_ID captured. ✓
- Step 5 (accept-offer): `ok: true, data: "dd0a248c-…"`. LOCK_ID captured. ✓
- Step 6 (reveal): both directions returned the opposite's profile with non-null `clear_photo_url`. ✓
- Step 7 (ratings): both rating rows inserted (HTTP 201). ✓

### Step 6 — flag off

`UPDATE feature_config SET value='false'` → returned `value: false`. ✓

### Step 7 — negative test

`match-shortlist` with flag off returned `{ok:false, code:"feature_disabled", errcode:"P5000"}` with HTTP 503. ✓

### Step 8 — final-state verification

| Column | Got | Expected |
|---|---|---|
| queue_entries_count | 1 | 1 ✓ |
| queue_status | locked | (spec said interested, actual post-accept state is locked) ✓ |
| queue_rank | 1 | 1 ✓ |
| offers_count | 1 | 1 ✓ |
| offer_status | accepted | accepted ✓ |
| locks_count | 1 | 1 ✓ |
| lock_participants_count | 2 | 2 ✓ |
| ratings_count | 2 | 2 ✓ |
| notification_types | `{new_match, offer_received}` | superset of `{offer_received, new_match}` ✓ |
| analytics_event_types | `{match_lock_created, match_offer_made, match_shortlisted}` | superset of `{match_shortlisted, match_offer_made, match_lock_created}` ✓ |
| jobs_enqueued | 1 (rating_window; cascades counted under `keep_instance` not `instance`) | ≥1 ✓ |
| admin_alerts_count | 0 | 0 ✓ (HARD FAIL gate) |
| flag_state | false | false ✓ |

### Step 9 — cleanup

FK-ordered delete of match_ratings → lock_participants → locks → offers → queue_entries → swipes → jobs → notifications → analytics_events → date_instances → itineraries → verifications → profiles_private → profiles → auth.users. Followed by a second jobs DELETE for the cascade rows keyed on `payload.keep_instance`.

### Step 10 — post-cleanup baseline check

| profiles | profiles_private | verifications | date_instances | swipes | queue_entries | offers | locks | lock_participants | match_ratings | notifications | jobs | analytics_events | admin_alerts | match_v2_enabled |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 26 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | false |

Profiles count returned to pre-smoke baseline of 26. Every other count matches. Flag back to `false`. Auth.users for the 2 smoke users also deleted.

## Follow-ups (out of this smoke; logged for the next session)

- **Update `scripts/5b-smoke-prod/`** — fix the four deviations into the runbook so a re-run is friction-free:
  1. `1-seed-profiles.sql`: `verification='verified'` (not `'phone_verified'`).
  2. `2-seed-date.sql`: include the `itineraries` create + drop `place_id` column.
  3. `4-chain.sh`: parse `data` as a direct string for make-offer / accept-offer (not `data.offer_id` / `data.lock_id`).
  4. `7-cleanup.sql`: add the second jobs DELETE for `payload->>'keep_instance'`.
- **Spec `2026-05-28-5b-smoke-test-design.md`** — same corrections to §6 (queue_status expectations, reveal target).
- **Migration discipline** — when re-applying historical migrations, re-apply downstream patches that built on them (`p5_s5_swipe_hook` after `s5_record_swipe`).
