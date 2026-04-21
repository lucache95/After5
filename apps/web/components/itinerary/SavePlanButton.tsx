'use client';

// Toggle a plan saved/unsaved. Auth-aware:
//   - Authed users: clicking flips state via /api/saved-plans
//   - Unauthed users: clicking redirects to /login?next=...&action=save&id=...
//     The current page can read those params after auth and call save().
//
// Visual: outlined heart by default; filled rose when saved. Optimistic
// update — flips immediately, reverts on server error.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import { cn } from '@/lib/cn';

export function SavePlanButton({
  itineraryId,
  fullWidth = true,
  size = 'md',
}: {
  itineraryId: string;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  // Hydrate initial saved state.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/saved-plans/check?id=${encodeURIComponent(itineraryId)}`)
      .then((r) => r.ok ? r.json() : { saved: false })
      .then((data) => { if (!cancelled) setSaved(!!data.saved); })
      .catch(() => { /* default unsaved */ });
    return () => { cancelled = true; };
  }, [itineraryId]);

  // Auto-save when arriving from /login with action=save&id=<this>
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'save' && params.get('id') === itineraryId) {
      // Strip the params so refresh doesn't re-trigger.
      const url = new URL(window.location.href);
      url.searchParams.delete('action');
      url.searchParams.delete('id');
      window.history.replaceState({}, '', url.toString());
      void toggle(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itineraryId]);

  async function toggle(forceSave?: boolean) {
    if (pending) return;
    const want = forceSave ?? !saved;
    setPending(true);
    setSaved(want); // optimistic

    try {
      const res = await fetch('/api/saved-plans', {
        method: want ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itinerary_id: itineraryId }),
      });

      if (res.status === 401) {
        // Bounce to login with the intent encoded so we auto-save on return.
        const next = `${window.location.pathname}?action=save&id=${itineraryId}`;
        router.push(`/login?next=${encodeURIComponent(next)}`);
        setSaved(false);
        return;
      }

      if (!res.ok) {
        // Revert optimistic update on server error.
        setSaved(!want);
        return;
      }

      const data = (await res.json()) as { saved?: boolean };
      if (typeof data.saved === 'boolean') setSaved(data.saved);
    } catch {
      setSaved(!want);
    } finally {
      setPending(false);
    }
  }

  const sizeClasses = size === 'sm'
    ? 'px-4 py-2 text-xs'
    : 'px-5 py-3 text-sm';

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={pending}
      aria-pressed={saved}
      className={cn(
        'group inline-flex items-center justify-center gap-2 rounded-pill border font-medium transition-all',
        sizeClasses,
        fullWidth ? 'w-full' : '',
        saved
          ? 'border-rose-300 bg-rose-50 text-rose-900 hover:border-rose-400'
          : 'border-border bg-background text-text hover:border-text/40',
        pending && 'opacity-70',
      )}
    >
      <Heart
        className={cn(
          'h-4 w-4 transition-all',
          saved ? 'fill-rose-500 stroke-rose-500' : 'stroke-current',
        )}
        strokeWidth={2}
      />
      {saved ? 'Saved' : 'Save this plan'}
    </button>
  );
}
