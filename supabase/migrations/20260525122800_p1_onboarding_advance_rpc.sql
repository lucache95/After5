create or replace function advance_onboarding_step(p_to_step text)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  steps text[] := array['age_gate','basics','photos','preferences','phone_verify','selfie_verify','done'];
  cur text; cur_ix int; new_ix int; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'advance_onboarding_step: not authenticated'; end if;
  new_ix := array_position(steps, p_to_step);
  if new_ix is null then raise exception 'advance_onboarding_step: invalid step %', p_to_step; end if;
  select onboarding_step into cur from profiles where id = uid;
  cur_ix := array_position(steps, cur);
  if new_ix <= cur_ix then
    raise exception 'advance_onboarding_step: cannot move backward (% -> %)', cur, p_to_step;
  end if;
  update profiles set onboarding_step = p_to_step,
    onboarding_completed_at = case when p_to_step = 'done' then now() else onboarding_completed_at end
   where id = uid;
  return p_to_step;
end $fn$;
revoke execute on function advance_onboarding_step(text) from public;
grant execute on function advance_onboarding_step(text) to authenticated;
