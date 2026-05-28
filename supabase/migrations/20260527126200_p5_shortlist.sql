-- 20260527126200_p5_shortlist.sql
-- A.3: match_shortlist + match_ingest_interest + queue_entries column additions.
--
-- DIVERGENCE FROM SPEC §2.4: spec proposed "bump-and-cascade" rank collision policy.
-- During implementation I confirmed queue_entries has UNIQUE(date_instance_id,
-- candidate_id) but rank is just an int (no UNIQUE per rank). Each candidate has
-- their own rank; multiple candidates can co-exist at the same rank if the UI
-- doesn't deduplicate. The simpler P5-source model: set the candidate's rank;
-- the only DB-enforced rule is the frozen-slot for the active offer holder
-- (rank=1 can't move while an offer is active). UI (D's InterestedList) handles
-- visual ordering and re-ranks via additional shortlist calls if needed.
-- Spec §2.4 will be amended at the end of A's work to reflect this.
--
-- Also: the P5-source's match_shortlist calls match_detect_reciprocal() which
-- doesn't exist yet (B's scope). That call is stripped here. Reciprocal
-- detection happens inside match_make_offer (A.4) per spec §2.8.

-- Add per-row tracking columns (P5 source line 370)
alter table queue_entries
  add column if not exists swiper_disclosed_at timestamptz,
  add column if not exists offer_frozen_rank int;

-- INTERNAL helper. Seed queue_entries from right-swipes (idempotent). Invoked by S5's
-- modified record_swipe after a successful right-swipe (A.8 hook). Not a public C2 RPC.
create or replace function match_ingest_interest(p_instance uuid)
returns int language plpgsql security definer set search_path=public as $fn$
declare n int := 0; cre uuid;
begin
  select creator_id into cre from date_instances where id=p_instance;
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
  select s.date_instance_id, s.swiper_id, s.creator_id, 'interested'
    from swipes s
   where s.date_instance_id=p_instance and s.direction='right'
     -- never enqueue a blocked pair in either direction
     and not exists (select 1 from blocks b where (b.blocker_id=cre and b.blocked_id=s.swiper_id)
                                                or (b.blocker_id=s.swiper_id and b.blocked_id=cre))
  on conflict (date_instance_id, candidate_id) do nothing;
  get diagnostics n = row_count; return n;
end $fn$;

-- C2 PUBLIC RPC. Creator shortlists an interested candidate and sets/reorders rank in one call.
-- Discloses swiper profile (already RLS-allowed; made explicit + audited via swiper_disclosed_at).
-- Frozen rule: while an offer is active, rank=1 (the offer-holder) is immutable; other positions reorder freely.
create or replace function match_shortlist(p_actor uuid, p_instance uuid, p_candidate uuid, p_rank int)
returns void language plpgsql security definer set search_path=public as $fn$
declare cre uuid; offer_holder uuid;
begin
  -- C10 auth check
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;

  -- feature flag gate (P5000)
  if not coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false) then
    raise exception 'feature_disabled' using errcode='P5000';
  end if;

  if p_rank < 1 then raise exception 'bad_rank' using errcode='22023'; end if;

  select creator_id into cre from date_instances where id=p_instance;
  if cre is null then raise exception 'no_instance' using errcode='P0002'; end if;
  if cre <> p_actor then raise exception 'not_creator' using errcode='42501'; end if;

  -- serialize against make_offer/auto_roll on this instance
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));

  -- frozen-slot rule: cannot move the active offer-holder off rank 1, nor assign rank 1 to anyone else.
  select candidate_id into offer_holder
    from queue_entries where date_instance_id=p_instance and status='offer_active';
  if offer_holder is not null then
    if (p_candidate = offer_holder and p_rank <> 1)
       or (p_candidate <> offer_holder and p_rank = 1)
    then raise exception 'rank_frozen' using errcode='P0001'; end if;
  end if;

  update queue_entries
     set status = case when status='interested' then 'shortlisted'::queue_status else status end,
         rank = p_rank,
         swiper_disclosed_at = coalesce(swiper_disclosed_at, now()),
         updated_at = now()
   where date_instance_id=p_instance and candidate_id=p_candidate
     and status in ('interested','shortlisted','standby');
  if not found then raise exception 'not_interested' using errcode='P0002'; end if;

  -- audit + analytics (C8/C11.8)
  insert into audit_log(entity, entity_id, action, new_status, actor)
  values ('swiper_disclosure', p_candidate, 'disclosed_to_creator', 'shortlisted', p_actor);

  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_shortlisted', p_actor, 'queue_entry', p_candidate,
          jsonb_build_object('instance', p_instance, 'candidate', p_candidate, 'rank', p_rank));
end $fn$;

-- match_next_standby: lowest-rank shortlisted candidate (rank null sorts last). B's auto_roll consumer.
create or replace function match_next_standby(p_instance uuid)
returns uuid language sql stable security definer set search_path=public as $fn$
  select candidate_id from queue_entries
   where date_instance_id=p_instance and status='shortlisted'
   order by rank nulls last, created_at
   limit 1
$fn$;

revoke execute on function match_ingest_interest(uuid) from public, authenticated;
revoke execute on function match_next_standby(uuid) from public, authenticated;
-- match_shortlist STAYS executable by authenticated (it's a public C2 RPC; auth enforced via auth.uid()=p_actor check inside)
