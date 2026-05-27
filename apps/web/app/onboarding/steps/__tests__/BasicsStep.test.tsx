// apps/web/app/onboarding/steps/__tests__/BasicsStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const upsertProfile = vi.fn();
const advanceOnboarding = vi.fn();
const upsertPrivate = vi.fn().mockResolvedValue({ error: null });
const fakeClient = {
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
  from: vi.fn(() => ({ upsert: upsertPrivate })),
};
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => fakeClient,
  upsertProfile: (...a: unknown[]) => upsertProfile(...a),
  advanceOnboarding: (...a: unknown[]) => advanceOnboarding(...a),
}));

import { BasicsStep } from '../BasicsStep';

beforeEach(() => { push.mockReset(); upsertProfile.mockReset(); advanceOnboarding.mockReset(); upsertPrivate.mockClear(); });

describe('BasicsStep', () => {
  const initial = { first_name: '', bio: '', vibe_tags: [] as string[], prompts: [] as { prompt_id: string; answer: string }[] };

  it('empty: renders a blank form with a disabled continue (no first name yet)', () => {
    render(<BasicsStep userId="u1" initial={initial} />);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('error: shows a validation message when first name is blank on submit attempt', async () => {
    render(<BasicsStep userId="u1" initial={{ ...initial, bio: 'hi' }} />);
    await userEvent.type(screen.getByLabelText(/first name/i), ' ');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(upsertProfile).not.toHaveBeenCalled();
  });

  it('success: valid basics persist (profile + private bio) and advance to photos', async () => {
    upsertProfile.mockResolvedValue(undefined);
    advanceOnboarding.mockResolvedValue('photos');
    render(<BasicsStep userId="u1" initial={initial} />);
    await userEvent.type(screen.getByLabelText(/first name/i), 'Lee');
    await userEvent.type(screen.getByLabelText(/bio/i), 'Coffee and trails.');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith(
      fakeClient, 'u1', expect.objectContaining({ first_name: 'Lee' }),
    ));
    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalledWith(fakeClient, 'photos'));
    expect(push).toHaveBeenCalledWith('/onboarding/photo');
  });

  it('retry: a failed save shows retry that re-saves and advances', async () => {
    upsertProfile.mockRejectedValueOnce(new Error('save failed'));
    render(<BasicsStep userId="u1" initial={{ ...initial, first_name: 'Lee' }} />);
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    upsertProfile.mockResolvedValueOnce(undefined);
    advanceOnboarding.mockResolvedValueOnce('photos');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/photo'));
  });
});
