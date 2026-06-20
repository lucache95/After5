-- supabase/migrations/20260620130000_prof01_instagram_public.sql
--
-- ⚠️ GATED — NOT YET APPLIED TO PROD. Apply via the reviewed batched prod-apply
-- (security advisor after DDL). Local-green first.
--
-- PROF-01: a PUBLIC instagram handle on the dating profile.
--
-- profiles_private.instagram_handle already exists, but it's a private safety
-- field (emergency-contact context) — never surfaced. This adds a separate,
-- intentionally-public handle to the dating profile, rendered ONLY on
-- clear-identity surfaces (self-view, post-reveal lock, host-viewing-a-candidate)
-- via ProfileCard — never on the blind/blurred feed (browse_feed selects an
-- explicit column set and does not include this), so it can't bypass the reveal
-- gate.
--
-- Stored WITHOUT a leading '@' by convention; the UI prepends it and links to
-- instagram.com/<handle>.
alter table profiles add column if not exists instagram_handle text;

-- Let a signed-in user set their OWN handle through the existing profiles update
-- path (column-level grant; RLS still scopes the row to id = auth.uid()). The
-- seed runs as service-role and bypasses this, but real users get the same field.
grant update (instagram_handle) on profiles to authenticated;
