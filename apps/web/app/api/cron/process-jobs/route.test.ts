// apps/web/app/api/cron/process-jobs/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();

describe('/api/cron/process-jobs', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CRON_SECRET = 'cron-secret';
    process.env.JOBS_RUNNER_SECRET = 'runner-secret';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    globalThis.fetch = fetchMock as never;
    fetchMock.mockReset();
  });

  it('rejects when CRON_SECRET is wrong', async () => {
    const { GET } = await import('./route');
    const res = await GET(new Request('https://app/api/cron/process-jobs'));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invokes the process-jobs edge function with the runner secret', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ claimed: 2, done: 2, failed: 0 }), { status: 200 }));
    const { GET } = await import('./route');
    const res = await GET(new Request('https://app/api/cron/process-jobs', { headers: { authorization: 'Bearer cron-secret' } }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['x-jobs-secret']).toBe('runner-secret');
  });
});
