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
