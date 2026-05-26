-- supabase/migrations/20260525123450_p2_notification_rate_limit.sql
-- The single anti-storm guard (C1 + C10: P11's batching folds in here; no second
-- system). Reuses rate_limits + rate_limit_check (20260522110000_rate_limits.sql).
-- Safety categories (safety_checkin, safety_alert) are exempt.
-- C11.11 additions (verification_passed, verification_failed, appeal_resolved,
-- offer_withdrawn) fall to the default cap of 30/hour — intentional per contract v2.1.

create or replace function notification_rate_check(
  p_user_id uuid, p_type notification_type
) returns json
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_cap int; v_endpoint text := 'notify:' || p_type::text;
begin
  -- Safety + high-stakes-1:1 events are never throttled.
  if p_type in ('safety_checkin','safety_alert','offer_received','offer_expiring',
                'standby_promoted','date_reconfirm','new_match') then
    return json_build_object('allowed', true, 'current_count', 0, 'retry_after_seconds', 0);
  end if;
  v_cap := case p_type
    when 'new_message'       then 30
    when 'rating_request'    then 10
    when 'moderation_action' then 20
    when 'account'           then 20
    else 30
  end;
  return rate_limit_check(p_user_id::text, v_endpoint, v_cap);
end $fn$;

revoke execute on function notification_rate_check(uuid, notification_type) from public, authenticated;
