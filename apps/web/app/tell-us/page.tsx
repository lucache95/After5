'use client';

// /tell-us — a contact form that intentionally doesn't feel like one.
// Two-step: pick a card (kind), then write the note on a "postcard" surface.
// Same warm-cream + polaroid brand language as /about, /roadmap, /login.

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Bug, Coffee, Lightbulb, MessageCircle, Send } from 'lucide-react';

type Kind = 'bug' | 'place_suggestion' | 'feature' | 'other';

interface KindCard {
  id: Kind;
  label: string;
  hook: string;
  icon: typeof Bug;
  tilt: number;
  bg: string;
}

const KINDS: KindCard[] = [
  {
    id: 'bug',
    label: 'Something broke',
    hook: 'A photo, a closed restaurant, a button that won\'t — tell me what cracked.',
    icon: Bug,
    tilt: -3,
    bg: 'bg-rose-50/90',
  },
  {
    id: 'place_suggestion',
    label: 'A spot we\'re missing',
    hook: 'A coffee shop, a hike, a cocktail bar — somewhere you\'d send a friend.',
    icon: Coffee,
    tilt: 2,
    bg: 'bg-amber-50/90',
  },
  {
    id: 'feature',
    label: 'A wish',
    hook: 'A feature you want, a date format we don\'t cover, a city to expand to.',
    icon: Lightbulb,
    tilt: -2,
    bg: 'bg-emerald-50/90',
  },
  {
    id: 'other',
    label: 'Just hi',
    hook: 'A note, a thought, a hello. The catch-all.',
    icon: MessageCircle,
    tilt: 3,
    bg: 'bg-violet-50/90',
  },
];

export default function TellUsPage() {
  const [kind, setKind] = useState<Kind | null>(null);
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = KINDS.find((k) => k.id === kind);
  const canSubmit = bodyText.trim().length >= 5 && !submitting;

  async function submit() {
    if (!kind || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/tell-us', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          subject: subject.trim() || null,
          body: bodyText.trim(),
          email: email.trim() || null,
          page_url: typeof window !== 'undefined' ? window.location.href : null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'failed');
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-gradient-to-br from-amber-200/45 via-orange-200/25 to-transparent blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-[560px] w-[560px] rounded-full bg-gradient-to-tl from-rose-200/45 via-amber-100/25 to-transparent blur-3xl" />
      </div>

      <header className="relative z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4 md:px-10 md:py-5">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight text-text">
            After5
          </Link>
        </nav>
      </header>

      <div className="relative z-10 mx-auto max-w-3xl px-6 pb-24 pt-12 md:px-10 md:pb-32 md:pt-20">
        {done ? (
          <ThankYou onReset={() => { setDone(false); setKind(null); setBodyText(''); setSubject(''); }} />
        ) : !kind ? (
          <PickKind onPick={setKind} />
        ) : (
          <Compose
            kindCard={active!}
            subject={subject}
            setSubject={setSubject}
            bodyText={bodyText}
            setBodyText={setBodyText}
            email={email}
            setEmail={setEmail}
            submitting={submitting}
            canSubmit={canSubmit}
            error={error}
            onBack={() => setKind(null)}
            onSubmit={submit}
          />
        )}
      </div>
    </main>
  );
}

