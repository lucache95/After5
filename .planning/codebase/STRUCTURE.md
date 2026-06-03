# Codebase Structure

**Analysis Date:** 2026-06-03

## Directory Layout

```
After5/ (monorepo root, pnpm workspace)
├── apps/
│   └── web/                           # Next.js 15 App Router web app
│       ├── app/                       # App Router pages + API routes
│       │   ├── (authenticated)/       # Future grouped layout
│       │   ├── page.tsx               # / landing page
│       │   ├── layout.tsx             # Root layout (fonts, theme, PostHog)
│       │   ├── globals.css            # Tailwind + Barbiecore theme
│       │   ├── auth/                  # OAuth/magic-link flow
│       │   │   ├── callback/route.ts  # /auth/callback — session exchange
│       │   │   ├── confirm/route.ts   # /auth/confirm — email link handler
│       │   │   └── signout/route.ts   # /auth/signout — logout handler
│       │   ├── api/                   # HTTP API routes (not RPCs)
│       │   │   ├── notifications/route.ts      # GET/POST for notification list + mark-read
│       │   │   ├── inbox/             # Grouped inbox endpoints
│       │   │   │   ├── activity/route.ts      # Activity stream (paginated)
│       │   │   │   └── unread/route.ts        # Unread count
│       │   │   ├── offers/notify-offered/route.ts  # Offer expiration email
│       │   │   ├── offers/email/route.ts       # Offer detail email
│       │   │   ├── places/search/route.ts      # Place search (Google Places)
│       │   │   ├── devices/route.ts            # Push notification registration
│       │   │   ├── feedback/route.ts           # Feedback form submission
│       │   │   ├── stats/route.ts              # Dashboard stats
│       │   │   ├── admin/                      # Admin-only endpoints
│       │   │   │   ├── insiders/route.ts
│       │   │   │   └── venues/route.ts
│       │   │   └── insiders/              # Insider program (legacy)
│       │   ├── home/page.tsx                 # /home — post-login landing
│       │   ├── feed/                        # /feed — swipe deck entry point
│       │   │   ├── page.tsx                  # Server component, SSR feed load
│       │   │   ├── SwipeDeck.tsx            # 'use client' — swipe loop
│       │   │   └── __tests__/
│       │   ├── matches/                      # /matches — lock hub
│       │   │   ├── page.tsx                  # List all locks (active + past)
│       │   │   ├── lock-view.ts              # Helpers (bucketLocks, pickCounterpart)
│       │   │   ├── MatchesList.tsx           # 'use client' — renders lock cards
│       │   │   ├── [lockId]/                 # /matches/[lockId] — lock detail
│       │   │   │   ├── page.tsx              # Server entry; load lock + parties + photos
│       │   │   │   ├── LockDetail.tsx        # 'use client' — render lock detail
│       │   │   │   ├── rate/page.tsx         # /matches/[lockId]/rate — post-date rating
│       │   │   │   └── __tests__/
│       │   │   └── __tests__/
│       │   ├── inbox/                        # /inbox — unified inbox (activity + messages)
│       │   │   ├── page.tsx                  # Unified inbox entry
│       │   │   ├── ActivityList.tsx          # 'use client' — activity zone
│       │   │   └── __tests__/
│       │   ├── messages/                     # /messages — chat (legacy; moved to /inbox in #84)
│       │   │   ├── page.tsx                  # /messages — thread list (soft-deprecated)
│       │   │   ├── ThreadList.tsx            # Thread row component + helpers
│       │   │   ├── [threadId]/               # /messages/[threadId] — chat detail
│       │   │   │   ├── page.tsx              # Server entry; load thread + messages
│       │   │   │   ├── ChatThread.tsx        # 'use client' — message loop
│       │   │   │   └── __tests__/
│       │   │   └── thread-view.ts            # Helpers (sortByRecency, unreadCount)
│       │   ├── dates/                        # /dates — date instance listing
│       │   │   ├── page.tsx                  # List all date instances (browse, not feed)
│       │   │   ├── [slug]/page.tsx           # /dates/[slug] — detail view (future)
│       │   │   └── [slug]/interested/page.tsx # /dates/[slug]/interested — interest list (future)
│       │   ├── offers/                       # /offers — offer detail (candidate side)
│       │   │   ├── [offerId]/page.tsx        # /offers/[offerId] — view + accept/pass
│       │   │   └── __tests__/
│       │   ├── onboarding/                   # /onboarding/* — identity setup
│       │   │   ├── layout.tsx                # Onboarding-scoped layout (steps tracker)
│       │   │   ├── page.tsx                  # /onboarding — router to current step
│       │   │   ├── welcome/page.tsx          # 01 — welcome screen
│       │   │   ├── basics/page.tsx           # 02 — name, location, city
│       │   │   ├── phone/page.tsx            # 03 — phone number (SMS gate)
│       │   │   ├── verify/page.tsx           # 04 — Persona liveness + ID check
│       │   │   ├── photo/page.tsx            # 05 — profile photo upload
│       │   │   ├── preferences/page.tsx      # 06 — age/gender pref, distance, vibes
│       │   │   ├── done/page.tsx             # 07 — completion + redirect to /feed
│       │   │   └── __tests__/
│       │   ├── create/                       # /create — itinerary creation
│       │   │   ├── page.tsx                  # /create — choice: AI vs. blank
│       │   │   └── generate/page.tsx         # /create/generate — AI-generated plan
│       │   ├── my-nights/                    # /my-nights — user's posted dates
│       │   │   ├── page.tsx
│       │   │   └── __tests__/
│       │   ├── account/                      # /account/* — user settings
│       │   │   ├── page.tsx                  # /account — overview
│       │   │   ├── profile/page.tsx          # /account/profile — edit profile
│       │   │   ├── notifications/page.tsx    # /account/notifications — notification prefs
│       │   │   └── saved/page.tsx            # /account/saved — saved plans (legacy)
│       │   ├── reciprocal/[pairId]/page.tsx  # /reciprocal/[pairId] — mutual interest view
│       │   ├── admin/                        # /admin/* — admin dashboard (future S8)
│       │   │   ├── layout.tsx                # Admin-only layout
│       │   │   ├── eval/page.tsx             # Eval grid
│       │   │   ├── alerts/page.tsx           # System alerts
│       │   │   ├── reports/page.tsx          # User reports
│       │   │   ├── insiders/page.tsx         # Insider program
│       │   │   └── dates/[id]/page.tsx       # Date detail (admin view)
│       │   ├── feedback/[token]/page.tsx     # /feedback/[token] — feedback form
│       │   ├── login/page.tsx                # /login — auth gate
│       │   ├── join/page.tsx                 # /join — early access / promo landing
│       │   ├── about/page.tsx                # /about
│       │   ├── roadmap/page.tsx              # /roadmap
│       │   ├── privacy/page.tsx              # /privacy
│       │   ├── terms/page.tsx                # /terms
│       │   ├── vote/[id]/page.tsx            # /vote/[id] — vote on plans (legacy)
│       │   ├── insiders/page.tsx             # /insiders — insider info
│       │   ├── neighborhoods/page.tsx        # /neighborhoods — browse by area
│       │   ├── neighborhoods/[slug]/page.tsx # /neighborhoods/[slug]
│       │   ├── places/page.tsx               # /places — place browsing
│       │   ├── places/[slug]/page.tsx        # /places/[slug]
│       │   ├── plans/[id]/edit/page.tsx      # /plans/[id]/edit — plan editor
│       │   ├── types/page.tsx                # /types — place type browsing
│       │   ├── types/[slug]/page.tsx         # /types/[slug]
│       │   ├── vibes/page.tsx                # /vibes — vibe tag browsing
│       │   ├── vibes/[vibe]/page.tsx         # /vibes/[vibe]
│       │   ├── tell-us/page.tsx              # /tell-us — user input form
│       │   ├── offline/page.tsx              # /offline — offline placeholder
│       │   ├── nights/new/page.tsx           # /nights/new — create night (legacy)
│       │   ├── unsubscribe/page.tsx          # /unsubscribe — email unsubscribe
│       │   ├── robots.txt route
│       │   ├── sitemap.xml route
│       │   └── manifest.webmanifest route
│       ├── components/                       # Reusable React components
│       │   ├── __tests__/                   # Component tests
│       │   ├── create/                       # Plan creation UI (itinerary editor)
│       │   ├── itinerary/                    # Itinerary display components
│       │   ├── Avatar.tsx
│       │   ├── BottomTabShell.tsx            # Bottom nav bar (Feed, Matches, Inbox, Account)
│       │   ├── SwipeDeck.tsx                 # Reusable swipe component (feed, possibly elsewhere)
│       │   ├── ProfileCard.tsx               # Profile preview card
│       │   ├── PhotoLightbox.tsx             # Modal photo viewer (M6 gallery)
│       │   ├── UserMenu.tsx                  # Top-right user dropdown
│       │   ├── NotificationToast.tsx         # Toast notification renderer
│       │   └── [many others — UI components]
│       ├── lib/                              # Utility modules and helpers
│       │   ├── __tests__/
│       │   ├── supabase/                     # Supabase client factories
│       │   │   ├── server.ts                 # createClient() — RLS-bound server client
│       │   │   ├── client.ts                 # Browser client (legacy, replaced by SSR)
│       │   │   └── admin.ts                  # createAdminClient() — service-role admin
│       │   ├── after5/                       # Dating loop helpers
│       │   │   ├── __tests__/
│       │   │   ├── inbox-activity.ts         # groupActivity() — notification grouping
│       │   │   ├── match.ts                  # Match state helpers
│       │   │   ├── photos.ts                 # Profile photo queries + signing
│       │   │   └── [others]
│       │   ├── auth/                         # Auth helpers
│       │   │   └── [providers]
│       │   ├── onboarding/                   # Onboarding flow helpers
│       │   │   ├── steps.ts                  # routeForStep() — map step enum to route
│       │   │   └── [others]
│       │   ├── match/                        # Match flow helpers
│       │   │   ├── flag.ts                   # isMatchEnabledForViewer() RPC call
│       │   │   └── [others]
│       │   ├── itinerary/                    # Plan generation helpers
│       │   │   ├── __tests__/
│       │   │   ├── [scoring, filtering]
│       │   │   └── [others]
│       │   ├── places/                       # Place query helpers
│       │   │   ├── __tests__/
│       │   │   └── [place search, slugs]
│       │   ├── create/                       # Creation flow helpers
│       │   │   └── [others]
│       │   ├── email/                        # Email template / sending helpers
│       │   │   ├── __tests__/
│       │   │   └── welcome.ts                # ensureWelcomeSent() — send first email
│       │   ├── push/                         # Push notification helpers
│       │   │   └── [FCM, Web Push]
│       │   ├── cn.ts                         # classnames helper (Tailwind)
│       │   ├── format.ts                     # Date / number formatting
│       │   ├── slug.ts                       # Slug generation / parsing
│       │   ├── themes.ts                     # Theme constants (Barbiecore)
│       │   └── [many more utilities]
│       ├── e2e/                              # Playwright E2E tests
│       │   ├── route-smoke.spec.ts           # Full route smoke tests
│       │   ├── _helpers/                     # Test helpers (auth, factories)
│       │   └── [others]
│       ├── public/                           # Static assets
│       │   ├── ambient/                      # Ambient sound clips (legacy bucket path)
│       │   ├── email/                        # Email templates / images
│       │   ├── gallery/                      # Placeholder images
│       │   ├── icons/                        # SVG icons
│       │   ├── pins/                         # Map pin SVGs
│       │   ├── places/                       # Place images
│       │   ├── sample/                       # Sample images
│       │   └── vibes/                        # Vibe tag images
│       ├── .design/                          # Design specs and mockups
│       ├── .vercel/                          # Vercel deployment config
│       ├── next.config.js                    # Next.js configuration
│       ├── tailwind.config.ts                # Tailwind CSS theme (Barbiecore)
│       ├── tsconfig.json                     # TypeScript config (extends base)
│       └── package.json
├── packages/                                 # Shared libraries (monorepo)
│   ├── api-client/                           # Typed Supabase queries + RPC stubs
│   │   ├── src/
│   │   │   ├── __tests__/
│   │   │   ├── index.ts                      # Main export (createAfter5Client, generatePlan, submitFeedback)
│   │   │   ├── feed.ts                       # Feed queries (browseFeed, postNight, recordSwipe, etc.)
│   │   │   ├── feed.test.ts
│   │   │   └── profile.ts                    # Profile queries
│   │   └── package.json
│   ├── types/                                # Generated Supabase types
│   │   ├── src/
│   │   │   └── index.ts                      # type Database = { ... } — auto-generated
│   │   └── package.json
│   ├── validators/                           # Zod schemas for form inputs
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── [request/response schemas]
│   │   │   └── __tests__/
│   │   └── package.json
│   ├── business/                             # Business logic (no DB deps)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── [cohort logic, feature flags]
│   │   │   └── __tests__/
│   │   └── package.json
│   └── date-quality/                         # Date itinerary quality scoring
│       ├── src/
│       │   ├── index.ts
│       │   ├── scoring.ts
│       │   └── __tests__/
│       └── package.json
├── supabase/                                 # Supabase schema, migrations, edge functions
│   ├── migrations/                           # SQL migrations (applied in order)
│   │   ├── 20260419193959_initial_schema.sql         # Base tables (places, templates, itineraries)
│   │   ├── 20260525120100_p0_profiles_dating.sql     # Dating profile columns
│   │   ├── 20260525120200_p0_verifications.sql       # Verification / age-gate logic
│   │   ├── 20260525120300_p0_date_instances.sql      # Date instance table + browse_feed view
│   │   ├── 20260525120400_p0_swipes.sql              # Swipe tracking
│   │   ├── 20260525120500_p0_queue_entries.sql       # Job queue (process-jobs)
│   │   ├── 20260525120600_p0_offers.sql              # Offer table
│   │   ├── 20260525120700_p0_locks.sql               # Lock + lock_participants (+ sync trigger)
│   │   ├── 20260525120800_p0_match_ratings.sql       # Post-date ratings
│   │   ├── 20260525121100_p0_audit_log.sql           # Audit log for compliance
│   │   ├── 20260525122100_p1_profile_prompts.sql     # Profile prompt answers (M5)
│   │   ├── 20260525122200_p1_preferences_constraints.sql
│   │   ├── 20260525122300_p1_age_gate_trigger.sql    # Age gate enforcement
│   │   ├── 20260525122400_p1_verification_rollup_trigger.sql
│   │   ├── 20260525123200_p2_devices.sql             # Push notification devices
│   │   ├── 20260525123300_p2_notification_preferences.sql
│   │   ├── 20260525123450_p2_notification_rate_limit.sql
│   │   ├── 20260525123500_p2_can_enter_lock_flow.sql # Gate check RPC
│   │   ├── 20260525122700_p1_badge_view.sql          # Badges/awards view
│   │   ├── 20260522110000_rate_limits.sql            # Rate limiting RPC
│   │   ├── 20260527120200_s5_post_night.sql          # post_night() RPC
│   │   ├── 20260527120400_s5_browse_feed_drop_itinerary_id.sql
│   │   ├── 20260527122030_security_revoke_definer_rpc_and_plan_votes_rls.sql
│   │   ├── 20260527124550_s2_notification_type_5b_extend.sql
│   │   ├── 20260527124551_z_chat_lock_ready_5b_launch.sql    # chat_lock_ready() RPC
│   │   ├── 20260527126600_p5_profiles_revealed_policy.sql     # Reveal policy
│   │   ├── 20260527126700_p5_s5_swipe_hook.sql               # record_swipe() RPC
│   │   ├── 20260527127000_p5_c_sql.sql                       # match_demand_hint(), admin_* RPCs
│   │   ├── 20260527127400_p5_host_pre_offer_disclosure.sql   # match_host_can_see_candidate()
│   │   ├── 20260601100000_p7_messages_table.sql              # messages table
│   │   ├── 20260601100200_p7_chat_send_rpc.sql               # chat_send_message(), chat_mark_read(), etc.
│   │   ├── 20260601100500_p7_messages_realtime_publication.sql
│   │   ├── 20260601201000_realtime_publication_notif_queue_locks.sql
│   │   ├── 20260602120100_m4_date_instances_ambient.sql       # Ambient sound field
│   │   ├── 20260602120400_m4_browse_feed_ambient.sql          # browse_feed_for_viewer() RPC
│   │   ├── 20260602120700_m4_post_night_drop_4arg.sql
│   │   ├── 20260602130200_m6_profile_photos_storage.sql       # Profile photos storage / RLS
│   │   ├── 20260602160000_m35_places_google_id_full_unique.sql
│   │   └── [more migrations...]
│   ├── functions/                            # Supabase Edge Functions (Deno)
│   │   ├── _shared/                          # Shared utilities across functions
│   │   │   ├── auth.ts                       # User / session helpers
│   │   │   ├── types.ts                      # Common types
│   │   │   ├── errors.ts                     # Error handling
│   │   │   └── [others]
│   │   ├── generate-plan/                    # AI plan generation
│   │   │   ├── index.ts                      # Entry point; orchestrates Claude + Google Places
│   │   │   ├── prompt.ts                     # Prompt engineering + LLM call
│   │   │   ├── places-filter.ts              # Filter places by constraints
│   │   │   ├── google-places.ts              # Google Places API wrapper
│   │   │   ├── templates.ts                  # Itinerary templates
│   │   │   ├── persist.ts                    # Save to DB
│   │   │   └── index.test.ts
│   │   ├── match-make-offer/                 # Create offer (triggered by swipe pair)
│   │   │   ├── index.ts
│   │   │   └── index.test.ts
│   │   ├── match-accept-offer/               # Accept offer → create lock + thread
│   │   │   └── index.ts
│   │   ├── match-pass-offer/                 # Decline offer
│   │   │   └── index.ts
│   │   ├── match-withdraw/                   # Creator cancels offer pre-acceptance
│   │   │   └── index.ts
│   │   ├── match-cancel-lock/                # Cancel active lock (either party)
│   │   │   └── index.ts
│   │   ├── match-shortlist/                  # (Future) shortlist before offer
│   │   │   └── index.ts
│   │   ├── match-demand-hint/                # Demand / interest signal
│   │   │   └── index.ts
│   │   ├── match-resolve-reciprocal/         # (Future) mutual interest flow
│   │   │   └── index.ts
│   │   ├── chat-send-message/                # (Unused; RPC preferred) — chat send
│   │   │   └── index.ts
│   │   ├── chat-report-message/              # Report abusive message
│   │   │   └── index.ts
│   │   ├── classify-photos/                  # AI photo quality check
│   │   │   └── index.ts
│   │   ├── generate-cover/                   # Generate itinerary cover image
│   │   │   └── index.ts
│   │   ├── generate-blur/                    # Blur profile photo (anon → blurred)
│   │   │   └── index.ts
│   │   ├── confirm-phone/                    # Twilio SMS confirmation handler
│   │   │   └── index.ts
│   │   ├── start-verification/               # Persona liveness + ID check
│   │   │   └── index.ts
│   │   ├── persona-webhook/                  # Persona verification result webhook
│   │   │   └── index.ts
│   │   └── process-jobs/                     # Cron-triggered async job handler
│       ├── index.ts                          # Main handler (scheduled via Vercel cron)
│       ├── handlers.ts                       # Job handler dispatch
│       └── index.test.ts
├── scripts/                                  # Utility scripts
│   ├── [database seeding, migrations, etc.]
├── docs/                                     # Project documentation
│   └── [PLAN.md, TECH_PLAN.md, superpowers/]
├── .planning/                                # GSD planner output
│   └── codebase/                             # Codebase analysis documents (THIS FOLDER)
│       ├── ARCHITECTURE.md                   # (newly written)
│       └── STRUCTURE.md                      # (newly written)
├── package.json                              # Root workspace config
├── pnpm-workspace.yaml                       # Monorepo declaration
├── pnpm-lock.yaml                            # Lock file
├── turbo.json                                # Turborepo config
├── tsconfig.base.json                        # Shared TS config
└── vitest.config.ts                          # Vitest (unit test runner)
```

