-- Dating preference CHECK constraints on the new profiles columns. Each ADD is
-- guarded (duplicate_object) so the migration is re-runnable; VALIDATE on an
-- already-valid constraint is a no-op.
do $$ begin
  alter table profiles
    add constraint profiles_gender_chk
      check (gender is null or gender in ('woman','man','nonbinary')) not valid;
exception when duplicate_object then null; end $$;
alter table profiles validate constraint profiles_gender_chk;

do $$ begin
  alter table profiles
    add constraint profiles_gender_prefs_chk
      check (gender_preferences <@ array['woman','man','nonbinary']::text[]) not valid;
exception when duplicate_object then null; end $$;
alter table profiles validate constraint profiles_gender_prefs_chk;

do $$ begin
  alter table profiles
    add constraint profiles_age_pref_chk
      check (
        age_pref is null
        or (lower(age_pref) >= 18 and coalesce(upper(age_pref),99) <= 100
            and lower(age_pref) <= coalesce(upper(age_pref),99))
      ) not valid;
exception when duplicate_object then null; end $$;
alter table profiles validate constraint profiles_age_pref_chk;

do $$ begin
  alter table profiles
    add constraint profiles_distance_pref_chk
      check (distance_pref_km between 1 and 150) not valid;
exception when duplicate_object then null; end $$;
alter table profiles validate constraint profiles_distance_pref_chk;

do $$ begin
  alter table profiles
    add constraint profiles_dealbreakers_chk
      check (
        dealbreakers <@ array['smoking','wants_kids','no_kids','drinks_alcohol',
                              'no_alcohol','has_pets','no_pets']::text[]
      ) not valid;
exception when duplicate_object then null; end $$;
alter table profiles validate constraint profiles_dealbreakers_chk;
