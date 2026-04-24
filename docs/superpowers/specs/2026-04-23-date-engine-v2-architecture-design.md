# After5 Date Engine v2 — Architecture Design

**Date:** 2026-04-23
**Status:** Draft v2 — reviewer feedback addressed (15 issues), pending re-review
**Author:** Lucas Senechal (w/ Claude)
**Related research:**
- `.planning/research/date-engine-v2/01-current-system-audit.md`
- `.planning/research/date-engine-v2/02-venue-pipeline-research.md`

---

## 1. Executive Summary

After5 v1 is a Kelowna-only, hand-curated date planner with ~170 venues and a single-city codebase. Its generator is architecturally strong (LLM-never-picks-places keeps hallucinations structurally impossible), but the product ceiling is capped by data quality (~80% of venues have no photos, hours often stale, no real-time vetting, no feedback loop wired). This document defines the v2 architecture that unblocks multi-city scale and prepares the platform for its long-term direction — a dating product where users swipe on dates rather than on people.

**Strategic reframe:** After5 is not a date planner that may later add dating features. It is a dating app whose content object is a date plan. Every v2 design decision assumes that long-term truth.

**The v2 effort is organized as nine subsystems executed across ten phases (Phases 0–8 + mobile launch at 7.5), over an estimated 9–12 months of solo-founder work.** Option B (credibility-first) sequencing starts with fixing image quality before any new feature ships.

---

## 2. Strategic Pillars

Eight decisions made during brainstorming that constrain every design choice downstream.

| # | Pillar | Decision |
|---|---|---|
| 1 | **Trust tier** | 4-tier ladder (discovered → contacted → claimed → verified_partner) with a **capped multiplicative score bias (+10% max)** for partner venues in generation. Bias is floored by the top-decile quality threshold (see Invariant 7b) — a low-quality partner can never beat a top-decile non-partner. Outreach is the primary advancement mechanism; admin can override with required reason + audit log. |
| 2 | **User-date visibility** | Social by default — all generated dates are public unless marked private. A separate explicit "find match" toggle gates the swipe queue. Two orthogonal axes: `visibility` and `match_status`. |
| 3 | **Moderation** | Light until abuse materializes — LLM safety screen on publish + email/phone verification gates find-match + report/block system. No ID verification in v2. |
| 4 | **Multi-city** | Hooks-ready on day one — `cities` table, `city_id` foreign keys, per-city config (voice, aesthetic, clusters). Kelowna-only live; city #2 becomes a data-import job, not a refactor. |
| 5 | **Outreach** | AI-drafted + human-approved queue in Phase 1. Proven templates graduate to auto-send. Outreach doubles as data vetting (responses = data verification, partner acquisition, discount codes). |
| 6 | **Match mechanic** | Mutual swipe (either party can decline) + batch review queue for creators ("3 people swiped on your Mission Hill date"). Combines Tinder-familiar mechanics with a curator feel for creators. |
| 7 | **Post-match** | Light-touch — chat opens, day-of reminder, 24h post-date rating prompt. The rating feedback loop is the single largest quality lever in the product. |
| 8 | **Author hints** | Blurred photo + first name + age + payment preference + vibe tags on the swipe card. Full profile reveal only after confirmed match. Plan-forward, person-hinted. |

---

## 3. Architecture Overview

**Hub-and-spoke with Supabase Postgres at the center. Every subsystem reads and writes through the database; no direct service-to-service calls.**

```
                    ┌────────────────────────────────────┐
                    │   Supabase Postgres (the HUB)      │
                    │   • auth (with Apple/Google/phone) │
                    │   • storage (image source of truth)│
                    │   • realtime (chat, notifications) │
                    │   • pgvector HNSW (semantic search)│
                    │   • events table (append-only log) │
                    │   • feed_cache (denormalized)      │
                    └────┬──────────────┬────────────┬───┘
                         │              │            │
                 ┌───────┴───────┐      │            │
                 │ Supabase Edge │      │            │
                 │ Functions     │      │            │
                 │ (Deno, <150s) │      │            │
                 └───────┬───────┘      │            │
                         │              │            │
       ┌─────────────────┴──┐           │            │
       │                    │           │            │
┌──────┴──────┐    ┌────────┴────┐     │            │
│  Vercel     │    │   Mobile    │     │            │
│  Next.js    │    │   (Expo:    │     │            │
│             │    │   iOS + And)│     │            │
│ • user web  │    │             │     │            │
│ • /admin    │    │ • user UX   │     │            │
│   (Phase 0-4)│   │   + swipe   │     │            │
│ • admin.*   │    │ • reuses    │     │            │
│   (Phase 5+)│    │   auth +    │     │            │
│             │    │   edge fns  │     │            │
└─────────────┘    └─────────────┘     │            │
                                   ┌───┴──────────┐ │
                                   │   Inngest    │ │
                                   │ (async jobs) │ │
                                   │              │ │
                                   │ • ingest     │ │
                                   │ • vetting    │ │
                                   │ • outreach   │ │
                                   │ • content    │ │
                                   │ • reminders  │ │
                                   │ • feed_cache │ │
                                   │ • budget     │ │
                                   │   circuit    │ │
                                   │   breaker    │ │
                                   └──────┬───────┘ │
                                          │         │
              ┌───────────────────────────┼─────────┤
              ▼                           ▼         ▼
       ┌──────────────┐         ┌──────────────┐  ┌──────────────┐
       │ Replicate    │         │ Cloudflare   │  │ Claude API   │
       │ (FLUX image  │         │ Images       │  │ (Sonnet prose│
       │  + video)    │         │ (CDN + xforms│  │  Haiku triage│
       └──────────────┘         └──────────────┘  │  Vision)     │
                                                  └──────────────┘
       ┌──────────────┐         ┌──────────────┐  ┌──────────────┐
       │ ElevenLabs   │         │ Runway /     │  │ Remotion     │
       │ (brand voice)│         │ Kling /      │  │ Lambda       │
       └──────────────┘         │ Sora 2 (vid) │  │ (MP4 render) │
                                └──────────────┘  └──────────────┘
       ┌──────────────┐         ┌──────────────┐  ┌──────────────┐
       │ Google Places│         │ Firecrawl    │  │ Resend       │
       │ (live enrich │         │ (scraping)   │  │ (outreach    │
       │  only)       │         │              │  │  email)      │
       └──────────────┘         └──────────────┘  └──────────────┘
       ┌──────────────┐         ┌──────────────┐  ┌──────────────┐
       │ Overture +   │         │ Ticketmaster │  │ TikTok / IG /│
       │ Foursquare OS│         │ + SeatGeek   │  │ YouTube APIs │
       │ (bulk seed)  │         │ (events)     │  │ (content     │
       │              │         │              │  │  posting)    │
       └──────────────┘         └──────────────┘  └──────────────┘
```

**Execution runtime boundaries (important — different runtimes have different limits):**

