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
    label: 'something broke',
    hook: 'a photo, a closed spot, a button that won\'t — tell me what cracked.',
    icon: Bug,
    tilt: -3,
    bg: 'bg-rose-50/90',
  },
  {
    id: 'place_suggestion',
    label: 'a spot we\'re missing',
    hook: 'a coffee shop, a hike, a cocktail bar — somewhere you\'d send a friend.',
    icon: Coffee,
    tilt: 2,
    bg: 'bg-amber-50/90',
  },
  {
    id: 'feature',
    label: 'a wish',
    hook: 'a feature you want, a night format we don\'t cover, a city to add.',
    icon: Lightbulb,
    tilt: -2,
    bg: 'bg-emerald-50/90',
  },
  {
    id: 'other',
    label: 'just hi',
    hook: 'a note, a thought, a hello. the catch-all.',
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
    <main className="min-h-dvh bg-shell-base">
      <header className="border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-md">
        <nav className="mx-auto flex w-full max-w-[480px] items-center justify-between px-6 py-4">
          <Link href="/" className="font-heading text-xl lowercase tracking-tight text-shell-accent">
            after5
          </Link>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-[480px] px-6 pb-24 pt-12">
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
      <p className="mb-3 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-accent">
        tell us
      </p>
      <h1 className="font-heading text-4xl lowercase leading-[1.04] text-shell-ink md:text-5xl">
        what&apos;s on your mind?
      </h1>
      <p className="mt-5 font-body text-[15px] leading-relaxed text-shell-ink/70">
        pick a card. we read every note — same day, by a real person (me).
      </p>

      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {KINDS.map((k) => {
          const Icon = k.icon;
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => onPick(k.id)}
              className={`group relative rounded-3xl border-2 border-shell-ink/10 ${k.bg} p-7 text-left shadow-fun transition-transform duration-300 hover:-translate-y-1 hover:rotate-0`}
              style={{ transform: `rotate(${k.tilt}deg)` }}
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-shell-accent ring-1 ring-shell-ink/10">
                <Icon className="h-5 w-5" strokeWidth={2} />
              </span>
              <h2 className="mt-5 font-heading text-xl lowercase leading-tight text-shell-ink">
                {k.label}
              </h2>
              <p className="mt-3 font-body text-sm leading-relaxed text-shell-ink/65">{k.hook}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 font-body text-xs font-medium lowercase text-shell-ink">
                tell us about it
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.25} />
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-12 text-center font-body text-xs lowercase text-shell-ink/45">
        or just email{' '}
        <a href="mailto:hello@tryafter5.app" className="text-shell-accent underline decoration-shell-accent/40 underline-offset-4 hover:decoration-shell-accent">
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
    kindCard.id === 'bug' ? 'what broke? where? what were you trying to do?'
    : kindCard.id === 'place_suggestion' ? 'name, neighbourhood, why it should be on after5...'
    : kindCard.id === 'feature' ? 'describe the wish — bonus points for the use case.'
    : 'whatever you want to say.';

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mb-7 inline-flex items-center gap-1.5 font-body text-sm lowercase text-shell-ink/55 underline decoration-shell-ink/25 underline-offset-4 transition hover:text-shell-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.25} />
        pick a different card
      </button>

      {/* postcard surface — a white card with a "stamp" */}
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="relative rounded-3xl border-2 border-shell-ink/10 bg-white p-7 shadow-fun"
      >
        {/* stamp */}
        <span
          aria-hidden
          className="absolute right-7 top-7 hidden h-20 w-16 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-shell-accent/40 bg-shell-pink/50 font-body text-[9px] font-bold lowercase tracking-[0.12em] text-shell-accent sm:flex"
          style={{ transform: 'rotate(6deg)' }}
        >
          <Icon className="h-5 w-5" strokeWidth={2} />
          <span>to: lucas</span>
        </span>

        <p className="font-body text-[11px] font-semibold lowercase tracking-[0.18em] text-shell-accent">
          re: {kindCard.label}
        </p>

        <label className="mt-6 block">
          <span className="block font-body text-xs font-medium lowercase text-shell-ink/65">
            subject <span className="text-shell-ink/40">(optional)</span>
          </span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="one-line summary"
            maxLength={200}
            className="mt-1.5 w-full border-b-2 border-shell-ink/15 bg-transparent pb-2 font-body text-base text-shell-ink placeholder:text-shell-ink/40 outline-none transition-colors focus:border-shell-accent"
          />
        </label>

        <label className="mt-7 block">
          <span className="block font-body text-xs font-medium lowercase text-shell-ink/65">
            the note
          </span>
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder={placeholder}
            rows={8}
            maxLength={4000}
            required
            className="mt-1.5 w-full resize-y rounded-2xl border-2 border-shell-ink/10 bg-shell-pink/20 p-4 font-body text-[15px] leading-relaxed text-shell-ink placeholder:text-shell-ink/40 outline-none transition-colors focus:border-shell-accent focus:ring-4 focus:ring-shell-accent/20"
            autoFocus
          />
          <span className="mt-1 block font-body text-[11px] text-shell-ink/45 [font-variant-numeric:tabular-nums]">
            {bodyText.length} / 4000
          </span>
        </label>

        <label className="mt-6 block">
          <span className="block font-body text-xs font-medium lowercase text-shell-ink/65">
            your email <span className="text-shell-ink/40">(optional — only if you want a reply)</span>
          </span>
          <input
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1.5 w-full border-b-2 border-shell-ink/15 bg-transparent pb-2 font-body text-base text-shell-ink placeholder:text-shell-ink/40 outline-none transition-colors focus:border-shell-accent"
          />
        </label>

        {error && (
          <p className="mt-5 rounded-2xl border-2 border-shell-accent/30 bg-shell-pink/50 px-4 py-3 font-body text-sm lowercase text-shell-ink">
            couldn&apos;t send — {error}. try again or email hello@tryafter5.app.
          </p>
        )}

        <div className="mt-8 flex items-center justify-between gap-4">
          <p className="font-body text-xs lowercase text-shell-ink/45">
            read same day. no newsletters, ever.
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-full bg-shell-accent px-7 py-3 font-body text-sm font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'sending...' : 'send it'}
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
      <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-shell-pink text-shell-accent ring-2 ring-shell-accent/20">
        <Send className="h-6 w-6" strokeWidth={2.25} />
      </div>
      <h1 className="mt-8 font-heading text-4xl lowercase leading-tight text-shell-ink md:text-5xl">
        on its way
      </h1>
      <p className="mx-auto mt-5 max-w-[420px] font-body text-[15px] leading-relaxed text-shell-ink/70">
        thanks for the note. i read everything within a day or two — usually the same evening. if you left an email, i&apos;ll reply.
      </p>
      <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border-2 border-shell-ink/15 px-6 py-2.5 font-body text-sm font-semibold lowercase text-shell-ink transition hover:border-shell-ink/30 active:scale-95"
        >
          send another
        </button>
        <Link
          href="/create"
          className="inline-flex items-center gap-2 rounded-full bg-shell-accent px-6 py-2.5 font-body text-sm font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95"
        >
          back to planning
          <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
        </Link>
      </div>
    </div>
  );
}
