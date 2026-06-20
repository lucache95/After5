'use client';

// Dating landing hero — holds all framer-motion so app/page.tsx stays a
// server component. Spring physics + useReducedMotion mirror the proven
// WelcomeAgeGate pattern; Polaroid is already a client component.

import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { Polaroid } from '@/components/Polaroid';

export function LandingHero() {
  const reduce = useReducedMotion();
  const spring = { type: 'spring' as const, stiffness: 360, damping: 30 };
  return (
    <section className="mx-auto w-full max-w-[480px] px-6 pt-16 pb-10 text-center md:pt-24">
      <motion.div
        className="mb-9 flex items-end justify-center gap-2"
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={reduce ? false : { opacity: 1, y: 0 }}
        transition={spring}
      >
        <Polaroid tone="dating" src="/gallery/pottery-wheel.jpg" alt="two people laughing at a pottery wheel" size="sm" rotation={-7} className="-mr-2 translate-y-3" />
        <Polaroid tone="dating" src="/gallery/couple-dance-sunset.jpg" alt="a couple dancing against an orange sunset" label="real nights" size="md" rotation={2} />
        <Polaroid tone="dating" src="/gallery/rooftop-pizza-sunset.jpg" alt="friends sharing pizza on a rooftop at golden hour" size="sm" rotation={7} className="-ml-2 translate-y-4" />
      </motion.div>
      <motion.h1
        className="font-heading text-4xl lowercase leading-[1.02] text-shell-ink md:text-5xl"
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={reduce ? false : { opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.05 }}
      >
        match on the night, not the face.
      </motion.h1>
      <p className="mx-auto mt-5 max-w-[420px] font-body text-[15px] leading-relaxed text-shell-ink/70 md:text-base">
        after5 builds your match around an actual plan for the evening. everyone&apos;s verified. less small talk, more showing up.
      </p>
      <div className="mt-8 flex flex-col items-center gap-3">
        <Link href="/onboarding" className="rounded-full bg-shell-accent px-8 py-3.5 font-body text-[15px] font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100">
          let&apos;s go
        </Link>
        <Link href="/create" className="font-body text-sm lowercase text-shell-ink/55 underline decoration-shell-ink/25 underline-offset-4 transition hover:text-shell-ink">
          or just make my date
        </Link>
      </div>
    </section>
  );
}
