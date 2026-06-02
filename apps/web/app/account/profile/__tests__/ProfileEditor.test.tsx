// apps/web/app/account/profile/__tests__/ProfileEditor.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// PhotoCropper is irrelevant to these field-save tests; stub it.
vi.mock('@/app/onboarding/steps/PhotoCropper', () => ({ PhotoCropper: () => null }));

// next/image → plain img in jsdom (PhotoManager tiles).
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as Record<string, never>)} />,
}));

// framer-motion Reorder → plain list (PhotoManager).
vi.mock('framer-motion', () => ({
  Reorder: {
    Group: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
    Item: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
  },
  useReducedMotion: () => false,
}));

const upsertProfile = vi.fn();
const insertPrivate = vi.fn().mockResolvedValue({ error: null });
const updateEq = vi.fn().mockResolvedValue({ error: null });
const updatePrivate = vi.fn(() => ({ eq: updateEq }));
const fakeClient = {
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
  from: vi.fn(() => ({ insert: insertPrivate, update: updatePrivate })),
  storage: { from: vi.fn() },
  functions: { invoke: vi.fn() },
};
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => fakeClient,
  upsertProfile: (...a: unknown[]) => upsertProfile(...a),
}));

import { ProfileEditor, type ProfileEditorInitial } from '../ProfileEditor';

const initial: ProfileEditorInitial = {
  first_name: 'Lee',
  neighborhood: 'glenmore',
  bio: 'coffee and trails.',
  instagram_handle: 'lee.codes',
  vibe_tags: ['trails', 'live music'],
  photo_url: null,
  photos: [],
  prompt_answers: [],
  expanded: {},
  available_prompts: [
    { id: 'two_truths', label: 'two truths and a lie', placeholder: 'make me guess…' },
    { id: 'green_flag', label: 'green flag energy', placeholder: 'what wins me over…' },
  ],
};

beforeEach(() => {
  push.mockReset(); refresh.mockReset(); upsertProfile.mockReset().mockResolvedValue(undefined);
  insertPrivate.mockClear().mockResolvedValue({ error: null });
  updateEq.mockClear().mockResolvedValue({ error: null });
  updatePrivate.mockClear();
});

describe('ProfileEditor', () => {
  it('renders the current values (bio, instagram, vibe tags)', () => {
    render(<ProfileEditor userId="u1" initial={initial} />);
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Lee');
    expect(screen.getByLabelText(/bio/i)).toHaveValue('coffee and trails.');
    expect(screen.getByLabelText(/instagram/i)).toHaveValue('lee.codes');
    expect(screen.getByLabelText(/remove trails/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/remove live music/i)).toBeInTheDocument();
  });

  it('saves bio + vibes to profiles/profiles_private and instagram_handle to private', async () => {
    // Row exists → insert 23505 → update fallback carries instagram_handle.
    insertPrivate.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
    render(<ProfileEditor userId="u1" initial={initial} />);

    const bio = screen.getByLabelText(/bio/i);
    await userEvent.clear(bio);
    await userEvent.type(bio, 'new bio');

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // profiles columns: own row, first_name + vibe_tags.
    await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith(
      fakeClient, 'u1', expect.objectContaining({ first_name: 'Lee', vibe_tags: ['trails', 'live music'] }),
    ));
    // profiles_private update fallback writes bio + instagram_handle, scoped to own row.
    await waitFor(() => expect(updatePrivate).toHaveBeenCalledWith(
      expect.objectContaining({ bio: 'new bio', instagram_handle: 'lee.codes' }),
    ));
    expect(updateEq).toHaveBeenCalledWith('user_id', 'u1');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('normalizes a pasted instagram url/@ into a bare handle', async () => {
    insertPrivate.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
    render(<ProfileEditor userId="u1" initial={initial} />);
    const ig = screen.getByLabelText(/instagram/i);
    await userEvent.clear(ig);
    await userEvent.type(ig, 'https://instagram.com/@some.one/');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(updatePrivate).toHaveBeenCalledWith(
      expect.objectContaining({ instagram_handle: 'some.one' }),
    ));
  });

  it('renders the four labelled sections', () => {
    render(<ProfileEditor userId="u1" initial={initial} />);
    expect(screen.getByRole('heading', { name: /photos/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /the basics/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /prompts/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /more about you/i })).toBeInTheDocument();
  });

  it('saves prompt_answers + expanded fields (pronouns) to profiles', async () => {
    const withData: ProfileEditorInitial = {
      ...initial,
      prompt_answers: [{ prompt_id: 'two_truths', answer: 'a lie' }],
      expanded: { pronouns: 'she/her', occupation: 'barista' },
    };
    render(<ProfileEditor userId="u1" initial={withData} />);
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith(
      fakeClient,
      'u1',
      expect.objectContaining({
        prompt_answers: [{ prompt_id: 'two_truths', answer: 'a lie' }],
        pronouns: 'she/her',
        occupation: 'barista',
      }),
    ));
  });

  it('RLS-safe: every write is scoped to the signed-in user (own row only)', async () => {
    // Fresh row path: insert carries user_id = u1.
    render(<ProfileEditor userId="u1" initial={initial} />);
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(insertPrivate).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1' }),
    ));
    // profiles write is scoped via upsertProfile(client, userId, ...) which
    // filters .eq('id', userId) internally.
    expect(upsertProfile.mock.calls[0]?.[1]).toBe('u1');
  });
});
