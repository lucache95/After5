// apps/web/app/reciprocal/[pairId]/__tests__/a11y.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/after5/match', () => ({ resolveReciprocal: vi.fn(), MatchError: class {}, messageForCode: () => '' }));

import { ReciprocalChooser } from '../ReciprocalChooser';

const inst = (id: string, title: string) => ({ id, title, starts_at: new Date(Date.now() + 86400000).toISOString(), cover_image_url: null });

describe('reciprocal a11y', () => {
  it('ReciprocalChooser has no axe violations', async () => {
    const { container } = render(<ReciprocalChooser pairId="p" instanceA={inst('a', 'jazz bar')} instanceB={inst('b', 'pottery')} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