## Directory Purposes

**Root (`/`):**
- Purpose: Monorepo workspace declaration; shared configurations (TypeScript, Turbo, Vitest).
- Contains: `pnpm-workspace.yaml`, `tsconfig.base.json`, `turbo.json`, root `package.json`.
- Key files: `PLAN.md` (master spec), `TECH_PLAN.md` (tech decisions), `.superpowers/` (Barbiecore design system).

**apps/web:**
- Purpose: The user-facing dating app (Next.js 15 SSR + React Client).
- Contains: App Router pages, API routes, components, utilities, E2E tests.
- Key files: `app/page.tsx` (landing), `app/layout.tsx` (root layout), `tailwind.config.ts` (Barbiecore theme).

**apps/web/app:**
- Purpose: App Router directory — one subdirectory per route.
- Contains: `.tsx` page files, `route.ts` API handlers, layout files.
- Pattern: Each route's subdirectory owns its page component, sub-routes, and local tests.

**apps/web/components:**
- Purpose: Reusable React components (UI library).
- Contains: Layout components (BottomTabShell), cards, modals, forms, iterative design.
- Pattern: One `.tsx` file per component; no subdirs unless component has many children (e.g., `create/`, `itinerary/`).

**apps/web/lib:**
- Purpose: Utility modules (non-UI logic).
- Contains: Supabase client factories, domain-specific helpers (onboarding, match, places), formatting.
- Pattern: Grouped by domain (supabase/, after5/, auth/, etc.); unit tests colocated in `__tests__/`.

