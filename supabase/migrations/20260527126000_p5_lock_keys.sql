-- 20260527126000_p5_lock_keys.sql
-- A.1: advisory-lock-key helpers (internal). IMMUTABLE bigint hashes for
-- pg_advisory_xact_lock. See docs/superpowers/specs/2026-05-27-5b-A-happy-path-design.md §2.7.

-- Canonical, order-independent advisory-lock key for a pair of users (used by reciprocal + accept).
create or replace function match_pair_lock_key(a uuid, b uuid)
returns bigint language sql immutable as $fn$
  select ('x' || substr(md5(least(a::text,b::text) || greatest(a::text,b::text)),1,16))::bit(64)::bigint
$fn$;

-- Single-instance advisory-lock key (used by make_offer/accept/auto_roll on one date instance).
create or replace function match_instance_lock_key(inst uuid)
returns bigint language sql immutable as $fn$
  select ('x' || substr(md5('date_instance:'||inst::text),1,16))::bit(64)::bigint
$fn$;

-- Helper table for the bash race harnesses to pass ids between shell sessions.
-- Test scaffolding; service-role only (no policies = default deny via RLS).
create table if not exists temp_race (k text primary key, v text);
alter table temp_race enable row level security;
