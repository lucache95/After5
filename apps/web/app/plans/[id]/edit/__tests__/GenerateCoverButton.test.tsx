import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// HeartLoader (the pending state) animates via framer-motion; stub it so jsdom renders.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children }: { children?: React.ReactNode }) => <span>{children}</span> }),
  useReducedMotion: () => true,
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { GenerateCoverButton } from '../GenerateCoverButton';

function deferredFetch() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  const fetchMock = vi.fn().mockReturnValue(promise);
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, resolve };
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const fail = (body: unknown, status = 502) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.unstubAllGlobals();
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe('GenerateCoverButton', () => {
  it('shows the pending state while the fn runs, then reports the new cover', async () => {
    const { fetchMock, resolve } = deferredFetch();
    const onGenerated = vi.fn();
    render(<GenerateCoverButton itineraryId="it-1" variant="empty" onGenerated={onGenerated} />);
    await userEvent.click(screen.getByRole('button', { name: /generate a cover/i }));
    expect(screen.getByText(/dreaming one up/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/generate-cover',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ itinerary_id: 'it-1' }) }),
    );
    resolve(ok({ cover_image_url: 'https://x/gen.webp' }));
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith('https://x/gen.webp'));
    expect(toastSuccess).toHaveBeenCalled();
    expect(screen.queryByText(/dreaming one up/i)).not.toBeInTheDocument();
  });

  it('surfaces the fn error message as a toast and does not call onGenerated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail({ error: 'replicate_failed' })));
    const onGenerated = vi.fn();
    render(<GenerateCoverButton itineraryId="it-1" variant="regenerate" onGenerated={onGenerated} />);
    await userEvent.click(screen.getByRole('button', { name: /regenerate with ai/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('replicate_failed'));
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it('handles a network failure with an honest toast', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<GenerateCoverButton itineraryId="it-1" variant="empty" onGenerated={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /generate a cover/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/couldn.t reach/i)));
  });
});
