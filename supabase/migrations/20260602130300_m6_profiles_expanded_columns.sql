-- 20260602130300_m6_profiles_expanded_columns.sql
-- M6: small, brand-fit expanded profile fields. All optional, nothing
-- identity-sensitive (no religion/politics/ethnicity). Additive + idempotent.
-- These live on `profiles` (the blind-safe row); they only surface post-reveal
-- via the ProfileCard read path. Writes are owner-scoped by the existing
-- profiles RLS (own row only).
alter table profiles
  add column if not exists pronouns   text,
  add column if not exists height_cm  int
    check (height_cm is null or (height_cm between 120 and 230)),
  add column if not exists occupation text,
  add column if not exists socials    jsonb not null default '{}'::jsonb;
