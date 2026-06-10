// apps/web/app/onboarding/steps/__tests__/PreferencesStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const savePreferences = vi.fn();
const advanceOnboarding = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  savePreferences: (...a: unknown[]) => savePreferences(...a),
  advanceOnboarding: (...a: unknown[]) => advanceOnboarding(...a),
}));

import { PreferencesStep } from '../PreferencesStep';

const initial = { gender: 'woman', gender_preferences: ['man'], age_min: 25, age_max: 40, distance_pref_km: 40, dealbreakers: [] as string[] };

beforeEach(() => { push.mockReset(); savePreferences.mockReset(); advanceOnboarding.mockReset(); });

describe('PreferencesStep', () => {
  it('success: valid prefs save and advance to phone', async () => {
    savePreferences.mockResolvedValue(undefined);
    advanceOnboarding.mockResolvedValue('phone_verify');
    render(<PreferencesStep userId="u1" initial={initial} />);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith(
      expect.anything(), 'u1', expect.objectContaining({ gender: 'woman', age_min: 25, age_max: 40 }),
    ));
    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalledWith(expect.anything(), 'phone_verify'));
    expect(push).toHaveBeenCalledWith('/onboarding/phone');
  });

  it('age input: deletable to empty, leading zero stripped while typing (the "019" bug)', async () => {
    render(<PreferencesStep userId="u1" initial={initial} />);
    const ageFrom = screen.getByLabelText(/age from/i);
    await userEvent.clear(ageFrom);
    expect(ageFrom).toHaveValue(''); // deleting to empty must work
    await userEvent.type(ageFrom, '019');
    expect(ageFrom).toHaveValue('19'); // never renders a trapped leading 0
  });

  it('age input: typed value submits as a number', async () => {
    savePreferences.mockResolvedValue(undefined);
    advanceOnboarding.mockResolvedValue('phone_verify');
    render(<PreferencesStep userId="u1" initial={initial} />);
    const ageFrom = screen.getByLabelText(/age from/i);
    await userEvent.clear(ageFrom);
    await userEvent.type(ageFrom, '19');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith(
      expect.anything(), 'u1', expect.objectContaining({ age_min: 19, age_max: 40 }),
    ));
  });

  it('age input: empty field blocks submit with the validation alert', async () => {
    render(<PreferencesStep userId="u1" initial={initial} />);
    await userEvent.clear(screen.getByLabelText(/age from/i));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/age range/i));
    expect(savePreferences).not.toHaveBeenCalled();
  });

  it('hard nos: clarifying helper line renders under the heading', () => {
    render(<PreferencesStep userId="u1" initial={initial} />);
    expect(screen.getByText(/anyone who matches one of these is an instant no/i)).toBeInTheDocument();
  });

  it('error: age_max below age_min is rejected before any save', async () => {
    render(<PreferencesStep userId="u1" initial={{ ...initial, age_min: 40, age_max: 30 }} />);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(savePreferences).not.toHaveBeenCalled();
  });

  it('retry: a failed save shows retry that re-saves and advances', async () => {
    savePreferences.mockRejectedValueOnce(new Error('save failed'));
    render(<PreferencesStep userId="u1" initial={initial} />);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    savePreferences.mockResolvedValueOnce(undefined);
    advanceOnboarding.mockResolvedValueOnce('phone_verify');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/phone'));
  });
});
