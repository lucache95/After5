-- supabase/tests/e19_producers.sql
-- E19 (REQ-E19 / D-03 / D-04): the PRODUCER contract for the two lock RPCs.
-- Asserts that BOTH match_accept_offer AND match_resolve_reciprocal enqueue the
-- two safety jobs (day_of_reconfirm + safety_checkin) BESIDE the existing
-- rating_window enqueue, with the correct dedup keys (reconfirm:||lid,
-- checkin:||lid), proving Pitfall 2 — the reciprocal path is wired, not just
-- the accept path.
--
-- SQL assertion script — the project's local-apply verification posture (no
-- pgTAP harness in-tree). RAISE EXCEPTION on any failed assertion so a non-zero
-- psql exit signals failure. EXECUTED in plan 06-05 against the local stack
-- AFTER 20260606130000_e19_lock_rpc_producers.sql applies; authored here.
--
-- Driving recipes mirror the existing lock tests:
--   accept path     -> a_accept_lock.sql (shortlist -> offer -> accept)
--   reciprocal path -> b_reciprocal.sql  (two cross offers -> resolve_reciprocal)
--
-- Two assertions, one per lock RPC. Each drives a real lock and asserts all
-- THREE jobs exist for that lid (rating: from the pre-existing enqueue +
-- reconfirm:/checkin: from the new E19 enqueues — confirming the safety jobs
-- sit beside, not instead of, rating_window).
\i supabase/tests/_fixtures.sql

insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- Assert all three safety/rating jobs exist for a lock id, raising on any miss.
-- Used by both paths so the contract is identical across accept + reciprocal.
create or replace function e19_assert_producer_jobs(p_lock uuid, p_ctx text)
returns void language plpgsql as $$
begin
  -- rating_window (pre-existing) — the new enqueues must sit beside it, not replace it
  perform 1 from jobs where type='rating_window' and dedup_key='rating:'||p_lock::text;
  if not found then
    raise exception 'E19(%): rating_window job missing (dedup rating:%)', p_ctx, p_lock;
  end if;

  -- day_of_reconfirm (NEW) — dedup key reconfirm:||lid, payload carries lock_id
  perform 1 from jobs
    where type='day_of_reconfirm' and dedup_key='reconfirm:'||p_lock::text
      and (payload->>'lock_id')::uuid = p_lock;
  if not found then
    raise exception 'E19(%): day_of_reconfirm job missing (dedup reconfirm:%)', p_ctx, p_lock;
  end if;

  -- safety_checkin (NEW) — dedup key checkin:||lid, payload carries lock_id
  perform 1 from jobs
    where type='safety_checkin' and dedup_key='checkin:'||p_lock::text
      and (payload->>'lock_id')::uuid = p_lock;
  if not found then
    raise exception 'E19(%): safety_checkin job missing (dedup checkin:%)', p_ctx, p_lock;
  end if;
end $$;

-- ============================================================================
-- (a) ACCEPT PATH: match_accept_offer enqueues both safety jobs + rating_window
-- ============================================================================
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; oid uuid; lid uuid;
BEGIN
  cre := mk_user('e19p_a_cre'); cand := mk_user('e19p_a_cand');
  insert into profiles_private(user_id, birthdate) values (cre, '1990-01-01'), (cand, '1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;

  -- candidate accepts → lock created, all three jobs enqueued atomically
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  lid := match_accept_offer(cand, oid, gen_random_uuid());
  IF lid IS NULL THEN RAISE EXCEPTION 'E19(accept): accept_offer returned NULL'; END IF;

  PERFORM e19_assert_producer_jobs(lid, 'accept');

  RAISE NOTICE 'E19(accept) OK: match_accept_offer enqueues rating_window + day_of_reconfirm + safety_checkin';
  ROLLBACK;
END $$;

-- ============================================================================
-- (b) RECIPROCAL PATH: match_resolve_reciprocal enqueues both safety jobs too
--     (Pitfall 2 — the reciprocal path must NOT be forgotten).
-- ============================================================================
DO $$
DECLARE
  alice uuid; bob uuid;
  itin_a uuid; itin_b uuid; inst_a uuid; inst_b uuid;
  res_a jsonb; res_b jsonb; v_pair_id uuid; lid uuid;
BEGIN
  alice := mk_user('e19p_r_alice'); bob := mk_user('e19p_r_bob');
  insert into profiles_private(user_id, birthdate)
    values (alice,'1990-01-01'),(bob,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (alice, bob);

  -- Alice creates a seeking instance; Bob shortlisted; Alice offers Bob (kind=offer).
  itin_a := mk_itinerary(alice);
  inst_a := mk_instance(itin_a, alice, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (bob, inst_a, alice, 'right');
  PERFORM match_ingest_interest(inst_a);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', alice::text)::text, true);
  PERFORM match_shortlist(alice, inst_a, bob, 1);
  res_a := match_make_offer(alice, inst_a, bob, gen_random_uuid());
  IF res_a->>'kind' IS DISTINCT FROM 'offer' THEN
    RAISE EXCEPTION 'E19(recip): Alice offer kind != offer (got %)', res_a;
  END IF;

  -- Bob creates his own seeking instance; Alice shortlisted; Bob offers Alice → reciprocal.
  itin_b := mk_itinerary(bob);
  inst_b := mk_instance(itin_b, bob, now() + interval '3 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (alice, inst_b, bob, 'right');
  PERFORM match_ingest_interest(inst_b);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', bob::text)::text, true);
  PERFORM match_shortlist(bob, inst_b, alice, 1);
  res_b := match_make_offer(bob, inst_b, alice, gen_random_uuid());
  IF res_b->>'kind' IS DISTINCT FROM 'reciprocal' THEN
    RAISE EXCEPTION 'E19(recip): Bob offer must return kind=reciprocal (got %)', res_b;
  END IF;
  v_pair_id := (res_b->>'pair_id')::uuid;
  IF v_pair_id IS NULL THEN RAISE EXCEPTION 'E19(recip): reciprocal return missing pair_id'; END IF;

  -- Resolve: Alice chooses inst_a → a single lock, all three jobs enqueued on the
  -- reciprocal path (p_chosen_instance = inst_a).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', alice::text)::text, true);
  lid := match_resolve_reciprocal(alice, v_pair_id, inst_a, gen_random_uuid());
  IF lid IS NULL THEN RAISE EXCEPTION 'E19(recip): resolve returned NULL lock'; END IF;

  PERFORM e19_assert_producer_jobs(lid, 'reciprocal');

  RAISE NOTICE 'E19(reciprocal) OK: match_resolve_reciprocal enqueues rating_window + day_of_reconfirm + safety_checkin (Pitfall 2 wired)';
  ROLLBACK;
END $$;

-- cleanup helper
drop function if exists e19_assert_producer_jobs(uuid, text);
