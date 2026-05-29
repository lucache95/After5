-- feature_config holds non-secret, client-facing flags (match_v2_enabled, offer_window_hours, …).
-- RLS was enabled with NO select policy → deny-all, so user-context/SSR reads saw null. D's host
-- page (and future E/F/G surfaces) gate on match_v2_enabled via the user's client and were stuck on
-- the coming-soon fallback. Allow public SELECT; writes stay locked (service_role/admin only).
drop policy if exists feature_config_public_read on public.feature_config;
create policy feature_config_public_read
  on public.feature_config for select
  to anon, authenticated
  using (true);
