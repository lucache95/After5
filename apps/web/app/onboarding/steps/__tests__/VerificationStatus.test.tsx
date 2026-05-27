// apps/web/app/onboarding/steps/__tests__/VerificationStatus.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const readVerification = vi.fn();
const advanceOnboarding = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  advanceOnboarding: (...a: unknown[]) => advanceOnboarding(...a),
}));
// readVerification is a local helper the component exports for testability.
vi.mock('../verification-poll', () => ({ readVerification: (...a: unknown[]) => readVerification(...a) }));

import { VerificationStatus } from '../VerificationStatus';

beforeEach(() => { push.mockReset(); readVerification.mockReset(); advanceOnboarding.mockReset(); });

describe('VerificationStatus', () => {
  it('loading: shows a checking state on first render', () => {
    readVerification.mockReturnValue(new Promise(() => {}));
    render(<VerificationStatus />);
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });

  it('pending: renders the limbo banner with notify + re-open', async () => {
    readVerification.mockResolvedValue('pending');
    render(<VerificationStatus />);
    await waitFor(() => expect(screen.getAllByText(/we.ll notify you|checking your id/i).length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /re-open|continue/i })).toBeInTheDocument();
  });

  it('verified: advances to done and routes', async () => {
    readVerification.mockResolvedValue('verified');
    advanceOnboarding.mockResolvedValue('done');
    render(<VerificationStatus />);
    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalledWith(expect.anything(), 'done'));
    expect(push).toHaveBeenCalledWith('/onboarding/done');
  });

  it('failed: shows the failure copy with try-again + appeal', async () => {
    readVerification.mockResolvedValue('failed');
    render(<VerificationStatus />);
    await waitFor(() => expect(screen.getByText(/didn.t go through/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /appeal/i })).toBeInTheDocument();
  });
});
