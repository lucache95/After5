-- M1: per-city generation provider map. Runtime-flippable, no redeploy.
-- "_default" applies to any city without an explicit entry.
insert into feature_config (key, value)
values ('generation_providers',
  '{"kelowna":"kelowna","_default":"onthefly"}'::jsonb)
on conflict (key) do nothing;
