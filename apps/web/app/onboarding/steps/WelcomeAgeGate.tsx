'use client';
// Step 1 (age_gate): intro + confirm 18+. Real DOB proof is the later ID scan;
// this is the entry gate. On confirm: advanceOnboarding('basics') then route forward.
// Restyled to the warm-filmic dating brand (DESIGN-SYSTEM): the polaroid couple shot
// sells the promise, pink is reserved for the CTA + checkbox accent.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/cn';
import { Polaroid } from '@/components/Polaroid';
import { browserAfter5Client, advanceOnboarding } from '@/lib/after5/client';

export function WelcomeAgeGate() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');

  const disabled = !confirmed || phase === 'submitting';

  async function handleContinue() {
    setPhase('submitting');
    try {
      await advanceOnboarding(browserAfter5Client(), 'basics');
      router.push('/onboarding/basics');
    } catch {
      setPhase('error');
    }
  }

  return (
    <div>
      {/* Hero polaroid cluster — the photo carries the promise (DESIGN-SYSTEM §5). */}
      <motion.div
        className="mb-7 flex items-end justify-center gap-3"
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={reduceMotion ? false : { opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
      >
        <Polaroid
          tone="dating"
          src="/gallery/dinner-laughing.jpg"
          alt="two people laughing across a candlelit dinner table"
          size="sm"
          rotation={-6}
          className="-mr-3 translate-y-2"
        />
        <Polaroid
          tone="dating"
          src="/gallery/couple-dance-sunset.jpg"
          alt="a couple dancing on a hillside against an orange sunset"
          label="real nights"
          size="md"
          rotation={2}
        />
        <Polaroid
          tone="dating"
          src="/gallery/bar-couple-cozy.jpg"
          alt="a couple leaning close at a warm candlelit bar"
          size="sm"
          rotation={7}
          className="-ml-3 translate-y-3"
        />
      </motion.div>

      <h1 className="font-heading text-3xl lowercase leading-[1.05] text-shell-ink">
        real people. real nights. zero small talk.
      </h1>
      <p className="mt-4 font-body text-[15px] leading-relaxed text-shell-ink/70">
        after5 builds your match around an actual plan for the evening. everyone&apos;s verified, so
        the person who shows up is the person from the photos. set up your profile and we&apos;ll do the rest.
      </p>

      <label className="mt-7 flex items-start gap-3 font-body text-sm text-shell-ink">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-5 w-5 rounded-md border-shell-ink/25 text-shell-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40"
        />
        <span>yep, i&apos;m 18 or older.</span>
      </label>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-2xl border border-shell-accent/30 bg-white/70 px-4 py-3 font-body text-[13px] text-shell-ink">
          couldn&apos;t save that. check your connection and try again.
        </div>
      )}

      <div className="mt-7 flex items-center gap-4">
        <button
          type="button"
          onClick={handleContinue}
          disabled={disabled}
          aria-busy={phase === 'submitting'}
          className={cn(
            'flex min-h-[48px] items-center justify-center rounded-full px-8 font-body text-[16px] font-semibold lowercase transition',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
            disabled
              ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35'
              : 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95',
          )}
        >
          {phase === 'submitting' ? 'one sec…' : phase === 'error' ? 'try again' : "let's go"}
        </button>
        <a
          href="/"
          className="font-body text-sm font-medium text-shell-ink/60 underline decoration-shell-ink/20 underline-offset-4 hover:text-shell-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 rounded-full"
        >
          not now
        </a>
      </div>
    </div>
  );
}
