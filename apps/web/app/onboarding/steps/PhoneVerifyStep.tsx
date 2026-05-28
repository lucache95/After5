'use client';
// Step 5 (phone_verify): attach + verify the user's phone on their EXISTING account.
// Uses updateUser({phone}) then verifyOtp({type:'phone_change'}) (NOT signInWithOtp /
// type:'sms', which is a sign-in primitive that can swap the session to another
// identity). Then confirmPhone (server writes the verified phone row) then
// advanceOnboarding('selfie_verify').
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { browserAfter5Client, confirmPhone, advanceOnboarding } from '@/lib/after5/client';

export function PhoneVerifyStep() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'enter_phone' | 'enter_code'>('enter_phone');
  const [phase, setPhase] = useState<'idle' | 'sending' | 'verifying' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function friendly(msg: string): string {
    return /rate.?limit|too.?many|over_/i.test(msg)
      ? 'You just asked for a code. Wait a moment and try again.'
      : msg || 'Something went wrong.';
  }

  async function sendCode() {
    setPhase('sending');
    setErrorMsg('');
    // Attach the phone to the CURRENT user (phone-change), never a sign-in.
    const { error } = await browserAfter5Client().auth.updateUser({ phone });
    if (error) { setErrorMsg(friendly(error.message)); setPhase('error'); return; }
    setStage('enter_code');
    setPhase('idle');
  }

  async function verify() {
    setPhase('verifying');
    setErrorMsg('');
    const client = browserAfter5Client();
    const { data: { session: pre } } = await client.auth.getSession();
    const { data, error } = await client.auth.verifyOtp({ phone, token: code, type: 'phone_change' });
    if (error || !data?.session) { setErrorMsg(friendly(error?.message ?? 'That code did not work.')); setPhase('error'); return; }
    // Belt-and-braces: phone_change updates the current user; the uid must not change.
    if (pre?.user?.id && data.user?.id && data.user.id !== pre.user.id) {
      setErrorMsg('We could not verify your number on this account. Please sign in again.');
      setPhase('error');
      return;
    }
    try {
      await confirmPhone(client);
      await advanceOnboarding(client, 'selfie_verify');
      router.push('/onboarding/verify');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'We could not confirm your number.');
      setPhase('error');
    }
  }

  const inputBase = cn(
    'block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-4 py-3 font-body text-[15px] text-shell-ink',
    'placeholder:text-shell-ink/35 focus:outline-none focus:ring-2 focus:ring-shell-accent/60',
  );
  const ctaBase = cn(
    'flex min-h-[48px] items-center justify-center rounded-full px-8 font-body text-[16px] font-semibold lowercase transition',
    'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
  );

  return (
    <div>
      <h1 className="font-heading text-3xl lowercase text-shell-ink">verify your number</h1>
      <p className="mt-3 font-body text-[15px] leading-relaxed text-shell-ink/70">every number gets checked, so nobody&apos;s a ghost. we&apos;ll text you a 6-digit code.</p>

      <div className="mt-7 space-y-4">
        <div>
          <label htmlFor="phone" className="mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink">phone</label>
          <input id="phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 250 555 1234"
            disabled={stage === 'enter_code'}
            className={cn(inputBase, 'disabled:opacity-60')} />
        </div>
        {stage === 'enter_code' && (
          <div>
            <label htmlFor="code" className="mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink">6-digit code</label>
            <input id="code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)}
              className={cn(inputBase, 'tracking-[0.4em] [font-variant-numeric:tabular-nums]')} />
          </div>
        )}
      </div>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-2xl border border-shell-accent/30 bg-white/70 px-4 py-3 font-body text-[13px] text-shell-ink">{errorMsg}</div>
      )}

      <div className="mt-7 flex items-center gap-4">
        {stage === 'enter_phone' ? (
          <button type="button" onClick={sendCode} disabled={!phone || phase === 'sending'} aria-busy={phase === 'sending'}
            className={cn(ctaBase,
              !phone || phase === 'sending' ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35' : 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95')}>
            {phase === 'sending' ? 'sending…' : 'text me a code'}
          </button>
        ) : (
          <>
            <button type="button" onClick={verify} disabled={code.length < 6 || phase === 'verifying'} aria-busy={phase === 'verifying'}
              className={cn(ctaBase,
                code.length < 6 || phase === 'verifying' ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35' : 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95')}>
              {phase === 'verifying' ? 'checking…' : "i'm in"}
            </button>
            <button type="button" onClick={() => { setStage('enter_phone'); setCode(''); setPhase('idle'); }}
              className="font-body text-sm font-medium text-shell-ink/60 underline decoration-shell-ink/20 underline-offset-4 hover:text-shell-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 rounded-full">
              use a different number
            </button>
          </>
        )}
      </div>
    </div>
  );
}
