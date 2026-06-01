// apps/web/lib/push/subscribe.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('enablePushNotifications', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns unsupported when the browser lacks Push/SW APIs', async () => {
    // jsdom has no serviceWorker/PushManager by default.
    const { enablePushNotifications } = await import('./subscribe');
    const res = await enablePushNotifications();
    expect(res).toEqual({ ok: true, subscribed: false, reason: 'unsupported' });
  });

  it('no-ops with not_configured when VAPID public key is absent (env-gated)', async () => {
    // Stub a "supported" environment so we reach the env check.
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistration: vi.fn(), register: vi.fn(), ready: Promise.resolve() },
    });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { enablePushNotifications } = await import('./subscribe');
    const res = await enablePushNotifications();

    expect(res).toEqual({ ok: true, subscribed: false, reason: 'not_configured' });
    // Critical: it never requested permission or hit the network without a key.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
