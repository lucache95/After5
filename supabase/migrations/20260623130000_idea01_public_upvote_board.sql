-- idea01: public, upvotable feature-request board.
--
-- Curate user_feedback (kind='feature') into a public board: admin approves an
-- item (is_public + public_title), logged-in users upvote, top floats up. Bugs /
-- place suggestions never go public. Decisions: admin-approves, logged-in voting.

alter table user_feedback
  add column if not exists is_public    boolean not null default false,
  add column if not exists published_at timestamptz,
  add column if not exists public_title text,
  add column if not exists vote_count   int not null default 0;

-- Extend the status vocabulary with the public-roadmap states. The live check
-- allowed new/triaged/done/wontfix (internal triage); add planned + shipped so
-- the public board can show roadmap progress.
alter table user_feedback drop constraint if exists user_feedback_status_check;
alter table user_feedback add constraint user_feedback_status_check
  check (status = any (array['new','triaged','planned','shipped','done','wontfix']));

create table if not exists feature_votes (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references user_feedback(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (feedback_id, user_id)
);

create index if not exists feature_votes_feedback_idx on feature_votes (feedback_id);
create index if not exists feature_votes_user_idx on feature_votes (user_id);

alter table feature_votes enable row level security;

-- Anyone reads (for "did I vote" checks); authenticated users manage only their own.
do $$ begin
  create policy "feature_votes_read" on feature_votes for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "feature_votes_insert_own" on feature_votes for insert to authenticated with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "feature_votes_delete_own" on feature_votes for delete to authenticated using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Keep the denormalized count on user_feedback in sync.
create or replace function feature_votes_count_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update user_feedback set vote_count = vote_count + 1 where id = new.feedback_id;
  elsif tg_op = 'DELETE' then
    update user_feedback set vote_count = greatest(0, vote_count - 1) where id = old.feedback_id;
  end if;
  return null;
end; $$;

drop trigger if exists feature_votes_count on feature_votes;
create trigger feature_votes_count
  after insert or delete on feature_votes
  for each row execute function feature_votes_count_trigger();

-- The trigger fires as definer; it must never be REST-callable directly.
revoke all on function feature_votes_count_trigger() from public, anon, authenticated;

-- Toggle the caller's vote on a PUBLIC idea; returns the new state. SECURITY
-- DEFINER so the count/insert work under RLS, but auth.uid() still scopes to the
-- caller and we hard-check the item is public.
create or replace function toggle_feature_vote(p_feedback uuid)
returns table (voted boolean, vote_count int)
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_exists boolean;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  if not exists (select 1 from user_feedback where id = p_feedback and is_public) then
    raise exception 'not a public idea';
  end if;
  select exists(select 1 from feature_votes where feedback_id = p_feedback and user_id = v_uid) into v_exists;
  if v_exists then
    delete from feature_votes where feedback_id = p_feedback and user_id = v_uid;
    voted := false;
  else
    insert into feature_votes (feedback_id, user_id) values (p_feedback, v_uid);
    voted := true;
  end if;
  select uf.vote_count into vote_count from user_feedback uf where uf.id = p_feedback;
  return next;
end; $$;

revoke all on function toggle_feature_vote(uuid) from public, anon;
grant execute on function toggle_feature_vote(uuid) to authenticated;

-- Public board read. A prior security migration removed anon's direct SELECT on
-- user_feedback (it holds emails/bodies), so expose ONLY the safe board columns
-- of public items via a definer RPC — no PII leak. Shipped items sort last.
create or replace function get_public_ideas()
returns table (id uuid, public_title text, status text, vote_count int, published_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, public_title, status, vote_count, published_at
  from user_feedback
  where is_public = true
  order by (status in ('shipped','done')) asc, vote_count desc, published_at desc;
$$;
revoke all on function get_public_ideas() from public;
grant execute on function get_public_ideas() to anon, authenticated;