**apps/web/e2e:**
- Purpose: Playwright E2E tests; full-stack integration tests.
- Contains: `.spec.ts` test files; helper utilities.
- Key files: `route-smoke.spec.ts` (all routes visited).

**packages/api-client:**
- Purpose: Typed Supabase queries + RPC stubs; used by web app and (future) mobile.
- Contains: `feed.ts` (browseFeed, postNight, recordSwipe), `profile.ts`, `index.ts` (exports).
- Pattern: Functions return types from `@after5/types` (generated from Supabase schema).

**packages/types:**
- Purpose: Supabase-generated TypeScript types (`type Database`).
- Contains: `index.ts` (single export); regenerated on schema change via `supabase gen types` or similar.
- Key: Source of truth for table/RPC signatures.

**packages/validators:**
- Purpose: Zod schemas for form inputs and RPC payloads.
- Contains: Request/response schemas; validation helpers.
- Pattern: Used by pages + edge functions for input validation before DB writes.

**packages/business:**
- Purpose: Business logic (e.g., cohort gates, feature flag evaluation) without DB dependencies.
- Contains: Deterministic functions; no async DB calls.
- Examples: `feedColdStartTier()`, `isMatchEnabledForViewer()` logic (not RPC; used in page filters).

**packages/date-quality:**
- Purpose: Itinerary quality scoring; ML/heuristic models for place ranking.
- Contains: Scoring functions, filters.
- Used by: generate-plan edge function.

