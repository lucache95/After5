-- supabase/tests/p1_age_gate.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE minor uuid; adult uuid; blocked boolean := false;
BEGIN
  minor := mk_user('minor');
  adult := mk_user('adult');
  insert into profiles_private (user_id, birthdate) values (minor, current_date - interval '16 years')
    on conflict (user_id) do update set birthdate = excluded.birthdate;
  insert into profiles_private (user_id, birthdate) values (adult, current_date - interval '25 years')
    on conflict (user_id) do update set birthdate = excluded.birthdate;
  BEGIN
    update profiles set dating_enabled = true where id = minor;
  EXCEPTION WHEN others THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'AGE GATE FAILED: a 16-year-old enabled dating'; END IF;
  update profiles set dating_enabled = true where id = adult;
  PERFORM 1 FROM profiles WHERE id = adult AND dating_enabled = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGE GATE FAILED: a 25-year-old was blocked'; END IF;
  RAISE NOTICE 'age gate OK';
  ROLLBACK;
END $$;
