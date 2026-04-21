'use client';

// Client component for the voting cards. Handles the localStorage voter
// token, vote submission, and live tally updates.

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { coverImageFor } from '@/lib/place-image';
import { cn } from '@/lib/cn';

interface ItineraryLite {
  id: string;
  slug: string | null;
  title: string | null;
  hook: string | null;
  total_cost_pp: number | null;
  total_duration_min: number | null;
  stops: unknown;
}

const TOKEN_KEY = 'after5_vote_token';
const VOTE_KEY = (sid: string) => `after5_vote_${sid}`;
const NAME_KEY = 'after5_voter_name';

function getOrCreateToken(): string {
  if (typeof window === 'undefined') return '';
  let t = localStorage.getItem(TOKEN_KEY);
  if (!t) {
    t = crypto.randomUUID();
    localStorage.setItem(TOKEN_KEY, t);
  }
  return t;
}

export function VoteCards({
  sessionId,
  itineraries,
  initialTally,
}: {
  sessionId: string;
  itineraries: ItineraryLite[];
  initialTally: Record<string, number>;
}) {
  const [tally, setTally] = useState(initialTally);
  const [votedFor, setVotedFor] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setVotedFor(localStorage.getItem(VOTE_KEY(sessionId)));
    setName(localStorage.getItem(NAME_KEY) ?? '');
  }, [sessionId]);

  async function vote(itineraryId: string) {
    setSubmitting(true);
    const token = getOrCreateToken();
    if (name) localStorage.setItem(NAME_KEY, name);
    try {
      const res = await fetch('/api/votes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          itinerary_id: itineraryId,
          voter_token: token,
          voter_name: name || null,
        }),
      });
      if (!res.ok) throw new Error('vote failed');
      // Optimistic local tally update — if user re-votes, decrement old
      const next = { ...tally };
      if (votedFor && votedFor !== itineraryId) {
        next[votedFor] = Math.max(0, (next[votedFor] ?? 1) - 1);
      }
      if (!votedFor || votedFor !== itineraryId) {
        next[itineraryId] = (next[itineraryId] ?? 0) + 1;
      }
      setTally(next);
      setVotedFor(itineraryId);
      localStorage.setItem(VOTE_KEY(sessionId), itineraryId);
    } catch (err) {
      console.error('vote failed', err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Optional name field so the planner knows who voted */}
      <div className="mb-8 max-w-md">
        <label className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-muted">
          Your name (optional)
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="So they know it was you"
          className="block w-full rounded-card border border-border bg-background px-4 py-3 text-sm text-text outline-none transition-colors focus:border-accent"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {itineraries.map((it) => {
          const stops = (Array.isArray(it.stops) ? it.stops : []) as Array<{
            place_type?: string;
            photo_url?: string | null;
          }>;
          const cover = coverImageFor(stops);
          const totalHr =
            it.total_duration_min !== null
              ? Math.round((it.total_duration_min / 60) * 10) / 10
              : 0;
          const isVoted = votedFor === it.id;
          const count = tally[it.id] ?? 0;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => vote(it.id)}
              disabled={submitting}
              className={cn(
                'group flex flex-col rounded-card border-2 p-3 text-left transition-all',
                isVoted
                  ? 'border-emerald-500 bg-emerald-500/5'
                  : 'border-transparent hover:border-border',
              )}
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card bg-surface">
                <Image
                  src={cover}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 100vw, 33vw"
                  className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.02]"
                />
                {isVoted && (
                  <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-pill bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white shadow-sm">
                    <Check className="h-3 w-3" strokeWidth={3} /> Your vote
                  </div>
                )}
                {count > 0 && !isVoted && (
                  <div className="absolute right-3 top-3 inline-flex items-center rounded-pill bg-white/95 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-text backdrop-blur-sm">
                    {count} {count === 1 ? 'vote' : 'votes'}
                  </div>
                )}
              </div>
              <div className="mt-3 px-1">
                <h3 className="font-display text-lg font-semibold leading-tight text-text md:text-xl">
                  {it.title}
                </h3>
                {it.hook && <p className="mt-1.5 line-clamp-2 text-xs text-secondary">{it.hook}</p>}
                <p className="mt-3 text-xs text-muted [font-variant-numeric:tabular-nums]">
                  <span className="text-text">${Math.round(it.total_cost_pp ?? 0)}</span>
                  <span className="mx-1.5 text-border">·</span>
                  <span>{totalHr} hr</span>
                  {count > 0 && (
                    <>
                      <span className="mx-1.5 text-border">·</span>
                      <span className="text-emerald-600">{count} {count === 1 ? 'vote' : 'votes'}</span>
                    </>
                  )}
                </p>
                {it.slug && (
                  <a
                    href={`/dates/${it.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-3 inline-block text-xs text-secondary underline decoration-border decoration-1 underline-offset-[5px] hover:text-text hover:decoration-text"
                  >
                    See full plan →
                  </a>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
