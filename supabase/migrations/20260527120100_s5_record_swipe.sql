-- supabase/migrations/20260527120100_s5_record_swipe.sql
-- Idempotent swipe write. Actor = auth.uid() (C10). creator_id denormalized from
-- the instance (the swiper never sees it). A swipe is final: re-swipe is a no-op.
create or replace function record_swipe(p_instance uuid, p_direction swipe_direction)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid := auth.uid(); v_creator uuid;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='28000'; end if;
  select creator_id into v_creator from date_instances where id = p_instance;
  if v_creator is null then raise exception 'no such date instance' using errcode='P0002'; end if;
  if v_creator = v_actor then raise exception 'cannot swipe your own night' using errcode='P0001'; end if;
  insert into swipes (swiper_id, date_instance_id, creator_id, direction)
  values (v_actor, p_instance, v_creator, p_direction)
  on conflict (swiper_id, date_instance_id) do nothing;
end $fn$;
revoke execute on function record_swipe(uuid, swipe_direction) from public;
grant execute on function record_swipe(uuid, swipe_direction) to authenticated;
