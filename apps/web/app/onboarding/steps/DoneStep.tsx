'use client';
// Step 7 (done): celebrate + "turn dating on" + route to the payoff. The primary
// navigation CTA targets /feed in BOTH gate states (real-user fix: landing on the
// cold-start /home after onboarding had zero payoff; the teaser feed lets even
// gate-blocked users browse real nights). A quiet secondary still goes to /home.
// Enabling is gated by canEnableDating (computed server-side, passed as `gate`);
// the DB age-gate trigger remains the hard enforcement.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { BadgeCheck, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Polaroid } from '@/components/Polaroid';
import { PendingButtonContent } from '@/components/PendingButtonContent';
import { browserAfter5Client } from '@/lib/after5/client';
import { datingGateMessage } from '@/lib/onboarding/dating-gate';
import { track } from '@/app/PostHogProvider';

export function DoneStep({
  userId, badge, gate = { ok: true },
}: {
  userId: string;
  badge: { verified: boolean; isNew: boolean };
  gate?: { ok: boolean; reason?: string };
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [datingOn, setDatingOn] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'enabling' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function enableDating() {
    setPhase('enabling');
    setErrorMsg('');
    const client = browserAfter5Client();
    const { error } = await client.from('profiles').update({ dating_enabled: true }).eq('id', userId);
    if (error) { setErrorMsg(error.message); setPhase('error'); return; }
    // ACCT-01: a returning user (same verified phone) resumes their reputation. This
    // runs AFTER phone/ID verification (gate.ok), so the identity hash is trustworthy.
    // Best-effort: never block turning dating on if the lookup fails.
    try { await client.rpc('seed_reputation_from_ledger'); } catch { /* best-effort */ }
    track.onboardingCompleted({ dating_enabled: true });
    setDatingOn(true);
    setPhase('idle');
  }

  return (
    <div className="text-center">
      <motion.div
        className="mb-7 flex justify-center"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.9, rotate: -4 }}
        animate={reduceMotion ? false : { opacity: 1, scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      >
        <Polaroid
          tone="dating"
          src="/gallery/couple-dance-sunset.jpg"
          alt="a couple dancing on a hillside against a sunset sky"
          label="see you out there"
          size="lg"
        />
      </motion.div>

      {gate.ok ? (
        <>
          <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-shell-pink px-4 py-1.5 font-body text-sm font-semibold lowercase text-shell-accent">
            <BadgeCheck className="h-4 w-4" aria-hidden />
            {badge.verified ? 'verified' : 'profile complete'}{badge.isNew ? ' · new' : ''}
          </div>
          <h1 className="mt-6 font-heading text-4xl lowercase text-shell-ink">you&apos;re in.</h1>
          <p className="mt-4 font-body text-[15px] leading-relaxed text-shell-ink/70">
            profile&apos;s set and verified. flip dating on and we&apos;ll start warming up your first nights nearby.
          </p>
        </>
      ) : (
        <>
          <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-shell-pink px-4 py-1.5 font-body text-sm font-semibold lowercase text-shell-ink/60">
            <BadgeCheck className="h-4 w-4" aria-hidden />
            {'profile complete'}{badge.isNew ? ' · new' : ''}
          </div>
          <h1 className="mt-6 font-heading text-4xl lowercase text-shell-ink">almost there.</h1>
          <p className="mt-4 font-body text-[15px] leading-relaxed text-shell-ink/70">
            your profile&apos;s set — one thing&apos;s blocking dating:
          </p>
          <div role="alert" className="mx-auto mt-4 max-w-sm rounded-2xl border border-shell-accent/30 bg-white/70 px-4 py-3 font-body text-[15px] text-shell-ink">
            {datingGateMessage(gate.reason)}
          </div>
          {/* not_verified is fixable right now — hand them the door (P2: the
              calm not-yet-verified framing, never an invented id failure). */}
          {gate.reason === 'not_verified' && (
            <p className="mt-3">
              <button type="button" onClick={() => router.push('/onboarding/verify')}
                className="font-body text-sm font-medium lowercase text-shell-ink/60 underline decoration-shell-ink/20 underline-offset-4 transition-colors hover:text-shell-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 rounded-full">
                finish verifying →
              </button>
            </p>
          )}
        </>
      )}

      {phase === 'error' && (
        <div role="alert" className="mx-auto mt-5 max-w-sm rounded-2xl border border-shell-accent/30 bg-white/70 px-4 py-3 font-body text-[13px] text-shell-ink">{errorMsg}</div>
      )}

      <div className="mt-8 flex flex-col items-center gap-3">
        {datingOn ? (
          <p className="font-body text-sm font-semibold lowercase text-shell-accent" aria-live="polite">dating&apos;s on. lining up your first nights nearby.</p>
        ) : gate.ok ? (
          <button type="button" onClick={enableDating} disabled={phase === 'enabling'} aria-busy={phase === 'enabling'}
            className={cn(
              'flex min-h-[48px] items-center justify-center rounded-full px-8 font-body text-[16px] font-semibold lowercase transition',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
              phase === 'enabling' ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35' : 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95')}>
            <PendingButtonContent pending={phase === 'enabling'} pendingLabel="turning on…" accessibilityLabel="turning dating on">
              {phase === 'error' ? 'try again' : 'turn dating on'}
            </PendingButtonContent>
          </button>
        ) : null}
        {/* Payoff CTA — always targets /feed. Pink when it IS the primary (gate
            blocked, or dating just turned on); outlined while "turn dating on"
            holds the pink, so exactly one pink button per state. */}
        <button type="button" onClick={() => router.push('/feed')}
          className={cn(
            'flex min-h-[48px] items-center justify-center gap-2 rounded-full px-8 font-body text-[16px] font-semibold lowercase transition',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
            datingOn || !gate.ok
              ? 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95'
              : 'border-2 border-shell-ink/15 text-shell-ink hover:border-shell-ink/30 active:scale-95',
          )}>
          see tonight&apos;s nights <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" onClick={() => router.push('/home')}
          className="font-body text-sm font-medium text-shell-ink/60 underline decoration-shell-ink/20 underline-offset-4 hover:text-shell-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 rounded-full">
          home
        </button>
      </div>
    </div>
  );
}
