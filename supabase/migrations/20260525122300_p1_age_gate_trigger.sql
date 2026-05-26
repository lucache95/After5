create or replace function enforce_age_gate() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare bd date; yrs numeric;
begin
  if new.dating_enabled is true and (tg_op = 'INSERT' or old.dating_enabled is distinct from true) then
    select birthdate into bd from profiles_private where user_id = new.id;
    if bd is null then
      raise exception 'age gate: birthdate required before enabling dating';
    end if;
    yrs := extract(year from age(bd));
    if yrs < 18 then
      raise exception 'age gate: must be 18+ to enable dating (got % years)', yrs;
    end if;
    new.age := floor(yrs)::int;
  end if;
  return new;
end $fn$;
do $$ begin
  create trigger profiles_age_gate before insert or update on profiles
    for each row execute function enforce_age_gate();
exception when duplicate_object then null; end $$;

create or replace function resync_age_on_birthdate() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare yrs numeric;
begin
  if new.birthdate is distinct from old.birthdate and new.birthdate is not null then
    yrs := extract(year from age(new.birthdate));
    update profiles
       set age = floor(yrs)::int,
           dating_enabled = case when yrs < 18 then false else dating_enabled end
     where id = new.user_id;
  end if;
  return new;
end $fn$;
do $$ begin
  create trigger profiles_private_birthdate_resync after update of birthdate on profiles_private
    for each row execute function resync_age_on_birthdate();
exception when duplicate_object then null; end $$;
