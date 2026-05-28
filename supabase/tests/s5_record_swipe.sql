-- supabase/tests/s5_record_swipe.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; usr uuid; itin uuid; inst uuid; n int;
BEGIN
  cre := mk_user('creator'); usr := mk_user('swiper');
  itin := mk_itinerary(cre); inst := mk_instance(itin, cre, now()+interval '3 days');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',usr,'role','authenticated')::text, true);

  perform record_swipe(inst, 'right');
  perform record_swipe(inst, 'right');               -- idempotent: second is a no-op
  perform record_swipe(inst, 'left');                -- swipe is final: must NOT flip to left

  reset role;
  select count(*) into n from swipes where swiper_id=usr and date_instance_id=inst;
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly 1 swipe row, got %', n; END IF;
  PERFORM 1 from swipes where swiper_id=usr and date_instance_id=inst
    and direction='right' and creator_id=cre;
  IF NOT FOUND THEN RAISE EXCEPTION 'swipe row wrong: direction not right or creator_id not denormalized'; END IF;
  RAISE NOTICE 's5_record_swipe OK';
  ROLLBACK;
END $$;
