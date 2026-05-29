// Lock-fired celebration (spec §4.4). Shown once when this viewer's lock just
// fired (justLocked from ?just=1, or a Realtime locks INSERT). Decorative
// particles are framer-motion only (no canvas-confetti dep) and fully gated
// behind useReducedMotion; the match announcement is a role=status live region
// so screen readers hear it regardless of motion preference.
'use client';
import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/cn';

const PARTICLES = Array.from({ length: 14 }, (_, i) => i);

export function MatchConfirmation({ name, show }: { name: string; show: boolean }) {
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(show);

  useEffect(() => { setVisible(show); }, [show]);
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), 3200);
    return () => clearTimeout(t);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      <div className="pointer-events-auto mx-4 max-w-[360px] rounded-3xl bg-shell-base px-8 py-10 text-center shadow-[0_24px_56px_-14px_rgba(80,40,20,0.4)]">
        <p role="status" className="font-heading text-4xl lowercase leading-tight text-shell-ink">
          you matched with {name}
        </p>
        <p className="mt-3 font-body text-shell-ink/70">it&apos;s locked in. see the details below.</p>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="mt-6 rounded-full bg-shell-accent px-6 py-2.5 font-body font-semibold lowercase text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        >
          let&apos;s go
        </button>
      </div>
      {!reduce && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {PARTICLES.map((i) => (
            <motion.span
              key={i}
              className={cn('absolute top-1/2 left-1/2 block h-2 w-2 rounded-full', i % 2 ? 'bg-shell-accent' : 'bg-shell-pink')}
              initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              animate={{
                opacity: 0,
                x: Math.cos((i / PARTICLES.length) * Math.PI * 2) * 180,
                y: Math.sin((i / PARTICLES.length) * Math.PI * 2) * 180,
                scale: 0.4,
              }}
              transition={{ duration: 1.1, ease: 'easeOut' }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
