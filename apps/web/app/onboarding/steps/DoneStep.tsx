'use client';
// Step 7 (done): celebrate + "turn dating on" + route to the first-session home.
// Enabling is gated by canEnableDating (computed server-side, passed as `gate`);
// the DB age-gate trigger remains the hard enforcement.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { browserAfter5Client } from '@/lib/after5/client';
import { datingGateMessage } from '@/lib/onboarding/dating-gate';

export function DoneStep({
  userId, badge, gate = { ok: true },
}: {
  userId: string;
  badge: { verified: boolean; isNew: boolean };
  gate?: { ok: boolean; reason?: string };
}) {
  const router = useRouter();
  const [datingOn, setDatingOn] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'enabling' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function enableDating() {
    setPhase('enabling');
    setErrorMsg('');
    const { error } = await browserAfter5Client().from('profiles').update({ dating_enabled: true }).eq('id', userId);
    if (error) { setErrorMsg(error.message); setPhase('error'); return; }
    setDatingOn(true);
    setPhase('idle');
  }

  return (
    <div className="text-center">
      <div className="mx-auto inline-flex items-center gap-2 rounded-pill bg-emerald-50 px-4 py-1.5 text-sm font-semibold text-emerald-800">
        <BadgeCheck className="h-4 w-4" />
        {badge.verified ? 'Verified' : 'Profile complete'}{badge.isNew ? ' · New' : ''}
      </div>
      <h1 className="mt-6 font-display text-3xl font-bold text-text">You&apos;re in.</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-secondary">
        Your profile is set and confirmed. Flip dating on and we&apos;ll start warming up your first Kelowna nights.
      </p>

      {phase === 'error' && (
        <div role="alert" className="mx-auto mt-5 max-w-sm rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{errorMsg}</div>
      )}

      <div className="mt-8 flex flex-col items-center gap-3">
        {datingOn ? (
          <p className="text-sm font-medium text-emerald-700">Dating is on. We&apos;ll start lining up your first Kelowna nights.</p>
        ) : gate.ok ? (
          <button type="button" onClick={enableDating} disabled={phase === 'enabling'}
            className={cn('inline-flex items-center justify-center rounded-pill px-8 py-3.5 text-[15px] font-medium transition-all',
              phase === 'enabling' ? 'cursor-not-allowed bg-border text-muted' : 'bg-accent text-white hover:-translate-y-0.5')}>
            {phase === 'enabling' ? 'Turning on…' : phase === 'error' ? 'Try again' : 'Turn dating on'}
          </button>
        ) : (
          <p role="alert" className="mx-auto max-w-sm text-[13px] text-secondary">{datingGateMessage(gate.reason)}</p>
        )}
        <button type="button" onClick={() => router.push('/home')}
          className="inline-flex items-center gap-2 text-sm font-medium text-secondary underline decoration-border underline-offset-4 hover:text-text">
          Enter After5 <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
