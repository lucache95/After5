-- supabase/tests/p0_audit_log.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; usr uuid; itin uuid; inst uuid; l uuid; n int;
BEGIN
  cre := mk_user('c');
  usr := mk_user('u');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now()+interval '3 days');
  insert into locks (date_instance_id,creator_id,matched_user_id) values (inst,cre,usr) returning id into l;
  update locks set status='completed' where id=l;
  select count(*) into n from audit_log where entity='locks' and entity_id=l;
  IF n < 1 THEN RAISE EXCEPTION 'audit_log did not capture lock transition'; END IF;
  RAISE NOTICE 'audit_log OK (% rows)', n;
  ROLLBACK;
END $$;
