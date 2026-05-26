alter table profiles
  add constraint profiles_gender_chk
    check (gender is null or gender in ('woman','man','nonbinary')) not valid;
alter table profiles validate constraint profiles_gender_chk;
alter table profiles
  add constraint profiles_gender_prefs_chk
    check (gender_preferences <@ array['woman','man','nonbinary']::text[]) not valid;
alter table profiles validate constraint profiles_gender_prefs_chk;
alter table profiles
  add constraint profiles_age_pref_chk
    check (
      age_pref is null
      or (lower(age_pref) >= 18 and coalesce(upper(age_pref),99) <= 100
          and lower(age_pref) <= coalesce(upper(age_pref),99))
    ) not valid;
alter table profiles validate constraint profiles_age_pref_chk;
alter table profiles
  add constraint profiles_distance_pref_chk
    check (distance_pref_km between 1 and 150) not valid;
alter table profiles validate constraint profiles_distance_pref_chk;
alter table profiles
  add constraint profiles_dealbreakers_chk
    check (
      dealbreakers <@ array['smoking','wants_kids','no_kids','drinks_alcohol',
                            'no_alcohol','has_pets','no_pets']::text[]
    ) not valid;
alter table profiles validate constraint profiles_dealbreakers_chk;
