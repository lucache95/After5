// apps/web/app/dates/[instanceId]/interested/__tests__/a11y.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';

vi.mock('@/lib/after5/realtime', () => ({ subscribeQueueInserts: () => () => {} }));
vi.mock('@/lib/after5/match', () => ({ shortlist: vi.fn(), makeOffer: vi.fn(), MatchError: class {}, messageForCode: () => '' }));
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
  return { ...actual, Reorder: { Group: ({ children }: { children?: React.ReactNode }) => <ul>{children}</ul>, Item: ({ children }: { children?: React.ReactNode }) => <li>{children}</li> } };
});
vi.mock('../MakeOfferModal', () => ({ MakeOfferModal: () => null }));

import { InterestedList } from '../InterestedList';
import { CancelWithReasonPicker } from '../CancelWithReasonPicker';

const cand = (id: string, status: string, rank: number | null) => ({ candidate_id: id, status, rank, first_name: `N${id}`, age: 26, city: 'portland', photo_url: null, can_enter_lock_flow: true });

describe('host surfaces a11y', () => {
  it('InterestedList has no axe violations', async () => {
    const { container } = render(<InterestedList instanceId="i" userId="u" offerWindowHours={24} activeOffer={null} candidates={[cand('a', 'shortlisted', 1), cand('b', 'interested', null)]} />);
    expect(await axe(container)).toHaveNoViolations();
  });
  it('CancelWithReasonPicker has no axe violations', async () => {
    const { container } = render(<CancelWithReasonPicker onConfirm={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
