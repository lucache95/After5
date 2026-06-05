-- 20260606150000_data01_places_fsq_source.sql
-- Phase 8 (Compliant Any-City Venue Corpus) DATA-01 + DATA-02 schema.
--
-- This migration is the schema + provenance that lets the Foursquare corpus
-- upsert idempotently and excludes the legally-non-compliant Google-warmed rows
-- from the LLM candidate pool WITHOUT deleting them (published nights' frozen
-- jsonb stops reference those rows).
--
-- Prod-vs-local state (verify before the gated 08-06 prod-apply on ufufmcpnysvwtutpbian):
--   * M1 (20260601211000) added places.source NOT NULL default 'curated' with an
--     UNNAMED check (curated/discovered/warmed). On this DB it auto-named to
--     places_source_check. This migration drops whatever check constraint on
--     places mentions 'discovered' (name-agnostic) and recreates it with the two
--     new values, keeping discovered/warmed valid so the relabel + any legacy
--     rows stay legal.
--   * M35 (20260602160000) taught the lesson re-applied here: a PARTIAL unique
--     index is NOT a valid ON CONFLICT arbiter for supabase-js/PostGREST. The
--     fsq_place_id unique index below is therefore FULL (Pitfall 5).
--   * LOCAL/CI has no source='discovered' rows, so the relabel pass is a NO-OP
--     here. PROD has Google-warmed rows -> the relabel marks them 'google_legacy'.
--     Verify the before/after count at the gated prod-apply.
--
-- Secure-by-default: this migration adds columns + one unique index + one data
-- relabel only. places stays public-read; NO RLS change, NO USING(true), NO new
-- function (so no search_path to pin). Re-run the Supabase security advisor after
-- the gated prod-apply per CLAUDE.md. Idempotent throughout.

-- 1. Extend places.source to accept the new provenance values. The M1 check is
--    unnamed; locate it by content (mentions 'discovered'), drop it, recreate
--    with 'foursquare' + 'google_legacy' added. Guarded + idempotent: re-running
--    finds no 'discovered'-mentioning check (the recreated one mentions
--    google_legacy) and skips the drop.
do $$
declare
  v_conname text;
begin
  select conname into v_conname
    from pg_constraint
   where conrelid = 'public.places'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%discovered%'
     and pg_get_constraintdef(oid) not ilike '%google_legacy%'
   limit 1;

  if v_conname is not null then
    execute format('alter table public.places drop constraint %I', v_conname);
  end if;
end $$;

alter table public.places
  drop constraint if exists places_source_check;

alter table public.places
  add constraint places_source_check
  check (source in ('curated','discovered','warmed','foursquare','google_legacy'));

-- 2. The new Foursquare upsert key.
alter table public.places
  add column if not exists fsq_place_id text;

-- 3. FULL unique index (NOT partial) so ON CONFLICT (fsq_place_id) is a valid
--    arbiter for the Foursquare warm upsert (Pitfall 5 / M35). NULLs are distinct
--    in Postgres, so curated rows with a null fsq_place_id remain valid.
create unique index if not exists places_fsq_place_id_key
  on public.places (fsq_place_id);

-- 4. Per-city seed state. Cold-start checks one cities row ("has this city ever
--    been seeded?") instead of scanning places.
alter table public.cities
  add column if not exists seeded_at timestamptz;

-- 5. One-time relabel pass: Google-warmed rows (source='discovered') become
--    'google_legacy' so they drop out of the LLM candidate pool. Curated Kelowna
--    rows (source='curated') are untouched. NO delete -- published nights' frozen
--    jsonb stops reference these rows. NO-OP on local/CI (no discovered rows);
--    relabels the Google-warmed rows on prod.
update public.places
   set source = 'google_legacy'
 where source = 'discovered';
