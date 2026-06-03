# External Integrations

**Analysis Date:** 2026-06-03

## APIs & External Services

**LLM & AI:**
- Anthropic Claude API (v1/messages endpoint) - Used in edge function `supabase/functions/generate-plan/index.ts` for itinerary copy generation (title, hook, why_it_works, stop descriptions)
  - SDK: `@anthropic-ai/sdk@^0.40.0` (in Deno edge function)
  - Auth: `ANTHROPIC_API_KEY` (server-only, set in Vercel env)
  - Model: `ANTHROPIC_MODEL` env var (default `claude-sonnet-4-6`)
  - Endpoint: `https://api.anthropic.com/v1/messages`

**Image Generation:**
- Replicate FLUX schnell - AI image generation for itinerary cover images
  - Model: `black-forest-labs/flux-schnell`
  - Auth: `REPLICATE_API_KEY` (server-only, admin auth required)
  - Endpoint: `https://api.replicate.com/v1/models/*/predictions`
  - Implementation: `supabase/functions/generate-cover/index.ts`
  - Uploads results to: Supabase Storage bucket `itinerary-covers`

**Maps & Places:**
- Google Places API (Text Search + place details) - Location discovery for date plan generation
  - Endpoint: `https://places.googleapis.com/v1/places:searchText`
  - Auth: `GOOGLE_PLACES_API_KEY` (server-only, used in `apps/web/app/api/places/search/route.ts`)
  - Used by: `supabase/functions/generate-plan/google-places.ts` (mapper functions, on-the-fly cache warming)
  - Returns: Place metadata (name, type, price level, coordinates)

- Mapbox Static Images API & GL - Route visualization and maps
  - Endpoint: `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/...`
  - Auth: `NEXT_PUBLIC_MAPBOX_TOKEN` (client-safe, included in Next.js bundle)
  - Used in: `components/RadiusMap.tsx` and `components/itinerary/ItineraryMap.tsx` (static PNG generation)
  - Style: `mapbox/light-v11` (light theme for itinerary routes)

**Email:**
- Resend - Transactional and broadcast email
  - Endpoint: `https://api.resend.com/emails`
  - Auth: `RESEND_API_KEY` (server-only, set in Vercel env)
  - From: `RESEND_FROM_EMAIL` (default configured in env template)
  - Reply-to: `RESEND_REPLY_TO` (optional, routes inbound to founder inbox)
  - Implementation: `apps/web/lib/email/resend.ts` (best-effort wrapper, never throws on user-facing paths)
  - Used by:
    - Welcome email (`apps/web/lib/email/welcome.ts`)
    - Plan export email (`apps/web/app/api/email-plan/route.ts`)
    - Match notifications (`apps/web/app/api/offers/email/route.ts`)
    - Weekly digest broadcast (`apps/web/app/api/cron/weekly-broadcast/route.ts`)
    - Post-date feedback request (`apps/web/app/api/cron/post-date-feedback/route.ts`)
    - Offer expiration warnings (`apps/web/app/api/cron/offer-expiring/route.ts`)

**Identity & Age Verification:**
- Persona - KYC + 18+ age verification
  - Endpoint: `https://api.withpersona.com/api/v1/inquiries`
  - Auth: `PERSONA_API_KEY` (server-only, Bearer token)
  - Template: `PERSONA_TEMPLATE_ID` (inquiry template for age checks)
  - Webhook secret: `PERSONA_WEBHOOK_SECRET` (for webhook signature verification)
  - Implementation: 
    - Start inquiry: `supabase/functions/start-verification/index.ts`
    - Webhook receiver: `supabase/functions/persona-webhook/index.ts`
  - API Version: `Persona-Version: 2023-01-05`
  - State machine: pending → verified/rejected, stored in `verifications` table

