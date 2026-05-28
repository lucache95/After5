-- 2-seed-date.sql — seed one itinerary + one date_instance owned by Host.
-- Service_role bypasses RLS. Real schema notes:
--   - date_instances.itinerary_id is NOT NULL with FK to itineraries — must create
--     an itinerary first (host-owned).
--   - date_instances.venue_id is the optional venue FK (nullable); the match chain
--     doesn't care about it for the smoke, leave null.
--   - date_instances.duration_min defaults to 150; time_range is computed from
--     starts_at + duration_min, no need to set it.
--
-- Variables to substitute:
--   :host_uid — Host UID

with new_itinerary as (
  insert into public.itineraries (
    user_id, inputs, stops, title, city_id, is_public, vibe_tags
  )
  values (
    :'host_uid'::uuid,
    '{"smoke_test": true, "neighborhood": "Downtown Kelowna"}'::jsonb,
    '[{"name": "Smoke Test Stop 1", "type": "cocktail_bar"}, {"name": "Smoke Test Stop 2", "type": "restaurant"}]'::jsonb,
    'Smoke test date (delete me)',
    '06b7bad2-9918-44cf-8d45-b611e053fa27'::uuid,  -- Kelowna (prod)
    false,
    '{cozy,creative}'::text[]
  )
  returning id
),
new_instance as (
  insert into public.date_instances (
    itinerary_id, creator_id, city_id, starts_at, duration_min, status
  )
  select
    ni.id,
    :'host_uid'::uuid,
    '06b7bad2-9918-44cf-8d45-b611e053fa27'::uuid,  -- Kelowna (prod)
    now() + interval '5 days',                      -- starts 5 days out
    150,
    'seeking'                                       -- per date_match_status enum
  from new_itinerary ni
  returning id, itinerary_id, creator_id, city_id, starts_at, status::text
)
select * from new_instance;
