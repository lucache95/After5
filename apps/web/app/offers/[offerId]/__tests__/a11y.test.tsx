// apps/web/app/offers/[offerId]/__tests__/a11y.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';

vi.mock('@/lib/after5/match', () => ({
  acceptOffer: vi.fn(), passOffer: vi.fn(), withdraw: vi.fn(),
  MatchError: class extends Error { code: string; constructor(c: string) { super(c); this.code = c; } },
  messageForCode: (c: string) => c,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { OfferDetail, type OfferDetailProps } from '../OfferDetail';
import { AccountGate, type GateReason } from '../AccountGate';

const base: OfferDetailProps = {
  offerId: 'off-1',
  instanceId: 'inst-1',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  status: 'active',
  host: { first_name: 'Sam', age: 29, city: 'Portland', photo_url: null, bio: 'likes long walks.' },
  date: { startsAt: new Date('2026-06-01T19:00:00Z').toISOString() },
};

describe('offer surfaces a11y', () => {
  it('OfferDetail happy path has no violations', async () => {
    const { container } = render(<OfferDetail {...base} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('OfferDetail expired path has no violations', async () => {
    const { container } = render(<OfferDetail {...base} expiresAt={new Date(Date.now() - 10_000).toISOString()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each<GateReason>(['verify', 'cooldown', 'suspended', 'dating_disabled', 'blocked', 'generic'])(
    'AccountGate %s has no violations',
    async (reason) => {
      const { container } = render(<AccountGate reason={reason} />);
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
