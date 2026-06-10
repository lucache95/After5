import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock next/navigation pathname
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

// Mock supabase client — getUser resolves based on per-test setup
const getUser = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser },
  }),
}));

// Suppress the /api/stats fetch in tests
global.fetch = vi.fn().mockResolvedValue({ ok: false });

import { EarlyAccessBanner } from '../EarlyAccessBanner';

beforeEach(() => {
  getUser.mockReset();
  // Reset sessionStorage between tests
  sessionStorage.clear();
});

describe('EarlyAccessBanner — anon user', () => {
  it('renders the banner for an unauthenticated visitor', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    render(<EarlyAccessBanner />);
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: /early access/i })).toBeInTheDocument(),
    );
  });

  it('shows lowercase copy', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    render(<EarlyAccessBanner />);
    await waitFor(() =>
      expect(screen.getByText(/forever free for the first 100 members/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/claim your spot/i)).toBeInTheDocument();
  });
});

describe('EarlyAccessBanner — authed user', () => {
  it('renders nothing for a signed-in user', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    render(<EarlyAccessBanner />);
    // Wait a tick for the async getUser to resolve
    await waitFor(() => expect(getUser).toHaveBeenCalled());
    expect(screen.queryByRole('complementary', { name: /early access/i })).not.toBeInTheDocument();
  });
});
