'use client';
// Non-blocking state banner. The gallery + explainer always render beneath (the
// home is never a dead end). Exactly one primary action per state.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Clock, ShieldAlert } from 'lucide-react';
import type { HomeState } from '@/lib/onboarding/teaser';
import { EnableDatingButton } from './EnableDatingButton';

export function HomeStateBanner({ state, gate }: { state: HomeState; gate?: { ok: boolean; reason?: string } }) {
  const router = useRouter();
  if (state === 'verified') return null;

  if (state === 'pending') {
    return (
      <div className="mb-8 flex items-center gap-3 rounded-card border border-amber-200 bg-amber-50 px-5 py-4">
        <Clock className="h-5 w-5 shrink-0 text-amber-700" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-900">We&apos;re checking your ID, usually about a minute.</p>
          <p className="text-[13px] text-amber-800">Look around while you wait. Check back here to see when you&apos;re cleared.</p>
        </div>
        <button type="button" onClick={() => router.push('/dates')}
          className="shrink-0 rounded-pill bg-amber-700 px-4 py-2 text-[13px] font-medium text-white hover:opacity-90">
          Look around
        </button>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div className="mb-8 flex items-center gap-3 rounded-card border border-red-200 bg-red-50 px-5 py-4">
        <ShieldAlert className="h-5 w-5 shrink-0 text-red-600" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-900">Your verification needs another try.</p>
          <p className="text-[13px] text-red-800">You can still explore. Finish verifying when you&apos;re ready.</p>
        </div>
        <Link href="/onboarding/verify" className="shrink-0 rounded-pill bg-red-600 px-4 py-2 text-[13px] font-medium text-white hover:opacity-90">
          Finish verifying
        </Link>
      </div>
    );
  }

  // dating_off
  return (
    <div className="mb-8 flex items-center gap-3 rounded-card border border-border bg-surface px-5 py-4">
      <div className="flex-1">
        <p className="text-sm font-semibold text-text">You&apos;re verified. Flip dating on to get matched.</p>
        <p className="text-[13px] text-secondary">We&apos;ll start warming up your first Kelowna nights.</p>
      </div>
      <EnableDatingButton gate={gate} />
    </div>
  );
}
