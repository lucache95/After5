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

  it('renders both doors', () => {
    render(<CreateChooser />);
    expect(screen.getByRole('button', { name: /build it for me/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start from scratch/i })).toBeInTheDocument();
  });

  it('door 1 routes to the generate funnel', async () => {
    render(<CreateChooser />);
    await userEvent.click(screen.getByRole('button', { name: /build it for me/i }));
    expect(push).toHaveBeenCalledWith('/create/generate');
    expect(createBlankItinerary).not.toHaveBeenCalled();
  });

  it('door 2 creates a blank itinerary then routes to its canvas', async () => {
    createBlankItinerary.mockResolvedValue('blank-123');
    render(<CreateChooser />);
    await userEvent.click(screen.getByRole('button', { name: /start from scratch/i }));
    await waitFor(() => expect(createBlankItinerary).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/plans/blank-123/edit'));
  });

  it('door 2 does not route when the RPC fails', async () => {
    createBlankItinerary.mockRejectedValue(new Error('boom'));
    render(<CreateChooser />);
    await userEvent.click(screen.getByRole('button', { name: /start from scratch/i }));
    await waitFor(() => expect(createBlankItinerary).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
  });
});
