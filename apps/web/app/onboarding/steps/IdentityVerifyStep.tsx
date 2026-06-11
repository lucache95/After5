'use client';
// Step 6 (selfie_verify): the front door + embedded capture. startVerification
// returns { inquiryId, sessionToken }; PersonaEmbed runs the government-ID + selfie
// capture; onComplete reveals VerificationStatus which reads the webhook verdict.
import { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PendingButtonContent } from '@/components/PendingButtonContent';
import { browserAfter5Client, startVerification } from '@/lib/after5/client';
import { PersonaEmbed } from './PersonaEmbed';
import { VerificationStatus } from './VerificationStatus';

type Stage = 'idle' | 'starting' | 'capturing' | 'submitted' | 'error';

// Friendly retry copy for any verification hiccup. The real error goes to the
// console (it's infrastructure jargon like "Edge Function returned a non-2xx
// status code" — never something a person should read mid-funnel).
const FRIENDLY_ERROR = "that didn't go through. give it another try?";

export function IdentityVerifyStep() {
  const [stage, setStage] = useState<Stage>('idle');
  const [inquiry, setInquiry] = useState<{ inquiryId: string; sessionToken?: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function start() {
    setStage('starting');
    setErrorMsg('');
    try {
      const res = await startVerification(browserAfter5Client()) as { inquiryId: string; sessionToken?: string };
      if (!res?.inquiryId) throw new Error('start-verification returned no inquiryId');
      setInquiry(res);
      setStage('capturing');
    } catch (e) {
      console.error('[verify] startVerification failed', e);
      setErrorMsg(FRIENDLY_ERROR);
      setStage('error');
    }
  }

  if (stage === 'submitted') return <VerificationStatus />;

  return (
    <div>
      <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-shell-pink px-3 py-1.5 font-body text-[11px] font-semibold lowercase tracking-wide text-shell-accent">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> one last thing
      </div>
      <h1 className="font-heading text-3xl lowercase text-shell-ink">prove it&apos;s really you</h1>
      {/* The sell for the single scariest ask in the funnel (P1, 2026-06-09 audit):
          payoff (everyone here did it), time (~2 minutes), privacy (persona checks
          your id, nobody on after5 sees it). */}
      <p className="mt-3 font-body text-[15px] leading-relaxed text-shell-ink/70">
        everyone you&apos;ll meet on after5 did this exact check, so every face here is a real one.
        it&apos;s a quick id + selfie scan that takes about 2 minutes.
        persona checks your id to confirm you&apos;re 18+, and it&apos;s never shown to anyone on after5.
      </p>

      {stage === 'capturing' && inquiry ? (
        <div className="mt-7">
          <PersonaEmbed
            inquiryId={inquiry.inquiryId}
            sessionToken={inquiry.sessionToken}
            onComplete={() => setStage('submitted')}
            onCancel={() => { setStage('idle'); setInquiry(null); }}
            onError={(e) => { console.error('[verify] persona embed error', e); setErrorMsg(FRIENDLY_ERROR); setStage('error'); }}
          />
        </div>
      ) : (
        <>
          {stage === 'error' && (
            <div role="alert" className="mt-5 rounded-2xl border border-shell-accent/30 bg-white/70 px-4 py-3 font-body text-[13px] text-shell-ink">{errorMsg}</div>
          )}
          <button type="button" onClick={start} disabled={stage === 'starting'} aria-busy={stage === 'starting'}
            className={cn(
              'mt-7 flex min-h-[48px] items-center justify-center rounded-full px-8 font-body text-[16px] font-semibold lowercase transition',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
              stage === 'starting' ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35' : 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95')}>
            <PendingButtonContent pending={stage === 'starting'} pendingLabel="starting…" accessibilityLabel="starting verification">
              {stage === 'error' ? 'try again' : "let's do it"}
            </PendingButtonContent>
          </button>
          {/* Teaser door (P1, 2026-06-09 audit): the cliff point is the one place a
              quiet peek at the goods earns the scan. /feed browses read-only
              pre-verification and /onboarding/verify is re-enterable, so nobody
              gets stranded. Deliberately quiet — it must not compete with the CTA. */}
          <p className="mt-5">
            <Link
              href="/feed"
              className="font-body text-sm font-medium lowercase text-shell-ink/60 underline decoration-shell-ink/20 underline-offset-4 transition-colors hover:text-shell-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 rounded-full"
            >
              peek at tonight&apos;s nights →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
