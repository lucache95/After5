// apps/web/lib/email/__tests__/send-offer-received.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmail = vi.fn();
vi.mock('@/lib/email/resend', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

// Mutable mocks the admin client closes over, reset per test.
let offerRow: { data: unknown; error: unknown };
let authResult: { data: unknown; error: unknown };

const maybeSingle = vi.fn(async () => offerRow);
const getUserById = vi.fn(async () => authResult);

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    auth: { admin: { getUserById } },
  }),
}));

import { sendOfferReceivedEmail } from '../send-offer-received';

const OFFER = {
  expires_at: '2026-06-01T18:00:00.000Z',
  candidate_id: 'cand-1',
  candidate: { first_name: 'Sam' },
  host: { first_name: 'Alex' },
  instance: { itinerary: { title: 'sunset paddle + tacos' } },
};

beforeEach(() => {
  sendEmail.mockReset();
  maybeSingle.mockClear();
  getUserById.mockClear();
  offerRow = { data: OFFER, error: null };
  authResult = { data: { user: { email: 'sam@example.com' } }, error: null };
});

describe('sendOfferReceivedEmail', () => {
  it('sends to the resolved candidate with the from-name subject on success', async () => {
    sendEmail.mockResolvedValue({ id: 'rs_123' });

    const res = await sendOfferReceivedEmail('off-9');

    expect(res).toEqual({ sent: true, id: 'rs_123' });
    expect(getUserById).toHaveBeenCalledWith('cand-1');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0][0];
    expect(arg.to).toBe('sam@example.com');
    expect(arg.subject).toBe('Alex sent you a night out');
    expect(arg.tag).toBe('offer_received');
    expect(arg.html).toContain('sunset paddle + tacos');
  });

  it('does not throw and reports skipped when the sender fails', async () => {
    sendEmail.mockResolvedValue(null); // resend.ts warns + returns null

    const res = await sendOfferReceivedEmail('off-9');

    expect(res).toEqual({ sent: false, skipped: 'email_not_configured_or_failed' });
  });

  it('does not throw and reports skipped when the sender itself rejects', async () => {
    sendEmail.mockRejectedValue(new Error('network boom'));

    await expect(sendOfferReceivedEmail('off-9')).resolves.toEqual({
      sent: false,
      skipped: 'lookup_error',
    });
  });

  it('skips when the recipient has no email and never calls the sender', async () => {
    authResult = { data: { user: { email: null } }, error: null };

    const res = await sendOfferReceivedEmail('off-9');

    expect(res).toEqual({ sent: false, skipped: 'no_recipient_email' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('skips when the offer is not found', async () => {
    offerRow = { data: null, error: null };

    const res = await sendOfferReceivedEmail('missing');

    expect(res).toEqual({ sent: false, skipped: 'offer_not_found' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('skips on an empty offerId without touching the DB', async () => {
    const res = await sendOfferReceivedEmail('');

    expect(res).toEqual({ sent: false, skipped: 'offer_not_found' });
    expect(maybeSingle).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to generic copy when host name / plan title are missing', async () => {
    offerRow = {
      data: { ...OFFER, host: null, instance: { itinerary: null } },
      error: null,
    };
    sendEmail.mockResolvedValue({ id: 'rs_456' });

    const res = await sendOfferReceivedEmail('off-9');

    expect(res.sent).toBe(true);
    const arg = sendEmail.mock.calls[0][0];
    expect(arg.subject).toBe('someone sent you a night out');
    expect(arg.html).toContain('a night out');
  });
});
