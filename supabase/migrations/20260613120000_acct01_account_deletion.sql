-- supabase/migrations/20260613120000_acct01_account_deletion.sql
-- ACCT-01: Account deletion & data lifecycle (GDPR/CCPA right-to-erasure).
-- LOCKED design (12-CONTEXT.md): anonymize-in-place (NOT hard delete), 7-day soft
-- grace window, active-commitment cleanup at REQUEST, auth removal at FINALIZE (in
-- the edge handler via admin API), and reputation carry-forward (anti-abuse) via a
-- privacy-preserving salted identity hash.
--
-- This migration ships, in order:
--   1. reputation_ledger        — service-role-only table (RLS enabled, no client policies)
--   2. request_account_deletion()    — auth'd self-serve; cleans commitments, writes
--                                       the ledger, flips state, enqueues the 7-day job
--   3. cancel_account_deletion()      — auth'd; re-flip to active + cancel the job
--   4. process_account_deletion(uuid) — service-role; anonymize (the job target).
--                                       Returns the storage paths the handler must purge.
--   5. seed_reputation_from_ledger()  — auth'd; called from onboarding AFTER re-verify
--
-- Conventions (battle-tested in this repo): every function is
--   `language plpgsql security definer set search_path = public, extensions`
-- (extensions is on the path so the pgcrypto `digest()` resolves regardless of the
-- session search_path). Self-serve RPCs assert auth.uid(); service-role RPCs are
-- REVOKEd from public/anon/authenticated (admin-tooling pattern).
--
-- SALT MECHANISM (server secret, never in the client bundle): the identity hash is
-- a salted SHA-256 of the verified phone (E.164). The salt is a Postgres custom GUC
-- `app.reputation_salt`, read with current_setting('app.reputation_salt', true).
-- It is set at the DATABASE level (`alter database postgres set app.reputation_salt
-- = '<secret>'`) so it lives only server-side. A client-callable RPC running as
-- SECURITY DEFINER reads the GUC without ever exposing it to the caller. If the GUC
-- is unset we FAIL LOUD (raise 'reputation_salt_unset') so a deletion can never
-- silently skip reputation preservation. See the SUMMARY for the gated prod command.

