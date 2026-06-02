import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

const postNight = vi.fn().mockResolvedValue('inst-1');
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  postNight: (...a: unknown[]) => postNight(...a),
  ambientSoundUrl: (p: string | null) => (p ? `https://x/${p}` : null),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('framer-motion', () => ({
  motion: {
    // Strip framer-motion-only props so React doesn't warn about unknown DOM attrs
    button: ({
      children,
      initial: _i,
      animate: _a,
      transition: _t,
      whileTap: _wt,
      ...props
    }: React.HTMLAttributes<HTMLButtonElement> & {
      children?: React.ReactNode;
      initial?: unknown;
      animate?: unknown;
      transition?: unknown;
      whileTap?: unknown;
    }) => (
      <button {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}>{children}</button>
    ),
  },
  useReducedMotion: () => false,
}));

import { PostNightForm } from '../PostNightForm';

const plan = (id: string) => ({
  id,
  title: `Plan ${id}`,
  cover_image_url: null,
  vibe_tags: ['jazz', 'chill'],
});

const sounds = [
  { id: 'amb-1', name: 'cozy fireplace', storage_path: 'cozy/x.m4a', vibe_tags: ['cozy'], duration_sec: 20 },
  { id: 'amb-2', name: 'jazz lounge', storage_path: 'classy/y.m4a', vibe_tags: ['classy'], duration_sec: 20 },
];

// future datetime-local string (tomorrow)
function futureLocal(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

beforeEach(() => {
  postNight.mockClear();
  mockPush.mockClear();
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
});

describe('PostNightForm', () => {
  it('empty-state: shows dry copy and link to /plan when no plans', () => {
    render(<PostNightForm plans={[]} />);
    expect(screen.getByText(/no plans yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /build a plan/i })).toHaveAttribute('href', '/plan');
  });

  it('submit button is disabled until a plan and future time are chosen', () => {
    render(<PostNightForm plans={[plan('a')]} />);
    expect(screen.getByRole('button', { name: /post it/i })).toBeDisabled();
  });

  it('plan cards are rendered with aria-checked=false initially', () => {
    render(<PostNightForm plans={[plan('a'), plan('b')]} />);
    const cards = screen.getAllByRole('radio');
    expect(cards).toHaveLength(2);
    cards.forEach((card) => expect(card).toHaveAttribute('aria-checked', 'false'));
  });

  it('selecting a plan marks it aria-checked=true', async () => {
    render(<PostNightForm plans={[plan('a')]} />);
    const card = screen.getByRole('radio', { name: /plan a/i });
    await userEvent.click(card);
    expect(card).toHaveAttribute('aria-checked', 'true');
  });
});

describe('PostNightForm ambient picker', () => {
  function ambientGroup() {
    return screen.getByRole('radiogroup', { name: /pick a soundtrack/i });
  }

  it('defaults to no preference and posts without an ambient id', async () => {
    render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} />);
    const none = within(ambientGroup()).getByRole('radio', { name: /no preference/i });
    expect(none).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('radio', { name: /plan a/i }));
    await userEvent.type(screen.getByLabelText(/when's the night/i), futureLocal());
    await userEvent.click(screen.getByRole('button', { name: /post it/i }));

    expect(postNight).toHaveBeenCalledTimes(1);
    expect(postNight.mock.calls[0]![1]).toMatchObject({ ambient_sound_id: null });
  });

  it('posts the chosen ambient_sound_id', async () => {
    render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} />);
    await userEvent.click(within(ambientGroup()).getByRole('radio', { name: /cozy fireplace/i }));
    await userEvent.click(screen.getByRole('radio', { name: /plan a/i }));
    await userEvent.type(screen.getByLabelText(/when's the night/i), futureLocal());
    await userEvent.click(screen.getByRole('button', { name: /post it/i }));

    expect(postNight).toHaveBeenCalledTimes(1);
    expect(postNight.mock.calls[0]![1]).toMatchObject({ ambient_sound_id: 'amb-1' });
  });

  it('preview plays one at a time', async () => {
    render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} />);
    await userEvent.click(screen.getByRole('button', { name: /preview cozy fireplace/i }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    // playing a second pauses the first before starting the new one
    await userEvent.click(screen.getByRole('button', { name: /preview jazz lounge/i }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it('has no a11y violations with the soundtrack picker', async () => {
    const { container } = render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
