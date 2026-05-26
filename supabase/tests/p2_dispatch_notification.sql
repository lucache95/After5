-- supabase/tests/p2_dispatch_notification.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE u uuid; res json; ch text; n int; alerts_before int; alerts_after int;
BEGIN
  u := mk_user('disp');
  -- opt out of everything (non-safety) + no device registered
  update notification_preferences
     set push_enabled=false, email_enabled=false, offers_enabled=false
   where user_id = u;

  -- non-safety offer notification with no consent/channel → suppressed
  res := dispatch_notification(u, 'offer_received',
           json_build_object('title','Offer','body','You got an offer','dedup_key','d1')::jsonb);
  ch := res->>'channel';
  IF ch <> 'suppressed' THEN RAISE EXCEPTION 'opted-out offer not suppressed: %', ch; END IF;

  -- C11.11 reconciliation: offer_withdrawn also respects offers_enabled → suppressed
  res := dispatch_notification(u, 'offer_withdrawn',
           json_build_object('title','Withdrawn','body','Offer withdrawn','dedup_key','dw1')::jsonb);
  ch := res->>'channel';
  IF ch <> 'suppressed' THEN RAISE EXCEPTION 'opted-out offer_withdrawn not suppressed: %', ch; END IF;

  -- C11.11 reconciliation: verification_passed respects account_enabled
  update notification_preferences set account_enabled=false where user_id = u;
  res := dispatch_notification(u, 'verification_passed',
           json_build_object('title','Verified','body','You are verified','dedup_key','dv1')::jsonb);
  ch := res->>'channel';
  IF ch <> 'suppressed' THEN RAISE EXCEPTION 'opted-out verification_passed not suppressed: %', ch; END IF;

  -- safety notification, NO device → must fail loud to admin_alert (never suppressed)
  SELECT count(*) INTO alerts_before FROM admin_alerts WHERE kind='safety_no_device';
  res := dispatch_notification(u, 'safety_checkin',
           json_build_object('title','Check in','body','You ok?','dedup_key','d2')::jsonb);
  ch := res->>'channel';
  IF ch = 'suppressed' THEN RAISE EXCEPTION 'safety notification was suppressed'; END IF;
  IF ch <> 'admin_alert' THEN RAISE EXCEPTION 'safety w/ no device should fail loud, got %', ch; END IF;
  SELECT count(*) INTO alerts_after FROM admin_alerts WHERE kind='safety_no_device';
  IF alerts_after <> alerts_before + 1 THEN RAISE EXCEPTION 'no admin_alert raised for tokenless safety'; END IF;

  -- dedup: re-dispatch same (type, dedup_key) does not insert a 2nd row
  res := dispatch_notification(u, 'safety_checkin',
           json_build_object('title','Check in','body','You ok?','dedup_key','d2')::jsonb);
  SELECT count(*) INTO n FROM notifications WHERE type='safety_checkin' AND dedup_key='d2';
  IF n <> 1 THEN RAISE EXCEPTION 'dedup failed: % rows', n; END IF;
  RAISE NOTICE 'dispatch_notification OK';
  ROLLBACK;
END $$;
