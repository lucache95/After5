// apps/web/app/api/cron/offer-expiring/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The sender is mocked: this test verifies the cron sweep, not email rendering
// (that lives in send-offer-expiring's own test).
const sendOfferExpiringEmail = vi.fn();
vi.mock('@/lib/email/send-offer-expiring', () => ({
  sendOfferExpiringEmail: (...a: unknown[]) => sendOfferExpiringEmail(...a),
}));

// Mutable mocks the admin client closes over, reset per test.
let queryResult: { data: unknown; error: unknown };
const updateEq = vi.fn(async () => ({ error: null }));
const update = vi.fn(() => ({ eq: updateEq }));

// Chainable select builder ending in the query result. The route calls:
//   .from('offers').select(..).eq('status','active').is('expiring_email_sent_at',null)
//   .gt('expires_at', ..).lte('expires_at', ..)
// The terminal .lte() resolves to queryResult.
function selectChain() {
  const lte = vi.fn(async () => queryResult);
  const gt = vi.fn(() => ({ lte }));
  const is = vi.fn(() => ({ gt }));
  const eq = vi.fn(() => ({ is }));
  return { eq };
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => selectChain(),
      update,
    }),
  }),
}));

const ROUTE = './route';

function authedRequest() {
  return new Request('https://app/api/cron/offer-expiring', {
    headers: { authorization: 'Bearer cron-secret' },
  });
}

beforeEach(() => {
  vi.resetModules();
  process.env.CRON_SECRET = 'cron-secret';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'svc-key';
  sendOfferExpiringEmail.mockReset();
  update.mockClear();
  updateEq.mockClear();
  queryResult = { data: [], error: null };
});

describe('/api/cron/offer-expiring', () => {
  it('rejects when the cron secret is wrong', async () => {
    const { GET } = await import(ROUTE);
    const res = await GET(new Request('https://app/api/cron/offer-expiring'));
    expect(res.status).toBe(401);
    expect(sendOfferExpiringEmail).not.toHaveBeenCalled();
  });

  it('sends a reminder to each expiring-soon offer and marks it reminded', async () => {
    queryResult = {
      data: [{ id: 'off-1', expires_at: '2026-06-01T18:00:00Z' }, { id: 'off-2', expires_at: '2026-06-01T19:00:00Z' }],
      error: null,
    };
    sendOfferExpiringEmail.mockResolvedValue({ sent: true, id: 'rs_1' });

    const { GET } = await import(ROUTE);
    const res = await GET(authedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(2);
    expect(sendOfferExpiringEmail).toHaveBeenCalledTimes(2);
    expect(sendOfferExpiringEmail).toHaveBeenCalledWith('off-1');
    expect(sendOfferExpiringEmail).toHaveBeenCalledWith('off-2');
    // Each offer stamped to dedup future runs.
    expect(update).toHaveBeenCalledTimes(2);
    expect(updateEq).toHaveBeenCalledWith('id', 'off-1');
    expect(updateEq).toHaveBeenCalledWith('id', 'off-2');
  });

  it('does nothing (no sends) when no offers qualify — already-sent are filtered by the query', async () => {
    queryResult = { data: [], error: null };

    const { GET } = await import(ROUTE);
    const res = await GET(authedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.qualifying).toBe(0);
    expect(body.sent).toBe(0);
    expect(sendOfferExpiringEmail).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('still stamps and does not throw when a send fails', async () => {
    queryResult = { data: [{ id: 'off-1', expires_at: '2026-06-01T18:00:00Z' }], error: null };
    sendOfferExpiringEmail.mockResolvedValue({ sent: false, skipped: 'email_not_configured_or_failed' });

    const { GET } = await import(ROUTE);
    const res = await GET(authedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(0);
    expect(body.skipped).toBe(1);
    // Stamped anyway so the next run won't re-spam.
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateEq).toHaveBeenCalledWith('id', 'off-1');
  });

  it('does not abort the sweep when the sender itself rejects', async () => {
    queryResult = {
      data: [{ id: 'off-1', expires_at: '2026-06-01T18:00:00Z' }, { id: 'off-2', expires_at: '2026-06-01T19:00:00Z' }],
      error: null,
    };
    sendOfferExpiringEmail.mockRejectedValueOnce(new Error('boom'));
    sendOfferExpiringEmail.mockResolvedValueOnce({ sent: true, id: 'rs_2' });

    const { GET } = await import(ROUTE);
    const res = await GET(authedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    // First threw (counted skipped), second sent. Both stamped.
    expect(body.sent).toBe(1);
    expect(body.skipped).toBe(1);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('reports a 500 when the offers query errors', async () => {
    queryResult = { data: null, error: { message: 'db down' } };

    const { GET } = await import(ROUTE);
    const res = await GET(authedRequest());
    expect(res.status).toBe(500);
    expect(sendOfferExpiringEmail).not.toHaveBeenCalled();
  });

  it('dry-run lists qualifying offers without sending or stamping', async () => {
    queryResult = { data: [{ id: 'off-1', expires_at: '2026-06-01T18:00:00Z' }], error: null };

    const { GET } = await import(ROUTE);
    const res = await GET(
      new Request('https://app/api/cron/offer-expiring?dry_run=true', {
        headers: { authorization: 'Bearer cron-secret' },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dry_run).toBe(true);
    expect(body.qualifying).toBe(1);
    expect(body.offer_ids).toEqual(['off-1']);
    expect(sendOfferExpiringEmail).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
