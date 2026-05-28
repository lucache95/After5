// apps/web/app/onboarding/steps/__tests__/BasicsStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const upsertProfile = vi.fn();
const advanceOnboarding = vi.fn();
// profiles_private write is now insert-first with an update fallback on 23505.
const insertPrivate = vi.fn().mockResolvedValue({ error: null });
const updateEq = vi.fn().mockResolvedValue({ error: null });
const updatePrivate = vi.fn(() => ({ eq: updateEq }));
const fakeClient = {
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
  from: vi.fn(() => ({ insert: insertPrivate, update: updatePrivate })),
};
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => fakeClient,
  upsertProfile: (...a: unknown[]) => upsertProfile(...a),
  advanceOnboarding: (...a: unknown[]) => advanceOnboarding(...a),
}));

import { BasicsStep } from '../BasicsStep';

beforeEach(() => {
  push.mockReset(); upsertProfile.mockReset(); advanceOnboarding.mockReset();
  insertPrivate.mockClear().mockResolvedValue({ error: null });
  updateEq.mockClear().mockResolvedValue({ error: null });
  updatePrivate.mockClear();
});

describe('BasicsStep', () => {
  const initial = { first_name: '', bio: '', vibe_tags: [] as string[], prompts: [] as { prompt_id: string; answer: string }[] };

  it('empty: renders a blank form with a disabled continue (no first name yet)', () => {
    render(<BasicsStep userId="u1" initial={initial} />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('error: shows a validation message when first name is blank on submit attempt', async () => {
    render(<BasicsStep userId="u1" initial={{ ...initial, bio: 'hi' }} />);
    await userEvent.type(screen.getByLabelText(/first name/i), ' ');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(upsertProfile).not.toHaveBeenCalled();
  });

  it('success: valid basics persist (profile + private bio) and advance to photos', async () => {
    upsertProfile.mockResolvedValue(undefined);
    advanceOnboarding.mockResolvedValue('photos');
    render(<BasicsStep userId="u1" initial={initial} />);
    await userEvent.type(screen.getByLabelText(/first name/i), 'Lee');
    await userEvent.type(screen.getByLabelText(/bio/i), 'Coffee and trails.');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith(
      fakeClient, 'u1', expect.objectContaining({ first_name: 'Lee' }),
    ));
    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalledWith(fakeClient, 'photos'));
    expect(push).toHaveBeenCalledWith('/onboarding/photo');
  });

  it('private bio: inserts the row, then falls back to update on a 23505 conflict', async () => {
    upsertProfile.mockResolvedValue(undefined);
    advanceOnboarding.mockResolvedValue('photos');
    insertPrivate.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
    render(<BasicsStep userId="u1" initial={{ ...initial, first_name: 'Lee', bio: 'hi' }} />);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(updatePrivate).toHaveBeenCalled());
    expect(updateEq).toHaveBeenCalledWith('user_id', 'u1');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/photo'));
  });

  it('tag chips: comma commits, X removes, backspace at empty removes last', async () => {
    upsertProfile.mockResolvedValue(undefined);
    advanceOnboarding.mockResolvedValue('photos');
    render(<BasicsStep userId="u1" initial={{ ...initial, first_name: 'Lee', bio: 'hi' }} />);
    const tagInput = screen.getByLabelText(/vibe tags/i);
    // Comma commits a chip
    await userEvent.type(tagInput, 'trails,');
    expect(screen.getByLabelText(/remove trails/i)).toBeInTheDocument();
    // Second comma commits a second chip
    await userEvent.type(tagInput, 'live music,');
    expect(screen.getByLabelText(/remove live music/i)).toBeInTheDocument();
    // X removes a chip
    await userEvent.click(screen.getByLabelText(/remove trails/i));
    expect(screen.queryByLabelText(/remove trails/i)).not.toBeInTheDocument();
    // Backspace at empty input removes the last remaining chip
    await userEvent.type(tagInput, '{Backspace}');
    expect(screen.queryByLabelText(/remove live music/i)).not.toBeInTheDocument();
    // Now add one tag and submit — it should reach upsertProfile with that tag
    await userEvent.type(tagInput, 'patio,');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith(
      fakeClient, 'u1', expect.objectContaining({ vibe_tags: ['patio'] }),
    ));
  });

  it('tag chips: in-flight (uncommitted) typing is committed on submit', async () => {
    upsertProfile.mockResolvedValue(undefined);
    advanceOnboarding.mockResolvedValue('photos');
    render(<BasicsStep userId="u1" initial={{ ...initial, first_name: 'Lee', bio: 'hi' }} />);
    // Type a tag but DON'T add the comma — the input value is still "coffee"
    await userEvent.type(screen.getByLabelText(/vibe tags/i), 'coffee');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith(
      fakeClient, 'u1', expect.objectContaining({ vibe_tags: ['coffee'] }),
    ));
  });

  it('retry: a failed save shows retry that re-saves and advances', async () => {
    upsertProfile.mockRejectedValueOnce(new Error('save failed'));
    render(<BasicsStep userId="u1" initial={{ ...initial, first_name: 'Lee' }} />);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    upsertProfile.mockResolvedValueOnce(undefined);
    advanceOnboarding.mockResolvedValueOnce('photos');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/photo'));
  });
});