**supabase/migrations:**
- Purpose: SQL schema evolution; DDL + RLS policies + RPC definitions + seed data.
- Contains: `.sql` files named by phase + timestamp + description.
- Pattern: Numbered sequentially; idempotent (use `CREATE TABLE IF NOT EXISTS`, `do $$ ... exception ... end $$`).
- Key: `browse_feed_for_viewer()` RPC, match_* RPCs, chat_send_message() RPC live here.

**supabase/functions:**
- Purpose: Deno edge functions; async orchestration, webhook handlers, long-running jobs.
- Contains: One subdirectory per function; `index.ts` is the entry point.
- Pattern: `export default async function(req: Request) { ... }` — Supabase runtime auto-wires this.

## Key File Locations

**Entry Points:**
- `apps/web/app/page.tsx` — Landing page (logged-out, static).
- `apps/web/app/home/page.tsx` — Post-login home (logged-in, dynamic).
- `apps/web/app/layout.tsx` — Root layout (fonts, theme, PostHog, providers).

**Configuration:**
- `apps/web/tailwind.config.ts` — Barbiecore theme (pink, fonts, spacing).
- `apps/web/next.config.js` — Next.js settings (image optimization, env vars).
- `apps/web/tsconfig.json` — TypeScript (extends base, path aliases).
- `supabase/config.toml` — Supabase project settings.

