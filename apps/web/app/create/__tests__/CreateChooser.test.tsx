import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateChooser } from '../CreateChooser';

const push = vi.fn();
const back = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back }),
}));

const createBlankItinerary = vi.fn();
vi.mock('@after5/api-client', () => ({
  createBlankItinerary: (...a: unknown[]) => createBlankItinerary(...a),
}));
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({}) }));
vi.mock('sonner', () => ({
  toast: { loading: () => 't', success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

describe('CreateChooser', () => {
  beforeEach(() => {
    push.mockClear();
    back.mockClear();
    createBlankItinerary.mockReset();
  });

  it('presents generate as the dominant primary action routing to the funnel', async () => {
    render(<CreateChooser />);
    const generate = screen.getByRole('button', { name: /build it for me/i });
    expect(generate).toBeInTheDocument();
    // The dominant action is the pink shell-accent card.
    expect(generate.className).toContain('bg-shell-accent');
    await userEvent.click(generate);
    expect(push).toHaveBeenCalledWith('/create/generate');
    expect(createBlankItinerary).not.toHaveBeenCalled();
  });

  it('demotes the manual door to a quiet secondary link, not a co-equal card', () => {
    render(<CreateChooser />);
    const manual = screen.getByRole('button', { name: /build from scratch/i });
    expect(manual).toBeInTheDocument();
    // It must NOT be a co-equal primary card: no pink fill, no bordered-card chrome.
    expect(manual.className).not.toContain('bg-shell-accent');
    expect(manual.className).not.toMatch(/border-shell-ink\/15/);
  });

  it('the demoted manual link still creates a blank itinerary then opens its canvas', async () => {
    createBlankItinerary.mockResolvedValue('blank-123');
    render(<CreateChooser />);
    await userEvent.click(screen.getByRole('button', { name: /build from scratch/i }));
    await waitFor(() => expect(createBlankItinerary).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/plans/blank-123/edit'));
  });

  it('the demoted manual link does not route when the RPC fails (no trap)', async () => {
    createBlankItinerary.mockRejectedValue(new Error('boom'));
    render(<CreateChooser />);
    await userEvent.click(screen.getByRole('button', { name: /build from scratch/i }));
    await waitFor(() => expect(createBlankItinerary).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
  });
});
