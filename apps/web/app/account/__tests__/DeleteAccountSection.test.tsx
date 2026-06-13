// apps/web/app/account/__tests__/DeleteAccountSection.test.tsx
// ACCT-01 client boundary tests: the active-state delete flow (open drawer → confirm
// → request_account_deletion RPC) and the pending-state banner (cancel → cancel RPC).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// vaul's pointer-drag release reads getComputedStyle().transform, which is undefined
// in jsdom (throws in getTranslate on a full pointerdown→up sequence). Buttons INSIDE
// the Drawer.Content are therefore clicked with fireEvent.click (a plain click event,
// no pointer sequence) — the same DOM click the user fires, without vaul's drag path.

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({ rpc }) }));

import { DeleteAccountSection } from '../DeleteAccountSection';

beforeEach(() => { refresh.mockReset(); rpc.mockClear(); rpc.mockResolvedValue({ data: null, error: null }); });

describe('DeleteAccountSection', () => {
  it('active: confirming calls request_account_deletion and refreshes', async () => {
    render(<DeleteAccountSection accountState="active" />);
    await userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    await screen.findByText(/delete your account\?/i);  // drawer open
    // Two "delete my account" controls once open (the row + the confirm); click the
    // confirm CTA inside the drawer (the last one) via fireEvent (no vaul drag path).
    const confirms = screen.getAllByRole('button', { name: /delete my account/i });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('request_account_deletion'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('active: keep-my-account dismisses without calling the RPC', async () => {
    render(<DeleteAccountSection accountState="active" />);
    await userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    fireEvent.click(await screen.findByRole('button', { name: /keep my account/i }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('active: an RPC failure surfaces an error and does not refresh', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    render(<DeleteAccountSection accountState="active" />);
    await userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    await screen.findByText(/delete your account\?/i);
    const confirms = screen.getAllByRole('button', { name: /delete my account/i });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/try again/i));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('pending: renders the 7-day banner and cancel calls cancel_account_deletion', async () => {
    render(<DeleteAccountSection accountState="deletion_pending" />);
    expect(screen.getByText(/deletion scheduled/i)).toBeInTheDocument();
    expect(screen.getByText(/7 days/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cancel deletion/i }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('cancel_account_deletion'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('pending: does NOT show the delete-affordance row', () => {
    render(<DeleteAccountSection accountState="deletion_pending" />);
    expect(screen.queryByRole('button', { name: /delete my account/i })).not.toBeInTheDocument();
  });
});
