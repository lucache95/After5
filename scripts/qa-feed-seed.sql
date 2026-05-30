-- QA Feed Seed — local dev only (postgres superuser, bypasses RLS)
-- Re-runnable: uses ON CONFLICT / fixed UUIDs
-- PGURL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
-- psql "$PGURL" -v target=local -f scripts/qa-feed-seed.sql
--
-- ── SAFETY GUARD — prevent an accidental PRODUCTION run ──────────────────────
-- This is local-dev only. You MUST pass `-v target=local`; a run with no
-- `-v target` aborts before any write.
\set ON_ERROR_STOP on
\if :{?target}
\else
\echo '*** ABORT qa-feed-seed: local-dev only — pass -v target=local. No writes performed. ***'
\quit
\endif

-- ────────────────────────────────────────────────────────────────
-- 0. CONSTANTS
-- ────────────────────────────────────────────────────────────────
\set viewer_id '5f387641-2ee9-443a-abb8-bb7f8e48a1a0'
\set kelowna_id 'cde497ea-c50e-481c-8b56-4bc98a61388c'
\set host_id    'aaaaaaaa-0000-4000-8000-000000000001'

-- ────────────────────────────────────────────────────────────────
-- 1. VIEWER — set birthdate first, then promote
-- ────────────────────────────────────────────────────────────────
-- 1a. Ensure profiles_private row exists and set birthdate
INSERT INTO public.profiles_private (user_id, birthdate)
VALUES (:'viewer_id', '1995-06-15')
ON CONFLICT (user_id) DO UPDATE
  SET birthdate = '1995-06-15';

-- 1b. Promote viewer profile (age will be set by enforce_age_gate trigger when dating_enabled flips true)
UPDATE public.profiles
SET
  onboarding_step  = 'done',
  verification     = 'verified',
  dating_enabled   = true,
  primary_city_id  = :'kelowna_id',
  distance_pref_km = 40
WHERE id = :'viewer_id';

-- ────────────────────────────────────────────────────────────────
-- 2. HOST — auth.users row (triggers auto-create profiles row)
-- ────────────────────────────────────────────────────────────────
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  encrypted_password, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
VALUES (
  :'host_id',
  'authenticated',
  'authenticated',
  'qa_host@example.com',
  now(),
  -- bcrypt hash of 'password' (placeholder — local only)
  '$2a$10$PH3jfNLOiSMrCGovd7dW7.z1BVKV4.yJXvFLNF93QHtCJJx4mD3.q',
  '{"provider":"email","providers":["email"]}',
  '{"first_name":"Maya"}',
  now(), now(), false, false
)
ON CONFLICT (id) DO NOTHING;

