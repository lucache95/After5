import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StopsEditor } from '../StopsEditor';

const invoke = vi.fn();
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({ functions: { invoke } }) }));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) } }));

beforeEach(() => { invoke.mockReset(); toastError.mockReset(); });

test('swap this stop applies returned stops', async () => {
  invoke.mockResolvedValue({ data: { ok: true, stops: [{ place_id: 'pX', place_name: 'X' }] }, error: null });
  const onApply = vi.fn();
  render(<StopsEditor itineraryId="it1" stops={[{ place_id: 'p1', place_name: 'A' }] as never} onApply={onApply} onClose={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /change the ending|swap this stop/i }));
  await waitFor(() => expect(onApply).toHaveBeenCalledWith([{ place_id: 'pX', place_name: 'X' }]));
});

test('single stop: no "drop this stop" button renders', () => {
  render(<StopsEditor itineraryId="it1" stops={[{ place_id: 'p1', place_name: 'A' }] as never} onApply={vi.fn()} onClose={() => {}} />);
  expect(screen.queryByRole('button', { name: /drop this stop/i })).toBeNull();
});

test('incoherent change surfaces an error, no apply', async () => {
  invoke.mockResolvedValue({ data: { ok: false, issues: [{ message: 'breaks the flow' }] }, error: null });
  const onApply = vi.fn();
  render(<StopsEditor itineraryId="it1" stops={[{ place_id: 'p1', place_name: 'A' }] as never} onApply={onApply} onClose={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /change the ending|swap this stop/i }));
  await waitFor(() => expect(toastError).toHaveBeenCalled());
  expect(onApply).not.toHaveBeenCalled();
});

test('drop this stop only shows with more than one stop, and removes', async () => {
  invoke.mockResolvedValue({ data: { ok: true, stops: [{ place_id: 'p1', place_name: 'A' }] }, error: null });
  const onApply = vi.fn();
  render(<StopsEditor itineraryId="it1" stops={[{ place_id: 'p1', place_name: 'A' }, { place_id: 'p2', place_name: 'B' }] as never} onApply={onApply} onClose={() => {}} />);
  const dropButtons = screen.getAllByRole('button', { name: /drop this stop/i });
  expect(dropButtons.length).toBe(2);
  await userEvent.click(dropButtons[1]);
  await waitFor(() => expect(onApply).toHaveBeenCalledWith([{ place_id: 'p1', place_name: 'A' }]));
});
