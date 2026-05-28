'use client';
// Step 6 (selfie_verify): the front door + embedded capture. startVerification
// returns { inquiryId, sessionToken }; PersonaEmbed runs the government-ID + selfie
// capture; onComplete reveals VerificationStatus which reads the webhook verdict.
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { browserAfter5Client, startVerification } from '@/lib/after5/client';
import { PersonaEmbed } from './PersonaEmbed';
import { VerificationStatus } from './VerificationStatus';

type Stage = 'idle' | 'starting' | 'capturing' | 'submitted' | 'error';

export function IdentityVerifyStep() {
  const [stage, setStage] = useState<Stage>('idle');
  const [inquiry, setInquiry] = useState<{ inquiryId: string; sessionToken?: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function start() {
    setStage('starting');
    setErrorMsg('');
    try {
      const res = await startVerification(browserAfter5Client()) as { inquiryId: string; sessionToken?: string };
      if (!res?.inquiryId) throw new Error('Verification could not start.');
      setInquiry(res);
      setStage('capturing');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Verification could not start.');
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
      <p className="mt-3 font-body text-[15px] leading-relaxed text-shell-ink/70">
        quick id + selfie check, runs through persona. it&apos;s how we keep after5 real and confirm you&apos;re 18+.
      </p>

      {stage === 'capturing' && inquiry ? (
        <div className="mt-7">
          <PersonaEmbed
            inquiryId={inquiry.inquiryId}
            sessionToken={inquiry.sessionToken}
            onComplete={() => setStage('submitted')}
            onCancel={() => { setStage('idle'); setInquiry(null); }}
            onError={(e) => { setErrorMsg(e instanceof Error ? e.message : 'Verification was interrupted.'); setStage('error'); }}
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
            {stage === 'starting' ? 'starting…' : stage === 'error' ? 'try again' : "let's do it"}
          </button>
        </>
      )}
    </div>
  );
}
