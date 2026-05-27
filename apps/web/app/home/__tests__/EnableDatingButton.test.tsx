import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({}) }));

import { EnableDatingButton } from '../EnableDatingButton';

describe('EnableDatingButton', () => {
  it('default (no gate prop) renders the Turn dating on button', () => {
    render(<EnableDatingButton />);
    expect(screen.getByRole('button', { name: /turn dating on/i })).toBeInTheDocument();
  });

  it('gate blocked: renders friendly message and no button', () => {
    render(<EnableDatingButton gate={{ ok: false, reason: 'birthdate_missing' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/date of birth/i);
    expect(screen.queryByRole('button', { name: /turn dating on/i })).not.toBeInTheDocument();
  });
});
