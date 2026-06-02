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

  it('renders a gradient fallback (no img) when there are no photos', () => {
    render(<ProfileCard name="Sam" age={null} place={null} photos={[]} vibe_tags={[]} prompts={[]} />);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: /^sam$/i })).toBeInTheDocument();
  });

  it('does not leak PII unless explicitly passed', () => {
    render(<ProfileCard name="Lee" age={30} place="x" photos={[]} vibe_tags={[]} prompts={[]} />);
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });
});
