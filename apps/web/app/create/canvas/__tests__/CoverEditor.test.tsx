import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoverEditor } from '../CoverEditor';

const invoke = vi.fn();
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({ functions: { invoke } }) }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

// next/image requires real dimensions from an external loader in tests — stub it.
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

describe('CoverEditor', () => {
  beforeEach(() => {
    invoke.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('use a venue photo applies that stop photo as the cover', async () => {
    const onApply = vi.fn();
    const stops = [{ place_id: 'p1', place_name: 'A', photo_url: '/a.jpg' }];
    render(
      <CoverEditor
        itineraryId="it1"
        stops={stops as never}
        current={null}
        onApply={onApply}
        onClose={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'use /a.jpg' }));
    expect(onApply).toHaveBeenCalledWith('/a.jpg');
  });

  it('shows venue photos section when stops have photo_url, omits falsy urls', () => {
    const stops = [
      { place_id: 'p1', place_name: 'A', photo_url: '/a.jpg' },
      { place_id: 'p2', place_name: 'B', photo_url: null },
    ];
    render(
      <CoverEditor
        itineraryId="it1"
        stops={stops as never}
        current={null}
        onApply={vi.fn()}
        onClose={() => {}}
      />,
    );
    // getByRole throws if not found — confirms the photo button rendered
    screen.getByRole('button', { name: 'use /a.jpg' });
    // null photo should NOT produce a button
    expect(screen.queryByRole('button', { name: 'use null' })).toBeNull();
  });

  it('fresh cover calls generate-cover and applies on success', async () => {
    invoke.mockResolvedValue({
      data: { processed: 1, results: [{ id: 'it1', cover: 'https://cdn.example.com/cover.webp' }] },
      error: null,
    });
    const onApply = vi.fn();
    render(
      <CoverEditor
        itineraryId="it1"
        stops={[]}
        current={null}
        onApply={onApply}
        onClose={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /fresh cover/i }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith('https://cdn.example.com/cover.webp'));
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('fresh cover shows error toast and does NOT call onApply on failure', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('network') });
    const onApply = vi.fn();
    render(
      <CoverEditor
        itineraryId="it1"
        stops={[]}
        current={null}
        onApply={onApply}
        onClose={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /fresh cover/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onApply).not.toHaveBeenCalled();
  });
});
