'use client';
// Re-offers "turn dating on" from the home (dating_off state). Gated by
// canEnableDating (computed server-side, passed as `gate`); the DB age-gate
// trigger remains the hard enforcement.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { browserAfter5Client } from '@/lib/after5/client';
import { datingGateMessage } from '@/lib/onboarding/dating-gate';

export function EnableDatingButton({ gate = { ok: true } }: { gate?: { ok: boolean; reason?: string } }) {
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'enabling' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  if (!gate.ok) {
    return <span role="alert" className="font-body text-[12px] lowercase text-shell-ink/60">{datingGateMessage(gate.reason)}</span>;
  }

  async function enable() {
    setPhase('enabling'); setMsg('');
    const client = browserAfter5Client();
    const { data: { user } } = await client.auth.getUser();
    if (!user) { router.push('/login?next=/home'); return; }
    const { error } = await client.from('profiles').update({ dating_enabled: true }).eq('id', user.id);
    if (error) { setMsg(error.message); setPhase('error'); return; }
    router.refresh();
  }

  return (
    <span className="flex flex-col items-end">
      <button type="button" onClick={enable} disabled={phase === 'enabling'}
        className={cn('min-h-[44px] shrink-0 rounded-full px-4 py-2 font-body text-[13px] font-semibold lowercase transition',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
          phase === 'enabling'
            ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/50'
            : 'bg-shell-accent text-white hover:scale-[1.03] active:scale-95 motion-reduce:hover:scale-100')}>
        {phase === 'enabling' ? 'turning on…' : 'turn dating on'}
      </button>
      {phase === 'error' && <span role="alert" className="mt-1 font-body text-[11px] text-red-600">{msg}</span>}
    </span>
  );
}
