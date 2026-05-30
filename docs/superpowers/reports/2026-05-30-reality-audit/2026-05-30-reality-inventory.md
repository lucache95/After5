# After5 Reality Inventory — 2026-05-30 (Phase 1: Product Inventory)

READ-ONLY audit. Authority: implementation > tests > migrations > types > routes > edge fns > docs.
Prod ref: `ufufmcpnysvwtutpbian`. Tags: BUILT / PARTIAL / BROKEN / UNUSED / LEGACY / UNKNOWN.

## 1. Routes / Pages / Screens (`apps/web/app/**`)

### Dating-vertical
| Route | Tag | Evidence |
|---|---|---|
| `/feed` | BUILT | server page calls `browseFeed` (`browse_feed_for_viewer`); gates on `dating_enabled`+`verification='verified'`; `SwipeDeck` |
| `/matches` | PARTIAL | server page reads `locks` w/ party profiles; renders `ComingSoonBanner` behind feature flag |
| `/matches/[lockId]` + `/rate` | PARTIAL | lock detail + rating window UI; `locks`/`match_ratings` rows = 0 on prod |
| `/offers/[offerId]` | BUILT | offer page; wired to match-* edge fns |
| `/reciprocal/[pairId]` | BUILT | reciprocal resolution UI; `reciprocal_pairs` table exists |
| `/onboarding/**` | BUILT | full dating onboarding (see §9) |
| `/nights/new` | BUILT | host a night (date_instances create) |
| `/account`, `/account/notifications`, `/account/saved` | BUILT | profile/prefs/saved |
| `/login`, `/join`, `/auth/callback`, `/auth/signout` | BUILT | PKCE auth |

### Planner-legacy (pre-pivot, content/SEO + planner)
| Route | Tag | Evidence |
|---|---|---|
| `/plan`, `/plan/i/[id]` | LEGACY | only caller of `generate-plan` edge fn; itinerary generator |
| `/dates`, `/dates/[slug]`, `/dates/[slug]/interested` | LEGACY | static `next/link` content pages |
| `/places`, `/places/[slug]` | LEGACY | reads `places` (182 rows) — only populated legacy table |
| `/vibes`, `/vibes/[vibe]`, `/types`, `/types/[slug]`, `/neighborhoods`, `/neighborhoods/[slug]` | LEGACY | SEO content pages, static imports |
| `/templates/[id]`, `/wow/[id]`, `/vote/[id]` | LEGACY | planner share/vote artifacts; `templates`/`vote_sessions`/`plan_votes` all 0 rows |
| `/home` | LEGACY | planner landing |
| `/insiders`, `/admin/insiders` | PARTIAL | insider waitlist program; `insider_applications`/`insider_tasks` = 0 rows |
| `/roadmap`, `/about`, `/privacy`, `/terms`, `/tell-us`, `/feedback/[token]`, `/unsubscribe` | BUILT | static/marketing/legal |
| `/` | BUILT | root landing |

**Counts:** ~50 page routes. Dating: ~13 BUILT/PARTIAL. Planner-legacy: ~20 LEGACY. Marketing/legal/auth: ~12 BUILT.

## 2. API Routes / Server Actions (`app/api/**`)
No `'use server'` actions found (grep empty) — all mutations via API routes + edge fns.

| Route | Tag | Evidence |
|---|---|---|
| `/api/cron/process-jobs` | BUILT | proxies process-jobs (Vercel cron) |
| `/api/cron/post-date-feedback`, `/api/cron/weekly-broadcast` | PARTIAL/LEGACY | planner-era cron; weekly-broadcast → `email_broadcasts` (2 rows, 52 sends) |
| `/api/admin/eval`, `/api/admin/insiders`, `/api/admin/venues` | PARTIAL | legacy planner admin (venues=places) |
| `/api/insiders/apply`, `/api/insiders/submit-task` | PARTIAL | insider program, 0 rows |
| `/api/saved-plans`, `/api/saved-plans/check` | LEGACY | planner saves (`saved_plans` 3 rows) |
| `/api/votes`, `/api/vote-sessions` | LEGACY | planner voting, 0 rows |
| `/api/feedback`, `/api/notifications`, `/api/subscribe`, `/api/tell-us`, `/api/stats` | BUILT | misc; subscribe→`subscribers` (10 rows) |

