// apps/web/app/onboarding/steps/__tests__/PhoneVerifyStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
const confirmPhone = vi.fn();
const advanceOnboarding = vi.fn();
const fakeClient = { auth: { signInWithOtp, verifyOtp } };
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => fakeClient,
  confirmPhone: (...a: unknown[]) => confirmPhone(...a),
  advanceOnboarding: (...a: unknown[]) => advanceOnboarding(...a),
}));

import { PhoneVerifyStep } from '../PhoneVerifyStep';

beforeEach(() => { push.mockReset(); signInWithOtp.mockReset(); verifyOtp.mockReset(); confirmPhone.mockReset(); advanceOnboarding.mockReset(); });

describe('PhoneVerifyStep', () => {
  it('empty: send-code disabled until a phone is entered', () => {
    render(<PhoneVerifyStep />);
    expect(screen.getByRole('button', { name: /send code/i })).toBeDisabled();
  });

  it('success: send OTP → enter code → verify → confirmPhone → advance', async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ data: { session: {} }, error: null });
    confirmPhone.mockResolvedValue(undefined);
    advanceOnboarding.mockResolvedValue('selfie_verify');
    render(<PhoneVerifyStep />);
    await userEvent.type(screen.getByLabelText(/phone/i), '+12505551234');
    await userEvent.click(screen.getByRole('button', { name: /send code/i }));
    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledWith({ phone: '+12505551234' }));
    await userEvent.type(screen.getByLabelText(/code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ phone: '+12505551234', token: '123456', type: 'sms' }));
    await waitFor(() => expect(confirmPhone).toHaveBeenCalledWith(fakeClient));
    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalledWith(fakeClient, 'selfie_verify'));
    expect(push).toHaveBeenCalledWith('/onboarding/verify');
  });

  it('error: invalid/expired code surfaces a message and does not advance', async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: 'Token has expired or is invalid' } });
    render(<PhoneVerifyStep />);
    await userEvent.type(screen.getByLabelText(/phone/i), '+12505551234');
    await userEvent.click(screen.getByRole('button', { name: /send code/i }));
    await userEvent.type(screen.getByLabelText(/code/i), '000000');
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/expired|invalid/i));
    expect(advanceOnboarding).not.toHaveBeenCalled();
  });

  it('rate-limit: a send rate-limit error is translated to friendly copy', async () => {
    signInWithOtp.mockResolvedValue({ error: { message: 'rate limit exceeded' } });
    render(<PhoneVerifyStep />);
    await userEvent.type(screen.getByLabelText(/phone/i), '+12505551234');
    await userEvent.click(screen.getByRole('button', { name: /send code/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/wait|moment|too many/i));
  });
});
