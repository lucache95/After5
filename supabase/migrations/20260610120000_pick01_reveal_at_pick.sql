-- 20260610120000_pick01_reveal_at_pick.sql
-- Reveal-at-pick (founder decision 2026-06-10): the identity reveal moves from
-- LOCK-time to PICK-time. The candidate of an ACTIVE (unexpired) or accepted
-- offer sees the HOST's clear profile on /offers/[offerId] before deciding.
--
-- AUDIT FINDING (this migration is the contract record, not a behavior change):
-- the reveal predicates ALREADY grant exactly this scope, and nothing narrower
-- sits in front of them:
--   * match_reveal_allowed_pair(viewer, target) — branch (b) (126600, hardened
--     in 127700): TRUE when the viewer is the candidate of an offer on the
--     target-creator's instance with
--       (o.status = 'accepted' OR (o.status = 'active' AND o.expires_at > now()))
--     A passed/expired offer drops out of the predicate, so access self-revokes;
--     the lock-stage branches (l.status in ('active','completed')) are separate
--     and untouched.
--   * profile_photos_revealed_read (m6, 20260602130100) — table SELECT gated on
--     match_reveal_allowed_pair: the candidate can list the host's gallery rows
--     (clear_path) at offer stage already.
--   * profile_photos_clear_reveal_read on storage.objects (m6, 20260602130200)
--     — clear-object SELECT gated on the SAME predicate via the profile_photos
--     join: only the host's own photos, only while the pair predicate holds.
-- Until now the OFFER-stage half of that grant was treated as defense-in-depth
-- surplus and the APP enforced blur-at-offer (E15 rung-2 / T-05-05). With
-- reveal-at-pick the app now USES the offer-stage grant; these comments make
-- the intent durable so a future "tighten RLS to lock-only" cleanup doesn't
-- silently break the pick-time ceremony.
--
-- Blind contract doc deltas (code comments updated alongside this migration):
-- E15/E16 references that said "clear only post-lock" now read
-- "clear once picked (active/accepted offer) or locked".

comment on function public.match_reveal_allowed_pair(uuid, uuid) is
  'Pair reveal predicate. OFFER branch (accepted, or active AND unexpired) is LOAD-BEARING since reveal-at-pick (2026-06-10): the candidate sees the host clear on the offer screen. Do not narrow to lock-only.';

comment on policy profile_photos_revealed_read on public.profile_photos is
  'Counterparty gallery read via match_reveal_allowed_pair. Offer-stage (active unexpired / accepted) access is intentional: reveal-at-pick (2026-06-10).';

-- NOTE: storage.objects is owned by supabase_storage_admin, so `comment on policy
-- profile_photos_clear_reveal_read on storage.objects` fails under the migration
-- role (42501). Its contract lives in this file's header instead: the policy's
-- match_reveal_allowed_pair gate makes offer-stage clear reads intentional and
-- self-revoking on pass/expire.
