'use client';

// Post-date feedback form — warm-cream brand, same language as /tell-us.
// Designed for 3-tap minimum: rate each stop + overall recommendation + submit.
// Works without auth (token in URL proves identity).

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ThumbsUp,
  ThumbsDown,
  SkipForward,
  RotateCcw,
  Heart,
  Check,
} from 'lucide-react';

interface StopInfo {
  place_id: string;
  place_name: string;
  place_type: string | null;
  photo_url: string | null;
  what_to_do: string | null;
}

type StopVote = 'up' | 'down' | 'skip' | null;

interface Props {
  token: string;
  itineraryId: string;
  dateTitle: string;
  coverImageUrl: string | null;
  stops: StopInfo[];
}

export function FeedbackForm({
  token,
  itineraryId,
  dateTitle,
  coverImageUrl,
  stops,
}: Props) {
  const [votes, setVotes] = useState<StopVote[]>(() => stops.map(() => null));
  const [goBack, setGoBack] = useState<(boolean | null)[]>(() =>
    stops.map(() => null),
  );
  const [stopNotes, setStopNotes] = useState<string[]>(() =>
    stops.map(() => ''),
  );
  const [wouldRecommend, setWouldRecommend] = useState<
    'yes' | 'maybe' | 'no' | null
  >(null);
  const [overallNotes, setOverallNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setVote(idx: number, vote: StopVote) {
    setVotes((v) => {
      const next = [...v];
      next[idx] = next[idx] === vote ? null : vote;
      return next;
    });
  }

  function setGoBackAt(idx: number, val: boolean) {
    setGoBack((g) => {
      const next = [...g];
      next[idx] = next[idx] === val ? null : val;
      return next;
    });
  }

  function setNoteAt(idx: number, val: string) {
    setStopNotes((n) => {
      const next = [...n];
      next[idx] = val;
      return next;
    });
  }

  const hasAnyVote =
    votes.some((v) => v !== null) || wouldRecommend !== null;

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const stopVotesPayload = votes
      .map((vote, idx) => {
        if (!vote) return null;
        return {
          stop_idx: idx,
          vote: vote === 'skip' ? ('skip' as const) : vote,
          go_back:
            vote !== 'skip' ? goBack[idx] ?? undefined : undefined,
          note: stopNotes[idx]?.trim() || undefined,
        };
      })
      .filter(Boolean);

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itinerary_id: itineraryId,
          token,
          source: 'post_date_email',
          stop_votes: stopVotesPayload,
          would_do: wouldRecommend,
          notes: overallNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'already_submitted') {
          setError('You\u2019ve already submitted feedback for this date.');
        } else if (data.error === 'token_expired') {
          setError('This feedback link has expired.');
        } else if (data.error === 'rate_limited') {
          setError('Too many submissions. Please try again later.');
        } else {
          throw new Error('failed');
        }
        return;
      }
      setDone(true);
    } catch {
      setError('Something went wrong. Try again?');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return <ThankYou dateTitle={dateTitle} />;
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      {/* Background blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-gradient-to-br from-amber-200/45 via-orange-200/25 to-transparent blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-[560px] w-[560px] rounded-full bg-gradient-to-tl from-rose-200/45 via-amber-100/25 to-transparent blur-3xl" />
      </div>

      <header className="relative z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4 md:px-10 md:py-5">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-text"
          >
            After5
          </Link>
        </nav>
      </header>

      <div className="relative z-10 mx-auto max-w-2xl px-6 pb-24 pt-10 md:px-10 md:pb-32 md:pt-16">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
          Post-date review
        </p>
        <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
          How was{' '}
          <em className="font-semibold not-italic text-accent" style={{ fontStyle: 'italic' }}>
            {dateTitle}
          </em>
          ?
        </h1>
        <p className="mt-4 max-w-prose text-base leading-relaxed text-secondary">
          Rate each stop, skip any you didn&apos;t visit. Takes about 30 seconds.
        </p>

        {/* Cover image */}
        {coverImageUrl && (
          <div className="mt-8 overflow-hidden rounded-[14px] border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverImageUrl}
              alt={dateTitle}
              className="w-full object-cover"
              style={{ maxHeight: 220 }}
            />
          </div>
        )}

        {/* Stop cards */}
        <div className="mt-10 space-y-6">
          {stops.map((stop, idx) => (
            <StopCard
              key={stop.place_id || `stop-${idx}`}
              stop={stop}
              idx={idx}
              vote={votes[idx]}
              goBackVal={goBack[idx]}
              note={stopNotes[idx]}
              onVote={(v) => setVote(idx, v)}
              onGoBack={(v) => setGoBackAt(idx, v)}
              onNote={(v) => setNoteAt(idx, v)}
            />
          ))}
        </div>

        {/* Overall recommendation */}
        <div className="mt-10 rounded-[16px] border border-border bg-white/90 p-6 backdrop-blur-md md:p-8">
          <h2 className="font-display text-lg font-bold tracking-[-0.01em] text-text">
            Would you recommend this date?
          </h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {(['yes', 'maybe', 'no'] as const).map((val) => (
              <button
                key={val}
                type="button"
                onClick={() =>
                  setWouldRecommend(wouldRecommend === val ? null : val)
                }
                className={`rounded-pill border px-5 py-2.5 text-sm font-medium transition-all ${
                  wouldRecommend === val
                    ? val === 'yes'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                      : val === 'maybe'
                        ? 'border-amber-300 bg-amber-50 text-amber-900'
                        : 'border-rose-300 bg-rose-50 text-rose-900'
                    : 'border-border bg-background text-secondary hover:border-muted hover:text-text'
                }`}
              >
                {val === 'yes' && '👍 Definitely'}
                {val === 'maybe' && '🤷 Maybe'}
                {val === 'no' && '👎 Nah'}
              </button>
            ))}
          </div>

          <label className="mt-6 block">
            <span className="block text-xs font-medium text-secondary">
              Anything else? <span className="text-muted">(optional)</span>
            </span>
            <textarea
              value={overallNotes}
              onChange={(e) => setOverallNotes(e.target.value)}
              placeholder="What made the night great? What would you change?"
              rows={3}
              maxLength={500}
              className="mt-1.5 w-full resize-y rounded-card border border-border bg-background p-3 text-sm text-text outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/30"
            />
          </label>
        </div>

        {/* Submit */}
        {error && (
          <p className="mt-6 rounded-card border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {error}
          </p>
        )}

        <div className="mt-8 flex items-center justify-between gap-4">
          <p className="text-xs text-muted">
            Your feedback makes future dates better.
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={!hasAnyVote || submitting}
            className="inline-flex items-center gap-2 rounded-pill bg-text px-7 py-3 text-sm font-medium text-background transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? 'Sending...' : 'Submit review'}
            <Check className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </main>
  );
}

