import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// Mock the supabase browser client so UserMenu resolves a signed-in session.
const getUser = vi.fn();
const maybeSingle = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  }),
}));

import { UserMenu } from '../UserMenu';

beforeEach(() => {
  getUser.mockReset();
  maybeSingle.mockReset();
});

describe('UserMenu — signed out', () => {
  it('renders a lowercase "sign in" link to /login', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    render(<UserMenu />);
    const link = await screen.findByRole('link', { name: 'sign in' });
    expect(link).toHaveAttribute('href', '/login');
  });
});

describe('UserMenu — signed in (dating IA)', () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'jamie@example.com' } } });
    maybeSingle.mockResolvedValue({ data: { first_name: 'Jamie' } });
  });

  async function openMenu() {
    render(<UserMenu />);
    const trigger = await screen.findByRole('button', { name: 'account menu' });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  }

  it('points dropdown items at the dating loop, not the planner', async () => {
    await openMenu();
    const dest = (name: string) =>
      screen.getByRole('menuitem', { name }).getAttribute('href');
    expect(dest('your profile')).toBe('/account');
    expect(dest('your nights')).toBe('/my-nights');
    expect(dest('matches')).toBe('/matches');
    expect(dest('messages')).toBe('/messages');
  });

  it('repoints "your profile" to the real hub /account, never the teaser /home (D-05)', async () => {
    await openMenu();
    const profile = screen.getByRole('menuitem', { name: 'your profile' });
    expect(profile).toHaveAttribute('href', '/account');
    const homeLinks = screen
      .getAllByRole('menuitem')
      .filter((el) => el.getAttribute('href') === '/home');
    expect(homeLinks).toHaveLength(0);
  });

  it('keeps a discreet planner wedge "plan a date" → /create/generate', async () => {
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'plan a date' })).toHaveAttribute('href', '/create/generate');
  });

  it('does NOT use the legacy planner IA ("My dates")', async () => {
    await openMenu();
    expect(screen.queryByText('My dates')).not.toBeInTheDocument();
  });

  it('exposes a sign-out form posting to /auth/signout', async () => {
    await openMenu();
    const signOut = screen.getByRole('menuitem', { name: 'sign out' });
    expect(signOut.closest('form')).toHaveAttribute('action', '/auth/signout');
  });

  it('shows the lowercased display name', async () => {
    await openMenu();
    expect(screen.getAllByText('jamie').length).toBeGreaterThanOrEqual(1);
  });
});
