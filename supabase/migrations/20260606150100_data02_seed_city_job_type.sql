-- 20260606150100_data02_seed_city_job_type.sql
-- Phase 8 (Compliant Any-City Venue Corpus) DATA-02: the async city pre-seed.
--
-- Adds 'seed_city' to the canonical job_type enum (P2 / 20260525123000) so a
-- user's city can be warmed in the background the moment they set their profile
-- location: enqueue_job('seed_city', now(), {city_id}, p_dedup_key := city_id)
-- → process-jobs HANDLERS['seed_city'] does the same Foursquare fetch→map→upsert
-- as cold-start and stamps cities.seeded_at.
--
-- job_type is an ENUM (not a text+check column) — see 20260525123000_p2_jobs.sql.
-- ALTER TYPE ... ADD VALUE cannot run inside an explicit transaction block in
-- older PG, so we use the IF NOT EXISTS form (PG 12+, supported on PG 17) which
-- is idempotent on its own and safe to replay on `supabase db reset`.
--
-- No RLS/grant change: enqueue_job stays revoked from public/authenticated (P2),
-- so this new type is only enqueuable from the service-role server route.

alter type job_type add value if not exists 'seed_city';
