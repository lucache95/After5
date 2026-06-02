-- 20260602160000_m35_places_google_id_full_unique.sql
-- Fix #70: the on-the-fly warmer's upsert (places, onConflict 'google_place_id') failed
-- with "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- because 20260601211000 created places_google_place_id_key as a PARTIAL unique index
-- (WHERE google_place_id IS NOT NULL). Postgres will not use a partial index as an
-- ON CONFLICT arbiter unless the request restates the predicate, and supabase-js/PostGREST
-- cannot express that — so every warm upsert errored, 0 places persisted, and any
-- non-Kelowna (on-the-fly) generation returned no_candidates.
--
-- Replace it with a FULL unique index on google_place_id. Non-null values are already
-- unique (M1 deduped them before creating the partial index), and Postgres treats NULLs
-- as distinct, so the many curated rows with a NULL google_place_id remain valid. The
-- full index IS a valid ON CONFLICT (google_place_id) arbiter, so the warm upsert succeeds.
-- Idempotent.
drop index if exists places_google_place_id_key;
create unique index if not exists places_google_place_id_key on places (google_place_id);