**Core Logic:**
- `apps/web/lib/supabase/server.ts` — RLS client factory.
- `packages/api-client/src/feed.ts` — Feed RPC + post_night RPC.
- `supabase/migrations/20260527120200_s5_post_night.sql` — post_night() RPC definition.
- `supabase/functions/generate-plan/index.ts` — AI plan generation orchestration.

**Testing:**
- `apps/web/e2e/route-smoke.spec.ts` — Full-route E2E test (Playwright).
- `packages/api-client/src/feed.test.ts` — Feed query unit tests.
- `supabase/functions/generate-plan/index.test.ts` — Edge function unit tests.

## Naming Conventions

**Files:**
- Pages: `page.tsx` in route subdirectory (e.g., `app/feed/page.tsx`).
- API routes: `route.ts` (e.g., `app/api/notifications/route.ts`).
- Components: PascalCase (e.g., `SwipeDeck.tsx`, `BottomTabShell.tsx`).
- Utils: camelCase (e.g., `pickCounterpart.ts`, `formatDate.ts`).
- Migrations: `YYYYMMDDHHMMSS_phase_description.sql` (e.g., `20260527120200_s5_post_night.sql`).
- Edge functions: kebab-case directory name (e.g., `generate-plan/`, `match-make-offer/`).

**Functions:**
- RPC names: snake_case (e.g., `browse_feed_for_viewer()`, `match_accept_offer()`).
- API functions: camelCase (e.g., `browseFeed()`, `recordSwipe()`).
- React components: PascalCase (e.g., `SwipeDeck`, `ProfileCard`).
- Utility functions: camelCase (e.g., `pickCounterpart()`, `formatDate()`).