| Runtime | Time limit | What runs here | What does NOT |
|---|---|---|---|
| **Next.js / Vercel** | 60s hobby / 300s pro | UI routes, auth callbacks, thin API proxies | Long-running jobs, expensive AI |
| **Supabase Edge Functions (Deno)** | **150s wall clock** | `generate-plan` (sub-150s LLM + DB work), lightweight webhooks, RLS-aware CRUD, client-driven Inngest triggers | FLUX generation (>150s), Remotion render (10+ min), DuckDB bulk queries, multi-step ingestion |
| **Inngest** | 2h per step soft cap; workflow can span days | All multi-step / retry-prone work. Each step can call out to external APIs; steps are independently retryable. Inngest orchestrates but doesn't execute long compute itself. | In-line user-request processing where <150s is enough |
| **External async APIs** (Replicate, Runway, Remotion Lambda) | Their SLA | Long compute (image gen, video render). Inngest waits via polling or `step.waitForEvent` when webhook available. | — |

**The pattern:** Inngest steps are short (<30s) orchestration calls. When a step needs expensive compute, it kicks off an external job (Replicate, Remotion Lambda) and either polls or listens for completion. This keeps Inngest infrastructure cheap and makes failures retryable at the step level.

**Explicit non-choices:**
- No Railway / Fly / Kubernetes — Supabase + Vercel + Inngest covers the needs at planned scale
- No Modal — Claude vision handles image scoring; add Modal only if quality or volume demands
- No dedicated search infrastructure — pgvector + Postgres FTS is enough for v2 scale
- No message queue infrastructure — Inngest handles event semantics
- No microservices — one Postgres, one codebase (until Phase 5 admin split)

---

## 4. Schema

Organized by subsystem. Key columns and relationships only; exact DDL lives in migration files.

### 4.1 Cities & geography

**`cities`** *(new)*

```
id                    uuid pk
slug                  text unique         -- "kelowna", "vancouver"
name                  text
country               text                -- "CA"
region                text                -- "BC"
timezone              text                -- "America/Vancouver"
centroid              geography(Point)
bounding_box          geography(Polygon, nullable)
default_radius_km     int
is_active             bool                -- flip true to launch city
voice_hints           jsonb nullable      -- LLM prompt additions per city
cover_aesthetic       jsonb nullable      -- FLUX style per city
drive_cluster_map     jsonb nullable
created_at, updated_at
```

### 4.2 Venue layer

**`places`** *(extended existing)*

```
-- existing columns preserved
-- new columns:
city_id               uuid fk cities
trust_tier            text enum           -- discovered|contacted|claimed|verified_partner
contact_confirmed_at  timestamptz nullable
partner_since         timestamptz nullable
primary_photo_id      uuid fk place_photos nullable
placekey              text nullable
google_place_id       text nullable
fsq_place_id          text nullable
overture_id           text nullable
business_status       text enum           -- operational|temporarily_closed|permanently_closed|unknown
business_status_checked_at  timestamptz
staleness_score       float               -- computed nightly
quality_score         float               -- derived from events (existing column, now event-sourced)
completion_score      float               -- from did-it-happen ratings (new, event-sourced)
venue_embedding       vector(1536) nullable  -- OpenAI text-embedding-3-small; regenerated nightly or on attribute change; pgvector HNSW index
llm_attributed        bool                -- true if type/vibe_tags/price_tier came from LLM ingestion and not yet verified
```

**`place_photos`** *(new)*

```
id                    uuid pk
place_id              uuid fk places
url                   text
source                text enum           -- og_image|scraped|ai_generated|user_upload|seed|unsplash|pexels
aesthetic_score       float               -- 0-10, from Claude vision
relevance_score       float               -- 0-1, CLIP similarity
claude_vibe_verdict   jsonb               -- vision API output
photo_time_of_day     text nullable
photo_season          text nullable
photo_has_snow        bool
is_primary            bool
created_at, last_verified_at
```

*Invariant:* `places.primary_photo_id` may only reference rows with `aesthetic_score >= 6.0` (CHECK constraint enforced by trigger).

*Licensing note:* **Google Places photos are NOT persisted** in `place_photos`. Their `photoUri` expires and Google's TOS forbids caching or re-hosting. Google Places photos are fetched **live at display time** using the stored `places.google_place_id`, rendered with mandatory `authorAttributions` when present. Our `place_photos` rows are the source of truth for photos we own or have redisplayable rights to (og:image scrapes, Unsplash/Pexels with attribution, AI-generated, user uploads).

### 4.3 User layer

**`profiles`** *(extended existing — public, visible to all authenticated users)*

```
-- existing columns preserved
-- new columns:
first_name            text
age                   int
payment_preference    text enum           -- full|half|none
vibe_tags             text[]
age_preferences       int4range
gender_preferences    text[]
blurred_photo_url     text
clear_photo_url       text                -- RLS-gated to matched users
trust_level           int                 -- 0=new, 1=normal, 2=trusted, -1=flagged
primary_city_id       uuid fk cities
creator_score         float               -- derived from date ratings
```

**`profiles_private`** *(new — owner-only RLS)*

```
user_id               uuid pk fk profiles
full_name             text
email                 text
phone                 text
birthdate             date
bio                   text nullable
instagram_handle      text nullable
email_verified        bool
phone_verified        bool
```

**`devices`** *(new — for mobile push)*

```
id                    uuid pk
user_id               uuid fk profiles
platform              text enum           -- ios|android|web
token                 text                -- APNs / FCM / Web Push endpoint
registered_at, last_seen_at
is_active             bool
```

### 4.4 Plan/itinerary layer

**`itineraries`** *(extended existing)*

```
-- existing columns preserved
-- new columns:
city_id               uuid fk cities
visibility            text enum           -- public|unlisted|private (default public)
match_status          text enum           -- none|seeking|matched|completed (default none)
match_seeking_since   timestamptz nullable
social_score          int                 -- 0-10, LLM quality for content pipeline
moderation_status     text enum           -- pending|approved|flagged|rejected
context_embedding     vector(1536) nullable  -- for semantic feed ranking ("cozy wine bar" → matches); pgvector HNSW index
```

### 4.5 Dating layer

**`swipes`** *(new)*

```
id                    uuid pk
swiper_id             uuid fk profiles
itinerary_id          uuid fk itineraries
creator_id            uuid fk profiles    -- denormalized for query efficiency
direction             text enum           -- right|left
status                text enum           -- pending|approved|declined|expired (pending right only)
created_at
expires_at            timestamptz         -- default now() + interval '30 days'
```

**`matches`** *(new)*

```
id                    uuid pk
itinerary_id          uuid fk itineraries
creator_id            uuid fk profiles
matched_user_id       uuid fk profiles
matched_at            timestamptz
state                 text enum           -- confirmed|reminded|completed|cancelled|ghosted
scheduled_for         timestamptz         -- the actual date time
chat_channel_id       text                -- Supabase Realtime channel

unique (itinerary_id, matched_user_id)
index (itinerary_id, matched_user_id)
index (creator_id, state)
```