## 3. Edge Functions (local vs PROD)
All 16 local dirs are deployed + ACTIVE on prod. Version drift noted.

| Function | Prod ver | Tag | Evidence |
|---|---|---|---|
| `generate-plan` | v39 | LEGACY | planner itinerary gen; only `/plan` calls it; heavily iterated (v39) |
| `process-jobs` | v1 | BUILT | job runner; cron-driven |
| `match-shortlist` | v3 | BUILT | invoked from web src |
| `match-make-offer` | v3 | BUILT | invoked from web src |
| `match-accept-offer` | v2 | BUILT | invoked from web src |
| `match-resolve-reciprocal` | v3 | BUILT | reciprocal flow |
| `match-pass-offer`, `match-withdraw`, `match-cancel-lock`, `match-demand-hint` | v2 | PARTIAL | deployed; no direct web src invocation found (called server-side/via jobs) |
| `generate-blur` | v2 | BUILT | invoked in onboarding `PhotoCropper`/`PhotoStep` |
| `generate-cover`, `classify-photos` | v6/v5 | UNUSED | no src callers; classify built locally |
| `start-verification`, `confirm-phone`, `persona-webhook` | v2 | PARTIAL | Persona/Twilio verify; blocked on Twilio per memory; `verifications` 0 rows |

## 4. Tables / Views (prod, 49 tables)
**Dating (S1/S2/S3/P5):** `profiles`(8), `profiles_private`(2), `profile_prompts`(5), `date_instances`(0), `swipes`(0), `queue_entries`(0), `offers`(0), `locks`(0), `lock_participants`(0), `match_ratings`(0), `reciprocal_pairs`(0), `blocks`(0), `reports`(0), `disputes`(0), `verifications`(0), `chat_threads`(0), `transition_idempotency`(2), `cities`(1). **BUILT schema, zero live data** (pre-launch).

**Infra:** `jobs`(0), `devices`(0), `notification_preferences`(4), `notifications`(0), `admin_alerts`(0), `feature_config`(2), `analytics_events`(0), `rate_limits`(1), `audit_log`(10), `subscribers`(10).

**Legacy planner (UNUSED — 0 rows, no dating refs):** `templates`, `user_preferences`, `feedback`, `pairings`, `modifiers`, `place_vibe_images`, `plan_feedback`, `vote_sessions`, `plan_votes`, `place_reviews`, `itinerary_reviews`, `user_feedback`, `insider_applications`, `insider_tasks`. `itineraries`(504) + `places`(182) = only populated legacy tables (SEO content). `email_broadcasts`(2)/`email_broadcast_sends`(52) active legacy.

**BROKEN/UNUSED:** `temp_race`(0) — leftover test table. `spatial_ref_sys` — RLS DISABLED (PostGIS system table, low risk but flagged critical by advisor).

## 5. RPCs / Functions (public schema, app-level)
**BUILT + wired:** `browse_feed_for_viewer`, `record_swipe`, `post_night`, `advance_onboarding_step`, `register_device` (all called via `packages/`). `match_shortlist`, `match_make_offer`, `match_accept_offer`, `match_pass_offer`, `match_withdraw`, `match_cancel_lock`, `match_demand_hint`, `match_resolve_reciprocal`, `match_expire_offer`, `match_auto_roll`, `match_bulk_withdraw`, `close_rating_window` (edge fns / jobs). `dispatch_notification`, `enqueue_job`, `claim_due_jobs`, `complete_job`, `fail_job`, `can_enter_lock_flow`, `emit_analytics`, `rate_limit_check`, chat suite (`open/close/promote_chat_thread`).

