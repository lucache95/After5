-- supabase/tests/a_reveal_predicate.sql
-- A.6: match_reveal_allowed enumeration — 4 cases.
\i supabase/tests/_fixtures.sql
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

DO $$
DECLARE cre uuid; cand uuid; stranger uuid; itin uuid; inst uuid; oid uuid; lid uuid;
BEGIN
  cre := mk_user('rp_cre'); cand := mk_user('rp_cand'); stranger := mk_user('rp_stranger');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01'),(stranger,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand, stranger);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');

  -- Case 0: bare instance, no offers/locks. ONLY creator sees.
  IF NOT match_reveal_allowed(cre, inst) THEN
    RAISE EXCEPTION 'A.6 case 0: creator should always reveal';
  END IF;
  IF match_reveal_allowed(cand, inst) THEN
    RAISE EXCEPTION 'A.6 case 0: stranger candidate should NOT reveal pre-offer';
  END IF;
  IF match_reveal_allowed(stranger, inst) THEN
    RAISE EXCEPTION 'A.6 case 0: unrelated user should NOT reveal';
  END IF;

  -- Bring candidate into an active offer
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;

  -- Case 1: candidate of active offer reveals
  IF NOT match_reveal_allowed(cand, inst) THEN
    RAISE EXCEPTION 'A.6 case 1: active-offer candidate should reveal';
  END IF;
  -- Stranger still cannot
  IF match_reveal_allowed(stranger, inst) THEN
    RAISE EXCEPTION 'A.6 case 1: stranger should NOT reveal';
  END IF;

  -- Candidate accepts → lock formed
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  lid := match_accept_offer(cand, oid, gen_random_uuid());

  -- Case 2: lock participants reveal
  IF NOT match_reveal_allowed(cre, inst) THEN
    RAISE EXCEPTION 'A.6 case 2: creator still reveals after lock';
  END IF;
  IF NOT match_reveal_allowed(cand, inst) THEN
    RAISE EXCEPTION 'A.6 case 2: matched candidate (lock participant) should reveal';
  END IF;
  IF match_reveal_allowed(stranger, inst) THEN
    RAISE EXCEPTION 'A.6 case 2: stranger still should NOT reveal';
  END IF;

  -- Case 3: cancelled lock. Per spec §2.6, the offer.status='accepted' persists as a
  -- permanent historical fact unless B's cancel mechanism rolls it back. So the
  -- cancelled-lock candidate STILL reveals (via the accepted-offer pathway).
  -- If product wants cancelled-lock to revoke reveal, B's match_cancel_lock must
  -- also update offer.status to e.g. 'cancelled' — that's B's design call.
  update locks set status='cancelled' where id=lid;
  IF NOT match_reveal_allowed(cand, inst) THEN
    RAISE EXCEPTION 'A.6 case 3: cancelled-lock candidate should STILL reveal via accepted-offer';
  END IF;
  IF NOT match_reveal_allowed(cre, inst) THEN
    RAISE EXCEPTION 'A.6 case 3: creator still always reveals';
  END IF;
  -- But: if the offer ALSO gets rolled back (e.g., B rewrites it on safety cancel),
  -- the candidate loses reveal:
  update offers set status='passed' where id=oid;
  IF match_reveal_allowed(cand, inst) THEN
    RAISE EXCEPTION 'A.6 case 3b: with offer rolled to non-accepted, candidate should NOT reveal';
  END IF;

  RAISE NOTICE 'A.6: match_reveal_allowed 4-case enumeration OK';
  ROLLBACK;
END $$;
