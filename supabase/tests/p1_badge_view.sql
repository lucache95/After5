-- supabase/tests/p1_badge_view.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
BEGIN
  PERFORM 1 FROM information_schema.columns WHERE table_name='public_profile_card' AND column_name='clear_photo_url';
  IF FOUND THEN RAISE EXCEPTION 'LEAK: public_profile_card exposes clear_photo_url'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='public_profile_card' AND column_name='first_name';
  IF FOUND THEN RAISE EXCEPTION 'LEAK: public_profile_card exposes first_name (spec: no name)'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='public_profile_card' AND column_name='full_name';
  IF FOUND THEN RAISE EXCEPTION 'LEAK: public_profile_card exposes full_name'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='public_profile_card' AND column_name='badge_verified';
  IF NOT FOUND THEN RAISE EXCEPTION 'public_profile_card missing badge_verified'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='public_profile_card' AND column_name='badge_is_new';
  IF NOT FOUND THEN RAISE EXCEPTION 'public_profile_card missing badge_is_new'; END IF;
END $$;
