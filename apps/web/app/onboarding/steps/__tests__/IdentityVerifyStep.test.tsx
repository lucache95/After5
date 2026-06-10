// apps/web/app/onboarding/steps/__tests__/IdentityVerifyStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const startVerification = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  startVerification: (...a: unknown[]) => startVerification(...a),
}));

// Stub the Persona embed so the test drives onComplete/onCancel without the CDN.
let lastProps: { onComplete?: () => void; onCancel?: () => void; onError?: (e: unknown) => void } = {};
vi.mock('../PersonaEmbed', () => ({
  PersonaEmbed: (props: typeof lastProps & { inquiryId: string }) => { lastProps = props; return <div data-testid="persona-embed" />; },
}));

// VerificationStatus is a separate unit (Task 10); stub it to a marker.
vi.mock('../VerificationStatus', () => ({ VerificationStatus: () => <div data-testid="verification-status" /> }));

import { IdentityVerifyStep } from '../IdentityVerifyStep';

beforeEach(() => { startVerification.mockReset(); lastProps = {}; });

describe('IdentityVerifyStep', () => {
  it('empty: shows the start CTA before any inquiry', () => {
    render(<IdentityVerifyStep />);
    expect(screen.getByRole('button', { name: /let's do it/i })).toBeInTheDocument();
    expect(screen.queryByTestId('persona-embed')).not.toBeInTheDocument();
  });

  it('loading→success: startVerification mounts the embed with inquiryId+sessionToken', async () => {
    startVerification.mockResolvedValue({ inquiryId: 'inq_1', sessionToken: 'sess_1' });
    render(<IdentityVerifyStep />);
    await userEvent.click(screen.getByRole('button', { name: /let's do it/i }));
    await waitFor(() => expect(screen.getByTestId('persona-embed')).toBeInTheDocument());
  });

  it('error + retry: a failed startVerification shows an error and retries', async () => {
    startVerification.mockRejectedValueOnce(new Error('persona_error'));
    render(<IdentityVerifyStep />);
    await userEvent.click(screen.getByRole('button', { name: /let's do it/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    startVerification.mockResolvedValueOnce({ inquiryId: 'inq_2', sessionToken: 'sess_2' });
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.getByTestId('persona-embed')).toBeInTheDocument());
  });

  it('P1a copy: sells the check — everyone did it, ~2 minutes, persona checks the id, never shown to anyone', () => {
    render(<IdentityVerifyStep />);
    const pitch = screen.getByText(/about 2 minutes/i);
    expect(pitch).toHaveTextContent(/everyone you'll meet/i);
    expect(pitch).toHaveTextContent(/persona/i);
    expect(pitch).toHaveTextContent(/never shown to anyone/i);
  });

  it('P1a error: a raw edge-function error renders the friendly retry copy and logs the real error', async () => {
    const rawError = new Error('Edge Function returned a non-2xx status code');
    startVerification.mockRejectedValueOnce(rawError);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<IdentityVerifyStep />);
    await userEvent.click(screen.getByRole('button', { name: /let's do it/i }));
    const alert = await screen.findByRole('alert');
    // friendly copy, never the raw infrastructure jargon
    expect(alert).toHaveTextContent(/didn't go through\. give it another try\?/i);
    expect(alert).not.toHaveTextContent(/edge function|non-2xx/i);
    // the real error still reaches the console for debugging
    expect(errorLog).toHaveBeenCalledWith(expect.any(String), rawError);
    errorLog.mockRestore();
  });

  it("P1b teaser door: a quiet 'peek at tonight's nights' link targets /feed and is not a button", () => {
    render(<IdentityVerifyStep />);
    const link = screen.getByRole('link', { name: /peek at tonight's nights/i });
    expect(link).toHaveAttribute('href', '/feed');
    // it must not compete with the primary CTA, which stays the only button
    expect(screen.getByRole('button', { name: /let's do it/i })).toBeInTheDocument();
  });

  it('P1b teaser door hides while the Persona capture is mounted', async () => {
    startVerification.mockResolvedValue({ inquiryId: 'inq_1', sessionToken: 'sess_1' });
    render(<IdentityVerifyStep />);
    await userEvent.click(screen.getByRole('button', { name: /let's do it/i }));
    await waitFor(() => expect(screen.getByTestId('persona-embed')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /peek at tonight's nights/i })).not.toBeInTheDocument();
  });

  it('complete: onComplete reveals the VerificationStatus screen', async () => {
    startVerification.mockResolvedValue({ inquiryId: 'inq_1', sessionToken: 'sess_1' });
    render(<IdentityVerifyStep />);
    await userEvent.click(screen.getByRole('button', { name: /let's do it/i }));
    await waitFor(() => expect(lastProps.onComplete).toBeTypeOf('function'));
    lastProps.onComplete?.();
    await waitFor(() => expect(screen.getByTestId('verification-status')).toBeInTheDocument());
  });

  it('cancel: onCancel returns to the start CTA', async () => {
    startVerification.mockResolvedValue({ inquiryId: 'inq_1', sessionToken: 'sess_1' });
    render(<IdentityVerifyStep />);
    await userEvent.click(screen.getByRole('button', { name: /let's do it/i }));
    await waitFor(() => expect(lastProps.onCancel).toBeTypeOf('function'));
    lastProps.onCancel?.();
    await waitFor(() => expect(screen.getByRole('button', { name: /let's do it/i })).toBeInTheDocument());
  });
});
