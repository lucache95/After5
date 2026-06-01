// apps/web/app/api/cron/push-web/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendWebPush = vi.fn();
vi.mock('@/lib/push/send', () => ({
  sendWebPush: (...a: unknown[]) => sendWebPush(...a),
}));

// Chainable Supabase query stub. Terminal awaits resolve to { data, error }.
// `notifSelect` controls the notifications query result; `deviceSelect` the
// devices query; `rpc` and device-update calls are recorded for assertions.
function makeClient(opts: {
  notifs: Array<{ id: string; user_id: string; payload: unknown }>;
  devices: Array<{ user_id: string; web_push_sub: unknown }>;
}) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const deviceUpdates: Array<{ patch: unknown; userId: string }> = [];

  function from(table: string) {
    if (table === 'notifications') {
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'gte', 'order']) builder[m] = () => builder;
      builder.limit = () => Promise.resolve({ data: opts.notifs, error: null });
      return builder;
    }
    if (table === 'devices') {
      // SELECT path: select().in().not() -> awaitable.
      // UPDATE path: update(patch).eq('user_id', uid).not() -> awaitable.
      let pendingPatch: unknown = null;
      let pendingUser = '';
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.update = (patch: unknown) => { pendingPatch = patch; return builder; };
      builder.eq = (_col: string, val: string) => { pendingUser = val; return builder; };
      builder.in = () => builder;
      builder.not = () => {
        if (pendingPatch !== null) {
          deviceUpdates.push({ patch: pendingPatch, userId: pendingUser });
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: opts.devices, error: null });
      };
      return builder;
    }
    throw new Error(`unexpected table ${table}`);
  }

  return { client: { from, rpc }, rpc, deviceUpdates };
}

const REQ = (init?: RequestInit) =>
  new Request('https://app/api/cron/push-web', { headers: { authorization: 'Bearer cron-secret' }, ...init });

let adminClient: ReturnType<typeof makeClient>['client'];
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminClient,
}));

describe('/api/cron/push-web', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CRON_SECRET = 'cron-secret';
    sendWebPush.mockReset();
  });

  it('rejects when CRON_SECRET is wrong', async () => {
    const built = makeClient({ notifs: [], devices: [] });
    adminClient = built.client;
    const { GET } = await import('./route');
    const res = await GET(new Request('https://app/api/cron/push-web'));
    expect(res.status).toBe(401);
    expect(sendWebPush).not.toHaveBeenCalled();
  });

  it('sends a web push for an undelivered web_push notification and marks it delivered', async () => {
    const sub = { endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } };
    const built = makeClient({
      notifs: [{ id: 'n1', user_id: 'u1', payload: { title: 'hi', body: 'yo', data: { url: '/chat/1' } } }],
      devices: [{ user_id: 'u1', web_push_sub: sub }],
    });
    adminClient = built.client;
    sendWebPush.mockResolvedValue({ ok: true, expired: [] });

    const { GET } = await import('./route');
    const res = await GET(REQ());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ scanned: 1, sent: 1, failed: 0, pruned: 0 });
    // Payload threading: url falls back to payload.data.url.
    expect(sendWebPush).toHaveBeenCalledWith(sub, expect.objectContaining({ title: 'hi', body: 'yo', url: '/chat/1' }));
    expect(built.rpc).toHaveBeenCalledWith('mark_notification_delivered', { p_id: 'n1', p_error: undefined });
  });

  it('prunes a gone (410) subscription and records the failure', async () => {
    const sub = { endpoint: 'https://push.example/gone', keys: { p256dh: 'p', auth: 'a' } };
    const built = makeClient({
      notifs: [{ id: 'n2', user_id: 'u2', payload: { title: 't', body: 'b' } }],
      devices: [{ user_id: 'u2', web_push_sub: sub }],
    });
    adminClient = built.client;
    sendWebPush.mockResolvedValue({ ok: true, expired: [sub] });

    const { GET } = await import('./route');
    const res = await GET(REQ());
    const json = await res.json();

    expect(json).toMatchObject({ scanned: 1, sent: 0, failed: 1, pruned: 1 });
    expect(built.rpc).toHaveBeenCalledWith('mark_notification_delivered', { p_id: 'n2', p_error: 'subscription_expired' });
    expect(built.deviceUpdates).toEqual([{ patch: { web_push_sub: null }, userId: 'u2' }]);
  });

  it('records no_web_push_sub when the user has no stored subscription', async () => {
    const built = makeClient({
      notifs: [{ id: 'n3', user_id: 'u3', payload: { title: 't', body: 'b' } }],
      devices: [],
    });
    adminClient = built.client;

    const { GET } = await import('./route');
    const res = await GET(REQ());
    const json = await res.json();

    expect(json).toMatchObject({ scanned: 1, sent: 0, failed: 1, pruned: 0 });
    expect(sendWebPush).not.toHaveBeenCalled();
    expect(built.rpc).toHaveBeenCalledWith('mark_notification_delivered', { p_id: 'n3', p_error: 'no_web_push_sub' });
  });

  it('stays inert (leaves rows untouched) when VAPID is not configured', async () => {
    const sub = { endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } };
    const built = makeClient({
      notifs: [{ id: 'n4', user_id: 'u4', payload: { title: 't', body: 'b' } }],
      devices: [{ user_id: 'u4', web_push_sub: sub }],
    });
    adminClient = built.client;
    sendWebPush.mockResolvedValue({ ok: false, error: 'web_push_not_configured' });

    const { GET } = await import('./route');
    const res = await GET(REQ());
    const json = await res.json();

    expect(json).toMatchObject({ skipped: 'web_push_not_configured', sent: 0 });
    // Inert: never marked the row delivered/errored.
    expect(built.rpc).not.toHaveBeenCalled();
  });

  it('dry_run reports the candidate count without sending', async () => {
    const built = makeClient({
      notifs: [{ id: 'n5', user_id: 'u5', payload: {} }],
      devices: [],
    });
    adminClient = built.client;

    const { GET } = await import('./route');
    const res = await GET(REQ({ headers: { authorization: 'Bearer cron-secret' } }));
    // append dry_run via a fresh request
    const res2 = await GET(new Request('https://app/api/cron/push-web?dry_run=true', { headers: { authorization: 'Bearer cron-secret' } }));
    const json = await res2.json();
    expect(json).toMatchObject({ dry_run: true, scanned: 1 });
    expect(sendWebPush).not.toHaveBeenCalled();
    void res;
  });
});
