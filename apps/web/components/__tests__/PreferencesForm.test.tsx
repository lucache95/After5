// REQ-E4 / D-09 — the shared mode-aware preferences form.
// Asserts the post-save fork: account mode saves but NEVER advances onboarding
// and never pushes /onboarding/* (Pitfall 2); onboarding mode advances + pushes;
// invalid input blocks the save in both modes; and parseAgePref is upper-exclusive
// correct (Pitfall 3).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, refresh, savePreferences, advanceOnboarding, datingUpdate, toastSuccess } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  savePreferences: vi.fn(async () => undefined),
  advanceOnboarding: vi.fn(async () => undefined),
  datingUpdate: vi.fn(() => ({ eq: async () => ({ error: null }) })),
  toastSuccess: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a) } }));
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({ from: () => ({ update: datingUpdate }) }),
  savePreferences: (...a: unknown[]) => savePreferences(...a),
  advanceOnboarding: (...a: unknown[]) => advanceOnboarding(...a),
}));

import { PreferencesForm, type PreferencesInitial } from '../PreferencesForm';
import { parseAgePref } from '@/lib/after5/parseAgePref';

const INITIAL: PreferencesInitial = {
  gender: 'woman',
  gender_preferences: ['man'],
  age_min: 25,
  age_max: 40,
  distance_pref_km: 40,
  dealbreakers: [],
};

beforeEach(() => {
  push.mockClear(); refresh.mockClear(); savePreferences.mockClear();
  advanceOnboarding.mockClear(); datingUpdate.mockClear(); toastSuccess.mockClear();
  savePreferences.mockResolvedValue(undefined);
  advanceOnboarding.mockResolvedValue(undefined);
});

describe('parseAgePref — canonical int4range parser (Pitfall 3)', () => {
  it('is upper-EXCLUSIVE for [lo,hi)', () => {
    expect(parseAgePref('[25,40)')).toEqual({ min: 25, max: 39 });
  });
  it('is inclusive for [lo,hi]', () => {
    expect(parseAgePref('[25,40]')).toEqual({ min: 25, max: 40 });
  });
  it('falls back to the default on bad input', () => {
    expect(parseAgePref('garbage')).toEqual({ min: 25, max: 40 });
    expect(parseAgePref(null)).toEqual({ min: 25, max: 40 });
  });
});

describe('PreferencesForm — account mode (Pitfall 2: never touch onboarding)', () => {
  it('saves exactly once and does NOT advance onboarding or push /onboarding/*', async () => {
    render(<PreferencesForm mode="account" userId="u1" initial={INITIAL} datingEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(savePreferences).toHaveBeenCalledTimes(1));
    expect(advanceOnboarding).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('preferences saved');
    expect(refresh).toHaveBeenCalled();
  });
});

describe('PreferencesForm — onboarding mode (behavior-preserving)', () => {
  it('saves then advances onboarding then pushes /onboarding/phone', async () => {
    render(<PreferencesForm mode="onboarding" userId="u1" initial={INITIAL} />);
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() => expect(savePreferences).toHaveBeenCalledTimes(1));
    expect(advanceOnboarding).toHaveBeenCalledWith(expect.anything(), 'phone_verify');
    expect(push).toHaveBeenCalledWith('/onboarding/phone');
  });
});

describe('PreferencesForm — invalid input blocks save (both modes)', () => {
  it('does not call savePreferences when age_max < age_min', async () => {
    const bad: PreferencesInitial = { ...INITIAL, age_min: 50, age_max: 30 };
    render(<PreferencesForm mode="account" userId="u1" initial={bad} datingEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await screen.findByRole('alert');
    expect(savePreferences).not.toHaveBeenCalled();
  });

  it('does not advance onboarding on invalid input', async () => {
    const bad: PreferencesInitial = { ...INITIAL, age_min: 50, age_max: 30 };
    render(<PreferencesForm mode="onboarding" userId="u1" initial={bad} />);
    fireEvent.click(screen.getByRole('button', { name: /next|try again/ }));
    await screen.findByRole('alert');
    expect(savePreferences).not.toHaveBeenCalled();
    expect(advanceOnboarding).not.toHaveBeenCalled();
  });
});

describe('PreferencesForm — dating toggle (A3: ON→OFF stop new exposure only)', () => {
  it('renders the pause control when dating is ON and writes dating_enabled=false on confirm', async () => {
    render(<PreferencesForm mode="account" userId="u1" initial={INITIAL} datingEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'pause dating' }));
    fireEvent.click(screen.getByRole('button', { name: 'pause' }));
    await waitFor(() => expect(datingUpdate).toHaveBeenCalledWith({ dating_enabled: false }));
  });

  it('A3: OFF write is dating_enabled-ONLY — it never touches offers/locks (active offers left intact)', async () => {
    render(<PreferencesForm mode="account" userId="u1" initial={INITIAL} datingEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'pause dating' }));
    fireEvent.click(screen.getByRole('button', { name: 'pause' }));
    await waitFor(() => expect(datingUpdate).toHaveBeenCalled());
    // The single profiles write carries ONLY dating_enabled — no offer/lock cascade.
    // A seeded active offer/lock is untouched because nothing else is written or invoked.
    const payload = datingUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['dating_enabled']);
    expect(payload.dating_enabled).toBe(false);
  });

  it('renders the ON→OFF (turn on) path when dating is OFF', async () => {
    render(<PreferencesForm mode="account" userId="u1" initial={INITIAL} datingEnabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'turn dating on' }));
    await waitFor(() => expect(datingUpdate).toHaveBeenCalledWith({ dating_enabled: true }));
  });

  it('does not render the dating toggle in onboarding mode', () => {
    render(<PreferencesForm mode="onboarding" userId="u1" initial={INITIAL} />);
    expect(screen.queryByText(/dating is on|turn dating on/i)).not.toBeInTheDocument();
  });
});
