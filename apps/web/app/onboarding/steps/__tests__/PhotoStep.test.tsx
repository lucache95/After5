// apps/web/app/onboarding/steps/__tests__/PhotoStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const upload = vi.fn();
const invoke = vi.fn();
const advanceOnboarding = vi.fn();
const fakeClient = { storage: { from: () => ({ upload }) }, functions: { invoke } };
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => fakeClient,
  advanceOnboarding: (...a: unknown[]) => advanceOnboarding(...a),
}));

import { PhotoStep } from '../PhotoStep';

function pickFile() {
  return new File(['x'], 'me.jpg', { type: 'image/jpeg' });
}

beforeEach(() => { push.mockReset(); upload.mockReset(); invoke.mockReset(); advanceOnboarding.mockReset(); });

describe('PhotoStep', () => {
  it('empty: upload button disabled until a file is chosen', () => {
    render(<PhotoStep userId="u1" />);
    expect(screen.getByRole('button', { name: /upload/i })).toBeDisabled();
  });

  it('success: uploads clear.jpg, runs generate-blur, advances to preferences', async () => {
    upload.mockResolvedValue({ error: null });
    invoke.mockResolvedValue({ data: { ok: true, blurredPath: 'u1/blurred.jpg' }, error: null });
    advanceOnboarding.mockResolvedValue('preferences');
    render(<PhotoStep userId="u1" />);
    await userEvent.upload(screen.getByLabelText(/choose a photo/i), pickFile());
    await userEvent.click(screen.getByRole('button', { name: /upload/i }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith('u1/clear.jpg', expect.any(File), expect.objectContaining({ upsert: true })));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('generate-blur', expect.anything()));
    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalledWith(fakeClient, 'preferences'));
    expect(push).toHaveBeenCalledWith('/onboarding/preferences');
  });

  it('error + retry: failed upload shows error; retry re-uploads', async () => {
    upload.mockResolvedValueOnce({ error: { message: 'storage down' } });
    render(<PhotoStep userId="u1" />);
    await userEvent.upload(screen.getByLabelText(/choose a photo/i), pickFile());
    await userEvent.click(screen.getByRole('button', { name: /upload/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/storage down|couldn.t/i));
    upload.mockResolvedValueOnce({ error: null });
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    advanceOnboarding.mockResolvedValueOnce('preferences');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/preferences'));
  });

  it('cancel/replace: picking a new file clears a prior error', async () => {
    upload.mockResolvedValueOnce({ error: { message: 'fail' } });
    render(<PhotoStep userId="u1" />);
    await userEvent.upload(screen.getByLabelText(/choose a photo/i), pickFile());
    await userEvent.click(screen.getByRole('button', { name: /upload/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    await userEvent.upload(screen.getByLabelText(/choose a photo/i), pickFile());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
