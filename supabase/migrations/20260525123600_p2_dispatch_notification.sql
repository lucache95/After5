-- supabase/migrations/20260525123600_p2_dispatch_notification.sql
-- Decision + log + fail-loud half of dispatch (network delivery is in notify.ts).
-- C1 signature: dispatch_notification(p_user, p_type, p_payload). Order:
-- consent → quiet-hours → rate-limit → channel (push→web→email). Safety types
-- bypass all gates. Escalation hierarchy: push → web → email → admin_alert. Email
-- is a valid safety channel, so a safety notification FAILS LOUD (channel='admin_alert'
-- + raise_admin_alert) only when NO REACHABLE CHANNEL exists (no push/web device AND
-- email disabled) — never silent (C1, C11.8). p_payload carries {title, body, data, dedup_key}.
--
-- RECONCILIATION (C11.11): notification_type has 15 values (S2-2 added
-- verification_passed, verification_failed, appeal_resolved, offer_withdrawn).
-- Extended consent gate:
--   offer_withdrawn       → respects offers_enabled (offer-category signal)
--   verification_passed / verification_failed / appeal_resolved → respects account_enabled

create or replace function dispatch_notification(
  p_user uuid, p_type notification_type, p_payload jsonb default '{}'
) returns json
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  v_is_safety boolean := p_type in ('safety_checkin','safety_alert');
  v_dedup text := nullif(p_payload->>'dedup_key','');
  v_prefs notification_preferences%rowtype;
  v_allowed boolean := true;
  v_rate json;
  v_notif_id uuid; v_existing uuid;
  v_tokens jsonb;
  v_channel notification_channel := 'suppressed';
  v_tz text; v_local time; v_qs time; v_qe time; v_in_quiet boolean := false;
begin
  -- dedup short-circuit
  if v_dedup is not null then
    select id into v_existing from notifications where type=p_type and dedup_key=v_dedup limit 1;
    if found then
      return json_build_object('notification_id', v_existing, 'channel', 'suppressed',
                               'tokens', '[]'::jsonb, 'reason', 'dedup');
    end if;
  end if;

  select * into v_prefs from notification_preferences where user_id = p_user;

  if not v_is_safety then
    -- 1) consent gate (missing prefs row => permissive defaults)
    if v_prefs.user_id is not null then
      if (not v_prefs.push_enabled and not v_prefs.email_enabled) then
        v_allowed := false;
      elsif p_type in ('offer_received','offer_expiring','standby_promoted') and not v_prefs.offers_enabled then
        v_allowed := false;
      -- C11.11 reconciliation: offer_withdrawn is offer-category
      elsif p_type = 'offer_withdrawn' and not v_prefs.offers_enabled then
        v_allowed := false;
      elsif p_type = 'new_match' and not v_prefs.matches_enabled then
        v_allowed := false;
      elsif p_type = 'new_message' and not v_prefs.messages_enabled then
        v_allowed := false;
      elsif p_type in ('date_reconfirm','rating_request') and not v_prefs.reminders_enabled then
        v_allowed := false;
      elsif p_type in ('account','moderation_action') and not v_prefs.account_enabled then
        v_allowed := false;
      -- C11.11 reconciliation: verification types are account-category
      elsif p_type in ('verification_passed','verification_failed','appeal_resolved') and not v_prefs.account_enabled then
        v_allowed := false;
      end if;
    end if;
    -- 2) quiet-hours gate (user's city tz; degrade permissive if tz unknown)
    if v_allowed and v_prefs.quiet_hours_start is not null and v_prefs.quiet_hours_end is not null then
      select c.timezone into v_tz from profiles pr
        join cities c on c.id = pr.primary_city_id where pr.id = p_user;
      if v_tz is not null then
        v_local := (now() at time zone v_tz)::time;
        v_qs := v_prefs.quiet_hours_start; v_qe := v_prefs.quiet_hours_end;
        v_in_quiet := case when v_qs <= v_qe then (v_local >= v_qs and v_local < v_qe)
                           else (v_local >= v_qs or v_local < v_qe) end; -- wraps midnight
        if v_in_quiet then v_allowed := false; end if;
      end if;
    end if;
    -- 3) rate-limit gate
    if v_allowed then
      v_rate := notification_rate_check(p_user, p_type);
      if not (v_rate->>'allowed')::boolean then v_allowed := false; end if;
    end if;
  end if;

  -- channel pick: native push → web push → email. Safety always proceeds.
  if v_allowed or v_is_safety then
    select coalesce(jsonb_agg(jsonb_build_object(
             'platform', platform, 'expo_push_token', expo_push_token, 'web_push_sub', web_push_sub)), '[]'::jsonb)
      into v_tokens from devices
     where user_id = p_user and (expo_push_token is not null or web_push_sub is not null);

    if v_tokens @> '[{"platform":"ios"}]' then v_channel := 'push_ios';
    elsif v_tokens @> '[{"platform":"android"}]' then v_channel := 'push_android';
    elsif v_tokens @> '[{"platform":"web"}]' then v_channel := 'web_push';
    elsif coalesce(v_prefs.email_enabled, true) then v_channel := 'email';
    elsif v_is_safety then v_channel := 'admin_alert';  -- safety w/ no channel: fail loud
    else v_channel := 'suppressed';
    end if;
    -- The chain above already guarantees the safety fail-loud: a safety notification with
    -- no push device AND email disabled routes to 'admin_alert'; with email enabled, email
    -- is the guaranteed safety fallback. Safety never lands on 'suppressed'. No extra guard.
  end if;

  -- Insert is race-safe against the notifications_dedup_uniq partial index: a concurrent
  -- dispatch that wins the (type, dedup_key) race makes this ON CONFLICT a no-op (returns
  -- the existing row below) instead of raising 23505 to the caller.
  insert into notifications (user_id, type, payload, dedup_key, channel)
  values (p_user, p_type, coalesce(p_payload,'{}'), v_dedup, v_channel)
  on conflict (type, dedup_key) where dedup_key is not null do nothing
  returning id into v_notif_id;
  if v_notif_id is null and v_dedup is not null then
    select id into v_notif_id from notifications where type=p_type and dedup_key=v_dedup limit 1;
    return json_build_object('notification_id', v_notif_id, 'channel', 'suppressed',
                             'tokens', '[]'::jsonb, 'reason', 'dedup_race');
  end if;

  -- fail-loud terminus: a safety notification that resolved to admin_alert raises one now.
  if v_is_safety and v_channel = 'admin_alert' then
    perform raise_admin_alert('safety_no_device',
      json_build_object('user_id', p_user, 'type', p_type::text, 'notification_id', v_notif_id)::jsonb);
  end if;

  return json_build_object(
    'notification_id', v_notif_id,
    'channel', v_channel,
    'tokens', case when v_channel in ('push_ios','push_android','web_push') then v_tokens else '[]'::jsonb end
  );
end $fn$;

create or replace function mark_notification_delivered(p_id uuid, p_error text default null)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  update notifications set delivered = (p_error is null), delivery_error = p_error where id = p_id;
end $fn$;

revoke execute on function dispatch_notification(uuid, notification_type, jsonb) from public, authenticated;
revoke execute on function mark_notification_delivered(uuid, text) from public, authenticated;
