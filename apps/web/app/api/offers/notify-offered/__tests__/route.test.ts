import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirrors the route-test convention (inbox/activity, push-web): mock the
// RLS-bound server client + the email dispatcher, then assert the route's
// ownership gate and best-effort contract.
//
// The route under test (POST /api/offers/notify-offered) is the server-runtime
// trigger for the offer-received email. It NEVER blocks the offer:
//   - unauthenticated → 401 (no send)
//   - non-owner caller → 200 { sent:false, skipped:'not_offer_creator' } (no send)
//   - owner caller → calls sendOfferReceivedEmail, returns its best-effort shape
//     even when Resend is unconfigured or throws (the offer RPC is the source of
//     truth; in-app dispatch is the guarantee).

let user: { id: string } | null = { id: 'host-1' };
// Row the ownership select returns: { id } when the caller owns the offer, null
// when the offer is foreign/stale. Drives the .maybeSingle() terminal.
let ownedRow: { id: string } | null = null;

// Records the (table, filters) the route applied so we can assert the ownership
// gate uses creator_id = the caller's id.
const eqCalls: Array<[string, unknown]> = [];

function offersQuery() {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = (col: string, val: unknown) => { eqCalls.push([col, val]); return b; };
  b.maybeSingle = async () => ({ data: ownedRow, error: null });
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      if (table !== 'offers') throw new Error(`unexpected table ${table}`);
      return offersQuery();
    },
  }),
}));

const sendOfferReceivedEmail = vi.fn();
vi.mock('@/lib/email/send-offer-received', () => ({
  sendOfferReceivedEmail: (...a: unknown[]) => sendOfferReceivedEmail(...a),
}));

import { POST } from '../route';

const REQ = (body: unknown) =>
  new Request('http://x/api/offers/notify-offered', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;

beforeEach(() => {
  user = { id: 'host-1' };
  ownedRow = null;
  eqCalls.length = 0;
  sendOfferReceivedEmail.mockReset();
});

describe('POST /api/offers/notify-offered', () => {
  it('401 when unauthenticated (never sends)', async () => {
    user = null;
    const res = await POST(REQ({ offerId: 'o1' }));
    expect(res.status).toBe(401);
    expect(sendOfferReceivedEmail).not.toHaveBeenCalled();
  });

  it('400 on invalid JSON body', async () => {
    const res = await POST(REQ('{not json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_json' });
    expect(sendOfferReceivedEmail).not.toHaveBeenCalled();
  });

  it('400 when offerId is missing/blank', async () => {
    const res = await POST(REQ({ offerId: '   ' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'offerId_required' });
    expect(sendOfferReceivedEmail).not.toHaveBeenCalled();
  });

  it('ownership gate: a non-owner caller is skipped (no send, no leak)', async () => {
    ownedRow = null; // the offer is not owned by this caller
    const res = await POST(REQ({ offerId: 'foreign-offer' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ sent: false, skipped: 'not_offer_creator' });
    // Gate scoped the read to the caller's id on creator_id.
    expect(eqCalls).toContainEqual(['id', 'foreign-offer']);
    expect(eqCalls).toContainEqual(['creator_id', 'host-1']);
    expect(sendOfferReceivedEmail).not.toHaveBeenCalled();
  });

  it('owner path attempts the send and returns the dispatcher result', async () => {
    ownedRow = { id: 'o1' };
    sendOfferReceivedEmail.mockResolvedValue({ sent: true, id: 'email-1' });
    const res = await POST(REQ({ offerId: 'o1' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(sendOfferReceivedEmail).toHaveBeenCalledWith('o1');
    expect(json).toMatchObject({ sent: true, id: 'email-1' });
  });

  it('best-effort: owner path still 200s when email is unconfigured/skipped', async () => {
    ownedRow = { id: 'o2' };
    // sendOfferReceivedEmail is best-effort and never throws — it returns a
    // skipped shape when RESEND is absent. The route must surface 200, not fail.
    sendOfferReceivedEmail.mockResolvedValue({
      sent: false,
      skipped: 'email_not_configured_or_failed',
    });
    const res = await POST(REQ({ offerId: 'o2' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ sent: false, skipped: 'email_not_configured_or_failed' });
  });
});
