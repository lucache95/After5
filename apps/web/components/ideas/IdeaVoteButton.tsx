'use client';

// Upvote toggle for the public idea board. Logged-out → bounce to login (return
// to /ideas). Logged-in → optimistic toggle, reconciled from the API response.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronUp } from 'lucide-react';
import { cn } from '@/lib/cn';

export function IdeaVoteButton({
  id, initialCount, initialVoted, isAuthed,
}: {
  id: string;
  initialCount: number;
  initialVoted: boolean;
  isAuthed: boolean;
}) {
  const router = useRouter();
  const [count, setCount] = useState(initialCount);
  const [voted, setVoted] = useState(initialVoted);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!isAuthed) { router.push('/login?next=/ideas'); return; }
    if (busy) return;
    setBusy(true);
    const prevVoted = voted;
    const prevCount = count;
    setVoted(!voted);
    setCount(count + (voted ? -1 : 1));
    try {
      const res = await fetch(`/api/ideas/${id}/vote`, { method: 'POST' });
      if (!res.ok) throw new Error('vote failed');
      const d = await res.json();
      setVoted(Boolean(d.voted));
      setCount(Number(d.vote_count ?? prevCount));
    } catch {
      setVoted(prevVoted);
      setCount(prevCount);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={voted}
      aria-label={voted ? 'remove your upvote' : 'upvote this idea'}
      className={cn(
        'flex min-w-[58px] shrink-0 flex-col items-center justify-center rounded-2xl border-2 px-3 py-2 transition active:scale-95',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/30',
        voted ? 'border-shell-accent bg-shell-pink text-shell-accent' : 'border-shell-ink/15 text-shell-ink hover:border-shell-ink/30',
      )}
    >
      <ChevronUp className="h-4 w-4" aria-hidden />
      <span className="font-heading text-lg leading-none [font-variant-numeric:tabular-nums]">{count}</span>
    </button>
  );
}
