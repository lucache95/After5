import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RouteLoading } from '../RouteLoading';

vi.mock('next/navigation', () => ({ usePathname: () => '/inbox' }));

describe('RouteLoading', () => {
  it('renders the heartbeat loader without tabs by default', () => {
    render(<RouteLoading />);
    expect(screen.getByRole('progressbar', { name: 'loading' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /discover/i })).not.toBeInTheDocument();
  });

  it('renders the bottom tab bar when tabs is set', () => {
    render(<RouteLoading tabs />);
    expect(screen.getByRole('progressbar', { name: 'loading' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /discover/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /profile/i })).toBeInTheDocument();
  });
});
