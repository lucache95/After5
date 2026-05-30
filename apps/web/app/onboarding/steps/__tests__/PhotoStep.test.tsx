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

// Mock PhotoCropper — canvas-based cropping doesn't work in jsdom.
// Renders two buttons that drive onConfirm/onCancel synchronously.
vi.mock('../PhotoCropper', () => ({
  PhotoCropper: ({
    onConfirm,
    onCancel,
  }: {
    file: File;
    onConfirm: (blob: Blob) => void;
    onCancel: () => void;
    busy?: boolean;
  }) => (
    <div>
      <button type="button" onClick={() => onConfirm(new Blob(['x'], { type: 'image/jpeg' }))}>
        looks good
      </button>
      <button type="button" onClick={onCancel}>
        choose different
      </button>
    </div>
  ),
}));

import { PhotoStep } from '../PhotoStep';

function pickFile() {
  return new File(['x'], 'me.jpg', { type: 'image/jpeg' });
}

beforeEach(() => { push.mockReset(); upload.mockReset(); invoke.mockReset(); advanceOnboarding.mockReset(); });

describe('PhotoStep', () => {
  it('empty: upload button disabled until a file is chosen', () => {
    render(<PhotoStep userId="u1" />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('success: uploads clear.jpg, runs generate-blur, advances to preferences', async () => {
    upload.mockResolvedValue({ error: null });
    invoke.mockResolvedValue({ data: { ok: true, blurredPath: 'u1/blurred.jpg' }, error: null });
    advanceOnboarding.mockResolvedValue('preferences');
    render(<PhotoStep userId="u1" />);
    await userEvent.upload(screen.getByLabelText(/pick a photo/i), pickFile());
    // Component enters cropping phase — confirm the mock crop to return to idle.
    await userEvent.click(screen.getByRole('button', { name: /looks good/i }));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith('u1/clear.jpg', expect.any(Blob), expect.objectContaining({ upsert: true })));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('generate-blur', expect.anything()));
    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalledWith(fakeClient, 'preferences'));
    expect(push).toHaveBeenCalledWith('/onboarding/preferences');
  });

  it('error + retry: failed upload shows error; retry re-uploads', async () => {
    upload.mockResolvedValueOnce({ error: { message: 'storage down' } });
    render(<PhotoStep userId="u1" />);
    await userEvent.upload(screen.getByLabelText(/pick a photo/i), pickFile());
    // Confirm the mock crop to return to idle with a croppedBlob.
    await userEvent.click(screen.getByRole('button', { name: /looks good/i }));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/storage down|couldn.t/i));
    upload.mockResolvedValueOnce({ error: null });
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    advanceOnboarding.mockResolvedValueOnce('preferences');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/preferences'));
  });

  it('rejects an unsupported format (HEIC) with a clear message and keeps upload disabled', async () => {
    render(<PhotoStep userId="u1" />);
    const heic = new File(['x'], 'me.heic', { type: 'image/heic' });
    await userEvent.upload(screen.getByLabelText(/pick a photo/i), heic, { applyAccept: false });
    expect(screen.getByRole('alert')).toHaveTextContent(/not supported|jpeg|png/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeDisabled();
  });

  it('cancel/replace: picking a new file clears a prior error', async () => {
    upload.mockResolvedValueOnce({ error: { message: 'fail' } });
    render(<PhotoStep userId="u1" />);
    await userEvent.upload(screen.getByLabelText(/pick a photo/i), pickFile());
    // Confirm the mock crop so we can click next and trigger the error.
    await userEvent.click(screen.getByRole('button', { name: /looks good/i }));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // Picking a new file should clear the error (enters cropping again).
    await userEvent.upload(screen.getByLabelText(/pick a photo/i), pickFile());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