**Variables & Types:**
- Constants: UPPER_SNAKE_CASE (e.g., `DEFAULT_LIMIT`).
- Types: PascalCase (e.g., `FeedNight`, `LockRowWithParties`).
- Interfaces: PascalCase with I prefix or no prefix (e.g., `MatchCard` or `IMatchCard`).
- Enums: PascalCase (e.g., `LockStatus`, `OfferStatus` — defined in SQL).

**Routes (App Router):**
- Static: `/about`, `/privacy`, `/terms`, `/roadmap`, `/login`, `/onboarding`.
- Dynamic: `/feed`, `/matches`, `/matches/[lockId]`, `/messages/[threadId]`, `/offers/[offerId]`.
- Admin: `/admin/dashboard`, `/admin/users`, etc. (gated by RLS role).

## Where to Add New Code

**New Feature (Dating Loop Addition):**
1. **Schema Change:** Add tables/columns to `supabase/migrations/[timestamp]_[description].sql`.
2. **RPC:** Define SECURITY DEFINER RPC in same migration (or new one).
3. **API Client Stubs:** Export RPC helper in `packages/api-client/src/index.ts` or new module.
4. **Page/Component:** Create route in `apps/web/app/[route]/page.tsx` or add component to `apps/web/components/`.
5. **Tests:** Add tests to `apps/web/e2e/` (Playwright) and `packages/api-client/src/__tests__/` (unit).

