-- supabase/tests/acct01_account_deletion.sql
-- ACCT-01 account-deletion lifecycle. Mirrors b_job_rpcs.sql conventions (fixtures +
-- DO blocks + set_config for auth.uid + ROLLBACK per case + RAISE EXCEPTION on fail).
-- Run against LOCAL: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f this
-- REQUIRES: app.reputation_salt GUC set (alter database postgres set app.reputation_salt='...').
\i supabase/tests/_fixtures.sql
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- Guard: the salt must be configured or every reputation path fails loud (by design).
DO $$
BEGIN
  IF current_setting('app.reputation_salt', true) IS NULL
     OR btrim(current_setting('app.reputation_salt', true)) = '' THEN
    RAISE EXCEPTION 'acct01 PRECONDITION: app.reputation_salt GUC is unset — set it before running these tests';
  END IF;
END $$;

-- Helper: give a user a VERIFIED phone (auth.users.phone + verifications row).
create or replace function mk_verified_phone(p_user uuid, p_phone text) returns void
language plpgsql as $$
begin
  update auth.users set phone = p_phone where id = p_user;
  insert into verifications(user_id, kind, state, verified_at)
  values (p_user, 'phone', 'verified', now())
  on conflict do nothing;
end $$;

-- ============================================================================
-- CASE 1: request_account_deletion cleans commitments + writes ledger + enqueues
--          job + flips state; cancel restores 'active' and cancels the job.
-- ============================================================================
DO $$
DECLARE
  cre uuid; actor uuid; other uuid;
  it uuid; i1 uuid; i2 uuid; i3 uuid;
  oid uuid; lid uuid; hash text; n int;
BEGIN
  cre := mk_user('ad_cre'); actor := mk_user('ad_actor'); other := mk_user('ad_other');
  insert into profiles_private(user_id, birthdate, bio)
    values (cre,'1990-01-01','x'),(actor,'1990-01-01','actor bio'),(other,'1990-01-01','x')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true, reliability_score=88.50, standing='warned' where id=actor;
  PERFORM mk_verified_phone(actor, '+15555550123');
  it := mk_itinerary(cre);

  -- actor: an open queue entry, an active offer, AND an active lock as matched party.
  i1 := mk_instance(it, cre, now() + interval '3 days');
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
    values (i1, actor, cre, 'interested');

  i2 := mk_instance(it, cre, now() + interval '4 days');
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
    values (i2, actor, cre, 'offer_active');
  insert into offers(date_instance_id, candidate_id, creator_id, status, expires_at)
    values (i2, actor, cre, 'active', now() + interval '1 hour') returning id into oid;

  i3 := mk_instance(it, cre, now() + interval '5 days');
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
    values (i3, actor, cre, 'locked');
  insert into locks(date_instance_id, creator_id, matched_user_id, status)
    values (i3, cre, actor, 'active') returning id into lid;

  -- ACT as the actor (auth.uid() = actor)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor::text)::text, true);
  PERFORM request_account_deletion();

  -- ASSERT: state flipped + dating off
  PERFORM 1 FROM profiles WHERE id=actor AND account_state='deletion_pending' AND dating_enabled=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE1: account_state not deletion_pending'; END IF;

  -- ASSERT: lock cancelled (counterpart notified)
  PERFORM 1 FROM locks WHERE id=lid AND status='cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE1: active lock not cancelled'; END IF;

  -- ASSERT: active offer resolved negative + open queue entry withdrawn
  PERFORM 1 FROM offers WHERE id=oid AND status IN ('passed','expired');
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE1: active offer not resolved'; END IF;
  PERFORM 1 FROM queue_entries WHERE date_instance_id=i1 AND candidate_id=actor AND status='offer_passed';
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE1: open queue entry not withdrawn'; END IF;

  -- ASSERT: 7-day deletion_process job enqueued with the right dedup key
  PERFORM 1 FROM jobs
   WHERE type='deletion_process' AND dedup_key='deletion:'||actor::text
     AND status='pending' AND run_after > now() + interval '6 days';
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE1: deletion_process job not enqueued (7-day)'; END IF;

  -- ASSERT: ledger written from the verified phone, carrying score + standing.
  hash := acct_identity_hash('+15555550123');
  PERFORM 1 FROM reputation_ledger
   WHERE identity_hash=hash AND reliability_score=88.50 AND standing='warned' AND prior_account_count=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE1: reputation_ledger not written correctly'; END IF;

  -- IDEMPOTENT request: second call is a no-op (no second job, no error).
  PERFORM request_account_deletion();
  SELECT count(*) INTO n FROM jobs
   WHERE type='deletion_process' AND dedup_key='deletion:'||actor::text AND status IN ('pending','running');
  IF n <> 1 THEN RAISE EXCEPTION 'CASE1: idempotent request created a duplicate job (got %)', n; END IF;

  -- CANCEL restores active + cancels the job.
  PERFORM cancel_account_deletion();
  PERFORM 1 FROM profiles WHERE id=actor AND account_state='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE1: cancel did not restore active'; END IF;
  PERFORM 1 FROM jobs WHERE type='deletion_process' AND dedup_key='deletion:'||actor::text AND status='cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE1: cancel did not cancel the job'; END IF;

  -- CANCEL idempotent: second call no-ops (state already active).
  PERFORM cancel_account_deletion();

  RAISE NOTICE 'acct01 CASE1: request cleans+ledger+enqueue+flip, cancel restores OK';
  ROLLBACK;