-- pgcrypto provides digest(); it lives in the `extensions` schema on Supabase. Ensure
-- present (no-op if already installed) and reference it via the pinned search_path.
create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- 1. reputation_ledger — the durable, PII-free reputation tombstone.
-- ============================================================================
-- Keyed by a one-way salted hash of the verified phone so a returning bad actor is
-- recognized WITHOUT us retaining any profile data. GDPR posture: legitimate-interest
-- fraud/safety retention of a hash + score only (documented for the privacy policy).
create table if not exists reputation_ledger (
  identity_hash       text primary key,
  reliability_score   numeric,
  standing            standing_state,      -- written now; standing SEED wired in Phase 15
  prior_account_count int not null default 1,
  last_seen           timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

-- Service-role only: RLS enabled, NO policies for client roles, and grants revoked so
-- even a SELECT from authenticated/anon is denied. Only SECURITY DEFINER RPCs (which
-- run as the table owner) touch it.
alter table reputation_ledger enable row level security;
revoke all on table reputation_ledger from public, anon, authenticated;

-- ============================================================================
-- Internal helper: compute the salted identity hash for a verified-phone E.164.
-- Returns NULL when the input phone is null/blank (caller treats that as "no durable
-- identifier" — a user with no verified phone just deletes, no ledger write).
-- FAILS LOUD if the salt GUC is unset (a misconfigured server must not silently skip
-- reputation preservation).
-- ============================================================================
create or replace function acct_identity_hash(p_phone_e164 text)
returns text
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_salt text;
begin
  if p_phone_e164 is null or btrim(p_phone_e164) = '' then
    return null;  -- no durable identifier
  end if;
  v_salt := current_setting('app.reputation_salt', true);
  if v_salt is null or btrim(v_salt) = '' then
    raise exception 'reputation_salt_unset'
      using errcode = 'P5002',
            detail = 'app.reputation_salt GUC must be set (alter database ... set app.reputation_salt)';
  end if;
  return encode(digest(v_salt || btrim(p_phone_e164), 'sha256'), 'hex');
end $fn$;
revoke all on function acct_identity_hash(text) from public, anon, authenticated;

-- ============================================================================
-- 2. request_account_deletion() — auth'd self-serve. Idempotent.
-- ============================================================================
-- Order (fail-loud, commitments cleaned at REQUEST so nobody is locked to a ghost):
--   a. advisory lock on the user (serialize concurrent requests)
--   b. idempotent guard: already deletion_pending/deleted → no-op return
--   c. preserve reputation to the ledger from the VERIFIED phone (auth.users.phone +
--      a verifications row kind='phone' state='verified'). FAIL LOUD if salt unset;
--      skip cleanly (log analytics) if the user has no verified phone.
--   d. clean active commitments: cancel active lock(s) via match_cancel_lock (so the
--      counterpart is notified), withdraw every open offer/queue entry via
--      match_bulk_withdraw (which resolves active offers negative → closes chat).
--   e. flip account_state='deletion_pending'
--   f. enqueue the 7-day deletion_process job (dedup_key 'deletion:<uid>')
create or replace function request_account_deletion()
returns void
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  v_uid uuid := auth.uid();
  v_state account_lifecycle;
  v_phone text;
  v_hash text;
  rec record;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = 'P5001';
  end if;

  -- (a) serialize concurrent requests for the same user
  perform pg_advisory_xact_lock(hashtext('acct_del:' || v_uid::text));

  -- (b) idempotent guard
  select account_state into v_state from profiles where id = v_uid for update;
  if v_state is null then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  if v_state in ('deletion_pending', 'deleted') then
    return;  -- already pending or finalized — no-op
  end if;

  -- (c) preserve reputation BEFORE any scrub, from the verified phone.
  -- The verified phone lives in auth.users.phone; require a verifications row to
  -- prove it is actually verified (auth.users.phone can be set pre-verification).
  select u.phone into v_phone
    from auth.users u
   where u.id = v_uid
     and coalesce(btrim(u.phone), '') <> ''
     and exists (
       select 1 from verifications ve
        where ve.user_id = v_uid and ve.kind = 'phone' and ve.state = 'verified'
     );

  v_hash := acct_identity_hash(v_phone);  -- raises if salt unset; null if no phone

  if v_hash is not null then
    insert into reputation_ledger (identity_hash, reliability_score, standing, prior_account_count, last_seen)
    select v_hash, p.reliability_score, p.standing, 1, now()
      from profiles p where p.id = v_uid
    on conflict (identity_hash) do update
      set reliability_score   = excluded.reliability_score,
          standing            = excluded.standing,
          prior_account_count = reputation_ledger.prior_account_count + 1,
          last_seen           = now();
    insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
    values ('account_deletion_reputation_preserved', v_uid, 'profile', v_uid, jsonb_build_object());
  else
    -- No verified phone: acceptable per spec — just log that no ledger row was written.
    insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
    values ('account_deletion_no_durable_identifier', v_uid, 'profile', v_uid, jsonb_build_object());
  end if;

  -- (d) clean active commitments.
  -- Cancel every active lock the user is party to so the counterpart is notified.
  -- match_cancel_lock asserts p_actor = auth.uid() (satisfied here) and requires
  -- match_v2_enabled; if the flag is off there is no live match surface to clean, so
  -- skip lock cancellation cleanly in that case.
  if coalesce((select (value)::boolean from feature_config where key = 'match_v2_enabled'), false) then
    for rec in
      select id from locks
       where status = 'active' and (creator_id = v_uid or matched_user_id = v_uid)
    loop
      perform match_cancel_lock(v_uid, rec.id, 'creator_pre_lock', gen_random_uuid());
    end loop;
  end if;

  -- Withdraw every open offer/queue entry (resolves active offers negative → closes
  -- chat threads via match_resolve_offer_negative). Service-role RPC, reachable here
  -- because this function runs as SECURITY DEFINER (owner).
  perform match_bulk_withdraw(v_uid);

  -- (e) flip lifecycle to pending (removes the user from feed/lock surfaces, which
  -- already gate on account_state='active').
  update profiles set account_state = 'deletion_pending', dating_enabled = false
   where id = v_uid;

  -- (f) enqueue the 7-day finalize job.
  perform enqueue_job(
    'deletion_process',
    now() + interval '7 days',
    jsonb_build_object('user', v_uid),
    'deletion:' || v_uid::text
  );

  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('account_deletion_requested', v_uid, 'profile', v_uid,
          jsonb_build_object('finalize_after', (now() + interval '7 days')));
end $fn$;

revoke all on function request_account_deletion() from public, anon;
grant execute on function request_account_deletion() to authenticated;

-- ============================================================================
-- 3. cancel_account_deletion() — auth'd. Idempotent.
-- ============================================================================
-- Within the 7-day window the user can change their mind: re-flip to 'active' and
-- cancel the pending deletion_process job. Note this does NOT restore commitments
-- (those were cleaned at request — by design); it only stops the account from being
-- anonymized.
create or replace function cancel_account_deletion()
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_state account_lifecycle;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = 'P5001';
  end if;

  perform pg_advisory_xact_lock(hashtext('acct_del:' || v_uid::text));

  select account_state into v_state from profiles where id = v_uid for update;
  if v_state is null then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  if v_state <> 'deletion_pending' then
    return;  -- nothing pending (already active, or already finalized) — no-op
  end if;

  update profiles set account_state = 'active' where id = v_uid;
  perform cancel_jobs('deletion_process', 'deletion:' || v_uid::text);

  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('account_deletion_cancelled', v_uid, 'profile', v_uid, jsonb_build_object());
end $fn$;

revoke all on function cancel_account_deletion() from public, anon;
grant execute on function cancel_account_deletion() to authenticated;

-- ============================================================================
-- 4. process_account_deletion(p_user) — SERVICE-ROLE ONLY. The job target.
-- ============================================================================
-- Anonymize-in-place. Idempotent (already 'deleted' → no-op, returns no paths).
-- Returns the set of storage object paths (clear + blurred) the edge handler must
-- delete from the `profile-photos` bucket — we return them BEFORE deleting the
-- profile_photos rows so the handler has the full list. Does NOT remove auth here
-- (auth removal is the handler's job after this RPC succeeds — fail-loud ordering:
-- anonymize first, then handler deletes storage + auth user).
create or replace function process_account_deletion(p_user uuid)
returns setof text
language plpgsql security definer set search_path = public as $fn$
declare
  v_state account_lifecycle;
  v_clear text;
  v_blurred text;
begin
  if p_user is null then return; end if;

  perform pg_advisory_xact_lock(hashtext('acct_del:' || p_user::text));

  select account_state, clear_photo_url, blurred_photo_url
    into v_state, v_clear, v_blurred
    from profiles where id = p_user for update;
  if v_state is null then return; end if;        -- no such profile: drain cleanly
  if v_state = 'deleted' then return; end if;     -- already finalized: idempotent no-op

  -- Emit the storage paths the handler must purge: every profile_photos clear/blurred
  -- path, plus the denormalized mirror urls if they were stored as bucket paths.
  return query
    select path from (
      select clear_path   as path from profile_photos where user_id = p_user
      union
      select blurred_path as path from profile_photos where user_id = p_user and blurred_path is not null
      union all
      select v_clear   where v_clear   is not null
      union all
      select v_blurred where v_blurred is not null
    ) paths
    where path is not null and btrim(path) <> '';

  -- Delete the gallery rows (storage objects themselves are removed by the handler).
  delete from profile_photos where user_id = p_user;

  -- Delete the private PII row (birthdate/bio/phone/emergency_contact/...).
  delete from profiles_private where user_id = p_user;

  -- Scrub the tombstone profiles row: neutral name, null contact + photos, dating off,
  -- lifecycle = deleted. The row itself survives for FK integrity (matches/ratings/
  -- messages still reference it coherently).
  update profiles
     set first_name        = 'someone who left',
         email             = null,
         clear_photo_url   = null,
         blurred_photo_url  = null,
         dating_enabled     = false,
         account_state      = 'deleted'
   where id = p_user;

  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('account_deletion_finalized', null, 'profile', p_user, jsonb_build_object());
end $fn$;

revoke all on function process_account_deletion(uuid) from public, anon, authenticated;

-- ============================================================================
-- 5. seed_reputation_from_ledger() — auth'd, called from onboarding AFTER re-verify.
-- ============================================================================
-- Computes the identity hash for the CURRENT user's verified phone and, if a ledger
-- row exists, seeds the new profile's reliability_score from it and increments
-- prior_account_count + updates last_seen. Standing seed is DEFERRED to Phase 15
-- (standing machinery isn't wired yet) — we read the ledger column but do not set
-- profiles.standing here. Idempotent + best-effort (returns true iff a ledger row was
-- found and applied; never raises on "no ledger / no phone" — only on salt unset,
-- which is a server misconfig the caller should surface).
create or replace function seed_reputation_from_ledger()
returns boolean
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_hash text;
  v_score numeric;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = 'P5001';
  end if;

  select u.phone into v_phone
    from auth.users u
   where u.id = v_uid
     and coalesce(btrim(u.phone), '') <> ''
     and exists (
       select 1 from verifications ve
        where ve.user_id = v_uid and ve.kind = 'phone' and ve.state = 'verified'
     );

  v_hash := acct_identity_hash(v_phone);  -- raises if salt unset; null if no phone
  if v_hash is null then
    return false;  -- no durable identifier to look up
  end if;

  select reliability_score into v_score from reputation_ledger where identity_hash = v_hash;
  if not found then
    return false;  -- first-time identity, nothing to carry
  end if;

  -- Carry the reliability score forward (a returning user resumes their reputation).
  -- Standing carry-forward DEFERRED to Phase 15.
  update profiles set reliability_score = v_score where id = v_uid;

  -- Count the re-signup against the durable identity + refresh last_seen.
  update reputation_ledger
     set prior_account_count = prior_account_count + 1,
         last_seen = now()
   where identity_hash = v_hash;

  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('reputation_seeded_from_ledger', v_uid, 'profile', v_uid,
          jsonb_build_object('reliability_score', v_score));

  return true;
end $fn$;

revoke all on function seed_reputation_from_ledger() from public, anon;
grant execute on function seed_reputation_from_ledger() to authenticated;