function PickKind({ onPick }: { onPick: (k: Kind) => void }) {
  return (
    <>
      <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
        Tell us
      </p>
      <h1 className="font-display text-[44px] font-bold leading-[1.02] tracking-[-0.03em] text-text md:text-[64px]">
        What&apos;s on your{' '}
        <span className="italic font-semibold text-accent">mind</span>?
      </h1>
      <p className="mt-6 max-w-prose text-base leading-relaxed text-secondary md:text-lg">
        Pick a card. We read every note — same day, by a real person (me).
      </p>

      <div className="mt-12 grid grid-cols-1 gap-5 md:mt-16 md:grid-cols-2">
        {KINDS.map((k) => {
          const Icon = k.icon;
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => onPick(k.id)}
              className={`group relative rounded-[16px] border border-amber-100/80 ${k.bg} p-7 text-left backdrop-blur-md transition-transform duration-300 hover:-translate-y-1 hover:rotate-0 md:p-8`}
              style={{ transform: `rotate(${k.tilt}deg)` }}
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-text ring-1 ring-amber-100">
                <Icon className="h-5 w-5" strokeWidth={2} />
              </span>
              <h2 className="mt-5 font-display text-2xl font-bold leading-tight tracking-[-0.01em] text-text">
                {k.label}
              </h2>
              <p className="mt-3 text-[14px] leading-relaxed text-secondary">{k.hook}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-text">
                Tell us about it
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.25} />
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-12 text-center text-xs text-muted">
        Or just email{' '}
        <a href="mailto:hello@tryafter5.app" className="text-accent underline decoration-accent/40 underline-offset-[4px] hover:decoration-accent">
          hello@tryafter5.app
        </a>
      </p>
    </>
  );
}

function Compose({
  kindCard,
  subject,
  setSubject,
  bodyText,
  setBodyText,
  email,
  setEmail,
  submitting,
  canSubmit,
  error,
  onBack,
  onSubmit,
}: {
  kindCard: KindCard;
  subject: string;
  setSubject: (s: string) => void;
  bodyText: string;
  setBodyText: (s: string) => void;
  email: string;
  setEmail: (s: string) => void;
  submitting: boolean;
  canSubmit: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const Icon = kindCard.icon;
  const placeholder =
    kindCard.id === 'bug' ? 'What broke? Where? What were you trying to do?'
    : kindCard.id === 'place_suggestion' ? 'Name, neighbourhood, why it should be on After5...'
    : kindCard.id === 'feature' ? 'Describe the wish — bonus points for the use case.'
    : 'Whatever you want to say.';

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mb-8 inline-flex items-center gap-1.5 text-sm text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.25} />
        Pick a different card
      </button>

      {/* Postcard surface — bone-white card with a "stamp" + handwritten address line */}
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="relative rounded-[18px] border border-amber-100/80 bg-white/90 p-7 backdrop-blur-md md:p-10"
      >
        {/* Stamp */}
        <span
          aria-hidden
          className="absolute right-7 top-7 hidden h-20 w-16 flex-col items-center justify-center gap-1 rounded-[6px] border-2 border-dashed border-amber-300 bg-amber-50 text-[9px] font-bold uppercase tracking-[0.18em] text-amber-900 md:flex"
          style={{ transform: 'rotate(6deg)' }}
        >
          <Icon className="h-5 w-5" strokeWidth={2} />
          <span>To: Lucas</span>
        </span>

        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
          Re: {kindCard.label}
        </p>

        <label className="mt-6 block">
          <span className="block text-xs font-medium text-secondary">
            Subject <span className="text-muted">(optional)</span>
          </span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="One-line summary"
            maxLength={200}
            className="mt-1.5 w-full border-b border-border bg-transparent pb-2 text-base text-text outline-none transition-colors focus:border-accent"
          />
        </label>

        <label className="mt-7 block">
          <span className="block text-xs font-medium text-secondary">
            The note
          </span>
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder={placeholder}
            rows={8}
            maxLength={4000}
            required
            className="mt-1.5 w-full resize-y rounded-card border border-transparent bg-amber-50/40 p-4 font-display text-[17px] leading-relaxed text-text outline-none ring-1 ring-amber-100 transition-colors focus:border-accent focus:ring-accent/40"
            style={{
              backgroundImage:
                'repeating-linear-gradient(to bottom, transparent, transparent 26px, rgba(180, 130, 70, 0.18) 26px, rgba(180, 130, 70, 0.18) 27px)',
              lineHeight: '27px',
            }}
            autoFocus
          />
          <span className="mt-1 block text-[11px] text-muted [font-variant-numeric:tabular-nums]">
            {bodyText.length} / 4000
          </span>
        </label>

        <label className="mt-6 block">
          <span className="block text-xs font-medium text-secondary">
            Your email <span className="text-muted">(optional — only if you want a reply)</span>
          </span>
          <input
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1.5 w-full border-b border-border bg-transparent pb-2 text-base text-text outline-none transition-colors focus:border-accent"
          />
        </label>

        {error && (
          <p className="mt-5 rounded-card border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            Couldn&apos;t send — {error}. Try again or email hello@tryafter5.app.
          </p>
        )}

        <div className="mt-8 flex items-center justify-between gap-4">
          <p className="text-xs text-muted">
            Read same day. No newsletters, ever.
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-pill bg-text px-7 py-3 text-sm font-medium text-background transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? 'Sending…' : 'Drop in the mailbox'}
            <Send className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>
      </form>
    </>
  );
}

function ThankYou({ onReset }: { onReset: () => void }) {
  return (
    <div className="text-center">
      <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-900 ring-2 ring-emerald-200">
        <Send className="h-6 w-6" strokeWidth={2.25} />
      </div>
      <h1 className="mt-8 font-display text-4xl font-bold leading-tight tracking-[-0.02em] text-text md:text-5xl">
        On its <em className="font-display font-semibold not-italic text-accent" style={{ fontStyle: 'italic' }}>way</em>.
      </h1>
      <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-secondary md:text-lg">
        Thanks for the note. I read everything within a day or two — usually the same evening.
        If you left an email, I&apos;ll reply.
      </p>
      <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <button
          type="button"
          onClick={onReset}
          className="rounded-pill border border-border bg-background px-6 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface"
        >
          Send another
        </button>
        <Link
          href="/plan"
          className="inline-flex items-center gap-2 rounded-pill bg-text px-6 py-2.5 text-sm font-medium text-background transition-transform hover:-translate-y-0.5"
        >
          Back to planning
          <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
        </Link>
      </div>
    </div>
  );
}
