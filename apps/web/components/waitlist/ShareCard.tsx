'use client';

// Post-signup viral state: your spot in line + a shareable referral link that
// moves you up. Native share where supported, copy-to-clipboard fallback. Fires
// waitlist_shared analytics.

import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { track } from '@/app/PostHogProvider';
import { cn } from '@/lib/cn';

export function ShareCard({
  code,
  queuePosition,
  referralCount,
  total,
}: {
  code: string;
  queuePosition: number | null;
  referralCount: number;
  total: number | null;
}) {
  const [copied, setCopied] = useState(false);

  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?ref=${code}`
      : `https://tryafter5.app/?ref=${code}`;

  async function share() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'after5',
          text: "i just joined the after5 waitlist — match on the night, not the face. join me:",
          url: link,
        });
        track.waitlistShared('native');
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    await copy();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      track.waitlistShared('copy');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op; link is visible below */
    }
  }

  return (
    <div className="rounded-3xl bg-shell-pink/60 p-6 text-center ring-1 ring-shell-accent/10" aria-live="polite">
      <p className="font-body text-sm font-semibold lowercase text-shell-ink/70">you&apos;re on the list 🎉</p>
      {queuePosition != null && (
        <p className="mt-2 font-heading text-4xl lowercase text-shell-accent">
          #{queuePosition}
          {total != null && <span className="ml-1 align-middle font-body text-base text-shell-ink/55">of {total}</span>}
        </p>
      )}
      <p className="mt-3 font-body text-[15px] leading-relaxed text-shell-ink/75">
        want in sooner? every friend who joins with your link <span className="font-semibold text-shell-ink">moves you up the line.</span>
        {referralCount > 0 && (
          <span className="mt-1 block font-semibold text-shell-accent">
            {referralCount} {referralCount === 1 ? 'friend has' : 'friends have'} joined with your link.
          </span>
        )}
      </p>

      <div className="mt-5 flex flex-col gap-2">
        <button
          type="button"
          onClick={share}
          className="flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-shell-accent px-6 font-body text-[15px] font-semibold lowercase text-white shadow-fun transition hover:opacity-90 active:scale-95"
        >
          <Share2 className="h-4 w-4" aria-hidden /> share my link
        </button>
        <button
          type="button"
          onClick={copy}
          className={cn(
            'flex min-h-[44px] items-center justify-center gap-2 rounded-full border-2 px-6 font-body text-sm font-semibold lowercase transition active:scale-95',
            copied ? 'border-shell-accent/40 text-shell-accent' : 'border-shell-ink/15 text-shell-ink hover:border-shell-ink/30',
          )}
        >
          {copied ? <><Check className="h-4 w-4" aria-hidden /> copied</> : <><Copy className="h-4 w-4" aria-hidden /> copy link</>}
        </button>
      </div>

      <p className="mt-3 break-all font-body text-[11px] text-shell-ink/45">{link}</p>
    </div>
  );
}
