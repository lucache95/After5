-- 20260602120600_m4_revoke_anon_execute.sql
-- M4 follow-up hardening. Restores the anon-EXECUTE revoke that 20260527127600
-- applied but that M4 silently undid:
--   * 20260602120300 created a NEW post_night overload (uuid, timestamptz, uuid, int, uuid).
--     Supabase default privileges auto-grant anon EXECUTE on a new signature; the
--     migration only revoked from public + granted authenticated. The 2026-05-27 revoke
--     targeted the OLD 4-arg signature, so the new overload leaks anon EXECUTE.
--   * 20260602120400 dropped+recreated browse_feed_for_viewer(uuid, geography,
--     timestamptz, uuid, int). The drop discarded the prior anon revoke and the recreate
--     re-triggered the anon auto-grant.
-- Both functions self-enforce auth.uid() (anon callers raise 28000 not-authenticated),
-- so impact is low — but an unauthenticated caller should not be able to invoke a
-- SECURITY DEFINER user RPC at all, and we keep parity with the shipped hardening.
-- authenticated retains EXECUTE (these are the live feed/post-night surfaces).
-- Idempotent: REVOKE on an already-revoked grant is a no-op.
revoke execute on function public.post_night(uuid, timestamptz, uuid, integer, uuid) from anon;
revoke execute on function public.browse_feed_for_viewer(uuid, geography, timestamptz, uuid, integer) from anon;
