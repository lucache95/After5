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
  -- Must capture the INSERT row...
  select count(*) into n from audit_log where entity='locks' and entity_id=l and action='insert';
  IF n < 1 THEN RAISE EXCEPTION 'audit_log did not capture lock INSERT'; END IF;
  -- ...AND specifically the status_change row (guards the UPDATE branch of the trigger; a weaker
  -- count(*)>=1 would pass on the INSERT row alone even if status_change logging were broken).
  select count(*) into n from audit_log
    where entity='locks' and entity_id=l and action='status_change'
      and old_status='active' and new_status='completed';
  IF n < 1 THEN RAISE EXCEPTION 'audit_log did not capture lock status_change'; END IF;
  RAISE NOTICE 'audit_log OK (insert + status_change captured)';
  ROLLBACK;
END $$;
