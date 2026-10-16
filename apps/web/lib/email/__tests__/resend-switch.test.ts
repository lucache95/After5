import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendEmail } from '@/lib/email/resend';

describe('sendEmail master switch', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends nothing unless AFTER5_EMAIL_ENABLED is exactly "true"', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubEnv('RESEND_API_KEY', 'k');
    vi.stubEnv('RESEND_FROM_EMAIL', 'hi@tryafter5.app');
    for (const v of ['', 'false', 'TRUE', '1']) {
      vi.stubEnv('AFTER5_EMAIL_ENABLED', v);
      expect(await sendEmail({ to: 'a@b.com', subject: 's', html: 'h' })).toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends when switched on', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'e1' }) });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubEnv('RESEND_API_KEY', 'k');
    vi.stubEnv('RESEND_FROM_EMAIL', 'hi@tryafter5.app');
    vi.stubEnv('AFTER5_EMAIL_ENABLED', 'true');
    expect(await sendEmail({ to: 'a@b.com', subject: 's', html: 'h' })).toEqual({ id: 'e1' });
  });
});
