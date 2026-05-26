-- supabase/tests/p1_appeal_state.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'verification_state' AND e.enumlabel = 'appeal';
  IF NOT FOUND THEN RAISE EXCEPTION 'verification_state is missing the appeal value'; END IF;
  PERFORM 1 FROM profile_prompts WHERE id = 'two_truths';
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_prompts seed missing two_truths'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='dealbreakers';
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles.dealbreakers missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='onboarding_step';
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles.onboarding_step missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='prompt_answers';
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles.prompt_answers missing'; END IF;
END $$;