**SMS & Phone OTP:**
- Twilio (via Supabase Auth) - SMS OTP for phone verification
  - Auth: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (or API Key: `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET`)
  - Test credentials: `TWILIO_TEST_ACCOUNT_SID`, `TWILIO_TEST_AUTH_TOKEN`
  - Sender: `TWILIO_MESSAGE_SERVICE_SID` or `TWILIO_PHONE_NUMBER` (production only)
  - Configured in: Supabase Auth → SMS Provider settings
  - Client flow: `/api/auth/callback` → `signInWithOtp()` → Supabase sends SMS → `verifyOtp()` → `confirm-phone` edge function

**Push Notifications:**
- Web Push Protocol (VAPID) - Browser push notifications
  - Keys: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (server-only)
  - Contact: `VAPID_SUBJECT` (mailto: or https URL)
  - Implementation: `apps/web/lib/push/send.ts` (Node.js server) and `supabase/functions/_shared/notify.ts` (Deno edge)
  - Subscriptions stored in: `push_subscriptions` table
  - Sent via: `web-push` npm package or Expo Push API (backup)

**Analytics:**
- PostHog - Product analytics and feature tracking
  - Key: `NEXT_PUBLIC_POSTHOG_KEY` (client-safe)
  - Host: `NEXT_PUBLIC_POSTHOG_HOST` (default `https://us.posthog.com`)
  - Implementation: `apps/web/app/PostHogProvider.tsx`
  - Features: Pageview tracking (via App Router capture), custom events (plan_started, plan_generated, plan_saved, etc.)
  - Configuration: localStorage persistence, autocapture off, session recording off by default
  - Graceful no-op: if key is unset, analytics are skipped (common in local dev/CI)

**Deployment & Cron:**
- Vercel Cron - Scheduled jobs
  - Configured in: `apps/web/vercel.json`
  - Routes and schedules:
    - `/api/cron/weekly-broadcast` - "0 16 * * 0" (Sundays 4pm UTC / 9am Pacific)
    - `/api/cron/post-date-feedback` - "0 17 * * *" (daily 5pm UTC / 10am Pacific)
    - `/api/cron/process-jobs` - "* * * * *" (every minute, dispatches edge function)
    - `/api/cron/offer-expiring` - "*/30 * * * *" (every 30 minutes)
  - Auth: `CRON_SECRET` header (Bearer token)
  - Implementation: `apps/web/app/api/cron/*/route.ts`

- Vercel Deployments - Production hosting
  - Framework: Next.js
  - Build: `pnpm --filter @after5/web build` (from project root)
  - Install: `pnpm install --frozen-lockfile` (from project root)
  - Output: `.next/` directory
  - Edge Functions: Auto-deployed with the Next.js app (no additional deploy step)

## Data Storage

**Databases:**
- Supabase PostgreSQL 17 (cloud)
  - Project URL: `NEXT_PUBLIC_SUPABASE_URL` (e.g., `https://ufufmcpnysvwtutpbian.supabase.co`)
  - Project Ref: `SUPABASE_PROJECT_REF` (e.g., `ufufmcpnysvwtutpbian`)
  - Client SDK: `@supabase/supabase-js@2.45.0`
  - SSR support: `@supabase/ssr@0.10.2` (cookie-based auth for App Router)
  - Tables: `profiles`, `verifications`, `push_subscriptions`, `dates`, `matches`, `offers`, `places`, `itineraries`, `jobs`, `admin_alerts`, etc.
  - Schema location: `supabase/migrations/` (numbered .sql files)
  - Realtime: Enabled in config (`supabase/config.toml`)
  - RLS: Row-level security policies defined in migrations

**File Storage:**
- Supabase Storage (S3-compatible)
  - Bucket: `itinerary-covers` - AI-generated FLUX cover images
  - Bucket: Other buckets may exist for email assets, photos, etc.
  - Access: Public URL patterns allowed in Next.js config (`ufufmcpnysvwtutpbian.supabase.co` remote pattern)
  - Uploaded by: `supabase/functions/generate-cover/index.ts`

**Caching:**
- Redis/Memcached: Not detected in current stack
- Database query result caching: Handled by Supabase PostgREST API + client-side React state

