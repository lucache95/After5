'use client';
import { useState } from 'react';
import { browserAfter5Client, recordSwipe, type FeedNight } from '@/lib/after5/client';
import { NightCard } from './NightCard';
import { cn } from '@/lib/cn';

export function SwipeDeck({ initial }: { initial: FeedNight[] }) {
  const [deck] = useState(initial);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = deck[i];

  async function swipe(direction: 'left' | 'right') {
    if (!current || busy) return;
    setBusy(true); setError('');
    try {
      await recordSwipe(browserAfter5Client(), current.date_instance_id, direction);
      setI((n) => n + 1);
    } catch (e) {
      setError('That didn’t go through — try again.');
    } finally { setBusy(false); }
  }

  if (deck.length === 0 || i >= deck.length) {
    return <main className="mx-auto max-w-md px-6 py-20 text-center">
      <p className="font-display text-xl font-semibold text-text">We&apos;re lining up Kelowna nights.</p>
      <p className="mt-2 text-secondary">Check back soon, or <a className="underline" href="/nights/new">post your own night</a>.</p>
    </main>;
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <NightCard night={current} />
      {error && <p role="alert" className="mt-3 text-center text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-center gap-4">
        <button type="button" onClick={() => swipe('left')} disabled={busy}
          className={cn('rounded-pill border border-border px-8 py-3 text-[15px] font-medium', busy && 'opacity-50')}>Pass</button>
        <button type="button" onClick={() => swipe('right')} disabled={busy} aria-label="I'm interested"
          className={cn('rounded-pill bg-accent px-8 py-3 text-[15px] font-medium text-white', busy && 'opacity-50')}>I&apos;m interested</button>
      </div>
    </main>
  );
}
