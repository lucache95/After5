'use client';

// Three-question feedback pulse rendered below an itinerary view. The
// "would_do" answer is the gold signal — single-click yes/maybe/no.
// Per-stop thumbs and the "skip which" picker are progressive.
//
// Submits each answer as the user clicks (no big "Submit" button at the end)
// so we capture partial signal even if the user bounces. Each click POSTs an
// updated row; collisions are fine since we only care about the latest.

import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Stop {
  place_id: string;
  place_name: string;
}

type WouldDo = 'yes' | 'maybe' | 'no';

export function FeedbackPulse({
  itineraryId,
  stops,
  source = 'plan_results',
}: {
  itineraryId: string;
  stops: Stop[];
  source?: 'plan_results' | 'public_date';
}) {
  const [stopVotes, setStopVotes] = useState<Record<number, 'up' | 'down'>>({});
  const [skipIdx, setSkipIdx] = useState<number | null>(null);
  const [wouldDo, setWouldDo] = useState<WouldDo | null>(null);
  const [thanks, setThanks] = useState(false);

  async function persist(patch: Partial<{
    stop_votes: typeof stopVotes;
    skip_stop_idx: number | null;
    would_do: WouldDo | null;
  }>) {
    const merged = {
      stop_votes: Object.entries({ ...stopVotes, ...(patch.stop_votes ?? {}) }).map(
        ([idx, vote]) => ({ stop_idx: Number(idx), vote }),
      ),
      skip_stop_idx: 'skip_stop_idx' in patch ? patch.skip_stop_idx : skipIdx,
      would_do: 'would_do' in patch ? patch.would_do : wouldDo,
    };
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itinerary_id: itineraryId,
          source,
          ...merged,
        }),
      });
    } catch (err) {
      console.error('feedback failed', err);
    }
  }

  function voteStop(idx: number, vote: 'up' | 'down') {
    const next = { ...stopVotes, [idx]: vote };
    setStopVotes(next);
    persist({ stop_votes: next });
  }

  function pickSkip(idx: number) {
    const next = skipIdx === idx ? null : idx;
    setSkipIdx(next);
    persist({ skip_stop_idx: next });
  }

  function pickWouldDo(value: WouldDo) {
    setWouldDo(value);
    setThanks(true);
    persist({ would_do: value });
  }

  return (
    <div className="rounded-card border border-border bg-surface p-6 md:p-8">
      <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-muted">
        Quick pulse — helps us learn
      </p>
      <h3 className="font-display text-xl font-semibold leading-tight tracking-[-0.01em] text-text md:text-2xl">
        Would you actually do this?
      </h3>
      <p className="mt-2 text-sm text-secondary">
        One tap. We don’t store anything that ties this to you.
      </p>

      {/* Headline question */}
      <div className="mt-5 flex flex-wrap gap-2.5">
        {([
          { v: 'yes',   label: 'Yes' },
          { v: 'maybe', label: 'Maybe' },
          { v: 'no',    label: 'Not really' },
        ] as { v: WouldDo; label: string }[]).map(({ v, label }) => (
          <button
            key={v}
            type="button"
            onClick={() => pickWouldDo(v)}
            className={cn(
              'rounded-pill border px-5 py-2.5 text-sm transition-colors',
              wouldDo === v
                ? 'border-text bg-text text-background'
                : 'border-border text-secondary hover:border-text/40 hover:text-text',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Per-stop thumbs */}
      {stops.length > 0 && (
        <div className="mt-7">
          <p className="mb-2.5 text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Per stop
          </p>
          <div className="space-y-2">
            {stops.map((s, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-4 rounded-card border border-border bg-background px-4 py-2.5"
              >
                <span className="truncate text-sm text-text">{s.place_name}</span>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => voteStop(i, 'up')}
                    aria-label={`Like ${s.place_name}`}
                    className={cn(
                      'inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm transition-colors',
                      stopVotes[i] === 'up'
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-border text-muted hover:border-text/40 hover:text-text',
                    )}
                  >
                    <ThumbsUp className="h-4 w-4" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    onClick={() => voteStop(i, 'down')}
                    aria-label={`Dislike ${s.place_name}`}
                    className={cn(
                      'inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm transition-colors',
                      stopVotes[i] === 'down'
                        ? 'border-accent bg-accent text-background'
                        : 'border-border text-muted hover:border-text/40 hover:text-text',
                    )}
                  >
                    <ThumbsDown className="h-4 w-4" strokeWidth={2} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* "Which would you skip?" */}
      {stops.length >= 2 && (
        <div className="mt-7">
          <p className="mb-2.5 text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Which stop would you skip?
          </p>
          <div className="flex flex-wrap gap-2">
            {stops.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => pickSkip(i)}
                className={cn(
                  'rounded-pill border px-3 py-1.5 text-xs transition-colors',
                  skipIdx === i
                    ? 'border-accent bg-accent-soft text-text'
                    : 'border-border text-muted hover:border-text/40 hover:text-text',
                )}
              >
                {s.place_name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => pickSkip(-1)}
              className={cn(
                'rounded-pill border px-3 py-1.5 text-xs transition-colors',
                skipIdx === -1
                  ? 'border-text bg-text text-background'
                  : 'border-border text-muted hover:border-text/40 hover:text-text',
              )}
            >
              None — keep all
            </button>
          </div>
        </div>
      )}

      {thanks && (
        <p className="mt-6 text-sm text-emerald-700">
          Thanks. This is exactly what we need to make these better.
        </p>
      )}
    </div>
  );
}
