import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';

vi.mock('@/lib/after5/match', () => ({
  cancelLock: vi.fn(), submitRating: vi.fn(),
  MatchError: class extends Error { code: string; constructor(c: string) { super(c); this.code = c; } },
  messageForCode: (c: string) => c,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Drawer: Object.assign(Pass, { Root: Pass, Trigger: Pass, Portal: Pass, Overlay: Pass, Content: Pass, Title: Pass, Description: Pass, Close: Pass }) };
});
const useReducedMotion = vi.fn(() => true);
vi.mock('framer-motion', () => ({
  useReducedMotion: () => useReducedMotion(),
  motion: { span: (props: Record<string, unknown>) => <span {...props} /> },
}));

import { MatchesList, type MatchCard } from '../../MatchesList';
import { LockDetail } from '../LockDetail';
import { RevealModal } from '../RevealModal';
import { MatchConfirmation } from '../MatchConfirmation';
import { RatingForm } from '../rate/RatingForm';
import type { PartyProfile } from '../../lock-view';

const person: PartyProfile = {
  id: 'p1', first_name: 'jamie', age: 28, city: 'portland', neighborhood: 'alberta',
  clear_photo_url: null, vibe_tags: ['hiking', 'jazz'],
};
const card: MatchCard = { id: 'lock-1', status: 'active', counterpart: person, startsAt: '2026-06-01T19:00:00Z' };

describe('matches surfaces a11y', () => {
  it('MatchesList has no violations', async () => {
    const { container } = render(<MatchesList active={[card]} past={[{ ...card, id: 'l2', status: 'completed' }]} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('MatchesList empty state has no violations', async () => {
    const { container } = render(<MatchesList active={[]} past={[]} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('LockDetail has no violations', async () => {
    const { container } = render(
      <LockDetail lockId="lock-1" status="active" counterpart={person} threadId="thread-1" startsAt={card.startsAt} ratingOpen justLocked={false} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('RevealModal (open) has no violations', async () => {
    const { container } = render(<RevealModal open onOpenChange={vi.fn()} person={person} photos={[]} prompts={[]} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('MatchConfirmation (reduced motion) has no violations', async () => {
    useReducedMotion.mockReturnValue(true);
    const { container } = render(<MatchConfirmation name="jamie" show />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('MatchConfirmation (motion allowed) has no violations', async () => {
    useReducedMotion.mockReturnValue(false);
    const { container } = render(<MatchConfirmation name="jamie" show />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('RatingForm has no violations', async () => {
    const { container } = render(<RatingForm lockId="lock-1" rateeId="them" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
