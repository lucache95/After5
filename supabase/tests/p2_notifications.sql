-- supabase/tests/p2_notifications.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='notifications' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'notifications missing or RLS off'; END IF;
  IF NOT ('safety_checkin' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing safety_checkin'; END IF;
  IF NOT ('safety_alert' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing safety_alert'; END IF;
  IF NOT ('new_match' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing new_match'; END IF;
  -- C11.11 additions (4 extra values)
  IF NOT ('verification_passed' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing verification_passed (C11.11)'; END IF;
  IF NOT ('verification_failed' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing verification_failed (C11.11)'; END IF;
  IF NOT ('appeal_resolved' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing appeal_resolved (C11.11)'; END IF;
  IF NOT ('offer_withdrawn' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing offer_withdrawn (C11.11)'; END IF;
  -- Confirm total count = 15
  IF array_length(enum_range(null::notification_type), 1) <> 15
    THEN RAISE EXCEPTION 'notification_type should have 15 values, got %',
      array_length(enum_range(null::notification_type), 1); END IF;
END $$;
