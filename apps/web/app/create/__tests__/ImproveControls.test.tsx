import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImproveControls } from '../ImproveControls';
import type { Stop } from '@/lib/itinerary-types';

const invoke = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({ functions: { invoke: (...a: unknown[]) => invoke(...a) } }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

const STOPS: Stop[] = [
  { place_id: 'a', place_name: 'Clay Studio', place_type: 'activity', start_time: '18:00', duration_min: 60, estimated_cost_pp: 30 },
  { place_id: 'b', place_name: 'Sandrine', place_type: 'restaurant', start_time: '19:30', duration_min: 90, estimated_cost_pp: 40 },
];

describe('ImproveControls', () => {
  beforeEach(() => {
    invoke.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('renders a per-stop tweak affordance for every stop + an NL tweak input', () => {
    render(<ImproveControls itineraryId="it-1" stops={STOPS} onUpdated={() => {}} />);
    expect(screen.getAllByRole('button', { name: /swap .* for another spot/i })).toHaveLength(2);
    expect(screen.getByLabelText(/describe a change to your night/i)).toBeInTheDocument();
  });

  it('swap_stop calls the improve dispatch and updates in place on success', async () => {
    const newStops: Stop[] = [{ ...STOPS[0], place_id: 'c', place_name: 'New Studio' }, STOPS[1]];
    invoke.mockResolvedValue({ data: { ok: true, stops: newStops }, error: null });
    const onUpdated = vi.fn();
    render(<ImproveControls itineraryId="it-1" stops={STOPS} onUpdated={onUpdated} />);

    await userEvent.click(screen.getAllByRole('button', { name: /swap .* for another spot/i })[0]);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('generate-plan', {
      body: { action: 'swap_stop', itinerary_id: 'it-1', stop_index: 0 },
    }));
    expect(onUpdated).toHaveBeenCalledWith(newStops);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('an NL tweak applies the parsed change', async () => {
    invoke.mockResolvedValue({ data: { ok: true, stops: STOPS }, error: null });
    const onUpdated = vi.fn();
    render(<ImproveControls itineraryId="it-1" stops={STOPS} onUpdated={onUpdated} />);

    await userEvent.type(screen.getByLabelText(/describe a change to your night/i), 'cheaper');
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('generate-plan', {
      body: { action: 'nl_tweak', itinerary_id: 'it-1', tweak_text: 'cheaper' },
    }));
    expect(onUpdated).toHaveBeenCalled();
  });

  it('surfaces a coherence break as a toast — NOT a silent swap', async () => {
    invoke.mockResolvedValue({
      data: { ok: false, issues: [{ kind: 'proximity', message: 'this swap puts you 8.0km from the next stop — too far to flow.' }] },
      error: null,
    });
    const onUpdated = vi.fn();
    render(<ImproveControls itineraryId="it-1" stops={STOPS} onUpdated={onUpdated} />);

    await userEvent.click(screen.getAllByRole('button', { name: /swap .* for another spot/i })[0]);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/8\.0km/)));
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('reads the structured error body from a FunctionsHttpError (non-2xx)', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { context: { json: async () => ({ ok: false, issues: [{ kind: 'budget', message: 'over your budget.' }] }) } },
    });
    const onUpdated = vi.fn();
    render(<ImproveControls itineraryId="it-1" stops={STOPS} onUpdated={onUpdated} />);

    await userEvent.click(screen.getAllByRole('button', { name: /swap .* for another spot/i })[0]);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('over your budget.'));
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('tweak buttons meet the ≥44px tap-target minimum', () => {
    render(<ImproveControls itineraryId="it-1" stops={STOPS} onUpdated={() => {}} />);
    const btn = screen.getAllByRole('button', { name: /swap .* for another spot/i })[0];
    expect(btn.className).toMatch(/min-h-\[44px\]/);
  });
});
