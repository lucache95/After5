-- Rate-limit tracking table.
-- Stores per-identifier, per-endpoint request counts in fixed 1-hour windows.
-- The Edge Function checks/increments this before calling the Anthropic API,
-- preventing runaway costs from bots or for-loops.

create table rate_limits (
  id            bigint generated always as identity primary key,
  identifier    text not null,            -- IP address or user_id
  endpoint      text not null,            -- e.g. 'generate-plan'
  window_start  timestamptz not null,     -- truncated to the hour
  request_count int not null default 1,
  created_at    timestamptz not null default now()
);

-- Fast lookup for the check-and-increment query.
create unique index idx_rate_limits_lookup
  on rate_limits (identifier, endpoint, window_start);

-- Cleanup index: lets a periodic DELETE of old rows use an index scan.
create index idx_rate_limits_window
  on rate_limits (window_start);

-- RLS: only the service-role key (used by Edge Functions) touches this table.
-- No end-user needs direct access.
alter table rate_limits enable row level security;

-- No RLS policies = default-deny for anon/authenticated roles.
-- The Edge Function uses the service-role client, which bypasses RLS.

-- ─────────────────────────────────────────────────────────────────────
-- RPC: atomic check-and-increment in a single round-trip.
-- Returns whether the request is allowed, the current count, and how
-- many seconds until the window resets (for the Retry-After header).
-- ─────────────────────────────────────────────────────────────────────

create or replace function rate_limit_check(
  p_identifier   text,
  p_endpoint     text,
  p_max_requests int
)
returns json
language plpgsql
as $$
declare
  v_window      timestamptz;
  v_count       int;
  v_retry_secs  int;
begin
  -- Current fixed window = start of the current clock hour.
  v_window := date_trunc('hour', now());

  -- Atomic upsert: insert with count=1 or increment existing row.
  insert into rate_limits (identifier, endpoint, window_start, request_count)
  values (p_identifier, p_endpoint, v_window, 1)
  on conflict (identifier, endpoint, window_start)
  do update set request_count = rate_limits.request_count + 1
  returning request_count into v_count;

  -- If the increment pushed us over the limit, roll back the increment
  -- and report denial. This keeps the count accurate — the denied
  -- request doesn't consume a slot.
  if v_count > p_max_requests then
    update rate_limits
       set request_count = request_count - 1
     where identifier = p_identifier
       and endpoint   = p_endpoint
       and window_start = v_window;

    v_retry_secs := greatest(1,
      extract(epoch from (v_window + interval '1 hour') - now())::int
    );

    return json_build_object(
      'allowed',             false,
      'current_count',       v_count - 1,
      'retry_after_seconds', v_retry_secs
    );
  end if;

  -- Allowed. Fire-and-forget cleanup of rows older than 2 hours.
  delete from rate_limits where window_start < now() - interval '2 hours';

  return json_build_object(
    'allowed',             true,
    'current_count',       v_count,
    'retry_after_seconds', 0
  );
end;
$$;
