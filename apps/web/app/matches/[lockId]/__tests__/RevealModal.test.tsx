import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// vaul renders into a portal; stub to a passthrough so content is queryable in jsdom.
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Drawer: Object.assign(Pass, { Root: Pass, Trigger: Pass, Portal: Pass, Overlay: Pass, Content: Pass, Title: Pass, Description: Pass, Close: Pass }) };
});
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as Record<string, never>)} />,
}));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));

import { RevealModal } from '../RevealModal';
import type { PartyProfile } from '../../lock-view';

const person: PartyProfile = {
  id: 'p1', first_name: 'jamie', age: 28, city: 'portland', neighborhood: 'alberta',
  clear_photo_url: null, vibe_tags: ['hiking', 'jazz'],
};

describe('RevealModal', () => {
  it('renders first_name, age, place and each vibe tag', () => {
    render(<RevealModal open onOpenChange={vi.fn()} person={person} photos={[]} prompts={[]} />);
    expect(screen.getByText('jamie, 28')).toBeInTheDocument();
    expect(screen.getByText('alberta')).toBeInTheDocument();
    expect(screen.getByText('hiking')).toBeInTheDocument();
    expect(screen.getByText('jazz')).toBeInTheDocument();
  });

  it('renders the signed photo carousel and prompt answers', () => {
    render(
      <RevealModal
        open
        onOpenChange={vi.fn()}
        person={person}
        photos={['https://x/1', 'https://x/2']}
        prompts={[{ label: 'green flag energy', answer: 'good texter' }]}
      />,
    );
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText(/green flag energy/i)).toBeInTheDocument();
    expect(screen.getByText(/good texter/i)).toBeInTheDocument();
  });

  it('renders no bio text', () => {
    const { container } = render(
      <RevealModal open onOpenChange={vi.fn()} person={{ ...person, vibe_tags: [] }} photos={[]} prompts={[]} />,
    );
    expect(container.textContent).not.toMatch(/bio/i);
  });
});