*Advisory lock pattern for race-free match creation:* `pg_advisory_xact_lock(hashtext('match:' || itinerary_id::text || ':' || swiper_id::text))` wraps the insert, preventing double-match on simultaneous creator-approval clicks.

**`match_ratings`** *(new — the feedback-loop crown jewel)*

```
id                    uuid pk
match_id              uuid fk matches
user_id               uuid fk profiles
did_it_happen         bool
date_rating           int nullable        -- 1-5
person_rating         int nullable        -- 1-5
would_repeat_date     bool
would_repeat_person   bool
free_text             text nullable
created_at
```

### 4.6 Moderation layer

**`reports`** *(new)*

```
id                    uuid pk
reporter_id           uuid fk profiles
target_type           text enum           -- user|itinerary|message
target_id             uuid
reason                text enum
details               text
status                text enum           -- open|actioned|dismissed
actioned_by           uuid nullable
actioned_at           timestamptz nullable
resolution            text nullable
```

### 4.7 Signal capture — the quality lever

**`events`** *(new — append-only)*

```
id                    bigserial pk
event_type            text                -- "swipe.right", "match.created", "date.rated", etc.
actor_id              uuid nullable
subject_type          text
subject_id            text
payload               jsonb
created_at            timestamptz

indexes:
  (event_type, created_at DESC)
  (actor_id, created_at DESC)
```

*Invariant:* Trigger rejects UPDATE and DELETE **except** from the service-role RPC `erase_user_data(user_id)`, which satisfies GDPR/PIPEDA deletion rights. The erasure path nullifies `actor_id` and redacts PII fields in `payload` rather than removing rows (preserves aggregate signal integrity). Each erasure is logged to `events_erasure_log`.

**`events_erasure_log`** *(new — GDPR/PIPEDA audit trail for erasure operations)*

```
id                    bigserial pk
user_id               uuid                -- the user whose data was erased
requested_at          timestamptz
requested_by          uuid nullable       -- admin or the user themselves (self-service)
events_modified_count int                 -- how many rows scrubbed
fields_redacted       text[]              -- which payload keys were redacted
reason                text                -- "user_request" | "gdpr_dsar" | "admin_action"
```

**`feed_cache`** *(new — denormalized swipe feed)*

```
user_id               uuid fk profiles
itinerary_id          uuid fk itineraries
score                 float
reason                jsonb               -- why this was ranked here (debuggability)
computed_at           timestamptz
expires_at            timestamptz
primary key (user_id, itinerary_id)
index (user_id, score DESC)
```

### 4.8 Outreach & partnerships

**`outreach_templates`** *(new)*

```
id                    uuid pk
name                  text
channel               text enum           -- email|sms|dm
subject_template      text
body_template         text                -- mustache-style with venue fields
target_trust_tier     text
conversion_rate       float               -- updated from response data
is_active             bool
```

**`outreach_targets`** *(new — the queue)*

```
id                    uuid pk
place_id              uuid fk places
channel               text
assigned_template_id  uuid fk outreach_templates
priority              int                 -- higher = sooner
status                text enum           -- queued|drafted|approved|sent|responded|bounced|opted_out
scheduled_for         timestamptz nullable
sent_at               timestamptz nullable
responded_at          timestamptz nullable
```

**`outreach_messages`** *(new — AI drafts)*

```
id                    uuid pk
target_id             uuid fk outreach_targets
draft_subject         text
draft_body            text
ai_reasoning          jsonb               -- why this template/personalization
reviewed_by           uuid nullable
reviewed_at           timestamptz nullable
edits_made            bool
sent_at               timestamptz nullable
resend_message_id     text nullable       -- for webhook correlation
response_status       text enum           -- none|opened|replied|bounced|unsubscribed
```

**`partnerships`** *(new)*

```
place_id              uuid pk fk places
claimed_by_user_id    uuid fk profiles
discount_code         text nullable
discount_description  text nullable
claimed_at            timestamptz
last_updated_at       timestamptz
status                text
```

### 4.9 Social content pipeline

**`social_post_candidates`** *(new)*

```
id                    uuid pk
itinerary_id          uuid fk itineraries
social_score          int
content_tier          text enum           -- tier_1_authentic|tier_2_hybrid|tier_3_cinematic
script                jsonb               -- scene-by-scene breakdown
voiceover_url         text nullable
voiceover_script      text nullable
voiceover_model       text nullable
visual_plan           jsonb               -- per-scene assets + prompts
render_status         text enum           -- planning|generating_assets|composing|rendered|approved|posted|failed
render_url            text nullable       -- final MP4 in CF Images
thumbnail_url         text nullable
platform_variants     jsonb               -- 9:16 / 1:1 / 2:3 per-platform URLs
status                text enum           -- drafted|approved|posted|skipped
scheduled_for         timestamptz nullable
posted_to             jsonb nullable      -- platforms + post IDs
```

**`social_post_assets`** *(new — individual clips/images)*

```
id                    uuid pk
candidate_id          uuid fk social_post_candidates
scene_index           int
asset_type            text enum           -- image|clip|voiceover|music
provider              text                -- runway|kling|elevenlabs|photo_library|flux
provider_job_id       text nullable
cost_usd              numeric
url                   text
duration_seconds      float nullable
created_at
```

**`social_posts`** *(new — published posts)*

```
id                    uuid pk
candidate_id          uuid fk social_post_candidates
platform              text enum           -- instagram|tiktok|youtube|pinterest|threads
platform_post_id      text
posted_at             timestamptz
impressions           int
engagement            jsonb
```

### 4.10 Infrastructure

**`notifications`** *(new — delivery log)*

```
id                    uuid pk
user_id               uuid fk profiles
type                  text enum           -- match|swipe|reminder|rating_prompt|moderation|outreach_response
payload               jsonb
sent_via              text enum           -- push_ios|push_android|web_push|email
sent_at               timestamptz
delivered             bool
opened_at             timestamptz nullable
clicked_at            timestamptz nullable
```

**`feature_flags`** *(new — simple)*

```
key                   text pk
enabled               bool
config                jsonb nullable
updated_at
```

**`monthly_budget`** *(new — circuit breaker config, atomically-updated)*

```
service               text
month                 date                -- first of month
budget_usd            numeric
spent_usd             numeric             -- atomically incremented via UPDATE ... RETURNING
alert_at_pct          numeric             -- default 0.75
hard_stop_at_pct      numeric             -- default 1.0
primary key (service, month)
```

**`monthly_budget_events`** *(new — per-call cost ledger, idempotent)*

```
id                    uuid pk
service               text
month                 date
workflow_run_id       text                -- Inngest run id for idempotency
model                 text nullable       -- "claude-sonnet-4-6", "flux-1.1-pro", etc.
cost_usd              numeric
tokens_input          int nullable
tokens_output         int nullable
recorded_at           timestamptz
unique (workflow_run_id, service)         -- idempotency: same workflow retry does not double-charge
```

