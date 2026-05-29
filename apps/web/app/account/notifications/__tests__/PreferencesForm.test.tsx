import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const upsert = vi.fn(async () => ({ error: null }));
const from = vi.fn(() => ({ upsert }));
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({ from }) }));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }));

import { PreferencesForm } from '../PreferencesForm';

beforeEach(() => { upsert.mockClear(); from.mockClear(); toastError.mockClear(); toastSuccess.mockClear(); upsert.mockResolvedValue({ error: null }); });

const ALL_COLS = [
  'user_id', 'push_enabled', 'email_enabled', 'offers_enabled', 'matches_enabled',
  'messages_enabled', 'reminders_enabled', 'account_enabled', 'quiet_hours_start', 'quiet_hours_end',
];

describe('PreferencesForm', () => {
  it('renders all-on defaults when initial is null', () => {
    render(<PreferencesForm userId="u1" initial={null} />);
    for (const sw of screen.getAllByRole('switch')) {
      expect(sw).toHaveAttribute('aria-checked', 'true');
    }
  });

  it('save upserts the full column set with onConflict user_id', async () => {
    render(<PreferencesForm userId="u1" initial={null} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(upsert).toHaveBeenCalled());
    const [vals, opts] = upsert.mock.calls[0];
    expect(Object.keys(vals as Record<string, unknown>).sort()).toEqual([...ALL_COLS].sort());
    expect(opts).toMatchObject({ onConflict: 'user_id' });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('toggling a switch flips its persisted value', async () => {
    render(<PreferencesForm userId="u1" initial={null} />);
    const offers = screen.getByRole('switch', { name: /offers/i });
    fireEvent.click(offers);
    expect(offers).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect((upsert.mock.calls[0][0] as Record<string, unknown>).offers_enabled).toBe(false);
  });

  it('blocks save when only one quiet-hours field is set (both-or-neither)', async () => {
    render(<PreferencesForm userId="u1" initial={null} />);
    fireEvent.change(screen.getByLabelText(/quiet hours start/i), { target: { value: '22:00' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(upsert).not.toHaveBeenCalled();
  });

  it('persists both quiet-hours fields when both set', async () => {
    render(<PreferencesForm userId="u1" initial={null} />);
    fireEvent.change(screen.getByLabelText(/quiet hours start/i), { target: { value: '22:00' } });
    fireEvent.change(screen.getByLabelText(/quiet hours end/i), { target: { value: '07:00' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(upsert).toHaveBeenCalled());
    const vals = upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(vals.quiet_hours_start).toBe('22:00');
    expect(vals.quiet_hours_end).toBe('07:00');
  });
});
