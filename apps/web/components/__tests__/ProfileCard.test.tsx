import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as Record<string, never>)} />,
}));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));

import { ProfileCard } from '../ProfileCard';

describe('ProfileCard', () => {
  it('renders name+age heading, multiple photos, prompts and vibe chips', () => {
    render(
      <ProfileCard
        name="Maya"
        age={29}
        place="glenmore"
        pronouns="she/her"
        photos={['https://x/1', 'https://x/2']}
        vibe_tags={['trails', 'live music']}
        prompts={[{ label: 'green flag energy', answer: 'remembers your coffee order' }]}
      />,
    );
    expect(screen.getByRole('heading', { name: /maya, 29/i })).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText(/green flag energy/i)).toBeInTheDocument();
    expect(screen.getByText(/remembers your coffee order/i)).toBeInTheDocument();
    expect(screen.getByText('trails')).toBeInTheDocument();
    expect(screen.getByText('live music')).toBeInTheDocument();
  });

  it('renders a scroll-snap photo carousel that opts out of vaul drag', () => {
    render(
      <ProfileCard
        name="Maya"
        age={29}
        place="glenmore"
        photos={['https://x/1', 'https://x/2']}
        vibe_tags={[]}
        prompts={[]}
      />,
    );
    // jsdom can't exercise scroll-snap, but the container's structure must hold:
    // horizontal scroll + snap classes, and data-vaul-no-drag so swipes inside a
    // vaul sheet pan the strip instead of dragging the drawer.
    const strip = screen.getByRole('group', { name: /maya's photos/i });
    expect(strip).toHaveAttribute('data-vaul-no-drag');
    expect(strip.className).toContain('overflow-x-auto');
    expect(strip.className).toContain('snap-x');
    expect(strip.className).toContain('snap-mandatory');
    expect(strip.querySelectorAll('.snap-center')).toHaveLength(2);
  });

  it('renders a gradient fallback (no img) when there are no photos', () => {
    render(<ProfileCard name="Sam" age={null} place={null} photos={[]} vibe_tags={[]} prompts={[]} />);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: /^sam$/i })).toBeInTheDocument();
  });

  it('does not leak PII unless explicitly passed', () => {
    render(<ProfileCard name="Lee" age={30} place="x" photos={[]} vibe_tags={[]} prompts={[]} />);
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it('renders the "new here" reliability pill (no number) for a verified new member', () => {
    render(
      <ProfileCard
        name="Nova"
        age={27}
        place="x"
        photos={[]}
        vibe_tags={[]}
        prompts={[]}
        verification="verified"
        reliability_score={null}
      />,
    );
    expect(screen.getByText('new here')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    // aria-label spells out the new-member state
    expect(screen.getByLabelText(/new member, no rated dates yet/i)).toBeInTheDocument();
  });

  it('renders "{score}% · reliable" with an aria-label for an established member', () => {
    render(
      <ProfileCard
        name="Reed"
        age={31}
        place="x"
        photos={[]}
        vibe_tags={[]}
        prompts={[]}
        verification="verified"
        reliability_score={94}
      />,
    );
    expect(screen.getByText(/94% · reliable/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/reliability: 94 percent, established/i)).toBeInTheDocument();
  });

  it('carries an aria-label on the pill in both states', () => {
    const { rerender } = render(
      <ProfileCard name="A" age={20} place="x" photos={[]} vibe_tags={[]} prompts={[]} verification="verified" reliability_score={null} />,
    );
    expect(screen.getByLabelText(/new member/i)).toBeInTheDocument();
    rerender(
      <ProfileCard name="A" age={20} place="x" photos={[]} vibe_tags={[]} prompts={[]} verification="verified" reliability_score={88} />,
    );
    expect(screen.getByLabelText(/reliability: 88 percent, established/i)).toBeInTheDocument();
  });
});
