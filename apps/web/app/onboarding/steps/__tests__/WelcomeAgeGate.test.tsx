// apps/web/app/onboarding/steps/__tests__/WelcomeAgeGate.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const advanceOnboarding = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  advanceOnboarding: (...a: unknown[]) => advanceOnboarding(...a),
}));

import { WelcomeAgeGate } from '../WelcomeAgeGate';

beforeEach(() => { push.mockReset(); advanceOnboarding.mockReset(); });

describe('WelcomeAgeGate', () => {
  it('disables continue until 18+ is confirmed (empty/guard state)', () => {
    render(<WelcomeAgeGate />);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('success: confirming 18+ advances and routes to basics', async () => {
    advanceOnboarding.mockResolvedValue('basics');
    render(<WelcomeAgeGate />);
    await userEvent.click(screen.getByLabelText(/i am 18 or older/i));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalledWith(expect.anything(), 'basics'));
    expect(push).toHaveBeenCalledWith('/onboarding/basics');
  });

  it('error + retry: failed advance shows an error and a retry that re-calls', async () => {
    advanceOnboarding.mockRejectedValueOnce(new Error('network'));
    render(<WelcomeAgeGate />);
    await userEvent.click(screen.getByLabelText(/i am 18 or older/i));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t|try again|network/i));
    advanceOnboarding.mockResolvedValueOnce('basics');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/basics'));
  });

  it('loading: shows a submitting state while advancing', async () => {
    let resolve!: (v: string) => void;
    advanceOnboarding.mockReturnValue(new Promise<string>((r) => { resolve = r; }));
    render(<WelcomeAgeGate />);
    await userEvent.click(screen.getByLabelText(/i am 18 or older/i));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByRole('button', { name: /continuing/i })).toBeDisabled();
    resolve('basics');
  });
});
