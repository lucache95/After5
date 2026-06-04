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
  -- 5b PREREQ additions (5 extra values — see 20260527124550_s2_notification_type_5b_extend)
  IF NOT ('reciprocal_detected' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing reciprocal_detected (5b)'; END IF;
  IF NOT ('offer_passed' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing offer_passed (5b)'; END IF;
  IF NOT ('offer_expired' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing offer_expired (5b)'; END IF;
  IF NOT ('lock_cancelled_frozen' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing lock_cancelled_frozen (5b)'; END IF;
  IF NOT ('lock_cancelled_rolled' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing lock_cancelled_rolled (5b)'; END IF;
  -- Inbox/loop-closure additive values (20260603120000 gated inbox + 20260604120000 Phase-02 wave-1).
  IF NOT ('interest_received' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing interest_received (gated inbox)'; END IF;
  IF NOT ('identity_revealed' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing identity_revealed (gated inbox)'; END IF;
  IF NOT ('night_cancelled' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing night_cancelled (Phase 02 D-09)'; END IF;
  IF NOT ('night_changed' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing night_changed (Phase 02 D-09)'; END IF;
  -- Confirm total count = 24 (15 base/C11.11 + 5 from 5b PREREQ + 2 gated inbox + 2 Phase-02 wave-1).
  -- Additive only — enum values are never dropped, so this monotonically grows; bump on each add.
  IF array_length(enum_range(null::notification_type), 1) <> 24
    THEN RAISE EXCEPTION 'notification_type should have 24 values, got %',
      array_length(enum_range(null::notification_type), 1); END IF;
END $$;

-- Recipient may mark-read ONLY: authenticated can update read_at but NOT type/delivered/payload.
DO $$
DECLARE u uuid; nid uuid; ok boolean := false;
BEGIN
  u := mk_user('notif');
  insert into notifications (user_id, type, payload) values (u, 'new_match', '{}') returning id into nid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  EXECUTE 'set local role authenticated';
  -- allowed: mark read
  update notifications set read_at = now() where id = nid;
  -- denied: mutate a protected column (no column-grant) -> insufficient_privilege
  BEGIN
    update notifications set type = 'safety_alert' where id = nid;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  EXECUTE 'reset role';
  IF NOT ok THEN RAISE EXCEPTION 'recipient was able to mutate notifications.type (should be read_at-only)'; END IF;
  RAISE NOTICE 'notifications mark-read column lock OK';
  ROLLBACK;
END $$;
