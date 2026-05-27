'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserAfter5Client, postNight } from '@/lib/after5/client';
import { cn } from '@/lib/cn';

interface Plan { id: string; title: string | null; cover_image_url: string | null; vibe_tags: string[] | null; }

export function PostNightForm({ plans }: { plans: Plan[] }) {
  const router = useRouter();
  const [itineraryId, setItineraryId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [phase, setPhase] = useState<'idle' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const canPost = itineraryId && startsAt && new Date(startsAt) > new Date() && phase !== 'saving';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canPost) return;
    setPhase('saving'); setErrorMsg('');
    try {
      await postNight(browserAfter5Client(), { itinerary_id: itineraryId, starts_at: new Date(startsAt).toISOString() });
      router.push('/home');
    } catch (err) {
      console.error('[PostNightForm] post failed', err);
      setErrorMsg(err instanceof Error ? err.message : 'Could not post your night. Please try again.');
      setPhase('error');
    }
  }

  if (plans.length === 0) {
    return <main className="mx-auto max-w-xl px-6 py-16 text-center text-secondary">
      You don&apos;t have any plans yet. <a className="underline" href="/plan">Build one first</a>, then post it as a night.
    </main>;
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="font-display text-2xl font-bold text-text">Post a night</h1>
      <p className="mt-2 text-[15px] text-secondary">Pick a plan and a time. People nearby can say they&apos;re in — you choose who.</p>
      <form onSubmit={submit} className="mt-6 space-y-5">
        <label className="block text-sm font-medium text-text">Plan
          <select value={itineraryId} onChange={(e) => setItineraryId(e.target.value)}
            className="mt-1.5 block w-full rounded-card border border-border bg-white px-4 py-3 text-[15px]">
            <option value="">Choose a plan…</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.title ?? 'Untitled plan'}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-text">When
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
            className="mt-1.5 block w-full rounded-card border border-border bg-white px-4 py-3 text-[15px]" />
        </label>
        {phase === 'error' && <div role="alert" className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{errorMsg}</div>}
        <button type="submit" disabled={!canPost}
          className={cn('inline-flex w-full items-center justify-center rounded-pill px-7 py-3.5 text-[15px] font-medium transition-all',
            !canPost ? 'cursor-not-allowed bg-border text-muted' : 'bg-text text-background hover:-translate-y-0.5')}>
          {phase === 'saving' ? 'Posting…' : phase === 'error' ? 'Try again' : 'Post this night'}
        </button>
      </form>
    </main>
  );
}