## Authentication & Identity

**Auth Provider:**
- Supabase Auth - Custom authentication layer
  - Methods:
    - Email/password (magic links via Resend)
    - Phone OTP (SMS via Twilio)
    - OAuth providers (configured in Supabase dashboard)
  - Client implementation: `@supabase/ssr` for App Router (cookies)
  - Session storage: Secure HTTP-only cookies (managed by Supabase)
  - JWT verification: Edge Functions use `verify_jwt` flag in `supabase/config.toml`
  - Email template: `supabase/email-templates/` (customizable invitation, magic link, etc.)

**Age Verification:**
- Persona workflow (18+ gate required before match access)
  - State: `pending` → `verified` or `rejected`
  - Table: `verifications` (kind='age', provider='persona')
  - Webhook: Persona POSTs to `supabase/functions/persona-webhook/index.ts` with inquiry results

## Monitoring & Observability

**Error Tracking:**
- None detected (no Sentry, Rollbar, or similar configured)
- Errors logged to console/Supabase logs; admin alerts via `raise_admin_alert` RPC

**Logs:**
- Supabase Edge Function logs - Visible in Supabase dashboard
- Vercel logs - Visible in Vercel project dashboard
- Console logs in: Edge Functions (Deno) and API routes (Node.js)
- Database logs: Query logs available via Supabase dashboard
- Admin alerts: Custom table `admin_alerts` with RPC `raise_admin_alert` for critical events

## CI/CD & Deployment

**Hosting:**
- Vercel (production)
  - Region: Configurable (defaults to fastest region)
  - Deployments: GitHub → Vercel auto-deploy on push
  - Environments: Production (main branch), Preview (PR branches), Development (local)

**CI Pipeline:**
- Vercel CI - Integrated build + preview deployments
- GitHub Actions (if configured): Not detected in codebase root
- Pre-commit hooks: Not detected
- Local testing: `pnpm test` (Vitest), `pnpm test:e2e` (Playwright)

**Database Migrations:**
- Supabase CLI local development (`db:start`, `db:reset`, `db:diff`, `db:push`)
- Remote: `supabase db push` applies migrations to cloud
- Edge Functions: `supabase functions deploy` (or auto-deploy with main app)

## Environment Configuration

**Required env vars:**
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_PROJECT_REF`
- Anthropic: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- Resend: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- Mapbox: `NEXT_PUBLIC_MAPBOX_TOKEN`
- PostHog: `NEXT_PUBLIC_POSTHOG_KEY` (optional)
- Persona: `PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID`, `PERSONA_WEBHOOK_SECRET`
- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (or API Key variant)
- Vercel Cron: `CRON_SECRET`
- Jobs: `JOBS_RUNNER_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`
- Web Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (optional)
- Google Places: `GOOGLE_PLACES_API_KEY` (server-only)
- Replicate: `REPLICATE_API_KEY` (server-only)

**Secrets location:**
- `.env.local` (development, NEVER committed)
- `.env.prod.local` (production overrides, NEVER committed)
- Vercel project settings → Environment Variables (production, accessed at deploy time)
- Supabase project dashboard → Project Settings → API (for project keys)

## Webhooks & Callbacks

**Incoming Webhooks:**
- Persona Age Verification: `supabase/functions/persona-webhook/index.ts`
  - Signature verification: HMAC with `PERSONA_WEBHOOK_SECRET`
  - Payload: Inquiry ID, status (approved/rejected), user_id (reference-id)
  - Action: Update `verifications` table; trigger profile rollup

**Outgoing Webhooks:**
- Supabase Realtime subscriptions (client-side push, not traditional webhooks)
- Web Push notifications (via Web Push Protocol, not HTTPS webhooks)

**OAuth/Social Providers:**
- OAuth 2.0 (if configured in Supabase Auth) - Not explicitly integrated in analyzed code
  - Would be configured in Supabase dashboard (Google, GitHub, etc.)

---

*Integration audit: 2026-06-03*