-- 2b. Set host birthdate first (so age gate doesn't block dating_enabled=true)
INSERT INTO public.profiles_private (user_id, birthdate)
VALUES (:'host_id', '1998-03-10')
ON CONFLICT (user_id) DO UPDATE
  SET birthdate = '1998-03-10';

-- 2c. Promote host profile
UPDATE public.profiles
SET
  first_name         = 'Maya',
  gender             = 'woman',
  gender_preferences = '{man,woman}',
  age_pref           = '[25,41)',
  primary_city_id    = :'kelowna_id',
  distance_pref_km   = 40,
  verification       = 'verified',
  dating_enabled     = true,
  onboarding_step    = 'done'
WHERE id = :'host_id';

-- ────────────────────────────────────────────────────────────────
-- 3. ITINERARIES (4, owned by host)
-- ────────────────────────────────────────────────────────────────
INSERT INTO public.itineraries (
  id, user_id, inputs, stops, title, why_note,
  is_public, vibe_tags, pay_setting, cover_image_url,
  generated_at, slug, city_id, is_evergreen
)
VALUES
  (
    'bbbbbbbb-0001-4000-8000-000000000001',
    :'host_id',
    '{}', '[]',
    'jazz bar crawl',
    'Two velvet rooms, one long pour — you pick where we end up.',
    true, '{jazz,bar}', 'split',
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800',
    now(), 'qa-jazz-bar-crawl', :'kelowna_id', true
  ),
  (
    'bbbbbbbb-0002-4000-8000-000000000002',
    :'host_id',
    '{}', '[]',
    'beach picnic at sunset',
    'Blanket on the sand, wine from a paper bag, no agenda.',
    true, '{beach,picnic}', 'i_pay',
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800',
    now(), 'qa-beach-picnic-sunset', :'kelowna_id', true
  ),
  (
    'bbbbbbbb-0003-4000-8000-000000000003',
    :'host_id',
    '{}', '[]',
    'pottery and local wine',
    'Get your hands dirty, drink something good — probably in that order.',
    true, '{pottery,craft}', 'split',
    'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=800',
    now(), 'qa-pottery-local-wine', :'kelowna_id', true
  ),
  (
    'bbbbbbbb-0004-4000-8000-000000000004',
    :'host_id',
    '{}', '[]',
    'slow brunch, no rush',
    'Corner table, good coffee, nowhere else to be until noon.',
    true, '{coffee,brunch}', 'split',
    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800',
    now(), 'qa-slow-brunch-no-rush', :'kelowna_id', true
  )
ON CONFLICT (id) DO UPDATE
  SET title           = EXCLUDED.title,
      why_note        = EXCLUDED.why_note,
      is_public       = EXCLUDED.is_public,
      vibe_tags       = EXCLUDED.vibe_tags,
      pay_setting     = EXCLUDED.pay_setting,
      cover_image_url = EXCLUDED.cover_image_url;

-- ────────────────────────────────────────────────────────────────
-- 4. DATE_INSTANCES (4, one per itinerary, future evenings)
--    time_range is GENERATED — do NOT insert it
-- ────────────────────────────────────────────────────────────────
INSERT INTO public.date_instances (
  id, itinerary_id, creator_id, city_id,
  starts_at, duration_min, status, moderation_status, is_seed
)
VALUES
  (
    'cccccccc-0001-4000-8000-000000000001',
    'bbbbbbbb-0001-4000-8000-000000000001',
    :'host_id', :'kelowna_id',
    now() + interval '3 days' + interval '19 hours',
    150, 'seeking', 'approved', true
  ),
  (
    'cccccccc-0002-4000-8000-000000000002',
    'bbbbbbbb-0002-4000-8000-000000000002',
    :'host_id', :'kelowna_id',
    now() + interval '5 days' + interval '18 hours',
    150, 'seeking', 'approved', true
  ),
  (
    'cccccccc-0003-4000-8000-000000000003',
    'bbbbbbbb-0003-4000-8000-000000000003',
    :'host_id', :'kelowna_id',
    now() + interval '7 days' + interval '19 hours',
    150, 'seeking', 'approved', true
  ),
  (
    'cccccccc-0004-4000-8000-000000000004',
    'bbbbbbbb-0004-4000-8000-000000000004',
    :'host_id', :'kelowna_id',
    now() + interval '9 days' + interval '10 hours',
    150, 'seeking', 'approved', true
  )
ON CONFLICT (id) DO UPDATE
  SET starts_at         = EXCLUDED.starts_at,
      status            = EXCLUDED.status,
      moderation_status = EXCLUDED.moderation_status,
      is_seed           = EXCLUDED.is_seed;

-- ────────────────────────────────────────────────────────────────
-- 5. VERIFY — call RPC as viewer (SECURITY DEFINER fn reads
--    auth.uid() from JWT; as superuser we pass p_viewer explicitly)
-- ────────────────────────────────────────────────────────────────
SELECT
  date_instance_id,
  time_window_start,
  vibe_tags,
  title,
  why_note,
  pay_setting,
  is_seed,
  round(distance_m::numeric) AS distance_m
FROM browse_feed_for_viewer(
  p_viewer := '5f387641-2ee9-443a-abb8-bb7f8e48a1a0'
);
