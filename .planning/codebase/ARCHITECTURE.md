<!-- refreshed: 2026-06-03 -->
# Architecture

**Analysis Date:** 2026-06-03

## System Overview

After5 is a Next.js 15 / Supabase dating marketplace where users browse "nights" (time-bound experiences), match on the experience itself (not profiles), and progressively reveal identity. The app comprises three layers: presentation (App Router pages + components), orchestration (server actions + API routes), and persistence (Supabase RPCs + edge functions + database).

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        App Router Pages                             │
│  /feed /matches /inbox /messages /dates /onboarding /create /account │
│  `apps/web/app/[route]/page.tsx` — SSR entry points, RLS gates    │
└───────────────────────┬────────────────────────────────────────────┘
                        │
┌───────────────────────┴────────────────────────────────────────────┐
│                  Next.js API Routes & Server Actions               │
│  /api/* (route.ts) — HTTP handlers for notifications, devices      │
│  Server actions — not yet structured as separate files             │
└───────────────────────┬────────────────────────────────────────────┘
                        │
┌───────────────────────┴────────────────────────────────────────────┐
│                     Supabase RPC Layer                              │
│  browse_feed_for_viewer() — keyset-paginated feed                 │
│  post_night() — create dated instance + locks                      │
│  record_swipe() — track like/pass decisions                        │
│  match_* RPCs — offer/accept/pass/cancel/withdraw (M2)            │
│  chat_send_message() chat_mark_read() — P7 chat                   │
│  app_match_enabled_self() — flag gate                              │
└───────────────────────┬────────────────────────────────────────────┘
                        │
┌───────────────────────┴────────────────────────────────────────────┐
│              Supabase Edge Functions (Deno)                         │
│  `supabase/functions/` — async, definer-scoped, webhook handlers   │
│  generate-plan, match-*, chat-*, verify-*, process-jobs            │
└───────────────────────┬────────────────────────────────────────────┘
                        │
┌───────────────────────┴────────────────────────────────────────────┐
│            Supabase PostgreSQL Database                             │
│  Tables: profiles | date_instances | offers | locks | chat_threads │
│  Auth: Supabase Auth (OAuth + magic link)                          │
│  Storage: profile-photos, ambient-sounds (public bucket)           │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| App Router Pages | Entry point per route; fetch data via RLS client; render UI server-side | `apps/web/app/[route]/page.tsx` |
| React Components | UI presentation; client-side interactivity (swipes, modals, forms) | `apps/web/components/*.tsx` |
| Server Actions | NOT YET USED — future abstraction for form submissions | N/A |
| API Routes (HTTP) | Paginated reads (notifications, inbox activity); state mutation (mark-read, device register) | `apps/web/app/api/*/route.ts` |
| Supabase RPCs | Gated DB mutations (offers, locks, chat); feed queries; auth checks | SQL in `supabase/migrations/*.sql` |
| Edge Functions | Long-running ops (plan generation, photo blurring, job dispatch); webhook handlers (Persona, Twilio, Resend) | `supabase/functions/[name]/index.ts` |
| Database Layer | Source-of-truth for profiles, dates, matches, messages; RLS enforces visibility | `supabase/migrations/*.sql` + auth.users |
| API Client Package | Typed Supabase queries (feed, profile, RPC invocation) | `packages/api-client/src/*.ts` |

## Pattern Overview

**Overall:** Three-tier columnar stack — **Request Scope → RLS-Bound Supabase Client → Edge-Definer RPCs + Storage Policies**.

**Key Characteristics:**
- **RLS-First Security:** Every page fetch uses a row-level-security–scoped Supabase client (`createClient()` in `apps/web/lib/supabase/server.ts`). The authenticated browser session cookie automatically binds to `auth.uid()`. No server-side session state.
- **Server-Rendered Data Flow:** Pages are async, fetch data at SSR time via RLS client, and pass immutable props to client components. This avoids race conditions and keeps the server as the security boundary.
- **Definer RPCs for Mutations:** All dating loop writes (match offers, locks, withdrawals) invoke SECURITY DEFINER RPCs that re-check `auth.uid()` and emit notifications to counterparts. The RPC is the atomic transaction boundary.
- **Edge Functions for Side Effects:** Generation, photo processing, verification, and email dispatch run in edge functions. They read/write via admin client (service-role key) and can be retried safely via the `process-jobs` cron job.
- **Idempotency Ledger:** Critical RPCs store their results in `transition_idempotency` so a client-side retry with the same `p_idem_key` UUID returns the first result, preventing double-writes.

## Layers

**Presentation (App Router + React):**
- Purpose: Render SSR HTML; hydrate for client interactivity (swipes, modals, forms).
- Location: `apps/web/app/` (pages) and `apps/web/components/` (reusable UI).
- Contains: Page files (`.tsx`), layout trees, client components with Framer Motion / Sonner / Vaul.
- Depends on: Supabase RLS client for SSR reads; fetch() for API route calls; @after5/api-client for typed queries.
- Used by: Browsers; served by Next.js App Router.

**Orchestration (API Routes + Next.js):**
- Purpose: Handle HTTP requests that need pagination, pagination state, or are too large for RPC responses.
- Location: `apps/web/app/api/*/route.ts` (GET/POST handlers); auth handlers at `apps/web/app/auth/*/route.ts`.
- Contains: Request parsing, pagination logic, RLS client invocation, response marshaling.
- Depends on: Supabase RLS client; request/response Next.js APIs.
- Used by: Client components (fetch); external webhooks (POST /api/...); pre-OAuth callbacks.

**Data Access (Supabase API Client):**
- Purpose: Typed wrapper for Supabase operations; re-exported by `@after5/api-client`.
- Location: `packages/api-client/src/` (feed, profile, RPC stubs).
- Contains: Query builders, RPC signatures, types imported from `@after5/types`.
- Depends on: `@supabase/supabase-js`; `@after5/types` (generated from remote schema).
- Used by: Pages, API routes, edge functions.

**Backend Services (Supabase RPCs + Edge Functions):**
- Purpose: Database mutations, long-running async work, webhook handlers.
- Location: SQL in `supabase/migrations/` (RPC defs); Deno in `supabase/functions/` (edge functions).
- Contains: SECURITY DEFINER RPCs, event dispatch, job handlers, photo processing.
- Depends on: Supabase PostgreSQL; external APIs (Google Places, Persona, Twilio, Resend).
- Used by: Pages, API routes, other RPCs, cron jobs, webhooks.

**Database + Auth (Supabase):**
- Purpose: Single source of truth; RLS enforces visibility; Supabase Auth manages sessions.
- Location: `supabase/migrations/` (schema + RLS policies); `supabase/config.toml` (project config).
- Contains: Tables (profiles, date_instances, offers, locks, chat_threads, notifications); Auth users; Storage policies.
- Depends on: PostgreSQL; Supabase realtime (for chat).
- Used by: All layers (via RLS-bound client or admin client).

## Data Flow

### Primary Request Path: Browse Feed → Match → Reveal → Chat → Complete

1. **Page Load /feed** (`apps/web/app/feed/page.tsx`)
   - SSR getUser() → RLS client verifies `auth.uid()` is authenticated and `profiles.dating_enabled=true`.
   - Call `browseFeed()` via `@after5/api-client` → invokes RPC `browse_feed_for_viewer(p_after_starts, p_after_id, p_limit)`.
   - RPC applies keyset-pagination; returns feed of FeedNight objects (date_instance_id, title, vibe_tags, cover_image_url, ambient_sound_path, distance_m).
   - Pass FeedNight[] to SwipeDeck client component; component is marked 'use client'.

2. **User Swipes Right on a Night** (`apps/web/app/feed/SwipeDeck.tsx` — client)
   - Client calls `recordSwipe(instanceId, 'right')` → RPC `record_swipe(p_instance, p_direction)` inserts a swipe row.
   - On match (creator has also swiped right), the RPC emits a **notification** to the creator.
   - UI updates to show next night or "no more" state (infinite scroll with cursor pagination).

3. **Creator Sees Candidate's Swipe (Offer Created)** → Edge function `match-make-offer`
   - Process-jobs cron finds pending swipes; for each pair, invokes `match-make-offer` edge function.
   - Function creates an **offer** row with `status='active'` and sets `expires_at`.
   - Emits **new_offer** notification to candidate; optionally sends email via Resend.

4. **Candidate Sees Offer in /inbox or /dates** (`apps/web/app/inbox/page.tsx`)
   - SSR reads RLS-bound notifications table, groups by offer id, renders ActivityList.
   - Candidate taps "view offer" → routes to `/offers/[offerId]`.
   - Page loads offer + creator profile (with blurred photo until lock); renders accept/pass buttons.

5. **Candidate Accepts Offer** → Edge function `match-accept-offer`
   - Client calls match RPC `match_accept_offer(p_actor, p_offer, p_idem_key)`.
   - RPC creates a **lock** row (date_instance_id, creator_id, matched_user_id) + lock_participants rows.
   - RPC emits **offer_accepted** notification to creator.
   - RPC auto-creates a **chat_thread** row with state='open'.

6. **Lock → Identity Reveal** (`apps/web/app/matches/[lockId]/page.tsx`)
   - Page SSR reads lock + all FK embeds (creator profile, matched profile, date_instance).
   - M6 flow: fetch counterpart's `profile_photos` rows; sign clear URLs; render photo gallery.
   - Creator sees candidate's full profile + rating window.
   - Candidate sees creator's full profile + ratings from creator.

7. **In-App Chat** (`apps/web/app/inbox/[threadId]/page.tsx`)
   - SSR loads chat_threads row + FK (offers.creator, offers.candidate, date_instance).
   - RLS chat_threads_party_read scopes to both parties.
   - Client component is messageable; calls RPC `chat_send_message(p_actor, p_thread, p_body, p_idem_key)`.
   - RPC inserts message, recomputes `both_ready` flag, emits **new_message** notification to other party.

8. **Post-Lock Completion** → Rating Page (`apps/web/app/matches/[lockId]/rate/page.tsx`)
   - After lock's starts_at time passes, rating_window opens (7 days post-date).
   - Users rate each other; RPC writes to ratings table.
   - Creator can mark as no-show; RPC updates lock_status.

### Secondary Flow: Create and Host a Night

1. **User navigates /create/page** → chooses "use AI" or "start from scratch".
   - AI path invokes `generate-plan` edge function (calls Claude, Google Places, templates).
   - Scratch path calls RPC `create_blank_itinerary()` to seed an empty itinerary + one blank stop.

2. **User edits itinerary** → calls RPC `update_itinerary_stops(p_itinerary, p_stops[])`.
   - RPC validates stops (places exist, cost/time sane), upserts `stops` JSONB.

3. **User posts a date instance** → clicks "post to dates" on `/create/[id]`.
   - Calls RPC `post_night(p_itinerary, p_starts_at, p_venue, p_duration_min, p_ambient_sound_id)`.
   - RPC creates a date_instance, links to itinerary, sets status='seeking', stores ambient_sound pick.
   - Instance is immediately visible in the feed (browse_feed_for_viewer) to eligible candidates.

### Tertiary Flow: Admin & Moderation (Future S8/S9/S10)

- Admins read `/admin/` pages (RLS-gated to admin role).
- Admin-only RPCs: `admin_force_expire_offer()`, `admin_force_cancel_lock()`.
- Stored in migrations; not yet deployed to prod.

**State Management:**
- **Ephemeral Client State:** React hooks (useSwipes, useFilter, useChatScroll) + Zustand or React Context (not yet visible in codebase).
- **Persistent Server State:** Supabase database tables + auth.users. Every mutation is atomic via RPC or edge function.
- **Cache:** No explicit caching layer yet. Supabase client caches fetch results per-request scope; pages invalidate on navigation.
- **Notifications:** Rows in `notifications` table; UI polls `/api/notifications` via GET or listens on realtime channel.

## Key Abstractions

**FeedNight:**
- Purpose: Lightweight row-like object returned by `browse_feed_for_viewer()` RPC; omits creator profile (blind feed).
- Examples: Defined in `packages/api-client/src/feed.ts`.
- Pattern: JSON-serializable; includes distance_m, vibe_tags, ambient_sound_path for UI rendering.

**Lock (with Parties):**
- Purpose: A matched pair on a date instance. Embeds creator + matched profiles + date_instance for full context.
- Examples: Loaded in `/matches/[lockId]` by selecting with FK hints.
- Pattern: RLS ensures only creator or matched_user can read; includes rating_closed_at for window state.

**Offer:**
- Purpose: Unilateral interest in a date instance; expires after 48h or on candidate decision.
- Examples: Created by edge function; read via `/api/offers/[id]` or notifications.
- Pattern: Stateful (active → accepted/passed/expired); idempotent via transition_idempotency.

**Chat Thread:**
- Purpose: One-to-one messaging conduit; pinned to an offer; survives lock.
- Examples: Created on offer acceptance; state='open' until revoked_at is set.
- Pattern: RLS chat_threads_party_read scopes to both parties; messages table links thread → sender.

**Notification:**
- Purpose: Async event log; typed by `type` enum (new_offer, offer_accepted, new_message, etc.).
- Examples: Emitted by match RPCs via `dispatch_notification(user_id, type, payload)`.
- Pattern: Keyset-paginated in `/api/notifications`; grouped by offer_id in inbox.

**Ambient Sound:**
- Purpose: Optional soundtrack curated library entry (vibe-tagged, host-selectable).
- Examples: Loaded server-side on `/create` page; picker in post-night workflow.
- Pattern: Storage path; vibe_tags matched to itinerary vibes.

## Entry Points

**Landing Page (`/`):**
- Location: `apps/web/app/page.tsx`
- Triggers: Cold-start, logged-out user or returning user.
- Responsibilities: Static "how it works" hero, testimonials, CTA to /onboarding.

**Onboarding Flow (`/onboarding`):**
- Location: `apps/web/app/onboarding/page.tsx` (router) + subdirs (age_gate, phone, photo, preferences, verify, basics, done).
- Triggers: New user sign-in or incomplete profile.
- Responsibilities: Progressive disclosure of identity, verification, preferences; writes to profiles_private and profiles.

**Feed Page (`/feed`):**
- Location: `apps/web/app/feed/page.tsx`
- Triggers: Verified user navigating to browse dates.
- Responsibilities: SSR RPC call; keyset-pagination; render SwipeDeck client component.

**Matches Hub (`/matches`):**
- Location: `apps/web/app/matches/page.tsx`
- Triggers: User clicks "Matches" in bottom nav.
- Responsibilities: List active + past locks; bucket by date; link to detail pages.

**Match Detail (`/matches/[lockId]`):**
- Location: `apps/web/app/matches/[lockId]/page.tsx`
- Triggers: User taps a lock row.
- Responsibilities: Load lock + counterpart + photos; render LockDetail; show rating window if open.

**Inbox (`/inbox`):**
- Location: `apps/web/app/inbox/page.tsx`
- Triggers: User clicks "Inbox" in bottom nav.
- Responsibilities: Display activity (grouped notifications) + message threads; SSR seed of top 5 each.

**Message Thread (`/messages/[threadId]`):**
- Location: `apps/web/app/messages/[threadId]/page.tsx`
- Triggers: User taps a thread in inbox.
- Responsibilities: Load thread + messages; SSR seed first page; client-side message send loop.

**Create (Plan) (`/create`):**
- Location: `apps/web/app/create/page.tsx` → `/create/generate/page.tsx` (AI) or blank itinerary edit.
- Triggers: User clicks "Plan a Date" or "Post a Night" in nav.
- Responsibilities: Invoke generate-plan edge function or RPC create_blank_itinerary; render editor.

**My Nights (`/my-nights`):**
- Location: `apps/web/app/my-nights/page.tsx`
- Triggers: User clicks "My Nights" in bottom nav.
- Responsibilities: List user's posted date_instances + status (seeking, locked, completed); draft editor for edits.

**Auth Callback (`/auth/callback`):**
- Location: `apps/web/app/auth/callback/route.ts`
- Triggers: OAuth or magic-link redirect from Supabase.
- Responsibilities: Exchange code for session; mirror to subscribers table; claim anonymously-generated itineraries.

## Architectural Constraints

- **Threading:** Single-threaded event loop (Node.js). Async RPC calls to Supabase; edge functions run in Deno.
- **Global state:** None on app layer. Database is the single source of truth. RLS client is request-scoped.
- **Circular imports:** Checked by TypeScript; monorepo uses path aliases (`@after5/*`) to avoid implicit dependencies.
- **RPC Scope:** Each definer RPC re-checks `auth.uid()` and validates actor. No implicit trust in the caller's claimed identity.
- **Realtime Scope:** Chat uses Supabase realtime for message listen; notifications currently polled (future: realtime subscription).
- **Photo Privacy:** Blurred photos on open offers; clear photos only after lock. Signed URLs prevent public enumeration.
- **Session Scope:** Supabase session cookie (httpOnly, secure) is the auth token. Middleware refreshes it on every request.
- **Timezone:** All dates stored as `timestamptz` (UTC); client localizes on render.

## Anti-Patterns

### N+1 Profile Fetches in Feed

**What happens:** Early versions queried date_instances + manually fetched creator profiles in a loop, instead of using FK hints in the RPC query.

**Why it's wrong:** Waterfalls the feed, turning one RPC into 20+ DB round-trips.

**Do this instead:** `browse_feed_for_viewer()` RPC projects only night metadata (no creator embedded), so client never joins profiles unnecessarily. Profiles appear ONLY after a match (in lock detail or offer view), where they are FK-hinted in a single query.

### Storing Sensitive Data in Client Props

**What happens:** Early drafts passed full user profiles (including birthdate, emergency_contact) to client components.

**Why it's wrong:** Leaks sensitive data to the browser; violates PIPEDA.

**Do this instead:** Use `profiles_private` table (with restricted column grants on authenticated role) for sensitive data. Pages read via SSR, derive display values (first_name, age, vibe_tags), and pass only those to client.

### RLS Bypass via Admin Client in Pages

**What happens:** A page tries to use `createAdminClient()` to read data unrestricted.

**Why it's wrong:** Admin client has service-role key; if leaked, it can read all data regardless of RLS. Pages should use RLS-bound client only.

**Do this instead:** RPC calls inside edge functions use admin client (edge functions don't have direct browser access). Pages use RLS client. Admin routes (future) use admin client + explicit role checks in page code.

### Missing Idempotency on Retried Mutations

**What happens:** A match RPC called twice with the same parameters creates two offers/locks.

**Why it's wrong:** Race conditions on slow networks; double notifications sent.

**Do this instead:** All match RPCs accept `p_idem_key` (a UUID the client generates once). RPC stores result in transition_idempotency. A retried call with the same key returns the first result.

### Unvalidated Timestamps in Edge Functions

**What happens:** An edge function receives a `starts_at` from the client, trusts it, and creates a date_instance in the past.

**Why it's wrong:** Users can post dates retroactively, breaking the feed's temporal ordering.

**Do this instead:** `post_night()` RPC validates that `p_starts_at > now() + interval '1 hour'` before creating the instance.

## Error Handling

**Strategy:** Progressive disclosure + clear UX fallbacks.

**Patterns:**
- RPC errors (validation, permission, state) return structured error codes (P5001 auth_mismatch, P5010 chat_not_party, etc.).
- Page errors (SSR failures) log to server; render a user-facing error page or redirect to safe fallback (e.g., /login if unauthenticated).
- Edge function errors (generate-plan, photo processing) are stored in audit_log for debugging; UI shows "try again later" or fallback value.
- API route errors return JSON error + HTTP status; client shows toast (Sonner).
- Network timeouts trigger exponential backoff in client + local optimistic updates where safe (e.g., message send).

## Cross-Cutting Concerns

**Logging:** 
- Console.log in edges and pages; captured by Supabase logs and Vercel.
- Errors logged with context (user_id, action, timestamp) to aid debugging.
- No structured logging framework yet; future: consider structured logs (JSON) for prod analytics.

**Validation:**
- Input schemas defined in `@after5/validators` (Zod).
- Pages validate via Supabase RLS (RLS policies are the source of truth).
- Edge functions validate critical inputs before calling admin RPC.

**Authentication:**
- Supabase Auth handles OAuth (Google, etc.) + magic-link sign-in.
- Session cookie (httpOnly) set on /auth/callback; middleware refreshes.
- RPC definer functions re-check `auth.uid()` for extra safety.

**Authorization:**
- RLS policies on every table enforce visibility (e.g., locks_party_read restricts to creator or matched_user).
- Admin tables / routes use role checks (future, S8+).
- Photos: blurred until lock; clear only after lock (policy on profiles_photos storage).

---

*Architecture analysis: 2026-06-03*
