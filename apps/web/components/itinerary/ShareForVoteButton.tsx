'use client';

// "Share with friends" button on the /plan results page. Creates a
// vote_session with the 3 itinerary IDs, then copies the share URL to
// clipboard. Voters open the link, tap their favorite.

import { useState } from 'react';
import { Share2, Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export function ShareForVoteButton({ itineraryIds }: { itineraryIds: string[] }) {
  const [state, setState] = useState<'idle' | 'creating' | 'copied' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState<string>('');

  async function createAndShare() {
    if (state === 'creating') return;
    setState('creating');
    try {
      const res = await fetch('/api/vote-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itinerary_ids: itineraryIds }),
      });
      if (!res.ok) throw new Error('create failed');
      const data = (await res.json()) as { id?: string };
      if (!data.id) throw new Error('no id returned');
      const url = `${window.location.origin}/vote/${data.id}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setState('copied');
        setTimeout(() => setState('idle'), 2500);
      } catch {
        // Clipboard blocked — still show the URL so user can copy manually.
        setState('copied');
      }
    } catch (err) {
      console.error('share failed', err);
      setState('error');
      setTimeout(() => setState('idle'), 2500);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={createAndShare}
        disabled={state === 'creating'}
        className={cn(
          'inline-flex items-center gap-2 rounded-pill border px-4 py-2 text-sm transition-colors',
          state === 'copied'
            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
            : 'border-border bg-background text-text hover:border-text/40',
        )}
      >
        {state === 'copied' ? (
          <>
            <Check className="h-4 w-4" strokeWidth={2.5} /> Link copied
          </>
        ) : (
          <>
            <Share2 className="h-4 w-4" strokeWidth={2} />
            {state === 'creating' ? 'Creating link…' : 'Share with friends to vote'}
          </>
        )}
      </button>
      {state === 'copied' && shareUrl && (
        <p className="break-all text-xs text-muted">{shareUrl}</p>
      )}
      {state === 'error' && (
        <p className="text-xs text-accent">Something went wrong. Try again.</p>
      )}
    </div>
  );
}
