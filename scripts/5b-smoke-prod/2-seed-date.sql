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
-- TODO at execution time: adjust columns to match prod schema
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
