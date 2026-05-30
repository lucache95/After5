-- =============================================================================
-- seed-cohort-nights.sql — seed swipeable nights for the tester cohort
-- =============================================================================
-- Prod (and a fresh local db) has 0 date_instances, so even a fully verified
-- tester sees an EMPTY feed. This seeds a handful of APPROVED, FUTURE,
-- 'seeking' date_instances in the cohort city (default Kelowna) with minimal
-- itineraries, created by an already-verified cohort tester, so that the OTHER
-- verified testers get nights to swipe.
--
-- browse_feed_for_viewer feed-eligibility (must ALL hold):
--   di.status = 'seeking'                      <- set here
--   di.moderation_status = 'approved'          <- set here (table default)
--   di.starts_at > now()                       <- seeded in the near future
--   creator.account_state = 'active'           )
--   creator.standing not in (suspended/ban)    ) creator must be a real
--   creator.verification = 'verified'          ) match-ready profile -> run
--   creator.dating_enabled = true              ) cohort-unblock.sql FIRST
--   creator <> viewer, no prior swipe
--   mutual gender + age compatibility (both directions)
--   within distance (same-city centroid => distance 0, always passes)
--
-- PREREQUISITE: run scripts/cohort-unblock.sql first so :creator_id is a
-- verified, dating_enabled tester. Otherwise the seeded nights are filtered out.
--
-- HOW TO RUN (local, service-role / postgres):
--     psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--       -v city_slug=kelowna \
--       -v creator_id="'93393751-95d1-4177-8b16-e38bc2847abd'" \
--       -f scripts/seed-cohort-nights.sql
--
--   :creator_id defaults to the qa-cand local tester if omitted. Set it to one
--   of YOUR cohort uids (already unblocked). Re-runnable: deletes its own prior
--   seed rows (is_seed = true for this creator) before re-inserting.
--
-- NOTE: testers swipe each OTHER's nights. With a 2-person cohort, seed nights
-- for tester A (this script) and run again with :creator_id = tester B so each
-- sees the other. Seed rows are tagged is_seed = true for easy cleanup.
-- =============================================================================

\set ON_ERROR_STOP on
-- Default creator = qa-cand local tester (override with -v creator_id=...)
\if :{?creator_id}
\else
  \set creator_id '\'93393751-95d1-4177-8b16-e38bc2847abd\''
\endif

begin;

-- Resolve city; fail loudly if the slug is unknown.
create temporary table cohort_city on commit drop as
  select id as city_id from cities where slug = :'city_slug';
do $$
begin
  if not exists (select 1 from cohort_city) then
    raise exception 'seed-cohort-nights: no city found for the given slug';
  end if;
end $$;

-- Warn (not fail) if the creator is not currently feed-eligible: the nights
-- will insert but won't appear in any feed until the creator is unblocked.
-- (psql vars aren't substituted inside DO blocks, so we resolve into a temp
-- table here and let a DO block read from it.)
create temporary table cohort_creator on commit drop as
  select id,
         (verification = 'verified' and dating_enabled = true
          and account_state = 'active'
          and standing not in ('suspended','locked_ban')) as feed_eligible
  from profiles where id = :creator_id;
do $$
begin
  if not exists (select 1 from cohort_creator) then
    raise exception 'seed-cohort-nights: creator id not found in profiles';
  end if;
  if not (select feed_eligible from cohort_creator) then
    raise warning 'seed-cohort-nights: creator is NOT feed-eligible (run cohort-unblock.sql first); seeded nights will be hidden until then';
  end if;
end $$;

-- Idempotent: drop this creator's previous seed nights (and their itineraries).
delete from itineraries it
where it.id in (
  select di.itinerary_id from date_instances di
  where di.creator_id = :creator_id and di.is_seed = true
);  -- cascades to the date_instances via FK on delete cascade

-- -----------------------------------------------------------------------------
-- Create minimal itineraries (one per night) + the date_instances.
-- itineraries.inputs/stops are NOT NULL -> seed with empty jsonb.
-- The feed RPC reads it.pay_setting/vibe_tags/why_note/cover_image_url/title.
-- -----------------------------------------------------------------------------
with night_defs(n, title, why_note, pay_setting, vibe_tags, hours_ahead) as (
  values
    (1, 'Sunset wine flight on the bench', 'Three pours, golden hour, easy to talk over.',
        'split',    array['cozy','scenic'],     26),
    (2, 'Lakeside walk + late espresso',   'Move a little, then sit and actually talk.',
        'i_pay',    array['active','chill'],     50),
    (3, 'Downtown small plates crawl',      'Two stops, share everything, no big commitment.',
        'split',    array['foodie','lively'],    74),
    (4, 'Live music at a back-room bar',    'Low lights, good band, drinks optional.',
        'they_pay', array['music','nightlife'],  98)
),
ins_itin as (
  insert into itineraries (user_id, inputs, stops, title, why_note,
                           pay_setting, vibe_tags, city_id, is_public, match_status)
  select :creator_id, '{}'::jsonb, '[]'::jsonb, nd.title, nd.why_note,
         nd.pay_setting::payment_preference, nd.vibe_tags,
         (select city_id from cohort_city), false, 'seeking'::date_match_status
  from night_defs nd
  returning id, title
)
insert into date_instances (itinerary_id, creator_id, city_id, starts_at,
                            duration_min, status, moderation_status, is_seed)
select ii.id, :creator_id, (select city_id from cohort_city),
       now() + (nd.hours_ahead || ' hours')::interval,
       150, 'seeking'::date_match_status, 'approved'::moderation_status, true
from ins_itin ii
join night_defs nd on nd.title = ii.title;

-- Report what got seeded.
select di.id as date_instance_id, it.title, di.starts_at, di.status,
       di.moderation_status, di.is_seed
from date_instances di
join itineraries it on it.id = di.itinerary_id
where di.creator_id = :creator_id and di.is_seed = true
order by di.starts_at;

commit;
