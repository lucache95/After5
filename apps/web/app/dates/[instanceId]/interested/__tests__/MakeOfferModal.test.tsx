// apps/web/app/dates/[instanceId]/interested/__tests__/MakeOfferModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const makeOffer = vi.fn();
vi.mock('@/lib/after5/match', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/after5/match')>('@/lib/after5/match');
  return { ...actual, makeOffer: (...a: unknown[]) => makeOffer(...a) };
});
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
// vaul renders inline in jsdom; stub to a passthrough so the content is queryable.
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Drawer: Object.assign(Pass, { Root: Pass, Trigger: Pass, Portal: Pass, Overlay: Pass, Content: Pass, Title: Pass, Description: Pass, Close: Pass }) };
});

import { MakeOfferModal } from '../MakeOfferModal';
import { MatchError } from '@/lib/after5/match';

const candidate = { candidate_id: 'cand-1', first_name: 'Mara', age: 27, city: 'portland', photo_url: null };

beforeEach(() => { makeOffer.mockReset(); push.mockReset(); toastSuccess.mockReset(); toastError.mockReset(); });

describe('MakeOfferModal', () => {
  it('renders the expiry preview from offerWindowHours', () => {
    render(<MakeOfferModal open instanceId="inst-1" candidate={candidate} offerWindowHours={24} onOffered={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/24 hours to accept/i)).toBeInTheDocument();
  });

  it('confirm calls makeOffer and reports success on the offer path', async () => {
    makeOffer.mockResolvedValue({ kind: 'offer', offer_id: 'off-1' });
    const onOffered = vi.fn();
    render(<MakeOfferModal open instanceId="inst-1" candidate={candidate} offerWindowHours={24} onOffered={onOffered} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /send the offer/i }));
    await waitFor(() => expect(makeOffer).toHaveBeenCalledWith('inst-1', 'cand-1'));
    expect(onOffered).toHaveBeenCalledWith('cand-1');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('a reciprocal success result routes to the reciprocal screen (no error thrown)', async () => {
    makeOffer.mockResolvedValue({ kind: 'reciprocal', pair_id: 'pair-9' });
    render(<MakeOfferModal open instanceId="inst-1" candidate={candidate} offerWindowHours={24} onOffered={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /send the offer/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/reciprocal/pair-9'));
  });

  it('a genuine account_gated error toasts the mapped message', async () => {
    makeOffer.mockRejectedValue(new MatchError('account_gated', 'P5002'));
    render(<MakeOfferModal open instanceId="inst-1" candidate={candidate} offerWindowHours={24} onOffered={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /send the offer/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/can.t be offered/i)));
  });
});
