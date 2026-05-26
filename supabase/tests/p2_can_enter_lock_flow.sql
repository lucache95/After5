-- supabase/tests/p2_can_enter_lock_flow.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE u uuid;
BEGIN
  u := mk_user('gate');
  -- defaults (S1): account_state='active', standing='good', rollover_frozen=false
  IF NOT can_enter_lock_flow(u) THEN RAISE EXCEPTION 'active+good should pass gate'; END IF;

  update profiles set account_state='paused' where id=u;
  IF can_enter_lock_flow(u) THEN RAISE EXCEPTION 'paused must fail gate (C11.9)'; END IF;

  update profiles set account_state='active', standing='cooldown' where id=u;
  IF can_enter_lock_flow(u) THEN RAISE EXCEPTION 'cooldown must fail gate'; END IF;

  update profiles set standing='suspended' where id=u;
  IF can_enter_lock_flow(u) THEN RAISE EXCEPTION 'suspended must fail gate'; END IF;

  update profiles set standing='locked_ban', rollover_frozen=false where id=u;
  IF can_enter_lock_flow(u) THEN RAISE EXCEPTION 'locked_ban must fail gate'; END IF;

  update profiles set standing='good', rollover_frozen=true where id=u;
  IF can_enter_lock_flow(u) THEN RAISE EXCEPTION 'rollover_frozen must fail gate'; END IF;
  RAISE NOTICE 'can_enter_lock_flow OK';
  ROLLBACK;
END $$;
