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
        <Loader2 className="h-6 w-6 animate-spin text-shell-accent motion-reduce:animate-none" aria-hidden />
        <p className="font-body text-sm text-shell-ink/70" aria-live="polite">checking your verification…</p>
      </div>
    );
  }

  if (state === 'failed' || state === 'appeal') {
    return (
      <div className="text-center">
        <ShieldAlert className="mx-auto h-7 w-7 text-shell-accent" aria-hidden />
        <h1 className="mt-4 font-heading text-3xl lowercase text-shell-ink">that didn&apos;t go through.</h1>
        <p className="mt-3 font-body text-[15px] leading-relaxed text-shell-ink/70">
          we couldn&apos;t verify your id. run the scan again, or appeal if you think we got it wrong.
        </p>
        <div className="mt-7 flex flex-col items-center gap-3">
          <button type="button" onClick={() => { setState('loading'); check(); }}
            className="flex min-h-[48px] items-center justify-center rounded-full bg-shell-accent px-8 font-body text-[16px] font-semibold lowercase text-white shadow-fun transition hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none">
            try again
          </button>
          <a href="mailto:hello@tryafter5.app?subject=Verification%20appeal"
            className="font-body text-sm font-medium text-shell-ink/60 underline decoration-shell-ink/20 underline-offset-4 hover:text-shell-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 rounded-full">
            appeal this
          </a>
        </div>
      </div>
    );
  }

  // pending (and unverified-after-submit) — show the limbo banner
  return (
    <div className="text-center">
      <Loader2 className="mx-auto h-6 w-6 animate-spin text-shell-accent motion-reduce:animate-none" aria-hidden />
      <h1 className="mt-4 font-heading text-3xl lowercase text-shell-ink">checking your id…</h1>
      <p className="mt-3 font-body text-[15px] leading-relaxed text-shell-ink/70" aria-live="polite">
        usually about a minute. keep this open and it&apos;ll update the second you&apos;re cleared.
      </p>
      <div className="mt-7 flex flex-col items-center gap-3">
        <button type="button" onClick={() => { setState('loading'); check(); }}
          className="flex min-h-[48px] items-center justify-center rounded-full bg-shell-accent px-8 font-body text-[16px] font-semibold lowercase text-white shadow-fun transition hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none">
          re-open verification
        </button>
        <button type="button" onClick={() => router.push('/home')}
          className="font-body text-sm font-medium text-shell-ink/60 underline decoration-shell-ink/20 underline-offset-4 hover:text-shell-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 rounded-full">
          look around while you wait
        </button>
      </div>
    </div>
  );
}