**ORPHANED / no live caller:** `admin_force_cancel_lock`, `admin_force_expire_offer`, `match_next_standby`, `match_resolve_offer_negative`, `match_autoclose_creator_conflicts`, `requeue_stuck_jobs`, `prune_idempotency_ledger` — defined, no code/job reference found (admin/maintenance, callable manually).

## 6. Jobs (`process-jobs/handlers.ts`) — 13 job types
**WORKING (RPC exists on prod):** `offer_expiry`→match_expire_offer, `standby_roll`→match_auto_roll, `bulk_withdraw`→match_bulk_withdraw, `rating_window`→close_rating_window, `day_of_reconfirm`/`safety_checkin`→dispatchNotification, `notify`→generic.

**BROKEN/DORMANT (target RPC MISSING on prod — verified via pg_proc, all 6 absent):**
| Job | Missing RPC |
|---|---|
| `stale_date_close` | `match_stale_date_close` |
| `pending_expiry` | `match_expire_pending` |
| `reconfirm_timeout` | `match_reconfirm_timeout` |
| `chat_purge` | `chat_purge_thread` |
| `deletion_process` | `process_deletion` |
| `analytics_relay` | `analytics_relay_drain` |
These dispatch to RPCs that do not exist → would `fail_job` if enqueued. Matches prior "6 dormant" claim.

## 7. Notifications — enum has 20 values, only 5 dispatched in code
Enum (prod): new_match, offer_received, offer_expiring, standby_promoted, date_reconfirm, safety_checkin, safety_alert, new_message, rating_request, moderation_action, account, verification_passed, verification_failed, appeal_resolved, offer_withdrawn, reciprocal_detected, offer_passed, offer_expired, lock_cancelled_frozen, lock_cancelled_rolled.

**Actually dispatched in code:** `account`, `new_match`, `offer_received`, `safety_checkin`, `verification_failed` (+ `date_reconfirm`/`safety_checkin` from job handlers). **~14 enum values UNUSED** (no dispatch site): offer_expiring, standby_promoted, safety_alert, new_message, rating_request, moderation_action, verification_passed, appeal_resolved, offer_withdrawn, reciprocal_detected, offer_passed, offer_expired, lock_cancelled_frozen, lock_cancelled_rolled.

## 8. Webhooks
`persona-webhook` (v2, verify_jwt=false) — BUILT/PARTIAL, Persona ID verification callback; `verifications` table 0 rows so unexercised on prod.

## 9. Admin / Moderation Tools
**Legacy planner admin (`/admin/*`):** dates, eval, feedback, insiders, venues — PARTIAL/LEGACY, operate on planner tables. **Dating moderation:** `blocks`/`reports`/`disputes` tables + `admin_alerts` + `raise_admin_alert` RPC exist (BUILT schema) but NO dating-specific admin UI found — moderation surface is unbuilt UI-side.

## 10. Onboarding (`app/onboarding/**`)
BUILT, dating-vertical. Steps: `welcome` → `basics` → `preferences` → `photo` (PhotoCropper/PhotoStep → generate-blur, classify) → `phone` → `verify` (PersonaEmbed) → `done`. Backed by `advance_onboarding_step` RPC. `start-verification`/`confirm-phone` PARTIAL (Twilio-blocked per memory).

## 11. Date Generation Systems (TWO exist)
1. `generate-plan` edge fn (v39) — LEGACY planner itinerary generator. Only `/plan` calls it. Still ACTIVE on prod.
2. `post_night` RPC + `/nights/new` — BUILT dating host-a-night creation (date_instances).
No conflict (different verticals) but generate-plan is dead weight for the pivot.

## 12. Feed / Matching Systems
`browse_feed_for_viewer` (feed, wired via `browseFeed`/`@after5/api-client`), `record_swipe` (swipe), full `match_*` suite (shortlist→offer→accept/pass→lock→reciprocal→rating). BUILT end-to-end at schema+RPC+edge-fn level; **zero live rows** (locks/offers/swipes all 0) — never exercised in prod.