*Pricing source of truth:* A static `service_pricing.ts` module keyed by `(service, model, unit_type)` returns the rate per unit. Updated on provider price changes. Pre-call estimation uses this to compute `estimated_cost` for the atomic reservation in `reserveBudget()`.

### 4.11 Chat

**`chat_messages`** *(new — direct messaging within matches)*

```
id                    uuid pk
match_id              uuid fk matches
sender_id             uuid fk profiles
body                  text
attachments           jsonb nullable      -- future: image uploads, venue links
created_at            timestamptz
deleted_at            timestamptz nullable -- soft delete; user deletes own messages
flagged_at            timestamptz nullable
flag_reason           text nullable       -- set by moderation system
moderation_status     text enum           -- clean|flagged|removed (default clean)
index (match_id, created_at DESC)
```

*RLS:* Users in the match may SELECT; sender may INSERT/UPDATE their own (for soft-delete); admin may UPDATE moderation fields. Realtime channel is keyed `match_${match_id}` with subscription authorization checking membership in `matches`.

*Retention:* Messages persist for 90 days past `matches.state = 'completed' | 'cancelled' | 'ghosted'`, then archived to cold storage. Reports on messages lock them from expiry until resolved.

*Moderation integration:* A user report on a message writes to `reports` with `target_type='message'` + `target_id=chat_messages.id`. The moderation classifier scans messages async in batches (not inline, to keep chat latency low).

---

## 5. Subsystem Breakdown

Nine subsystems, each with clear boundaries. Subsystems communicate through the database, never directly.

### 5.1 Mobile Foundation *(Phase 0)*
**Purpose:** Future-proof for mobile without building the apps yet.

**Owns:** `devices`, `notifications` tables. Auth providers. Cloudflare Images.

**Workflows:**
- Auth provider registration (Apple, Google, Phone OTP, Email)
- Device registration/refresh (mobile apps call on app start)
- Notification router: `notification.dispatch(user_id, type, payload)` → fans out to APNs/FCM/web push/email

**Key decision:** Notifications event-driven. Any subsystem can emit dispatch events.

### 5.2 Image Enrichment Pipeline *(Phase 1)*
**Purpose:** Every venue has at least one aesthetic photo with `aesthetic_score >= 6.0`.

**Owns:** `place_photos` table. Supabase Storage + Cloudflare Images integration.

**Workflow (per place, Inngest):**
1. Scrape candidate from venue website og:image (or Unsplash/Pexels fallback with attribution). **Google Places photos are NOT ingested here** — they're fetched live at display time only, per Google's caching restrictions.
2. Score (tech check → Claude vision aesthetic + CLIP relevance)
3. Classify (time_of_day, season, has_snow)
4. Regenerate if `score < 6.0` (FLUX 1.1 Pro with grounded prompt → Sharp post-process: warm tint + film grain + vignette)
5. Re-score generated photo
6. Upload to Supabase Storage, serve via Cloudflare Images; set as `places.primary_photo_id`

**Key invariant:** A place can't appear in generated plans without a photo meeting the threshold.

**Display-time Google Places photos** (separate path): When rendering a venue detail view, if the place has `google_place_id`, an edge function fetches fresh `photoUri`s from the Google Places API, returns them to the client with the required `authorAttributions`. Nothing persisted. Covered by the budget circuit breaker.

### 5.3 Multi-City Infrastructure + Generator Evolution *(Phase 2)*
**Purpose:** Remove Kelowna hardcoding; wire feedback loop.

**Owns:** `cities`, `events`, `feed_cache` tables.

**Workflows:**
- City bootstrap — seed `kelowna` row, extract constants, pass `city_id` through generate-plan
- Event ingestion — every user action writes to `events`
- Nightly derivation — recomputes `places.quality_score`, `profiles.creator_score`, etc. from events
- Feed cache worker — per-user feed recomputed every ~5 min

**Key decision:** `events` is the single source of truth for all derived scores.

### 5.4 Venue Ingestion Pipeline *(Phase 3)*
**Purpose:** Bulk-seed cities; keep inventory growing.

**Owns:** Bulk import workflows; external ID reconciliation.

**Workflows:**
1. Bulk seed (city launch): Overture + FSQ OS → DuckDB query bounded to city bbox → Placekey derivation → dedupe → insert with `trust_tier=discovered`
2. Enrich (per venue, on-demand): Google Places live fetch → update `google_place_id`, `business_status` (metadata only, no photo ingestion)
3. Auto-categorize: LLM pass (Claude Haiku) over OSM tags → **proposes** `type`, `vibe_tags`, `price_tier` **constrained to enumerated values** (Zod schema validation rejects anything outside the enum). Rows written with `llm_attributed=true`. **Critical safety net:** LLM-attributed rows do NOT enter generator scoring until either (a) a human reviewer verifies them in `/admin/venues/review`, OR (b) batch QA sampling confirms ≥95% accuracy across a random 100-row sample per city. Protects Invariant 5 (LLM-never-picks) from being violated by proxy via contaminated attributes.

### 5.5 Vetting + Outreach + Business Portal *(Phase 4)*
**Purpose:** Keep data fresh; convert venues to partners; collect discount codes.

**Owns:** `outreach_templates`, `outreach_targets`, `outreach_messages`, `partnerships` tables. `/admin/outreach`, `/partners` pages.

**Workflows (vetting):**
- Weekly cron: refresh `business_status` for top-N per city
- Composite staleness score: Google status + website HTTP + review recency + sentiment drift
- Staleness ≥ threshold → enqueue outreach target

**Workflows (outreach):**
- AI drafting (Inngest) — personalized body from venue + template
- Admin review queue (skim/edit/send/skip)
- Resend send + webhook correlation (opens, replies, bounces)
- Response parsing → trust tier advancement

**Workflows (business portal):**
- Magic-link claim flow → creates `partnerships` row → `trust_tier` → `verified_partner`
- Profile edits gated by moderation queue for first-time editors

### 5.6 User-Date Publishing Layer *(Phase 5)*
**Purpose:** Generated dates become social content by default.

**Owns:** Extended `itineraries`; publishing UX; discovery feed.

**Workflows:**
- On generate → auto-insert with `visibility='public'` (unless user toggled private)
- On "find match" toggle → `match_status='seeking'` + moderation check
- Discovery feed at `/discover/[city]` — browseable, sorted by `quality_score + freshness_penalty`
- Save-for-later + share
- LLM `social_score` computation per new date

### 5.7 Social Content Pipeline *(Phase 6)*
**Purpose:** Auto-generate and post per-city TikTok/Reels/Shorts content.

**Owns:** `social_post_candidates`, `social_post_assets`, `social_posts` tables.

**Tiered content model:**
- **Tier 1 (85%):** Real photos (Ken Burns/parallax) + AI voiceover + captions + licensed music. ~$0.15/post.
- **Tier 2 (12%):** Tier 1 + 2-3 Runway/Kling AI clips. ~$1.50/post.
- **Tier 3 (3%):** Full Sora 2 cinematic. ~$8/post. Monthly flagship.

