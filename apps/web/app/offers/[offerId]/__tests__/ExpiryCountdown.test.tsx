// apps/web/app/offers/[offerId]/__tests__/ExpiryCountdown.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ExpiryCountdown } from '../ExpiryCountdown';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-29T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ExpiryCountdown', () => {
  it('renders a time string and updates on tick', () => {
    const expiresAt = new Date(Date.now() + 90_000).toISOString();
    render(<ExpiryCountdown expiresAt={expiresAt} />);
    const before = screen.getByRole('timer').textContent;
    act(() => { vi.advanceTimersByTime(1000); });
    const after = screen.getByRole('timer').textContent;
    expect(after).not.toBe(before);
  });

  it('renders expired and fires onExpire exactly once after the deadline passes', () => {
    const onExpire = vi.fn();
    const expiresAt = new Date(Date.now() + 1000).toISOString();
    render(<ExpiryCountdown expiresAt={expiresAt} onExpire={onExpire} />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText(/expired|slipped away/i)).toBeInTheDocument();
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('treats a long-past zombie offer as expired immediately on mount', () => {
    const onExpire = vi.fn();
    const expiresAt = new Date(Date.now() - 2 * 3600_000).toISOString();
    render(<ExpiryCountdown expiresAt={expiresAt} onExpire={onExpire} />);
    expect(screen.getByText(/expired|slipped away/i)).toBeInTheDocument();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('does not fire onExpire after unmount (no leaked interval)', () => {
    const onExpire = vi.fn();
    const expiresAt = new Date(Date.now() + 5000).toISOString();
    const { unmount } = render(<ExpiryCountdown expiresAt={expiresAt} onExpire={onExpire} />);
    unmount();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(onExpire).not.toHaveBeenCalled();
  });
});
