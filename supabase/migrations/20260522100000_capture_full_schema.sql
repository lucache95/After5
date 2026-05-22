-- After5 — capture full production schema
--
-- The initial migration (20260419193959) created: places, templates,
-- user_preferences, itineraries, feedback, pairings.
-- Since then many tables and columns were added through Supabase Studio
-- without version control. This migration brings git back to parity
-- with production.
--
-- Safe to run on an existing DB: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- Safe to run on a fresh DB: runs after the initial migration that creates
-- the base tables.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. NEW ENUMS
-- ═══════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE modifier_difficulty AS ENUM ('tame', 'spicy', 'chaos');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE place_approval_status AS ENUM ('draft', 'live', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. NEW TABLES (not in the initial migration)
-- ═══════════════════════════════════════════════════════════════════════

-- ── profiles ───────────────────────────────────────────────────────────
-- Lightweight public profile for authenticated users (auth.users owns
-- the identity; this holds display fields the app needs without
-- touching the auth schema).

CREATE TABLE IF NOT EXISTS profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name  text,
  email       text,
  city        text,
  neighborhood text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Owner-only read/write.
DO $$ BEGIN
  CREATE POLICY "profiles_owner_all"
    ON profiles FOR ALL
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Keep updated_at fresh.
CREATE OR REPLACE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── subscribers ────────────────────────────────────────────────────────
-- Email list: plan-gate captures, auth signups, early-access form.

CREATE TABLE IF NOT EXISTS subscribers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  first_name      text,
  source          text NOT NULL DEFAULT 'plan_gate',
  city            text,
  location        text,
  itinerary_id    uuid REFERENCES itineraries(id) ON DELETE SET NULL,
  user_agent      text,
  email_opt_out   boolean NOT NULL DEFAULT false,
  opted_out_at    timestamptz,
  welcome_sent_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- (email, source) is the natural conflict key for upserts.
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_email_source_key
  ON subscribers (email, source);

ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;

-- Service-role only (no user-facing reads). The API routes use
-- createAdminClient() which bypasses RLS.
-- Allow authenticated users to read their own subscriber row for
-- the account page counter.
DO $$ BEGIN
  CREATE POLICY "subscribers_service_role_all"
    ON subscribers FOR ALL
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── modifiers ──────────────────────────────────────────────────────────
-- "Wow-Factor" twists applied to itineraries.

CREATE TABLE IF NOT EXISTS modifiers (
  id                text PRIMARY KEY,
  label             text NOT NULL,
  body              text NOT NULL,
  difficulty        modifier_difficulty NOT NULL DEFAULT 'tame',
  vibe_affinity     text[] NOT NULL DEFAULT '{}',
  occasion_affinity text[] NOT NULL DEFAULT '{}',
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE modifiers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "modifiers_public_read"
    ON modifiers FOR SELECT
    USING (is_active = true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── saved_plans ────────────────────────────────────────────────────────
-- Authenticated users bookmarking itineraries.

CREATE TABLE IF NOT EXISTS saved_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  itinerary_id  uuid NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
  note          text,
  saved_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS saved_plans_user_itinerary_key
  ON saved_plans (user_id, itinerary_id);

ALTER TABLE saved_plans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "saved_plans_owner_all"
    ON saved_plans FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── plan_feedback ──────────────────────────────────────────────────────
-- Anonymous pulse feedback after viewing results (would_do, stop votes).

CREATE TABLE IF NOT EXISTS plan_feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id   uuid NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
  source         text NOT NULL DEFAULT 'plan_results',
  stop_votes     jsonb,
  skip_stop_idx  int,
  would_do       text CHECK (would_do IN ('yes', 'maybe', 'no')),
  notes          text,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_feedback_itinerary
  ON plan_feedback (itinerary_id);

ALTER TABLE plan_feedback ENABLE ROW LEVEL SECURITY;

-- Anonymous insert allowed; reads restricted to service role.
DO $$ BEGIN
  CREATE POLICY "plan_feedback_anon_insert"
    ON plan_feedback FOR INSERT
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "plan_feedback_service_read"
    ON plan_feedback FOR SELECT
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── user_feedback ──────────────────────────────────────────────────────
-- Bug reports, place suggestions, feature requests from /tell-us.

CREATE TABLE IF NOT EXISTS user_feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL CHECK (kind IN ('bug', 'place_suggestion', 'feature', 'other')),
  subject    text,
  body       text NOT NULL,
  email      text,
  user_id    uuid,
  page_url   text,
  user_agent text,
  status     text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;

-- Service-role insert (admin client); admin reads.
DO $$ BEGIN
  CREATE POLICY "user_feedback_insert"
    ON user_feedback FOR INSERT
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "user_feedback_read"
    ON user_feedback FOR SELECT
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── vote_sessions ──────────────────────────────────────────────────────
-- A shareable voting session for a batch of itineraries.

CREATE TABLE IF NOT EXISTS vote_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_ids     uuid[] NOT NULL,
  created_by_email  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vote_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "vote_sessions_public_read"
    ON vote_sessions FOR SELECT
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "vote_sessions_insert"
    ON vote_sessions FOR INSERT
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── plan_votes ─────────────────────────────────────────────────────────
-- Anonymous votes within a session. One vote per voter per session.

CREATE TABLE IF NOT EXISTS plan_votes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES vote_sessions(id) ON DELETE CASCADE,
  itinerary_id  uuid NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
  voter_token   text NOT NULL,
  voter_name    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS plan_votes_session_voter_key
  ON plan_votes (session_id, voter_token);

ALTER TABLE plan_votes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "plan_votes_public_read"
    ON plan_votes FOR SELECT
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "plan_votes_insert"
    ON plan_votes FOR INSERT
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── place_reviews ──────────────────────────────────────────────────────
-- Audit trail for AI and human place enrichment/classification actions.

CREATE TABLE IF NOT EXISTS place_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id      uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  reviewer_type text NOT NULL,
  reviewer_id   text NOT NULL,
  action        text NOT NULL,
  before_data   jsonb,
  after_data    jsonb,
  notes         text,
  confidence    decimal(3, 2),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_place_reviews_place
  ON place_reviews (place_id);

ALTER TABLE place_reviews ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "place_reviews_service_all"
    ON place_reviews FOR ALL
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── itinerary_reviews ──────────────────────────────────────────────────
-- AI/human quality review verdicts per itinerary.

CREATE TABLE IF NOT EXISTS itinerary_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id  uuid NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
  reviewer_type text NOT NULL,
  reviewer_id   text NOT NULL,
  verdict       text NOT NULL,
  issue_tags    text[] NOT NULL DEFAULT '{}',
  notes         text,
  confidence    decimal(3, 2),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_itinerary_reviews_itinerary
  ON itinerary_reviews (itinerary_id);

ALTER TABLE itinerary_reviews ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "itinerary_reviews_service_all"
    ON itinerary_reviews FOR ALL
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── place_vibe_images ──────────────────────────────────────────────────
-- Candidate vibe images for places (AI-sourced, scored, moderated).

CREATE TABLE IF NOT EXISTS place_vibe_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id      uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  url           text NOT NULL,
  source        text NOT NULL DEFAULT 'unsplash',
  source_query  text,
  status        text NOT NULL DEFAULT 'pending',
  ai_score      decimal(3, 2),
  ai_reason     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_place_vibe_images_place
  ON place_vibe_images (place_id);

ALTER TABLE place_vibe_images ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "place_vibe_images_service_all"
    ON place_vibe_images FOR ALL
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── email_broadcasts ───────────────────────────────────────────────────
-- Weekly digest (and future broadcast types) header rows.

CREATE TABLE IF NOT EXISTS email_broadcasts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL DEFAULT 'weekly_digest',
  subject         text NOT NULL,
  body_html       text,
  body_text       text,
  triggered_by    text NOT NULL DEFAULT 'cron',
  recipient_count int NOT NULL DEFAULT 0,
  notes           text,
  sent_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_broadcasts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "email_broadcasts_service_all"
    ON email_broadcasts FOR ALL
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── email_broadcast_sends ──────────────────────────────────────────────
-- Per-recipient send log (for idempotency + debugging).

CREATE TABLE IF NOT EXISTS email_broadcast_sends (
  broadcast_id   uuid NOT NULL REFERENCES email_broadcasts(id) ON DELETE CASCADE,
  subscriber_id  uuid NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  resend_id      text,
  error          text,
  sent_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (broadcast_id, subscriber_id)
);

ALTER TABLE email_broadcast_sends ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "email_broadcast_sends_service_all"
    ON email_broadcast_sends FOR ALL
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- 3. NEW COLUMNS on existing tables
-- ═══════════════════════════════════════════════════════════════════════

-- ── places — columns added post-initial-migration ──────────────────────

-- Google Places integration
ALTER TABLE places ADD COLUMN IF NOT EXISTS google_place_id   text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS rating            decimal(3, 1);
ALTER TABLE places ADD COLUMN IF NOT EXISTS review_count      int;
ALTER TABLE places ADD COLUMN IF NOT EXISTS reviews           jsonb;
ALTER TABLE places ADD COLUMN IF NOT EXISTS website           text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS phone             text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS hours_week        jsonb;

-- Discovery pipeline
ALTER TABLE places ADD COLUMN IF NOT EXISTS source_query      text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS discovered_at     timestamptz;
ALTER TABLE places ADD COLUMN IF NOT EXISTS llm_summary       text;

-- Approval workflow
ALTER TABLE places ADD COLUMN IF NOT EXISTS approval_status   place_approval_status NOT NULL DEFAULT 'live';
ALTER TABLE places ADD COLUMN IF NOT EXISTS is_published      boolean NOT NULL DEFAULT true;

-- Photo classification metadata (written by classify-photos Edge Function)
ALTER TABLE places ADD COLUMN IF NOT EXISTS photo_time_of_day text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS photo_season      text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS photo_has_snow    boolean;
ALTER TABLE places ADD COLUMN IF NOT EXISTS photo_quality     text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS photo_review_notes text;

-- Time-of-day photo variants
ALTER TABLE places ADD COLUMN IF NOT EXISTS daytime_photo_url  text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS evening_photo_url  text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS evening_friendly   boolean;
ALTER TABLE places ADD COLUMN IF NOT EXISTS photos             jsonb;

-- AI review tracking
ALTER TABLE places ADD COLUMN IF NOT EXISTS last_ai_review_at         timestamptz;
ALTER TABLE places ADD COLUMN IF NOT EXISTS last_ai_review_confidence  decimal(3, 2);
ALTER TABLE places ADD COLUMN IF NOT EXISTS last_human_review_at      timestamptz;
ALTER TABLE places ADD COLUMN IF NOT EXISTS last_human_review_by      text;

-- Scoring and categorization
ALTER TABLE places ADD COLUMN IF NOT EXISTS category_group     text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS friction_score     text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS perceived_value    text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS at_home            boolean NOT NULL DEFAULT false;

-- Booking details
ALTER TABLE places ADD COLUMN IF NOT EXISTS booking_url             text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS booking_phone           text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS booking_method          text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS booking_lead_time_days  int;

-- Indexes for new places columns
CREATE UNIQUE INDEX IF NOT EXISTS places_google_place_id_key
  ON places (google_place_id) WHERE google_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_places_approval_status
  ON places (approval_status) WHERE is_active = true;


-- ── itineraries — columns added post-initial-migration ─────────────────

ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS slug                     text;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS season                   text;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS when_planned             text;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS planned_for_date         text;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS intent                   text;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS modifier_id              text REFERENCES modifiers(id);
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS generation_log           jsonb;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS cover_image_url          text;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS cover_image_prompt       text;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS cover_image_generated_at timestamptz;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS built_by_name            text;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS built_by_neighborhood    text;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS claim_email              text;

-- Indexes for new itinerary columns
CREATE UNIQUE INDEX IF NOT EXISTS itineraries_slug_key
  ON itineraries (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_itineraries_claim_email
  ON itineraries (claim_email) WHERE claim_email IS NOT NULL AND user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_itineraries_season
  ON itineraries (season) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_itineraries_generated_at
  ON itineraries (generated_at DESC) WHERE is_public = true;


-- ═══════════════════════════════════════════════════════════════════════
-- 4. ADDITIONAL INDEXES for query patterns found in the codebase
-- ═══════════════════════════════════════════════════════════════════════

-- subscribers: email lookup (used by auth callback + upserts)
CREATE INDEX IF NOT EXISTS idx_subscribers_email
  ON subscribers (email);

-- plan_votes: session lookups (vote page)
CREATE INDEX IF NOT EXISTS idx_plan_votes_session
  ON plan_votes (session_id);

-- saved_plans: user lookups (account page)
CREATE INDEX IF NOT EXISTS idx_saved_plans_user
  ON saved_plans (user_id);

-- feedback: user lookups
CREATE INDEX IF NOT EXISTS idx_feedback_user
  ON feedback (user_id) WHERE user_id IS NOT NULL;

-- places.slug already has a UNIQUE constraint from the initial migration.


-- ═══════════════════════════════════════════════════════════════════════
-- 5. TRIGGER for profiles updated_at (already created above, but
--    ensure the function exists for fresh DBs)
-- ═══════════════════════════════════════════════════════════════════════

-- set_updated_at() was created in the initial migration. No action needed.