**Tool stack:** Claude Sonnet (script) → ElevenLabs (voice) → [real photos | FLUX | Runway/Kling/Sora 2] → Remotion Lambda (composition) → platform APIs.

**Workflow:**
1. Nightly candidate selection from high-social-score public itineraries
2. Script + voice + visuals generation (parallel)
3. Remotion Lambda composition with auto-captions (Whisper) + music (Epidemic Sound)
4. Per-platform variants (9:16 / 1:1 / 2:3)
5. Admin batch approval
6. Scheduled posting (YouTube Shorts first, then IG Reels, then TikTok pending approval)
7. Analytics ingestion from platform APIs

**Critical dependency:** TikTok Content Posting API + Instagram Graph API approvals must be applied for during Phase 4.

### 5.8 Match Engine + Post-Match *(Phase 7)*
**Purpose:** The dating layer. Strangers meet through dates.

**Owns:** `swipes`, `matches`, `match_ratings` tables. Chat via Supabase Realtime.

**Workflows:**
- Feed lookup (from `feed_cache`) filtered by swiper preferences
- Right swipe → `swipes.status='pending'` → creator notification
- Left swipe → event log only
- Creator batch review queue at `/matches/incoming`
- Match formation on creator approval → chat channel opens → mutual notification
- Day-of reminder cron (based on `match.scheduled_for`)
- 24h post-date rating prompt → writes to `match_ratings` + `events`
- Swipe expiration cron (30 days) + 3-day-ahead notification

### 5.9 Moderation Layer *(Phase 8, light-touch from Phase 5)*
**Purpose:** Keep the marketplace safe; scale trust as the user base grows.

**Owns:** `reports` table. Moderation decision workflows.

**Workflows:**
- Pre-publish screen: Claude Sonnet safety classifier on every new seeking date + user-authored date
- Report handling: user files report → Claude triage → auto-dismiss/auto-action/human queue
- Trust level automation: N open reports → `trust_level=-1` → feature degradation
- `/admin/moderation` triage queue

---

## 6. Phase Sequencing

Option B (credibility-first) ordering.

```
Month   1     2     3     4     5     6     7     8     9     10    11    12
P0      █
P1       ████
P2           ██
P3              █████
P4                  ██████
P5                        ████
P6                            ███████
P7                                   ████████
P7.5                                          ████████
P8       ─────────── (ongoing, light touch) ──────────→
```

### Phase 0 — Mobile Foundation *(~1 week)*
**Web-side** auth providers (Apple Sign In web flow via Services ID, Google Sign In, Phone OTP — all via Supabase Auth). `devices` + `notifications` tables + router abstraction. Cloudflare Images setup. Deep-link URL patterns (`/d/{slug}`, `/v/{venue}`) locked in.

**Deliberately deferred to Phase 7.5** (when mobile bundle ID exists): APNs certificate upload, FCM server key, Apple `apple-app-site-association` file, Android `assetlinks.json`, mobile OAuth client-ID configuration. The router abstraction is designed to accept these tokens on registration without code changes.

### Phase 1 — Image Aesthetic Pipeline *(~3–4 weeks)*
`place_photos` table, Inngest `enrich-venue-images` workflow, backfill Kelowna to 95%+ coverage.

### Phase 2 — Multi-City Hooks + Generator Evolution *(~2–3 weeks)*
`cities` table + seed, `city_id` FKs, `events` table, nightly derivation, `feed_cache` infrastructure, trust-tier bias in scoring.

### Phase 3 — Venue Ingestion Pipeline *(~4–6 weeks)*
Overture + FSQ OS bulk import, Placekey dedupe, Google Places enrichment, auto-categorization, Kelowna grows 170 → 500+.

### Phase 4 — Vetting + Outreach + Business Portal *(~4–6 weeks)*
Outreach tables + AI drafting worker + admin queue UI, Resend integration, staleness score cron, `/partners` claim flow, trust tier ladder active.
**Start TikTok + Instagram API approvals in parallel.**

### Phase 5 — User-Date Publishing Layer *(~3–4 weeks)*
Extended itineraries schema, publish flow, discovery feed, `/discover/[city]`, social_score, basic pre-publish safety screen.
**Admin migrates to `admin.tryafter5.app` during this phase.**

### Phase 6a — Social Content Pipeline (Foundation) *(~4–6 weeks)*
**Tier 1 only**: real photos + Ken Burns/parallax + ElevenLabs brand voice + Whisper auto-captions + Epidemic Sound licensed music. Claude Sonnet scripting with brand-voice prompt. Remotion Lambda composition (one-time AWS IAM/S3/CloudFront setup, ~1–2 weeks of that lives here). Admin approval queue at `/admin/content`. **YouTube Shorts posting only** (10k daily quota free, easiest OAuth). Budget-conservative while the pipeline and brand voice calibrate.

### Phase 6b — Tiered Video + Multi-Platform *(~6–8 weeks additional)*
Add **Tier 2** (Runway Gen-4 / Kling 2.0 AI B-roll hybrid, multi-provider resilience). Add **Tier 3** (Sora 2 monthly flagship). Instagram Reels posting (**requires FB app review approval landed from Phase 4**). TikTok Content Posting API (**requires TikTok for Business approval landed from Phase 4**). Music licensing deepened. Per-platform variants (9:16 / 1:1 / 2:3). If API approvals are delayed, this phase can partially ship (T2 + T3 live, direct posting remains draft-mode for those platforms).

### Phase 7 — Match Queue + Post-Match *(~6–8 weeks)*
Swipes + matches + ratings schema, profiles split (public/private), RLS for blur-reveal, Supabase Realtime chat, reminders + rating prompts.

### Phase 7.5 — Mobile App Launch *(~6–10 weeks)*
React Native + Expo, shared types/schemas via monorepo package, APNs/FCM wiring, deep linking, App Store + Play Store submission.

### Phase 8 — Moderation Hardening *(ongoing)*
Reports triage UI, expanded safety classifier, trust level automation, shadow-ban, ID verification only if abuse patterns demand it.

### Critical path callouts
- Start TikTok + Instagram API approvals by end of Phase 4 (2–4 weeks wait) → unblocks Phase 6b
- Photo coverage must reach 95%+ in Phase 1 before Phase 6a ships
- Multi-city hooks (Phase 2) must land before Phase 3
- Notification router (Phase 0) must land before Phase 4
- Phase 6a (Tier 1 YouTube Shorts) can ship even if Phase 4 approvals slip — resilient to platform-approval delays
- Phase 5 must land before Phase 6a so the content pipeline has a publish-eligible inventory to select from

---

## 7. Key Invariants

Seventeen load-bearing rules. Each includes enforcement mechanism.

