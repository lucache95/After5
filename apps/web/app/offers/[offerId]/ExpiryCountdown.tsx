// apps/web/app/offers/[offerId]/ExpiryCountdown.tsx
// Text-only countdown to an offer's expires_at. Ticks once a second on the
// client; on the first expired transition (or on mount if already past) it
// fires onExpire once and switches to a polite static line. A zombie offer
// (expires_at more than an hour in the past, spec §4.2) reads as expired
// immediately so a stale row never shows a live timer.
'use client';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

const ZOMBIE_MS = 3_600_000;

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h >= 1) return `${h}h ${m}m`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function ExpiryCountdown({
  expiresAt,
  onExpire,
}: {
  expiresAt: string;
  onExpire?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const deadline = Date.parse(expiresAt);
  const remaining = deadline - now;
  const expired = remaining <= 0 || deadline < now - ZOMBIE_MS;

  useEffect(() => {
    if (expired && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [expired, onExpire]);

  // suppressHydrationWarning: `now` is seeded from Date.now(), so the SSR render
  // (server clock) and the first client render (browser clock) produce different
  // countdown text — an intentional live-clock difference, not a real mismatch.
  // Without this the divergent text trips React hydration error #418 on load.
  if (expired) {
    return (
      <p
        suppressHydrationWarning
        role="timer"
        aria-live="polite"
        className="font-body text-sm text-shell-ink/60"
      >
        this offer expired.
      </p>
    );
  }

  return (
    <p
      suppressHydrationWarning
      role="timer"
      aria-live="off"
      className={cn('font-body text-sm text-shell-ink')}
    >
      {format(remaining)} left to decide
    </p>
  );
}
