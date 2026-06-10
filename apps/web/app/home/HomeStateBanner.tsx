'use client';
// Non-blocking state banner. The gallery + explainer always render beneath (the
// home is never a dead end). Exactly one primary action per state.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Clock, ShieldAlert } from 'lucide-react';
import type { HomeState } from '@/lib/onboarding/teaser';
import { datingGateMessage } from '@/lib/onboarding/dating-gate';
import { EnableDatingButton } from './EnableDatingButton';

export function HomeStateBanner({ state, gate }: { state: HomeState; gate?: { ok: boolean; reason?: string } }) {
  const router = useRouter();
  if (state === 'verified') return null;

  if (state === 'pending') {
    return (
      <div className="mb-6 flex items-center gap-3 rounded-3xl bg-white px-5 py-4 shadow-fun ring-1 ring-shell-ink/5">
        <Clock className="h-5 w-5 shrink-0 text-shell-accent" aria-hidden />
        <div className="flex-1">
          <p className="font-body text-sm font-semibold lowercase text-shell-ink">checking your id — about a minute.</p>
          <p className="font-body text-[13px] text-shell-ink/60">look around while you wait. we&apos;ll flip this when you&apos;re cleared.</p>
        </div>
        <button type="button" onClick={() => router.push('/dates')}
          className="min-h-[44px] shrink-0 rounded-full bg-shell-accent px-4 py-2 font-body text-[13px] font-semibold lowercase text-white transition hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100">
          look around
        </button>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div className="mb-6 flex items-center gap-3 rounded-3xl bg-white px-5 py-4 shadow-fun ring-1 ring-red-300/40">
        <ShieldAlert className="h-5 w-5 shrink-0 text-red-500" aria-hidden />
        <div className="flex-1">
          <p className="font-body text-sm font-semibold lowercase text-shell-ink">your verification needs another go.</p>
          <p className="font-body text-[13px] text-shell-ink/60">you can still poke around. finish verifying whenever.</p>
        </div>
        <Link href="/onboarding/verify"
          className="min-h-[44px] shrink-0 rounded-full bg-shell-accent px-4 py-2 font-body text-[13px] font-semibold lowercase text-white transition hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100">
          finish verifying
        </Link>
      </div>
    );
  }

  // dating_off + blocked gate (real-user fix): the old raw gate-message span read
  // like a permanent error dump. Render a calm branded notice card instead, and
  // branch on the actual reason: 'not_verified' is merely in-progress (route to
  // verify, never a failure claim); the rest get one support action. Deliberately
  // not dismissible — the user does need to resolve it.
  if (gate && !gate.ok) {
    const verifyPending = gate.reason === 'not_verified';
    return (
      <div className="mb-6 rounded-3xl bg-shell-pink/60 px-5 py-4 ring-1 ring-shell-accent/10">
        <p className="font-body text-sm font-semibold lowercase text-shell-ink">
          {verifyPending ? 'one last check before dating turns on' : 'one thing before dating turns on'}
        </p>
        <p className="mt-1 font-body text-[13px] leading-relaxed text-shell-ink/70">
          {datingGateMessage(gate.reason)}
        </p>
        {verifyPending ? (
          <Link href="/onboarding/verify"
            className="mt-3 inline-flex min-h-[40px] items-center rounded-full bg-white px-4 font-body text-[13px] font-semibold lowercase text-shell-ink ring-1 ring-shell-ink/10 transition hover:ring-shell-ink/25 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none">
            finish verifying
          </Link>
        ) : (
          <a href="mailto:hello@tryafter5.app"
            className="mt-3 inline-flex min-h-[40px] items-center rounded-full bg-white px-4 font-body text-[13px] font-semibold lowercase text-shell-ink ring-1 ring-shell-ink/10 transition hover:ring-shell-ink/25 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none">
            email us
          </a>
        )}
      </div>
    );
  }

  // dating_off
  return (
    <div className="mb-6 flex items-center gap-3 rounded-3xl bg-white px-5 py-4 shadow-fun ring-1 ring-shell-ink/5">
      <div className="flex-1">
        <p className="font-body text-sm font-semibold lowercase text-shell-ink">you&apos;re verified. flip dating on to get matched.</p>
        <p className="font-body text-[13px] text-shell-ink/60">we&apos;ll start warming up your first nights nearby.</p>
      </div>
      <EnableDatingButton gate={gate} />
    </div>
  );
}
