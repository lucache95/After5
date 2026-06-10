import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// RegisterDeviceOnLoad has side effects; stub it to a no-op marker.
vi.mock('../RegisterDeviceOnLoad', () => ({ RegisterDeviceOnLoad: () => <div data-testid="register-device" /> }));
vi.mock('../EnableDatingButton', () => ({ EnableDatingButton: () => <button>Turn dating on</button> }));

// HomeStateBanner calls useRouter for the pending state's Look around button.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { HomeStateBanner } from '../HomeStateBanner';

describe('HomeStateBanner (state → render + single primary action)', () => {
  it('pending: non-blocking banner with look-around action', () => {
    render(<HomeStateBanner state="pending" />);
    expect(screen.getByText(/checking your id/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /look around/i })).toBeInTheDocument();
  });
  it('failed: routes to retry/appeal', () => {
    render(<HomeStateBanner state="failed" />);
    expect(screen.getByRole('link', { name: /finish verifying|retry|verify/i })).toBeInTheDocument();
  });
  it('dating_off: re-offers turn dating on', () => {
    render(<HomeStateBanner state="dating_off" />);
    expect(screen.getByRole('button', { name: /turn dating on/i })).toBeInTheDocument();
  });
  it('verified: no blocking banner (primary state)', () => {
    const { container } = render(<HomeStateBanner state="verified" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('HomeStateBanner — blocked dating gate (branded notice, not an error dump)', () => {
  it('dating_off + blocked gate renders the calm notice card with one support action', () => {
    render(<HomeStateBanner state="dating_off" gate={{ ok: false, reason: 'birthdate_missing' }} />);
    expect(screen.getByText(/one thing before dating turns on/i)).toBeInTheDocument();
    expect(screen.getByText(/date of birth/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /email us/i })).toHaveAttribute('href', 'mailto:hello@tryafter5.app');
    // No raw "turn dating on" affordance while the gate is blocked.
    expect(screen.queryByRole('button', { name: /turn dating on/i })).not.toBeInTheDocument();
  });

  it('not_verified gate: in-progress copy + verify link, never a failure claim', () => {
    render(<HomeStateBanner state="dating_off" gate={{ ok: false, reason: 'not_verified' }} />);
    expect(screen.getByText(/one last check before dating turns on/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /finish verifying/i })).toHaveAttribute('href', '/onboarding/verify');
    expect(screen.queryByRole('link', { name: /email us/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't|failed|blocked/i)).not.toBeInTheDocument();
  });

  it('verified state never shows the gate card, even with a blocked gate object', () => {
    const { container } = render(<HomeStateBanner state="verified" gate={{ ok: false, reason: 'birthdate_missing' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('dating_off with an ok gate keeps the normal flip-dating-on banner', () => {
    render(<HomeStateBanner state="dating_off" gate={{ ok: true }} />);
    expect(screen.getByRole('button', { name: /turn dating on/i })).toBeInTheDocument();
    expect(screen.queryByText(/one thing before dating turns on/i)).not.toBeInTheDocument();
  });
});
