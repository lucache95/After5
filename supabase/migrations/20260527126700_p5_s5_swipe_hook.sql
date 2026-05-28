-- 20260527126700_p5_s5_swipe_hook.sql
-- A.8: extend S5's record_swipe to invoke match_ingest_interest on right-swipes.
-- Pre-A.8 body for rollback:
--
--   create or replace function record_swipe(p_instance uuid, p_direction swipe_direction)
--   returns void language plpgsql security definer set search_path=public as $function$
--   declare v_actor uuid := auth.uid(); v_creator uuid;
--   begin
--     if v_actor is null then raise exception 'not authenticated' using errcode='28000'; end if;
--     select creator_id into v_creator from date_instances where id = p_instance;
--     if v_creator is null then raise exception 'no such date instance' using errcode='P0002'; end if;
--     if v_creator = v_actor then raise exception 'cannot swipe your own night' using errcode='P0001'; end if;
--     insert into swipes (swiper_id, date_instance_id, creator_id, direction)
--     values (v_actor, p_instance, v_creator, p_direction)
--     on conflict (swiper_id, date_instance_id) do nothing;
--   end $function$;

create or replace function record_swipe(p_instance uuid, p_direction swipe_direction)
returns void language plpgsql security definer set search_path=public as $function$
declare v_actor uuid := auth.uid(); v_creator uuid;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='28000'; end if;
  select creator_id into v_creator from date_instances where id = p_instance;
  if v_creator is null then raise exception 'no such date instance' using errcode='P0002'; end if;
  if v_creator = v_actor then raise exception 'cannot swipe your own night' using errcode='P0001'; end if;

  insert into swipes (swiper_id, date_instance_id, creator_id, direction)
  values (v_actor, p_instance, v_creator, p_direction)
  on conflict (swiper_id, date_instance_id) do nothing;

  -- A.8 hook: on right-swipe, populate queue_entries via match_ingest_interest.
  -- Called only when match_v2 is enabled; otherwise S5 stays in legacy mode.
  -- The ingest is idempotent (ON CONFLICT DO NOTHING) so repeat right-swipes don't dup rows.
  if p_direction = 'right'::swipe_direction
     and coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false)
  then
    perform match_ingest_interest(p_instance);
  end if;
end $function$;
