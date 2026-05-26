create or replace function recompute_profile_verification(p_user uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  phone_state verification_state;
  age_state   verification_state;
  result      verification_state;
begin
  select state into phone_state from verifications
    where user_id = p_user and kind = 'phone' order by updated_at desc limit 1;
  select state into age_state from verifications
    where user_id = p_user and kind = 'age' order by updated_at desc limit 1;
  phone_state := coalesce(phone_state, 'unverified');
  age_state   := coalesce(age_state, 'unverified');
  if phone_state = 'failed' or age_state = 'failed' then
    result := 'failed';
  elsif phone_state = 'appeal' or age_state = 'appeal' then
    result := 'appeal';
  elsif phone_state = 'verified' and age_state = 'verified' then
    result := 'verified';
  elsif phone_state = 'pending' or age_state = 'pending'
        or phone_state = 'verified' or age_state = 'verified' then
    result := 'pending';
  else
    result := 'unverified';
  end if;
  update profiles set verification = result where id = p_user;
end $fn$;
revoke execute on function recompute_profile_verification(uuid) from public, authenticated;

create or replace function verifications_rollup() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  perform recompute_profile_verification(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end $fn$;
do $$ begin
  create trigger verifications_rollup_trg after insert or update or delete on verifications
    for each row execute function verifications_rollup();
exception when duplicate_object then null; end $$;
