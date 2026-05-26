// supabase/functions/_shared/notify_test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { dispatchNotification } from './notify.ts';

function fakeClient(dispatchResult: unknown) {
  const calls: Record<string, unknown[]> = {};
  return {
    calls,
    rpc(name: string, args: unknown) {
      (calls[name] ??= []).push(args);
      if (name === 'dispatch_notification') return Promise.resolve({ data: dispatchResult, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

Deno.test('suppressed channel performs no network send', async () => {
  const client = fakeClient({ notification_id: 'n1', channel: 'suppressed', tokens: [] });
  let expoCalled = false;
  await dispatchNotification(client as never,
    { userId: 'u1', type: 'offer_received', payload: { title: 't', body: 'b' } },
    { sendExpo: async () => { expoCalled = true; return { ok: true }; } });
  assertEquals(expoCalled, false);
  assertEquals(client.calls['mark_notification_delivered'], undefined);
});

Deno.test('native channel sends via Expo and marks delivered', async () => {
  const client = fakeClient({
    notification_id: 'n2', channel: 'push_ios',
    tokens: [{ platform: 'ios', expo_push_token: 'ExponentPushToken[x]' }],
  });
  let sentTo = '';
  await dispatchNotification(client as never,
    { userId: 'u1', type: 'safety_checkin', payload: { title: 't', body: 'b' } },
    { sendExpo: async (toks) => { sentTo = toks[0]; return { ok: true }; } });
  assertEquals(sentTo, 'ExponentPushToken[x]');
  assertEquals((client.calls['mark_notification_delivered'] as unknown[]).length, 1);
});

Deno.test('safety admin_alert channel emails ops (fail loud)', async () => {
  const client = fakeClient({ notification_id: 'n3', channel: 'admin_alert', tokens: [] });
  let opsEmailed = false;
  await dispatchNotification(client as never,
    { userId: 'u1', type: 'safety_checkin', payload: { title: 't', body: 'b' } },
    { sendOpsEmail: async () => { opsEmailed = true; return { ok: true }; } });
  assertEquals(opsEmailed, true);
});
