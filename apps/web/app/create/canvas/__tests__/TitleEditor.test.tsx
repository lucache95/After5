import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TitleEditor } from '../TitleEditor';

const invoke = vi.fn();
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({ functions: { invoke } }) }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

describe('TitleEditor', () => {
  beforeEach(() => {
    invoke.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('another take applies the new title', async () => {
    invoke.mockResolvedValue({ data: { ok: true, title: 'New Title', hook: 'new hook' }, error: null });
    const onApply = vi.fn();
    render(<TitleEditor itineraryId="it1" current={{ title: 'Old', hook: 'h' }} onApply={onApply} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /another take/i }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ title: 'New Title', hook: 'new hook' }));
  });

  it('surfaces issues as a toast and does NOT call onApply on ok:false', async () => {
    invoke.mockResolvedValue({ data: { ok: false, issues: [{ message: 'nope' }] }, error: null });
    const onApply = vi.fn();
    render(<TitleEditor itineraryId="it1" current={{ title: 'Old', hook: 'h' }} onApply={onApply} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /another take/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onApply).not.toHaveBeenCalled();
  });
});