END $$;

-- ============================================================================
-- CASE 2: process_account_deletion anonymizes (PII scrubbed, profiles_private gone,
--          photos rows gone, state='deleted') and returns storage paths. Idempotent.
-- ============================================================================
DO $$
DECLARE
  u uuid; npaths int; nprivate int; nphotos int;
BEGIN
  u := mk_user('ad_finalize');
  insert into profiles_private(user_id, birthdate, bio, emergency_contact)
    values (u,'1990-01-01','secret bio','{"name":"mom"}'::jsonb);
  update profiles
     set email='real@example.com', clear_photo_url=u::text||'/primary.jpg',
         blurred_photo_url=u::text||'/primary_blurred.jpg', dating_enabled=true,
         account_state='deletion_pending'
   where id=u;
  insert into profile_photos(user_id, clear_path, blurred_path, sort_order, is_primary)
    values (u, u::text||'/a.jpg', u::text||'/a_blurred.jpg', 0, true),
           (u, u::text||'/b.jpg', u::text||'/b_blurred.jpg', 1, false);

  -- ACT: returns the storage paths the handler must purge.
  SELECT count(*) INTO npaths FROM process_account_deletion(u);
  -- 2 clear + 2 blurred from gallery + 2 from the mirror urls = 6 paths.
  IF npaths < 4 THEN RAISE EXCEPTION 'CASE2: expected >=4 storage paths, got %', npaths; END IF;

  -- ASSERT: PII scrubbed on the tombstone row.
  PERFORM 1 FROM profiles
   WHERE id=u AND first_name='someone who left' AND email IS NULL
     AND clear_photo_url IS NULL AND blurred_photo_url IS NULL
     AND dating_enabled=false AND account_state='deleted';
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE2: profile not anonymized'; END IF;

  -- ASSERT: profiles_private + profile_photos rows gone.
  SELECT count(*) INTO nprivate FROM profiles_private WHERE user_id=u;
  IF nprivate <> 0 THEN RAISE EXCEPTION 'CASE2: profiles_private not deleted'; END IF;
  SELECT count(*) INTO nphotos FROM profile_photos WHERE user_id=u;
  IF nphotos <> 0 THEN RAISE EXCEPTION 'CASE2: profile_photos not deleted'; END IF;

  -- IDEMPOTENT: re-run on an already-deleted profile returns no paths + no error.
  SELECT count(*) INTO npaths FROM process_account_deletion(u);
  IF npaths <> 0 THEN RAISE EXCEPTION 'CASE2: idempotent re-run returned paths (got %)', npaths; END IF;

  RAISE NOTICE 'acct01 CASE2: process anonymizes + returns paths + idempotent OK';
  ROLLBACK;
