-- supabase/tests/p2_e2e_jobs_dispatch.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE u uuid; j uuid; claimed_id uuid; res json; n int; alerts int; cancelled int;
BEGIN
  u := mk_user('e2e');

  -- enqueue an offer_expiry timer (entity ids in payload, C1)
  j := enqueue_job('offer_expiry', now()-interval '1 second',
                   jsonb_build_object('offer_id', gen_random_uuid()), 'offer_expiry:e2e');
  select id into claimed_id from claim_due_jobs(10) limit 1;
  IF claimed_id <> j THEN RAISE EXCEPTION 'claim returned wrong job'; END IF;
  PERFORM complete_job(j);
  PERFORM 1 FROM jobs WHERE id=j AND status='done';
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_expiry job not done'; END IF;

  -- cancel_jobs no-ops on an already-resolved key, cancels a fresh pending one
  PERFORM enqueue_job('offer_expiry', now()+interval '1 hour', '{}'::jsonb, 'cancel:e2e');
  cancelled := cancel_jobs('offer_expiry', 'cancel:e2e');
  IF cancelled <> 1 THEN RAISE EXCEPTION 'cancel_jobs expected 1, got %', cancelled; END IF;

  -- safety dispatch with NO REACHABLE CHANNEL (no device AND email disabled) → fail loud
  -- (admin_alert + admin_alerts row). Email is a valid safety fallback, so the genuine
  -- fail-loud path requires both no push/web device AND email off (escalation hierarchy:
  -- push → web → email → admin_alert). mk_user registers no device; disable email here.
  update notification_preferences set email_enabled=false where user_id = u;
  SELECT count(*) INTO alerts FROM admin_alerts WHERE kind='safety_no_device';
  res := dispatch_notification(u, 'safety_checkin',
           json_build_object('title','Check in','body','You ok?','dedup_key','e2e:safe')::jsonb);
  IF (res->>'channel') <> 'admin_alert' THEN RAISE EXCEPTION 'safety w/ no reachable channel not fail-loud: %', res->>'channel'; END IF;
  SELECT count(*) INTO n FROM admin_alerts WHERE kind='safety_no_device';
  IF n <> alerts + 1 THEN RAISE EXCEPTION 'fail-loud admin_alert not raised'; END IF;

  RAISE NOTICE 'p2 e2e jobs+dispatch OK';
  ROLLBACK;
END $$;
