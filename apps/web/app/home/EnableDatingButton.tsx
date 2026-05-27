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
    return <span role="alert" className="text-[12px] text-secondary">{datingGateMessage(gate.reason)}</span>;
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
        className={cn('shrink-0 rounded-pill px-4 py-2 text-[13px] font-medium transition-all',
          phase === 'enabling' ? 'cursor-not-allowed bg-border text-muted' : 'bg-accent text-white hover:opacity-90')}>
        {phase === 'enabling' ? 'Turning on…' : 'Turn dating on'}
      </button>
      {phase === 'error' && <span role="alert" className="mt-1 text-[11px] text-red-600">{msg}</span>}
    </span>
  );
}
