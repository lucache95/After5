// REQ-E4 / D-09 — the shared mode-aware preferences form.
// Asserts the post-save fork: account mode saves but NEVER advances onboarding
// and never pushes /onboarding/* (Pitfall 2); onboarding mode advances + pushes;
// invalid input blocks the save in both modes; and parseAgePref is upper-exclusive
// correct (Pitfall 3).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { push, refresh, savePreferences, advanceOnboarding, datingUpdate, toastSuccess, fetchMock } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  savePreferences: vi.fn(async () => undefined),
  advanceOnboarding: vi.fn(async () => undefined),
  datingUpdate: vi.fn(() => ({ eq: async () => ({ error: null }) })),
  toastSuccess: vi.fn(),
  // P0 default-city backfill goes through fetch('/api/profile/default-city').
  fetchMock: vi.fn(async () => ({ ok: true })),
}));
vi.stubGlobal('fetch', fetchMock);

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
  fetchMock.mockClear();
  savePreferences.mockResolvedValue(undefined);
  advanceOnboarding.mockResolvedValue(undefined);
  fetchMock.mockResolvedValue({ ok: true } as never);
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

describe('PreferencesForm — P0 launch-city default (empty-feed fix)', () => {
  it('the save POSTs /api/profile/default-city (the server backfills a null city)', async () => {
    render(<PreferencesForm mode="onboarding" userId="u1" initial={INITIAL} />);
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/profile/default-city', { method: 'POST' }));
    // ordering: prefs are saved before the backfill fires
    expect(savePreferences).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/onboarding/phone');
  });

  it('a failing backfill NEVER stalls the funnel — still advances + pushes', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<PreferencesForm mode="onboarding" userId="u1" initial={INITIAL} />);
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/phone'));
    expect(advanceOnboarding).toHaveBeenCalledWith(expect.anything(), 'phone_verify');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('invalid input never fires the backfill (no save, no city write)', async () => {
    const bad: PreferencesInitial = { ...INITIAL, age_min: 50, age_max: 30 };
    render(<PreferencesForm mode="onboarding" userId="u1" initial={bad} />);
    fireEvent.click(screen.getByRole('button', { name: /next|try again/ }));
    await screen.findByRole('alert');
    expect(fetchMock).not.toHaveBeenCalled();
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

describe('PreferencesForm — pill labels (audit pass-2: lowercase + natural hard-nos)', () => {
  it('gender chips render lowercase (woman / man / nonbinary)', () => {
    render(<PreferencesForm mode="onboarding" userId="u1" initial={INITIAL} />);
    // All three gender options should appear lowercase
    expect(screen.getByRole('radio', { name: 'woman' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'man' })).toBeInTheDocument();
  });

  it('hard-no chips use natural dealbreaker labels (no double-negative)', () => {
    render(<PreferencesForm mode="onboarding" userId="u1" initial={INITIAL} />);
    // "smoking" → "smokers"
    expect(screen.getByRole('checkbox', { name: 'smokers' })).toBeInTheDocument();
    // "wants_kids" → "wants kids"
    expect(screen.getByRole('checkbox', { name: 'wants kids' })).toBeInTheDocument();
    // "no_kids" → "doesn't want kids" (not the double-negative "no kids")
    expect(screen.getByRole('checkbox', { name: "doesn't want kids" })).toBeInTheDocument();
  });

  it('selecting a hard-no chip stores the original schema value, not the display label', async () => {
    render(<PreferencesForm mode="onboarding" userId="u1" initial={INITIAL} />);
    // Click "smokers" chip — stored value must be "smoking"
    await userEvent.click(screen.getByRole('checkbox', { name: 'smokers' }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith(
      expect.anything(), 'u1', expect.objectContaining({ dealbreakers: ['smoking'] }),
    ));
  });
});

describe('PreferencesForm — DLB "about you" lifestyle facts (optional tri-state)', () => {
  it('defaults every unanswered fact to null in the save payload', async () => {
    render(<PreferencesForm mode="account" userId="u1" initial={INITIAL} datingEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith(
      expect.anything(), 'u1',
      expect.objectContaining({ smokes: null, drinks: null, has_pets: null, wants_kids: null }),
    ));
  });

  it('selecting yes persists true; selecting no persists false', async () => {
    render(<PreferencesForm mode="account" userId="u1" initial={INITIAL} datingEnabled />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'do you smoke: yes' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'do you drink: no' }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith(
      expect.anything(), 'u1',
      expect.objectContaining({ smokes: true, drinks: false, has_pets: null, wants_kids: null }),
    ));
  });

  it('tapping the selected chip again clears back to null (unanswered)', async () => {
    render(<PreferencesForm mode="account" userId="u1" initial={{ ...INITIAL, wants_kids: true }} datingEnabled />);
    const yes = screen.getByRole('checkbox', { name: 'want kids: yes' });
    expect(yes).toHaveAttribute('aria-checked', 'true'); // hydrated from initial
    await userEvent.click(yes); // clear
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith(
      expect.anything(), 'u1', expect.objectContaining({ wants_kids: null }),
    ));
  });

  it('yes and no are mutually exclusive within a row', async () => {
    render(<PreferencesForm mode="account" userId="u1" initial={INITIAL} datingEnabled />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'have pets: yes' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'have pets: no' }));
    expect(screen.getByRole('checkbox', { name: 'have pets: yes' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith(
      expect.anything(), 'u1', expect.objectContaining({ has_pets: false }),
    ));
  });

  it('renders the optional helper line (truthful enforcement copy)', () => {
    render(<PreferencesForm mode="account" userId="u1" initial={INITIAL} datingEnabled />);
    expect(screen.getByText(/optional — this is what other people's hard nos check against\./i)).toBeInTheDocument();
    expect(screen.getByText(/won't show up for you\./i)).toBeInTheDocument();
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