### Data integrity
1. **Our UUID is canonical; external IDs are cross-references.** *(Schema — UUID PK, external IDs nullable text.)*
2. **The `events` table is append-only except for compliance erasure.** *(Postgres trigger rejects UPDATE/DELETE except from service-role `erase_user_data(user_id)` RPC, which nullifies `actor_id` and redacts PII fields in `payload`. Each erasure is logged to `events_erasure_log`. Satisfies GDPR/PIPEDA deletion rights without breaking aggregate-score integrity.)*
3. **Every user/venue/itinerary row has a `city_id`.** *(NOT NULL constraint after Phase 2 backfill. See §8.10 Migration Playbook.)*
4. **Subsystems integrate through Postgres, not direct calls.** *(Convention + code review.)*

### Generation quality
5. **The LLM never picks places at selection time.** *(Architecture of `generate-plan`; place selection completes before any LLM call. Separate invariant 5b governs ingestion-time LLM use.)*
5b. **LLM-attributed place metadata is advisory until verified.** *(During ingestion, LLM proposes `type`/`vibe_tags`/`price_tier` constrained to enumerated values by Zod validation. Rows with `llm_attributed=true` do NOT enter generator scoring until either human-verified OR batch QA confirms ≥95% accuracy on a random sample. Prevents ingestion-time hallucination from leaking into selection — i.e., the LLM picking places by proxy through contaminated attributes.)*
6. **Place selection is deterministic-then-stochastic.** *(`selectWeightedTopK` final step in `scoring.ts`.)*
7. **Photos must pass aesthetic threshold to go primary.** *(CHECK constraint: `primary_photo_id` → `aesthetic_score >= 6.0`.)*
7b. **Partner bias cannot cross the top-decile quality threshold.** *(The +10% multiplicative bias on `verified_partner` places is capped so a low-quality partner never beats a top-decile non-partner. Enforced by `scoring.ts` implementation + regression test fixture that asserts: given a bottom-quartile partner and a top-decile non-partner, the non-partner wins. Prevents pay-to-play ranking corruption.)*

### Safety & privacy
8. **Profile reveal is enforced at the database, not the application.** *(RLS policies on `profiles_private.*` and `profiles.clear_photo_url` with match-existence check.)*
9. **Chat channels are match-scoped.** *(RLS on `chat_messages` + Realtime channel authorization.)*
10. **Dating features gate on explicit intent.** *(`match_status` defaults `'none'`; only user action transitions to `'seeking'`.)*
11. **Every publish passes a moderation screen.** *(Workflow sets `moderation_status`; feed excludes `'pending'|'flagged'|'rejected'`.)* *Admin override with required reason.*

### Trust dynamics
12. **Venue trust tier is a one-way ladder.** *(Trigger rejects downgrades except via admin override with required reason.)*
13. **Outreach is the primary tier-advancement mechanism.** *(Webhook handlers advance tiers; admin override with required reason + events log.)*
14. **User trust level auto-downgrades; admin restores.** *(Report triggers write `trust_level=-1`; only admin action reverts.)*

### Operational safety
15. **Every external-AI call passes an atomic budget gate.** *(`reserveBudget(service, estimated_cost)` performs `UPDATE monthly_budget SET spent_usd = spent_usd + $cost WHERE spent_usd + $cost <= budget_usd RETURNING spent_usd` with row-level lock — atomic "check-and-increment" prevents burst-race overruns. Post-call reconciliation writes actual cost to `monthly_budget_events` with `workflow_run_id` idempotency key. Pricing source of truth is a static `service_pricing.ts` module keyed by model + unit-type.)*
16. **Notifications route through one abstraction.** *(`notification.dispatch()` is the only allowed path. Code review enforces.)*
17. **The feed is served from `feed_cache`, not live queries.** *(Feed endpoint reads cache only; cache recomputed by background worker.)*

### Admin override principle
Every one-way invariant (11, 12, 13, 14) has admin override with required `reason` field, logged to `events` as the audit trail. This keeps system integrity without crippling operational needs.

---

## 8. Cross-Cutting Concerns

### 8.1 Row-Level Security

Four policy patterns:

| Pattern | Used for | Example |
|---|---|---|
| Owner-only | Private user data | `profiles_private`, `saved_plans` |
| Public read, owner write | Discoverable content | `itineraries WHERE visibility='public'` |
| Match-gated | Revealed-on-match data | `profiles.clear_photo_url`, `chat_messages` |
| Admin-only | Operational | `outreach_messages`, `events`, `reports`, `feed_cache` |

Admin detection via custom JWT claim in `app_metadata`, not a `profiles.is_admin` flag.

**Concrete match-gated policy** (the highest-stakes policy — profile reveal after match):

```sql
-- profiles_private: owner-only
CREATE POLICY profiles_private_owner_only ON profiles_private
  FOR ALL USING (auth.uid() = user_id);

-- profiles: public SELECT, but clear_photo_url requires column-level protection
-- Row-level SELECT on profiles is public (needed for swipe feed discovery).
-- Column protection for clear_photo_url uses a SECURITY INVOKER view:

CREATE VIEW profiles_v AS
SELECT
  id, first_name, age, payment_preference, vibe_tags,
  age_preferences, gender_preferences, blurred_photo_url,
  trust_level, primary_city_id, creator_score,
  CASE
    WHEN auth.uid() = id THEN clear_photo_url
    WHEN EXISTS (
      SELECT 1 FROM matches m
      WHERE m.state IN ('confirmed', 'reminded', 'completed')
        AND (
          (m.creator_id = auth.uid() AND m.matched_user_id = profiles.id)
          OR
          (m.matched_user_id = auth.uid() AND m.creator_id = profiles.id)
        )
    ) THEN clear_photo_url
    ELSE NULL
  END AS clear_photo_url
FROM profiles;

-- App code reads from profiles_v, never profiles directly.
-- REVOKE SELECT ON profiles.clear_photo_url FROM authenticated.
```

**Match-gated chat_messages:**

```sql
CREATE POLICY chat_messages_match_members ON chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM matches m
      WHERE m.id = chat_messages.match_id
        AND (m.creator_id = auth.uid() OR m.matched_user_id = auth.uid())
    )
  );

CREATE POLICY chat_messages_insert_self ON chat_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM matches m
      WHERE m.id = chat_messages.match_id
        AND (m.creator_id = auth.uid() OR m.matched_user_id = auth.uid())
        AND m.state IN ('confirmed', 'reminded', 'completed')
    )
  );
```

**Realtime channel authorization** for chat: channel name `match_${match_id}` with a Supabase Realtime `authorize` hook that checks membership in `matches`. Subscribing without membership returns 403.

**Test coverage:** Every RLS policy has a test that attempts unauthorized reads/writes and asserts rejection. RLS bypass is the highest-severity regression; blocks merge if any test fails.

### 8.2 Observability

One admin dashboard at `/admin/dashboard` refreshed every 5 min. Metrics tracked:
- **Data health:** photo coverage %, verified-hours %, tier distribution, staleness, venue count per city
- **Product health:** generation rate, publish conversion, find-match conversion, feed freshness, match rate, rating response rate, moderation queue depth
- **Growth health:** outreach sent/response/conversion, partner count, social impressions/engagement, DAU/WAU/MAU per city
- **Cost health:** monthly spend vs budget per service, cost per active user, top 10 expensive workflows

