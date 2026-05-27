import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const postNight = vi.fn().mockResolvedValue(undefined);
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  postNight: (...a: unknown[]) => postNight(...a),
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

beforeEach(() => {
  postNight.mockClear();
  mockPush.mockClear();
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
