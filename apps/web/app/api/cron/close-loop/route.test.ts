// apps/web/app/api/cron/close-loop/route.test.ts
// Verifies the close-loop cron sweep route: auth gate (CRON_SECRET) + that a valid
// call invokes the sweep_loop_terminus RPC via the admin client. Mirrors
// offer-expiring/route.test.ts and process-jobs/route.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The admin client is mocked: this test verifies routing + auth, not the RPC body
// (that lives in supabase/tests/e5_loop_completion.sql).
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }),
}));

const ROUTE = './route';

function authedRequest(qs = '') {
  return new Request(`https://app/api/cron/close-loop${qs}`, {
    headers: { authorization: 'Bearer cron-secret' },
  });
}

beforeEach(() => {
  vi.resetModules();
  process.env.CRON_SECRET = 'cron-secret';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'svc-key';
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 0, error: null });
});

describe('/api/cron/close-loop', () => {
  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import(ROUTE);
    const res = await GET(new Request('https://app/api/cron/close-loop'));
    expect(res.status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects (401) when the cron secret is missing', async () => {
    const { GET } = await import(ROUTE);
    const res = await GET(new Request('https://app/api/cron/close-loop'));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects (401) when the cron secret is wrong', async () => {
    const { GET } = await import(ROUTE);
    const res = await GET(
      new Request('https://app/api/cron/close-loop', {
        headers: { authorization: 'Bearer nope' },
      }),
    );
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('invokes sweep_loop_terminus on a valid call and reports the completed count', async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    const { GET } = await import(ROUTE);
    const res = await GET(authedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('sweep_loop_terminus');
    expect(body.swept).toBe(true);
    expect(body.completed).toBe(3);
  });

  it('authorizes via the ?secret= query param too', async () => {
    const { GET } = await import(ROUTE);
    const res = await GET(new Request('https://app/api/cron/close-loop?secret=cron-secret'));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it('dry-run authorizes but does NOT invoke the sweep', async () => {
    const { GET } = await import(ROUTE);
    const res = await GET(authedRequest('?dry_run=true'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dry_run).toBe(true);
    expect(body.swept).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports a 500 when the sweep RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { GET } = await import(ROUTE);
    const res = await GET(authedRequest());
    expect(res.status).toBe(500);
    expect(rpc).toHaveBeenCalledOnce();
  });
});
