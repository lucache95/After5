'use client';

// Waitlist capture → referral share state. Reads ?ref= for attribution, posts to
// /api/waitlist, and on success swaps to the ShareCard (the viral loop). Fires
// waitlist_viewed on mount and waitlist_joined on success.

import { useEffect, useState } from 'react';
import { track } from '@/app/PostHogProvider';
import { ShareCard } from './ShareCard';
import { cn } from '@/lib/cn';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Result = { code: string; queue_position: number | null; referral_count: number; total: number | null };

export function WaitlistForm({ trackView = true }: { trackView?: boolean }) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [referredBy, setReferredBy] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (trackView) track.waitlistViewed();
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) setReferredBy(ref.trim());
  }, [trackView]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (phase === 'submitting') return;
    const em = email.trim();
    if (!EMAIL_RE.test(em)) {
      setErrorMsg('that email looks off — mind checking it?');
      setPhase('error');
      return;
    }
    setPhase('submitting');
    setErrorMsg('');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: em, first_name: firstName.trim() || null, referred_by: referredBy }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'failed');
      setResult({
        code: data.code,
        queue_position: data.queue_position ?? null,
        referral_count: data.referral_count ?? 0,
        total: data.total ?? null,
      });
      track.waitlistJoined({ referred: !!referredBy });
      setPhase('done');
    } catch {
      setErrorMsg("hmm, that didn't go through. try again?");
      setPhase('error');
    }
  }

  if (phase === 'done' && result) {
    return <ShareCard code={result.code} queuePosition={result.queue_position} referralCount={result.referral_count} total={result.total} />;
  }

  const busy = phase === 'submitting';

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-sm">
      {referredBy && (
        <p className="mb-3 rounded-full bg-shell-pink/70 px-4 py-1.5 text-center font-body text-[13px] font-semibold lowercase text-shell-accent">
          a friend invited you — claim your spot 👇
        </p>
      )}
      <div className="flex flex-col gap-2">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your email"
          aria-label="your email"
          className="min-h-[48px] rounded-full border-2 border-shell-ink/15 bg-white px-5 font-body text-shell-ink placeholder:text-shell-ink/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        />
        <input
          type="text"
          autoComplete="given-name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="first name (optional)"
          aria-label="first name, optional"
          className="min-h-[48px] rounded-full border-2 border-shell-ink/15 bg-white px-5 font-body text-shell-ink placeholder:text-shell-ink/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        />
        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className={cn(
            'flex min-h-[52px] items-center justify-center rounded-full px-8 font-body text-[16px] font-semibold lowercase shadow-fun transition active:scale-95',
            busy ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35' : 'bg-shell-accent text-white hover:opacity-90',
          )}
        >
          {busy ? 'saving your spot…' : 'join the waitlist'}
        </button>
      </div>
      {phase === 'error' && (
        <p role="alert" className="mt-2 text-center font-body text-[13px] text-shell-accent">{errorMsg}</p>
      )}
      <p className="mt-3 text-center font-body text-[12px] lowercase text-shell-ink/50">
        kelowna · launching sept 8 · everyone id-verified
      </p>
    </form>
  );
}
