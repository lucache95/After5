'use client';

// Live countdown to the Sept-8 2026 launch (see the Kelowna launch plan). Drives
// urgency on the waitlist hero. Mount-guarded so the server render and first
// client paint match (Date math differs per env → would hydration-mismatch).

import { useEffect, useState } from 'react';

// Sept 8, 2026, 00:00 Pacific.
const LAUNCH = new Date('2026-09-08T00:00:00-07:00');

function remaining() {
  const ms = LAUNCH.getTime() - Date.now();
  if (ms <= 0) return null;
  return {
    days: Math.floor(ms / 86_400_000),
    hrs: Math.floor((ms % 86_400_000) / 3_600_000),
    min: Math.floor((ms % 3_600_000) / 60_000),
    sec: Math.floor((ms % 60_000) / 1_000),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function CountdownToLaunch() {
  const [mounted, setMounted] = useState(false);
  const [t, setT] = useState<ReturnType<typeof remaining>>(null);

  useEffect(() => {
    setMounted(true);
    setT(remaining());
    const id = setInterval(() => setT(remaining()), 1000);
    return () => clearInterval(id);
  }, []);

  const cells: [string, number][] = mounted && t
    ? [['days', t.days], ['hrs', t.hrs], ['min', t.min], ['sec', t.sec]]
    : [['days', 0], ['hrs', 0], ['min', 0], ['sec', 0]];

  // Past launch.
  if (mounted && !t) {
    return (
      <p className="font-body text-sm font-semibold lowercase text-shell-accent">
        the wait&apos;s over — we&apos;re live in kelowna.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-2 text-center font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-shell-ink/50">
        kelowna launch · sept 8
      </p>
      <div className="flex items-stretch justify-center gap-2" aria-label="time until launch">
        {cells.map(([label, val]) => (
          <div key={label} className="flex min-w-[60px] flex-col items-center rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-shell-ink/5">
            <span className="font-heading text-[28px] leading-none text-shell-accent [font-variant-numeric:tabular-nums]">
              {mounted ? pad(val) : '--'}
            </span>
            <span className="mt-1 font-body text-[10px] lowercase tracking-wide text-shell-ink/55">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
