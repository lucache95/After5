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
      <div className="mb-5 inline-flex items-center gap-2 rounded-pill bg-accent-soft px-3 py-1.5 text-[11px] font-semibold tracking-wide text-accent">
        <ShieldCheck className="h-3.5 w-3.5" /> One last step
      </div>
      <h1 className="font-display text-2xl font-bold text-text">Verify it&apos;s really you</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-secondary">
        Persona runs a quick government-ID and selfie check. This keeps After5 real and confirms you&apos;re 18+.
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
            <div role="alert" className="mt-5 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{errorMsg}</div>
          )}
          <button type="button" onClick={start} disabled={stage === 'starting'}
            className={cn('mt-7 inline-flex items-center justify-center rounded-pill px-7 py-3 text-[15px] font-medium transition-all',
              stage === 'starting' ? 'cursor-not-allowed bg-border text-muted' : 'bg-text text-background hover:-translate-y-0.5')}>
            {stage === 'starting' ? 'Starting…' : stage === 'error' ? 'Try again' : 'Start verification'}
          </button>
        </>
      )}
    </div>
  );
}
