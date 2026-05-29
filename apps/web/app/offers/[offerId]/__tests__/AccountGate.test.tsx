// apps/web/app/offers/[offerId]/__tests__/AccountGate.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountGate, deriveGateReason } from '../AccountGate';

const good = { dating_enabled: true, verification: 'verified', standing: 'good', account_state: 'active' };

describe('deriveGateReason', () => {
  it('returns null when everything is in good standing', () => {
    expect(deriveGateReason(good)).toBeNull();
  });
  it('dating_disabled when dating is switched off (highest priority)', () => {
    expect(deriveGateReason({ ...good, dating_enabled: false, verification: 'pending' })).toBe('dating_disabled');
  });
  it('verify when verification is pending', () => {
    expect(deriveGateReason({ ...good, verification: 'pending' })).toBe('verify');
  });
  it('verify beats standing', () => {
    expect(deriveGateReason({ ...good, verification: 'pending', standing: 'cooldown' })).toBe('verify');
  });
  it('cooldown standing', () => {
    expect(deriveGateReason({ ...good, standing: 'cooldown' })).toBe('cooldown');
  });
  it('suspended standing', () => {
    expect(deriveGateReason({ ...good, standing: 'suspended' })).toBe('suspended');
  });
  it('locked_ban maps to suspended', () => {
    expect(deriveGateReason({ ...good, standing: 'locked_ban' })).toBe('suspended');
  });
  it('paused account_state maps to suspended', () => {
    expect(deriveGateReason({ ...good, account_state: 'paused' })).toBe('suspended');
  });
});

describe('AccountGate', () => {
  it('verify reason → verify-first headline + onboarding link', () => {
    render(<AccountGate reason="verify" />);
    expect(screen.getByRole('heading')).toHaveTextContent(/verify first/i);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/onboarding');
  });
  it('cooldown reason → short break + settings/account', () => {
    render(<AccountGate reason="cooldown" />);
    expect(screen.getByRole('heading')).toHaveTextContent(/short break/i);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/settings/account');
  });
  it('suspended reason → on hold headline', () => {
    render(<AccountGate reason="suspended" />);
    expect(screen.getByRole('heading')).toHaveTextContent(/on hold/i);
  });
  it('dating_disabled reason → switched off + settings/dating', () => {
    render(<AccountGate reason="dating_disabled" />);
    expect(screen.getByRole('heading')).toHaveTextContent(/switched off/i);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/settings/dating');
  });
  it('blocked reason → feed link', () => {
    render(<AccountGate reason="blocked" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/feed');
  });
  it('generic reason → feed link', () => {
    render(<AccountGate reason="generic" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/feed');
  });
});
