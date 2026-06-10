-- 20260609120000_dlb01_profiles_lifestyle_facts.sql
-- DLB-01 (dealbreaker enforcement, half 1): the four lifestyle FACTS that the
-- long-stored profiles.dealbreakers tags finally get to check against.
--
-- profiles.dealbreakers (text[], 7-tag check constraint in
-- 20260525122200_p1_preferences_constraints.sql) has been collected since P1 but
-- NOTHING read it — profiles stored no lifestyle facts to compare. These columns
-- are the missing half; 20260609120100_dlb02 wires the mutual feed gate.
--
-- Semantics: nullable booleans, NULL = unanswered. A NULL fact NEVER excludes
-- anyone (the gate uses IS TRUE / IS FALSE), so existing rows (all NULL) see
-- zero feed change until a user opts in via the optional "about you" section.
--
-- Grants/RLS: unlike profiles_private (which revoked the table-level write grant
-- and re-grants per column — 20260525120100_p0_profiles_dating.sql C11.13),
-- `profiles` keeps its default table-level INSERT/UPDATE grants and is row-gated
-- by the profiles_owner_all RLS policy (capture_full_schema.sql). Additive
-- columns are therefore self-writable with NO grant change — same pattern as
-- m6_profiles_expanded_columns and e10_feed_filters_column.
alter table profiles
  add column if not exists smokes     boolean,
  add column if not exists drinks     boolean,
  add column if not exists has_pets   boolean,
  add column if not exists wants_kids boolean;

comment on column profiles.smokes     is 'Lifestyle fact (self-reported, optional). NULL = unanswered, never excludes. Checked by others'' dealbreakers: smoking → smokes IS TRUE.';
comment on column profiles.drinks     is 'Lifestyle fact (self-reported, optional). NULL = unanswered, never excludes. Checked by others'' dealbreakers: drinks_alcohol → drinks IS TRUE; no_alcohol → drinks IS FALSE.';
comment on column profiles.has_pets   is 'Lifestyle fact (self-reported, optional). NULL = unanswered, never excludes. Checked by others'' dealbreakers: has_pets → IS TRUE; no_pets → IS FALSE.';
comment on column profiles.wants_kids is 'Lifestyle fact (self-reported, optional). NULL = unanswered, never excludes. Checked by others'' dealbreakers: wants_kids → IS TRUE; no_kids → IS FALSE.';
