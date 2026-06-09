import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoverEditor } from '../CoverEditor';

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
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('use a venue photo applies that stop photo as the cover', async () => {
    const onApply = vi.fn();
    const stops = [{ place_id: 'p1', place_name: 'A', photo_url: '/a.jpg' }];
    render(<CoverEditor stops={stops as never} onApply={onApply} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'use /a.jpg' }));
    expect(onApply).toHaveBeenCalledWith('/a.jpg');
  });

  it('shows venue photos section when stops have photo_url, omits falsy urls', () => {
    const stops = [
      { place_id: 'p1', place_name: 'A', photo_url: '/a.jpg' },
      { place_id: 'p2', place_name: 'B', photo_url: null },
    ];
    render(<CoverEditor stops={stops as never} onApply={vi.fn()} onClose={() => {}} />);
    // getByRole throws if not found — confirms the photo button rendered
    screen.getByRole('button', { name: 'use /a.jpg' });
    // null photo should NOT produce a button
    expect(screen.queryByRole('button', { name: 'use null' })).toBeNull();
  });

  it('shows an empty state when no stop has a photo', () => {
    const stops = [{ place_id: 'p1', place_name: 'A', photo_url: null }];
    render(<CoverEditor stops={stops as never} onApply={vi.fn()} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /use / })).toBeNull();
    // getByText throws if not found — confirms the empty state rendered
    screen.getByText(/no venue photos/i);
  });
});
