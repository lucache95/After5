-- supabase/tests/_fixtures.sql
-- C8 canonical fixtures. Every P0 test \i's this file, then calls mk_user/mk_itinerary/mk_instance.

create or replace function mk_user(p_label text) returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          p_label||'_'||left(uid::text,8)||'@test.local', now(), now());
  insert into profiles (id, first_name) values (uid, p_label)
  on conflict (id) do update set first_name = p_label;
  return uid;
end $$;

-- mk_itinerary: a minimal evergreen itinerary owned by p_user, satisfying itineraries NOT-NULLs.
-- F1 deviation (pre-validated): live itineraries table has inputs/stops NOT NULL with no default,
-- so we supply minimal values '{}'::jsonb and '[]'::jsonb.
create or replace function mk_itinerary(p_user uuid) returns uuid language plpgsql as $$
declare iid uuid;
begin
  insert into itineraries (id, user_id, inputs, stops)
  values (gen_random_uuid(), p_user, '{}'::jsonb, '[]'::jsonb) returning id into iid;
  return iid;
end $$;

-- mk_instance: a concrete dated instance of p_itin, created by p_creator, in the 'kelowna' city
-- (seeded by Task 1), satisfying date_instances NOT-NULLs/FKs.
create or replace function mk_instance(p_itin uuid, p_creator uuid, p_starts timestamptz)
returns uuid language plpgsql as $$
declare did uuid; cid uuid;
begin
  select id into cid from cities where slug='kelowna';
  insert into date_instances (itinerary_id, creator_id, city_id, starts_at)
  values (p_itin, p_creator, cid, p_starts) returning id into did;
  return did;
end $$;
