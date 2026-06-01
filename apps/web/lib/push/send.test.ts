// apps/web/lib/push/send.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the web-push library so no real network/VAPID setup runs.
const setVapidDetails = vi.fn();
const sendNotification = vi.fn();
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: (...a: unknown[]) => setVapidDetails(...a),
    sendNotification: (...a: unknown[]) => sendNotification(...a),
  },
}));

const SUB = {
  endpoint: 'https://push.example/abc',
  keys: { p256dh: 'p', auth: 'a' },
};

const PAYLOAD = { title: 't', body: 'b', url: '/home', tag: 'x' };

describe('sendWebPush', () => {
  beforeEach(() => {
    vi.resetModules();
    setVapidDetails.mockReset();
    sendNotification.mockReset();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });

  it('no-ops with web_push_not_configured when VAPID env is absent', async () => {
    const { sendWebPush } = await import('./send');
    const res = await sendWebPush(SUB, PAYLOAD);
    expect(res).toEqual({ ok: false, error: 'web_push_not_configured' });
    expect(setVapidDetails).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('configures web-push and sends the JSON payload when VAPID env is set', async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    process.env.VAPID_SUBJECT = 'mailto:ops@after5.app';
    sendNotification.mockResolvedValue(undefined);

    const { sendWebPush } = await import('./send');
    const res = await sendWebPush(SUB, PAYLOAD);

    expect(res.ok).toBe(true);
    expect(res.expired).toEqual([]);
    expect(setVapidDetails).toHaveBeenCalledWith('mailto:ops@after5.app', 'pub', 'priv');
    expect(sendNotification).toHaveBeenCalledOnce();
    const [sub, body] = sendNotification.mock.calls[0];
    expect(sub).toEqual(SUB);
    expect(JSON.parse(body as string)).toEqual(PAYLOAD);
  });

  it('reports 410/404 subscriptions as expired for pruning', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';

    const goneSub = { endpoint: 'https://push.example/gone', keys: { p256dh: 'p', auth: 'a' } };
    const liveSub = { endpoint: 'https://push.example/live', keys: { p256dh: 'p', auth: 'a' } };

    sendNotification.mockImplementation((sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith('/gone')) return Promise.reject({ statusCode: 410 });
      return Promise.resolve(undefined);
    });

    const { sendWebPush } = await import('./send');
    const res = await sendWebPush([goneSub, liveSub], PAYLOAD);

    expect(res.ok).toBe(true);
    expect(res.expired).toEqual([goneSub]);
  });

  it('does not flag non-gone errors as expired', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    sendNotification.mockRejectedValue({ statusCode: 500 });

    const { sendWebPush } = await import('./send');
    const res = await sendWebPush(SUB, PAYLOAD);

    expect(res.ok).toBe(true);
    expect(res.expired).toEqual([]);
  });
});