### 8.3 Cost model + budget circuit breakers

| Service | Phase 1 | Phase 7 | Hard stop |
|---|---|---|---|
| Claude | $100 | $1,000 | yes |
| Replicate (FLUX) | $50 | $500 | yes |
| ElevenLabs | — | $400 | yes |
| Runway/Kling | — | $800 | yes |
| Remotion Lambda | — | $300 | yes |
| Google Places | $50 | $1,500 | yes |
| Firecrawl | $16 | $100 | yes |
| Resend | $20 | $50 | no |
| Cloudflare Images | $5 | $50 | no |

`checkBudget(service)` called by every AI workflow. 75% → email alert. 100% → throw + pause.

### 8.4 Feedback loop (the long-term quality engine)

```
User action
     ↓
events.insert (append-only)
     ↓
Nightly Inngest cron (aggregator)
     ↓
Derived score columns updated:
  places.quality_score      ← ratings + swipe-right rates on containing itineraries
  places.completion_score   ← did_it_happen ratings
  profiles.creator_score    ← ratings on their authored dates
  itineraries.social_score  ← LLM + swipe-right rate
  feed_cache                ← recomputed from above
     ↓
Next generate-plan + feed call uses new scores
```

### 8.5 Error handling patterns

| Failure | Response |
|---|---|
| External API timeout | Inngest retry, exponential backoff, 5 attempts max |
| Quota exceeded | Circuit breaker opens 1h |
| Malformed LLM JSON | Retry once with corrective suffix; then deterministic fallback |
| Unmoderatable content | Flag, not reject — human review |
| Race on match creation | Postgres advisory lock + unique constraint |
| Inngest failure mid-step | Resume from last completed step |
| Stale feed cache | Serve anyway + async refresh |

### 8.6 Testing strategy

- **Golden eval set**: 30–50 canonical good plans per city; regression-tested before every generator change
- **Subsystem tests**: focused on critical paths and invariants, not coverage percentage
- **Nightly E2E smoke**: Playwright generate → publish → find-match → swipe → match → chat → rate
- **Adversarial moderation fixtures**: swear words, phishing, PII, hate speech

### 8.7 Environment strategy

- **local**: Supabase local + Inngest dev server
- **staging**: separate Supabase project, seed data, mocked external APIs where feasible
- **production**: primary Supabase, full integrations
- Branch protection on main; feature branches → Vercel previews

### 8.8 Admin service boundary

- **Phase 0–4:** admin lives at `/admin` inside main Next.js app
- **Phase 5+:** admin migrates to `admin.tryafter5.app` (separate Vercel project, shared Supabase backend, shared auth via cookies on same root domain)
- Admin code never imports user-app code and vice versa; they share only `packages/types` + `packages/db-client` monorepo workspaces

### 8.9 Secrets & Deploy

**Secrets hierarchy:**
- **Supabase Vault** (service-role-only secrets) — API keys for Resend, Claude, Replicate, Google Places, ElevenLabs, Runway, Kling, OpenAI embeddings, Firecrawl, Epidemic Sound, Remotion Lambda AWS credentials. Accessed only by edge functions + Inngest workers (never shipped to browsers).
- **Vercel env vars, per environment** (`development` / `preview` / `production`) — public `NEXT_PUBLIC_*` keys (Supabase URL, anon key, Cloudflare Images account hash), app-configuration values (feature flag defaults, base URLs).
- **Inngest project secrets** — signing key (separate per environment), webhook secrets.
- **EAS secrets (Phase 7.5)** — Expo app signing credentials, mobile bundle IDs.

**Rotation cadence:**
- LLM API keys: rotate every 90 days (or on incident)
- Supabase service role key: rotate every 180 days
- OAuth client secrets (Apple, Google): rotate on org changes
- Webhook signing keys: rotate on provider change
- Rotations tracked in a `secret_rotation_log` (not in source — use 1Password or similar)

**Deploy pipeline:**
- `main` branch protection: requires CI green, required reviewers (just Lucas for now, add teammates later)
- Feature branches → Vercel preview URL auto-posted on PR
- Supabase migrations run against staging first; production migrations require manual approval gate
- Rollback plan: every migration has a tested down-migration; Vercel one-click rollback to previous deploy

**CI checks before merge:**
- Type check (`tsc --noEmit`)
- Lint (`biome check`)
- Unit tests (Vitest)
- Integration tests against local Supabase (Inngest workflow simulations)
- RLS policy regression tests
- Golden eval set regression (generator only)
- Secrets-scan (gitleaks or similar)

**Secrets that need special treatment:**
- `partnerships.discount_code` values are PII-adjacent (could be exploited); stored encrypted at rest via Supabase Vault, decrypted only when rendered to authorized users.
- User phone numbers (`profiles_private.phone`) encrypted column-level + access audit logged.

### 8.10 Migration Playbook

The v2 design adds columns and tables to a live product. Every migration must be zero-downtime and reversible.

**Pattern for adding NOT NULL columns to existing tables** (e.g., `places.city_id`, `itineraries.city_id`):

1. **Phase N** — add column as **nullable** with a sensible default
2. **Phase N backfill script** — populate all existing rows in batches (pause for ~seconds between batches to avoid replication lag)
3. **Verify** — `SELECT COUNT(*) WHERE col IS NULL` returns 0
4. **Phase N+1** — `ALTER COLUMN SET NOT NULL`

Concretely for Phase 2:
```sql
-- step 1: add nullable
ALTER TABLE places ADD COLUMN city_id uuid REFERENCES cities(id);
ALTER TABLE itineraries ADD COLUMN city_id uuid REFERENCES cities(id);
ALTER TABLE profiles ADD COLUMN primary_city_id uuid REFERENCES cities(id);

-- step 2: backfill (idempotent, restartable)
UPDATE places SET city_id = (SELECT id FROM cities WHERE slug='kelowna') WHERE city_id IS NULL;
UPDATE itineraries SET city_id = (SELECT id FROM cities WHERE slug='kelowna') WHERE city_id IS NULL;
UPDATE profiles SET primary_city_id = (SELECT id FROM cities WHERE slug='kelowna') WHERE primary_city_id IS NULL;

-- step 3: enforce
ALTER TABLE places ALTER COLUMN city_id SET NOT NULL;
ALTER TABLE itineraries ALTER COLUMN city_id SET NOT NULL;
-- profiles.primary_city_id stays nullable (new signups before they pick a city)
```

**Pattern for in-flight requests during deploys:**
- Zod schemas in edge functions are versioned (`v1` / `v2` accepted concurrently during transition)
- New fields added to Zod schemas use `.optional().default(...)` to accept old client requests
- Old fields being removed: mark deprecated for one release, remove in the next

