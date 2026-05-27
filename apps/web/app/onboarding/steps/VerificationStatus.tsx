'use client';
// The one async-limbo screen (decision A): pending / verified / failed. The
// webhook owns the verdict; this screen polls profiles.verification and routes.
// pending → "checking, we'll notify you" + re-open; verified → advance('done');
// failed → try again / appeal.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldAlert } from 'lucide-react';
import { browserAfter5Client, advanceOnboarding } from '@/lib/after5/client';
import { readVerification } from './verification-poll';
import type { VerificationState } from '@after5/validators';

export function VerificationStatus() {
  const router = useRouter();
  const [state, setState] = useState<VerificationState | 'loading'>('loading');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function check() {
    try {
      const v = await readVerification();
      setState(v);
      if (v === 'verified') {
        await advanceOnboarding(browserAfter5Client(), 'done').catch(() => { /* already done is fine */ });
        router.push('/onboarding/done');
        return;
      }
      if (v === 'pending') {
        // Poll every 4s while pending (the webhook may land any moment).
        timer.current = setTimeout(check, 4000);
      }
    } catch {
      setState('failed');
    }
  }

  useEffect(() => {
    check();
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p className="text-sm text-secondary">Checking your verification…</p>
      </div>
    );
  }

  if (state === 'failed' || state === 'appeal') {
    return (
      <div className="text-center">
        <ShieldAlert className="mx-auto h-7 w-7 text-red-500" />
        <h1 className="mt-4 font-display text-2xl font-bold text-text">That didn&apos;t go through.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-secondary">
          We couldn&apos;t verify your ID. You can try the scan again, or appeal if you think this is a mistake.
        </p>
        <div className="mt-7 flex flex-col items-center gap-3">
          <button type="button" onClick={() => { setState('loading'); check(); }}
            className="inline-flex items-center justify-center rounded-pill bg-text px-7 py-3 text-[15px] font-medium text-background hover:-translate-y-0.5">
            Try again
          </button>
          <a href="mailto:hello@tryafter5.app?subject=Verification%20appeal"
            className="text-sm font-medium text-secondary underline decoration-border underline-offset-4 hover:text-text">
            Appeal this decision
          </a>
        </div>
      </div>
    );
  }

  // pending (and unverified-after-submit) — show the limbo banner
  return (
    <div className="text-center">
      <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent" />
      <h1 className="mt-4 font-display text-2xl font-bold text-text">We&apos;re checking your ID…</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-secondary">
        Usually about a minute. Keep this open and it updates the moment you&apos;re cleared.
      </p>
      <div className="mt-7 flex flex-col items-center gap-3">
        <button type="button" onClick={() => { setState('loading'); check(); }}
          className="inline-flex items-center justify-center rounded-pill bg-text px-7 py-3 text-[15px] font-medium text-background hover:-translate-y-0.5">
          Continue / re-open verification
        </button>
        <button type="button" onClick={() => router.push('/home')}
          className="text-sm font-medium text-secondary underline decoration-border underline-offset-4 hover:text-text">
          Look around while you wait
        </button>
      </div>
    </div>
  );
}