function StopCard({
  stop,
  idx,
  vote,
  goBackVal,
  note,
  onVote,
  onGoBack,
  onNote,
}: {
  stop: StopInfo;
  idx: number;
  vote: StopVote;
  goBackVal: boolean | null;
  note: string;
  onVote: (v: StopVote) => void;
  onGoBack: (v: boolean) => void;
  onNote: (v: string) => void;
}) {
  const isSkipped = vote === 'skip';

  return (
    <div
      className={`rounded-[16px] border bg-white/90 backdrop-blur-md transition-all ${
        isSkipped
          ? 'border-border/50 opacity-60'
          : 'border-border'
      } p-5 md:p-6`}
    >
      <div className="flex items-start gap-4">
        {/* Stop number badge */}
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface text-xs font-bold text-text">
          {idx + 1}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-base font-bold tracking-[-0.01em] text-text md:text-lg">
            {stop.place_name}
          </h3>
          {stop.what_to_do && !isSkipped && (
            <p className="mt-1 text-sm text-secondary line-clamp-2">
              {stop.what_to_do}
            </p>
          )}
        </div>
      </div>

      {/* Vote buttons */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <VoteButton
          active={vote === 'up'}
          onClick={() => onVote('up')}
          variant="up"
          label="Great"
        />
        <VoteButton
          active={vote === 'down'}
          onClick={() => onVote('down')}
          variant="down"
          label="Not great"
        />
        <button
          type="button"
          onClick={() => onVote('skip')}
          className={`inline-flex items-center gap-1.5 rounded-pill border px-4 py-2 text-xs font-medium transition-all ${
            isSkipped
              ? 'border-muted/50 bg-muted/10 text-muted'
              : 'border-border bg-background text-muted hover:border-muted hover:text-secondary'
          }`}
        >
          <SkipForward className="h-3.5 w-3.5" strokeWidth={2} />
          Didn&apos;t visit
        </button>
      </div>

      {/* Go-back + note (only shown if voted up or down) */}
      {(vote === 'up' || vote === 'down') && (
        <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
          <div>
            <span className="text-xs font-medium text-secondary">
              Would you go back?
            </span>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onGoBack(true)}
                className={`inline-flex items-center gap-1.5 rounded-pill border px-4 py-1.5 text-xs font-medium transition-all ${
                  goBackVal === true
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-border bg-background text-secondary hover:border-muted'
                }`}
              >
                <RotateCcw className="h-3 w-3" strokeWidth={2} />
                Yes
              </button>
              <button
                type="button"
                onClick={() => onGoBack(false)}
                className={`inline-flex items-center gap-1.5 rounded-pill border px-4 py-1.5 text-xs font-medium transition-all ${
                  goBackVal === false
                    ? 'border-rose-300 bg-rose-50 text-rose-800'
                    : 'border-border bg-background text-secondary hover:border-muted'
                }`}
              >
                No
              </button>
            </div>
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder={
              vote === 'up'
                ? 'What made it great? (optional)'
                : 'What went wrong? (optional)'
            }
            maxLength={200}
            className="w-full border-b border-border/60 bg-transparent pb-1.5 text-xs text-text outline-none transition-colors placeholder:text-muted focus:border-accent"
          />
        </div>
      )}
    </div>
  );
}

