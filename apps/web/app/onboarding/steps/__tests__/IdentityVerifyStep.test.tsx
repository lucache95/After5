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