**Pattern for Inngest workflows during deploys:**
- Mid-flight workflow runs use the code version they started with (Inngest pins code per run)
- New workflow versions get a new name (`enrich-venue-images-v2`) and a cutover date
- Old workflows are drained before their code is removed (check `step` completions)

**Rollback strategy per phase:**
- Phase 0: trivial rollback — revert deploy, new tables drop cleanly
- Phase 1: image backfill is idempotent + interruptible; partial progress is fine
- Phase 2: schema rollback (drop `city_id` cols) is clean IF we haven't yet enforced NOT NULL
- Phase 3 onward: each phase includes a tested down-migration

**User data migration (for existing Kelowna users):**
- Current `profiles` rows: `first_name` / `age` / `payment_preference` fields added nullable; in-app prompt after Phase 5 asks users to fill them in. Dating features (Phase 7) gate on these being set.
- Current `itineraries` rows: `visibility` defaults to `public`, `match_status` defaults to `none` — no backfill needed beyond DDL default.

---

## 9. Out of Scope (v2)

Explicit deferrals so future-us doesn't accidentally drift into building them.

### Safety & identity
- ID verification (Stripe Identity / Persona) — revisit when abuse patterns emerge
- Background checks — out of scope permanently

### Bookings & payments
- Resy/OpenTable API integration — deep-link only in v2
- In-app payments — revisit with paid tiers
- Apple/Google IAP — only for premium mobile features
- Partner transaction processing — revisit Month 12+

### Product scope
- Group dates / 3+ matching — out of scope
- Video/voice chat in matches — text only
- Read receipts / typing indicators / online status — defer
- Calendar export — defer
- Public user profiles / follows — stay focused

### Technical
- Modal (Python ML) — only if Claude vision hits limits
- Self-hosted Overpass — only at high OSM volume
- Dedicated search (Meilisearch/Typesense) — pgvector enough
- GraphQL / tRPC — REST is fine
- Multi-region deploy — Vercel + Supabase CDN handle it
- LaunchDarkly / GrowthBook — simple `feature_flags` table
- A/B testing framework — after ~1k DAU per city
- PostHog / Amplitude — `events` + dashboards first

### Growth
- Referral program — after PMF signals
- Gamification — bolt-on later
- Full SEO polish + dynamic OG images — after ~1k public dates/city
- Segmented email campaigns — after Phase 5
- Granular notification prefs — on/off per channel enough

### Dating features
- Match insurance / safety button — defer
- Pre-match video intros — defer
- Live-photo verification badge — only if ID verification insufficient
- Priority signals ("super swipe") — monetization, defer
- Venue-check-in live dating — defer

### Content pipeline
- Sora 2 as default — T3 flagship only
- Human-on-camera creator partnerships — Month 8+
- Podcast/long-form audio — defer
- User video testimonials — defer

### Marketing infrastructure
- Dedicated CMS (Sanity/Payload) — MDX for v2

### Invariants we're NOT making (yet)
- ❌ "Every user has verified ID"
- ❌ "Every matched date is bookable"
- ❌ "Every city has a local human editor"
- ❌ "No stale date in the feed"
- ❌ "Every public date indexed on Google"

---

## 10. Open Questions

Things we haven't decided yet that will need answers in the relevant phase.

### Product-strategic (affect feature design)
- **Canonical venue ID philosophy — final call.** We've aligned on our UUID canonical, but Placekey vs `google_place_id` priority for dedupe needs a final call in Phase 3.
- **Chat infrastructure — stay on Supabase Realtime or upgrade.** MVP is Supabase Realtime; revisit at ~10k DAM if quality issues arise (Stream.io as alternative).
- **City #2 target.** Vancouver? Calgary? Toronto? — decision needed before Phase 3 is mostly theoretical (pick any for the ingestion pipeline), but matters by Phase 5–6 for marketing and editorial voice.
- **Monetization model.** When paid tiers arrive, what do they gate? (Priority swipes? Unlimited find-match? Discount codes?) — not a v2 decision but will need one by Month 10.
- **Creator compensation.** If creators' dates drive matches, do they get anything? (Discount codes? Affiliate cut from partners? Free Premium?) — will shape retention. Needs answer by Phase 7.
- **Content moderation escalation triggers.** What exact number of reports triggers flag? — tunable, set during Phase 5 rollout.
- **Chat message retention window.** Currently specified as "90 days past match completion" — revisit based on user feedback + storage cost signal.

### Technical (affect implementation detail)
- **Embedding model choice — OpenAI `text-embedding-3-small` (cheap) vs `text-embedding-3-large` (higher quality).** Research recommends `3-small` at ~$0.02/1M tokens; Phase 2 locks this in. Revisit if recall on semantic queries is poor.
- **Claude model assignment per workflow.** Tentative: Sonnet 4.6 for prose (itinerary writing, outreach drafts, content scripts, safety classifier), Haiku 4.5 for triage (ingestion categorization, report triage, social scoring), Vision for image aesthetic. Per-workflow model should be configurable so we can A/B test quality vs cost.
- **FLUX version — FLUX 1.1 Pro vs FLUX.2.** Research flags FLUX.2 as newest. Phase 1 should benchmark side-by-side on a sample of 20 venue regenerations; pick based on photorealism delta.
- **User-uploaded photo CDN strategy.** User uploads go to Supabase Storage, but delivery: raw Supabase Storage URLs vs piping through Cloudflare Images for transforms? Answer depends on usage patterns we'll learn from Phase 7.
- **OpenTable vs Resy deep-link priority.** Both are link-out-only in v2. Generator should pick the more-likely-to-work link when both exist. Affinity per city (Resy denser in NYC, OpenTable denser in Canada).
- **RLS bypass for admin — JWT claim vs service role.** Admin dashboard reads via `/api/admin/*` edge functions with service role OR JWT claim + elevated RLS policies. Second approach is safer but more RLS complexity. Lock in by Phase 4.

---

## 11. Glossary

- **Trust tier** — 4-level venue classification (discovered → contacted → claimed → verified_partner). Affects scoring and partnership features.
- **Find match toggle** — explicit user action to enter a generated date into the swipe queue.
- **Visibility vs match_status** — orthogonal axes on `itineraries`. Visibility controls discovery; match_status controls dating.
- **Events table** — append-only log of every meaningful user action; single source of truth for derived scores.
- **Feed cache** — denormalized per-user swipe-queue ranking, recomputed every ~5 min.
- **Staleness score** — composite metric on venues from Google status, website HTTP, review recency, sentiment drift.
- **Content tiers (T1/T2/T3)** — social content production tiers based on AI intensity (authentic photos / hybrid with AI clips / fully cinematic).
- **Outreach response webhook** — mechanism by which a venue's trust tier advances automatically.
- **Budget circuit breaker** — mandatory budget check before every external-AI call. Hard-stops at 100%.
- **Admin override principle** — every one-way invariant has an admin escape hatch requiring a `reason` field logged to `events`.

---

*End of design document.*