**New Component/Module:**
- **Reusable Component:** `apps/web/components/[NewComponent].tsx` (PascalCase, with client marker if interactive).
- **Domain Utility:** `apps/web/lib/[domain]/[helper].ts` (camelCase, with unit tests in `__tests__/`).
- **Shared Package:** `packages/[name]/src/[module].ts` (if useful across web + mobile).

**Utilities:**
- **Supabase Query Helper:** `packages/api-client/src/[domain].ts` (export typed RPC wrapper).
- **Formatting/Validation:** `apps/web/lib/[helper].ts` (or `packages/business/src/[logic].ts` if no DB).
- **Type Definition:** `packages/types/src/index.ts` (regenerate from Supabase; manually add if custom).

**Database Migrations:**
- Create file: `supabase/migrations/[YYYYMMDDHHMMSS]_[phase]_[description].sql`.
- Idempotent DDL: Use `CREATE TABLE IF NOT EXISTS`, `DO $$ ... EXCEPTION ... END $$`.
- RLS + RPC: Define policies and SECURITY DEFINER functions inline.
- Sequence: Apply in lexical order (timestamp ensures determinism).

**Edge Functions:**
- Create directory: `supabase/functions/[kebab-name]/`.
- Create `index.ts`: Export `default async function(req: Request) { ... }`.
- Shared code: Import from `supabase/functions/_shared/`.
- Tests: `index.test.ts` (or `index_test.ts`).

**API Routes (HTTP):**
- Create file: `apps/web/app/api/[path]/route.ts`.
- Export `GET` and/or `POST` functions.
- Use RLS client for authenticated routes; admin client for admin-only.
- Return JSON (NextResponse.json).

## Special Directories

**apps/web/.design:**
- Purpose: Figma exports; design specs; component mockups.
- Generated: Yes (manual Figma export).
- Committed: Yes (reference; not compiled).

**apps/web/.next:**
- Purpose: Next.js build output.
- Generated: Yes (on `npm run build`).
- Committed: No (in .gitignore).

**supabase/functions/_shared:**
- Purpose: Reusable code for edge functions (TypeScript/Deno modules).
- Generated: No (manually written).
- Committed: Yes.

**packages/types (Supabase-Generated):**
- Purpose: TypeScript definitions for Database schema.
- Generated: Yes (via `supabase gen types` or similar).
- Committed: Yes (checked in; regenerated on schema change).

---

*Structure analysis: 2026-06-03*