function VoteButton({
  active,
  onClick,
  variant,
  label,
}: {
  active: boolean;
  onClick: () => void;
  variant: 'up' | 'down';
  label: string;
}) {
  const Icon = variant === 'up' ? ThumbsUp : ThumbsDown;
  const activeClass =
    variant === 'up'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
      : 'border-rose-300 bg-rose-50 text-rose-800';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-pill border px-4 py-2 text-xs font-medium transition-all ${
        active
          ? activeClass
          : 'border-border bg-background text-secondary hover:border-muted hover:text-text'
      }`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      {label}
    </button>
  );
}

function ThankYou({ dateTitle }: { dateTitle: string }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-gradient-to-br from-amber-200/45 via-orange-200/25 to-transparent blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-[560px] w-[560px] rounded-full bg-gradient-to-tl from-rose-200/45 via-amber-100/25 to-transparent blur-3xl" />
      </div>

      <header className="relative z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4 md:px-10 md:py-5">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-text"
          >
            After5
          </Link>
        </nav>
      </header>

      <div className="relative z-10 mx-auto max-w-2xl px-6 pb-24 pt-16 md:px-10 md:pb-32 md:pt-24">
        <div className="text-center">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-900 ring-2 ring-emerald-200">
            <Heart className="h-6 w-6" strokeWidth={2.25} />
          </div>
          <h1 className="mt-8 font-display text-4xl font-bold leading-tight tracking-[-0.02em] text-text md:text-5xl">
            Thanks for the{' '}
            <em
              className="font-display font-semibold not-italic text-accent"
              style={{ fontStyle: 'italic' }}
            >
              review
            </em>
            .
          </h1>
          <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-secondary md:text-lg">
            Your feedback on &ldquo;{dateTitle}&rdquo; makes future plans better
            for everyone in Kelowna. We appreciate it.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/create"
              className="inline-flex items-center gap-2 rounded-pill bg-text px-6 py-2.5 text-sm font-medium text-background transition-transform hover:-translate-y-0.5"
            >
              Plan your next date
              <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
            </Link>
            <Link
              href="/dates"
              className="rounded-pill border border-border bg-background px-6 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface"
            >
              Browse dates
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
