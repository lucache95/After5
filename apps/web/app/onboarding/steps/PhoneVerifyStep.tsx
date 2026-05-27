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

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-text">Verify your phone</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-secondary">We verify every number so members can trust who they meet. We text a 6-digit code.</p>

      <div className="mt-7 space-y-4">
        <div>
          <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-text">Phone</label>
          <input id="phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 250 555 1234"
            disabled={stage === 'enter_code'}
            className="block w-full rounded-card border border-border bg-white px-4 py-3 text-[15px] outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15 disabled:opacity-60" />
        </div>
        {stage === 'enter_code' && (
          <div>
            <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-text">6-digit code</label>
            <input id="code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)}
              className="block w-full rounded-card border border-border bg-white px-4 py-3 text-[15px] tracking-[0.4em] [font-variant-numeric:tabular-nums] outline-none focus:border-accent" />
          </div>
        )}
      </div>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{errorMsg}</div>
      )}

      <div className="mt-7 flex items-center gap-4">
        {stage === 'enter_phone' ? (
          <button type="button" onClick={sendCode} disabled={!phone || phase === 'sending'}
            className={cn('inline-flex items-center justify-center rounded-pill px-7 py-3 text-[15px] font-medium transition-all',
              !phone || phase === 'sending' ? 'cursor-not-allowed bg-border text-muted' : 'bg-text text-background hover:-translate-y-0.5')}>
            {phase === 'sending' ? 'Sending…' : 'Send code'}
          </button>
        ) : (
          <>
            <button type="button" onClick={verify} disabled={code.length < 6 || phase === 'verifying'}
              className={cn('inline-flex items-center justify-center rounded-pill px-7 py-3 text-[15px] font-medium transition-all',
                code.length < 6 || phase === 'verifying' ? 'cursor-not-allowed bg-border text-muted' : 'bg-text text-background hover:-translate-y-0.5')}>
              {phase === 'verifying' ? 'Verifying…' : 'Verify'}
            </button>
            <button type="button" onClick={() => { setStage('enter_phone'); setCode(''); setPhase('idle'); }}
              className="text-sm font-medium text-secondary underline decoration-border underline-offset-4 hover:text-text">
              Use a different number
            </button>
          </>
        )}
      </div>
    </div>
  );
}
