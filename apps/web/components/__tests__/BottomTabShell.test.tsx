import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Drive isActive() by mocking usePathname. Each test sets the next return value.
const usePathname = vi.fn<[], string>();
vi.mock('next/navigation', () => ({
  usePathname: () => usePathname(),
}));

// The inbox badge self-seeds via fetch/realtime; stub it so the nav renders in
// jsdom without network or subscription side effects.
vi.mock('../InboxTabBadge', () => ({
  InboxTabBadge: () => null,
}));

import { BottomTabShell } from '../BottomTabShell';

function hrefOf(name: string): string | null {
  return screen.getByRole('link', { name }).getAttribute('href');
}

beforeEach(() => {
  usePathname.mockReset();
  usePathname.mockReturnValue('/feed');
});

describe('BottomTabShell — tab href map (REQ-E2)', () => {
  it('points the dates tab at /matches (D-04, not /my-nights)', () => {
    render(<BottomTabShell userId="u1" />);
    expect(hrefOf('dates')).toBe('/matches');
  });

  it('points the profile tab at /account (D-05, not /home)', () => {
    render(<BottomTabShell userId="u1" />);
    expect(hrefOf('profile')).toBe('/account');
  });

  it('keeps discover -> /feed, inbox -> /inbox, create -> /create', () => {
    render(<BottomTabShell userId="u1" />);
    expect(hrefOf('discover')).toBe('/feed');
    expect(hrefOf('inbox')).toBe('/inbox');
    expect(hrefOf('create')).toBe('/create');
  });

  it('renders no link pointing at the marketing teaser /home', () => {
    render(<BottomTabShell userId="u1" />);
    const homeLinks = screen
      .getAllByRole('link')
      .filter((el) => el.getAttribute('href') === '/home');
    expect(homeLinks).toHaveLength(0);
  });
});

describe('BottomTabShell — active-state regression (deep sub-routes)', () => {
  it('lights the dates tab on a /matches/[lockId] sub-route', () => {
    usePathname.mockReturnValue('/matches/abc');
    render(<BottomTabShell userId="u1" />);
    expect(screen.getByRole('link', { name: 'dates' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'profile' })).not.toHaveAttribute('aria-current');
  });

  it('lights the profile tab on /account', () => {
    usePathname.mockReturnValue('/account');
    render(<BottomTabShell userId="u1" />);
    expect(screen.getByRole('link', { name: 'profile' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'dates' })).not.toHaveAttribute('aria-current');
  });

  it('lights the profile tab on an /account/* sub-route', () => {
    usePathname.mockReturnValue('/account/preferences');
    render(<BottomTabShell userId="u1" />);
    expect(screen.getByRole('link', { name: 'profile' })).toHaveAttribute('aria-current', 'page');
  });
});
