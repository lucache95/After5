// apps/web/app/dates/[instanceId]/interested/CancelWithReasonPicker.tsx
// Controlled 4-reason cancel picker over the match-cancel-lock reason taxonomy
// (mutual | no_show | creator_pre_lock | safety). D OWNS this component; F mounts
// it on /matches/[lockId] and supplies onConfirm → match.cancelLock(lockId, reason)
// (divergence F-2). Dry lowercase copy (DESIGN-SYSTEM §3); 'safety' shows an
// extra confirmation because it's reported.
'use client';
import { useState } from 'react';
import { cn } from '@/lib/cn';

export type CancelReason = 'mutual' | 'no_show' | 'creator_pre_lock' | 'safety';

const REASONS: { value: CancelReason; label: string; blurb: string }[] = [
  { value: 'mutual', label: 'both of us called it off', blurb: 'no hard feelings, just not happening.' },
  { value: 'no_show', label: "they didn't show", blurb: "you were there, they weren't." },
  { value: 'creator_pre_lock', label: 'backing out before we meet', blurb: "you're pulling the plug early." },
  { value: 'safety', label: 'a safety issue', blurb: 'something felt off or unsafe.' },
];

export function CancelWithReasonPicker({
  onConfirm,
  busy = false,
}: {
  onConfirm: (reason: CancelReason) => void;
  busy?: boolean;
}) {
  const [reason, setReason] = useState<CancelReason | null>(null);
  const isSafety = reason === 'safety';

  return (
    <div className="mx-auto w-full max-w-[420px] px-1">
      <h2 className="font-heading text-2xl lowercase text-shell-ink">why are you cancelling?</h2>
      <fieldset className="mt-4 space-y-2" aria-label="cancellation reason">
        {REASONS.map((r) => {
          const selected = reason === r.value;
          return (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={r.label}
              onClick={() => setReason(r.value)}
              className={cn(
                'flex min-h-[44px] w-full flex-col items-start rounded-3xl border-2 px-4 py-3 text-left transition',
                'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                selected
                  ? 'border-shell-accent bg-shell-pink'
                  : 'border-shell-ink/15 bg-white hover:border-shell-ink/30',
              )}
            >
              <span className="font-body font-semibold lowercase text-shell-ink">{r.label}</span>
              <span className="font-body text-sm text-shell-ink/65">{r.blurb}</span>
            </button>
          );
        })}
      </fieldset>

      {isSafety && (
        <p className="mt-3 font-body text-sm text-shell-ink/70" role="note">
          this gets reported to our team and reviewed. only pick it if you mean it.
        </p>
      )}

      <button
        type="button"
        disabled={!reason || busy}
        onClick={() => reason && onConfirm(reason)}
        className={cn(
          'mt-5 flex min-h-[48px] w-full items-center justify-center rounded-full font-body font-semibold lowercase transition',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
          'disabled:opacity-50',
          isSafety ? 'bg-shell-ink text-white' : 'bg-shell-accent text-white',
        )}
      >
        {isSafety ? 'report and cancel' : 'cancel this date'}
      </button>
    </div>
  );
}
