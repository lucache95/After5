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
// next/image renders nothing useful in jsdom (and `fill` warns); stub to a plain img.
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as Record<string, never>)} />,
}));

import { OfferDetail, type OfferDetailProps } from '../OfferDetail';
import { AccountGate, type GateReason } from '../AccountGate';

const base: OfferDetailProps = {
  offerId: 'off-1',
  instanceId: 'inst-1',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  status: 'active',
  host: { first_name: 'Sam', age: 29, city: 'Portland', photo_url: null },
  date: { startsAt: new Date('2026-06-01T19:00:00Z').toISOString() },
  stops: [
    {
      name: 'rooftop bar', type: 'bar', start_time: null, duration_min: null,
      cost_pp: 22, what_to_do: null, neighborhood: 'downtown', local_insight: null,
      photo_url: null, lat: null, lng: null, drive_to_next_min: null,
    },
  ],
  vibeTags: ['chill'],
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