END $$;

-- ============================================================================
-- CASE 3: re-signup carries reliability_score via the ledger (anti-abuse).
-- ============================================================================
DO $$
DECLARE
  old_u uuid; new_u uuid; got boolean; v_score numeric; v_count int;
BEGIN
  -- Old account with a reputation + verified phone, requests deletion → ledger row.
  old_u := mk_user('ad_old');
  insert into profiles_private(user_id, birthdate) values (old_u,'1990-01-01');
  update profiles set reliability_score=42.00, standing='cooldown' where id=old_u;
  PERFORM mk_verified_phone(old_u, '+15555559999');
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', old_u::text)::text, true);
  PERFORM request_account_deletion();

  -- Simulate finalize freeing the old phone (the handler deletes auth.users(old_u),
  -- which releases the unique auth.users.phone so the new account can re-verify it).
  UPDATE auth.users SET phone = NULL WHERE id = old_u;

  -- New account, SAME phone (re-verified), seeds reputation on onboarding.
  new_u := mk_user('ad_new');
  insert into profiles_private(user_id, birthdate) values (new_u,'1990-01-01');
  PERFORM mk_verified_phone(new_u, '+15555559999');
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', new_u::text)::text, true);
  got := seed_reputation_from_ledger();

  IF got IS NOT TRUE THEN RAISE EXCEPTION 'CASE3: seed_reputation_from_ledger returned false for returning identity'; END IF;
  SELECT reliability_score INTO v_score FROM profiles WHERE id=new_u;
  IF v_score IS DISTINCT FROM 42.00 THEN RAISE EXCEPTION 'CASE3: reliability_score not carried (got %)', v_score; END IF;

  -- prior_account_count incremented (1 at request → 2 at seed).
  SELECT prior_account_count INTO v_count FROM reputation_ledger
   WHERE identity_hash=acct_identity_hash('+15555559999');
  IF v_count <> 2 THEN RAISE EXCEPTION 'CASE3: prior_account_count not incremented (got %)', v_count; END IF;

  -- IDEMPOTENT-ish: a brand-new identity with no ledger row returns false.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', mk_user('ad_fresh')::text)::text, true);
  -- (no verified phone for ad_fresh) → false, no raise.
  IF seed_reputation_from_ledger() IS NOT FALSE THEN RAISE EXCEPTION 'CASE3: seed returned true for no-phone user'; END IF;

  RAISE NOTICE 'acct01 CASE3: reputation carries on re-signup OK';
  ROLLBACK;
END $$;

-- ============================================================================
-- CASE 4: reputation_ledger is service-role only — authenticated cannot read/write.
-- ============================================================================
DO $$
DECLARE u uuid; denied boolean := false;
BEGIN
  u := mk_user('ad_rls');
  -- Become the authenticated role with a JWT (RLS enforced; no policy on the ledger).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', u::text)::text, true);
  SET LOCAL role authenticated;

  -- READ must be denied (table-level grant revoked → permission denied).
  BEGIN
    PERFORM 1 FROM reputation_ledger LIMIT 1;
    RAISE EXCEPTION 'CASE4: authenticated SELECT on reputation_ledger was NOT denied';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'CASE4: ledger read not denied'; END IF;

  denied := false;
  -- WRITE must be denied too.
  BEGIN
    INSERT INTO reputation_ledger(identity_hash, reliability_score) VALUES ('x', 1);
    RAISE EXCEPTION 'CASE4: authenticated INSERT on reputation_ledger was NOT denied';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'CASE4: ledger write not denied'; END IF;

  RESET role;
  RAISE NOTICE 'acct01 CASE4: reputation_ledger service-role-only (read+write denied) OK';
  ROLLBACK;
END $$;

DO $$ BEGIN RAISE NOTICE 'acct01: all account-deletion assertions OK'; END $$;
