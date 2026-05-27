'use client';
// Step 1 (age_gate): intro + confirm 18+. Real DOB proof is the later ID scan;
// this is the entry gate. On confirm: advanceOnboarding('basics') then route forward.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { browserAfter5Client, advanceOnboarding } from '@/lib/after5/client';

export function WelcomeAgeGate() {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');

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
      <div className="mb-5 inline-flex items-center gap-2 rounded-pill bg-accent-soft px-3 py-1.5 text-[11px] font-semibold tracking-wide text-accent">
        <Sparkles className="h-3.5 w-3.5" /> Welcome to After5 dating
      </div>
      <h1 className="font-display text-2xl font-bold leading-tight text-text md:text-3xl">
        Real people. Real Kelowna nights.
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-secondary">
        After5 builds your match around a real plan for the evening. We verify every member, so the person you meet is who they say they are. Set up your profile to start.
      </p>

      <label className="mt-7 flex items-start gap-3 text-sm text-text">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent"
        />
        <span>I am 18 or older.</span>
      </label>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
          We couldn&apos;t save that. Check your connection and try again.
        </div>
      )}

      <div className="mt-7 flex items-center gap-4">
        <button
          type="button"
          onClick={handleContinue}
          disabled={!confirmed || phase === 'submitting'}
          className={cn(
            'inline-flex items-center justify-center rounded-pill px-7 py-3 text-[15px] font-medium transition-all',
            !confirmed || phase === 'submitting'
              ? 'cursor-not-allowed bg-border text-muted'
              : 'bg-text text-background hover:-translate-y-0.5',
          )}
        >
          {phase === 'submitting' ? 'Continuing…' : phase === 'error' ? 'Try again' : 'Continue'}
        </button>
        <a href="/" className="text-sm font-medium text-secondary underline decoration-border underline-offset-4 hover:text-text">
          Not now
        </a>
      </div>
    </div>
  );
}
