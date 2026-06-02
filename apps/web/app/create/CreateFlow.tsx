'use client';

// M2 date-first landing — the fast funnel.
// A condensed single-screen input (vibe required + budget + time-of-day + city)
// → POST /api/create-plan → the active plan. Authed users see the full
// ItineraryView; anon users see the hero + stop 1 with the rest behind the
// BlurGateOverlay and an email-the-full-plan CTA. The blur-gate is enforced
// server-side, so the locked copy never reaches this component for anon.
import { useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { ItineraryView } from '@/components/itinerary/ItineraryView';
import { StopCard } from '@/components/itinerary/StopCard';
import { BlurGateOverlay } from './BlurGateOverlay';
import { PublishToFeedButton } from './PublishToFeedButton';
import type { GatedItinerary } from '@/lib/create/blur-gate';
import type { KnownCity } from '@/lib/create/cities';
import type { Itinerary, Stop } from '@/lib/itinerary-types';

// The fast-funnel vibe set. Lowercase, emoji-paired per the design system.
const VIBES: { id: string; label: string; emoji: string }[] = [
  { id: 'creative', label: 'creative', emoji: '✨' },
  { id: 'foodie', label: 'foodie', emoji: '🍝' },
  { id: 'romantic', label: 'romantic', emoji: '🌹' },
  { id: 'chill', label: 'chill', emoji: '🛋️' },
  { id: 'adventurous', label: 'adventurous', emoji: '🧗' },
  { id: 'boozy', label: 'boozy', emoji: '🍷' },
];

const BUDGETS = [
  { value: 25, label: '$25' },
  { value: 50, label: '$50' },
  { value: 100, label: '$100' },
  { value: 200, label: '$200' },
];

const TIMES: { id: 'morning' | 'evening' | 'all_day'; label: string }[] = [
  { id: 'morning', label: 'morning' },
  { id: 'evening', label: 'evening' },
  { id: 'all_day', label: 'all day' },
];

type Phase = 'input' | 'loading' | 'results';

// A locked GatedItinerary → a web Itinerary safe to render. For the anon teaser
// we only ever render stop 0 (always unlocked + complete), so a single cast is
// enough; locked stops never reach a StopCard.
function asStop(s: GatedItinerary['stops'][number]): Stop {
  return {
    place_id: s.place_id,
    place_name: s.place_name ?? '',
    place_slug: s.place_slug,
    place_type: s.place_type,
    start_time: s.start_time ?? '',
    duration_min: s.duration_min ?? 0,
    estimated_cost_pp: s.estimated_cost_pp ?? 0,
    what_to_do: s.what_to_do,
    photo_url: s.photo_url ?? null,
    address: s.address ?? null,
    neighborhood: s.neighborhood,
    lat: s.lat ?? null,
    lng: s.lng ?? null,
    local_insight: s.local_insight ?? null,
    reservation_url: s.reservation_url ?? null,
  };
}

export function CreateFlow({
  initialCity,
  fellBack,
  authed,
  cities,
  canPublish = false,
}: {
  initialCity: string;
  fellBack: boolean;
  authed: boolean;
  cities: KnownCity[];
  canPublish?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>('input');
  const [vibe, setVibe] = useState<string[]>([]);
  const [budget, setBudget] = useState(50);
  const [timeOfDay, setTimeOfDay] = useState<'morning' | 'evening' | 'all_day'>('evening');
  const [citySlug, setCitySlug] = useState(initialCity);
  const [showFallbackNote, setShowFallbackNote] = useState(fellBack);
  const [itineraries, setItineraries] = useState<GatedItinerary[]>([]);
  const [resultAuthed, setResultAuthed] = useState(authed);
  const [errorMsg, setErrorMsg] = useState('');

  const canGenerate = vibe.length >= 1 && phase !== 'loading';

  function toggleVibe(id: string) {
    setVibe((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  }

  async function generate() {
    if (vibe.length === 0) return;
    setPhase('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/create-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vibe,
          budget_per_person: budget,
          time_of_day: timeOfDay,
          city_slug: citySlug,
          occasion: 'date',
          duration_min: timeOfDay === 'all_day' ? 360 : 180,
        }),
      });
      if (!res.ok) throw new Error('generation_failed');
      const data: {
        itineraries: GatedItinerary[];
        authed: boolean;
        city: string;
        fellBack: boolean;
      } = await res.json();
      if (!data.itineraries?.length) throw new Error('no_itineraries');
      setItineraries(data.itineraries);
      setResultAuthed(data.authed);
      setShowFallbackNote(data.fellBack);
      setPhase('results');
    } catch {
      setErrorMsg('that one slipped away. try again?');
      setPhase('input');
    }
  }

  return (
    <main className="min-h-screen bg-shell-base">
      <div className="mx-auto w-full max-w-[480px] px-5 py-10">
        {phase === 'results' ? (
          <Results
            itineraries={itineraries}
            authed={resultAuthed}
            canPublish={canPublish}
            firstNameCity={citySlug}
            onRedo={() => setPhase('input')}
          />
        ) : (
          <InputScreen
            vibe={vibe}
            toggleVibe={toggleVibe}
            budget={budget}
            setBudget={setBudget}
            timeOfDay={timeOfDay}
            setTimeOfDay={setTimeOfDay}
            citySlug={citySlug}
            setCitySlug={setCitySlug}
            cities={cities}
            fellBack={showFallbackNote}
            canGenerate={canGenerate}
            loading={phase === 'loading'}
            errorMsg={errorMsg}
            onGenerate={generate}
          />
        )}
      </div>
    </main>
  );
}

function InputScreen(props: {
  vibe: string[];
  toggleVibe: (id: string) => void;
  budget: number;
  setBudget: (n: number) => void;
  timeOfDay: 'morning' | 'evening' | 'all_day';
  setTimeOfDay: (t: 'morning' | 'evening' | 'all_day') => void;
  citySlug: string;
  setCitySlug: (s: string) => void;
  cities: KnownCity[];
  fellBack: boolean;
  canGenerate: boolean;
  loading: boolean;
  errorMsg: string;
  onGenerate: () => void;
}) {
  const { vibe, toggleVibe, budget, setBudget, timeOfDay, setTimeOfDay, citySlug, setCitySlug, cities, fellBack, canGenerate, loading, errorMsg, onGenerate } = props;

  return (
    <div>
      <p className="font-body text-xs font-semibold lowercase tracking-[0.2em] text-shell-accent">
        build a date in 30 seconds
      </p>
      <h1 className="mt-2 font-heading text-4xl lowercase leading-[1.05] text-shell-ink">
        what&apos;s the <span className="text-shell-accent">vibe?</span>
      </h1>
      <p className="mt-3 font-body text-base lowercase text-shell-ink/70">
        pick at least one. we&apos;ll build the whole night around it.
      </p>

      {/* vibe pills — required */}
      <div className="mt-6 flex flex-wrap gap-2.5">
        {VIBES.map((v) => {
          const on = vibe.includes(v.id);
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggleVibe(v.id)}
              className={cn(
                'rounded-pill border px-4 py-2.5 font-body text-sm lowercase shadow-fun transition-colors',
                on
                  ? 'border-shell-accent bg-shell-accent text-white'
                  : 'border-shell-ink/15 bg-shell-base text-shell-ink hover:border-shell-accent/50',
              )}
            >
              <span className="mr-1 tracking-wide" aria-hidden>{v.emoji}</span>
              {v.label}
            </button>
          );
        })}
      </div>

      {/* budget */}
      <p className="mt-9 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-ink/55">
        budget per person
      </p>
      <div className="mt-3 flex flex-wrap gap-2.5">
        {BUDGETS.map((b) => (
          <button
            key={b.value}
            type="button"
            aria-pressed={budget === b.value}
            onClick={() => setBudget(b.value)}
            className={cn(
              'rounded-pill border px-4 py-2.5 font-body text-sm lowercase tabular-nums transition-colors',
              budget === b.value
                ? 'border-shell-ink bg-shell-ink text-shell-base'
                : 'border-shell-ink/15 bg-shell-base text-shell-ink hover:border-shell-ink/40',
            )}
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* time of day */}
      <p className="mt-9 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-ink/55">
        when?
      </p>
      <div className="mt-3 flex flex-wrap gap-2.5">
        {TIMES.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={timeOfDay === t.id}
            onClick={() => setTimeOfDay(t.id)}
            className={cn(
              'rounded-pill border px-4 py-2.5 font-body text-sm lowercase transition-colors',
              timeOfDay === t.id
                ? 'border-shell-ink bg-shell-ink text-shell-base'
                : 'border-shell-ink/15 bg-shell-base text-shell-ink hover:border-shell-ink/40',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* city selector */}
      <p className="mt-9 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-ink/55">
        where?
      </p>
      <select
        value={citySlug}
        onChange={(e) => setCitySlug(e.target.value)}
        aria-label="city"
        className="mt-3 block w-full rounded-pill border border-shell-ink/15 bg-shell-base px-5 py-3 font-body text-sm lowercase text-shell-ink outline-none transition-colors focus:border-shell-accent"
      >
        {cities.map((c) => (
          <option key={c.slug} value={c.slug}>{c.name.toLowerCase()}</option>
        ))}
      </select>
      {fellBack && (
        <p className="mt-3 rounded-3xl bg-shell-pink px-4 py-3 font-body text-sm lowercase text-shell-ink">
          we&apos;re only in kelowna right now — building you a kelowna night.
        </p>
      )}

      {errorMsg && (
        <p className="mt-6 rounded-3xl border border-shell-accent/30 bg-shell-pink px-4 py-3 font-body text-sm lowercase text-shell-ink">
          {errorMsg}
        </p>
      )}

      {/* CTA */}
      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        className="mt-10 w-full rounded-pill bg-shell-accent px-6 py-4 font-body text-base font-semibold lowercase text-white shadow-fun transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? 'building your night…' : 'make my date'}
      </button>
    </div>
  );
}

function Results({
  itineraries,
  authed,
  canPublish,
  firstNameCity,
  onRedo,
}: {
  itineraries: GatedItinerary[];
  authed: boolean;
  canPublish: boolean;
  firstNameCity: string;
  onRedo: () => void;
}) {
  const active = itineraries[0];
  if (!active) return null;

  // Authed: render the full ItineraryView (nothing is gated server-side).
  if (authed) {
    const full = { ...active, stops: active.stops.map(asStop) } as unknown as Itinerary;
    return (
      <div>
        <BackBar onRedo={onRedo} />
        <ItineraryView itinerary={full} />
        {active.id && (
          <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <p className="font-body text-sm lowercase text-shell-ink/70">
              want someone to actually go on it?
            </p>
            <PublishToFeedButton
              itineraryId={active.id}
              canPublish={canPublish}
              startsAt={defaultStartsAt()}
            />
          </div>
        )}
      </div>
    );
  }

  // Anon: hero + stop 1, then the locked region behind the overlay. The premium
  // copy is already stripped server-side, so there's nothing real underneath.
  const stop1 = active.stops[0];
  return <AnonTeaser active={active} stop1={stop1 ? asStop(stop1) : null} onRedo={onRedo} city={firstNameCity} />;
}

function AnonTeaser({
  active,
  stop1,
  onRedo,
  city,
}: {
  active: GatedItinerary;
  stop1: Stop | null;
  onRedo: () => void;
  city: string;
}) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const totalHr = Math.round((active.total_duration_min / 60) * 10) / 10;

  async function emailMePlan() {
    if (!emailValid) return;
    setSending(true);
    try {
      const res = await fetch('/api/email-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          first_name: firstName || null,
          city,
          itinerary: { ...active, stops: active.stops },
        }),
      });
      if (!res.ok) throw new Error('send_failed');
      setSent(true);
      toast.success('check your inbox — the full plan is on its way.');
    } catch {
      toast.error('couldn’t send it — try again?');
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <BackBar onRedo={onRedo} />

      {/* hero */}
      <header className="mt-2">
        {active.template_name && (
          <p className="mb-2 font-body text-[11px] font-medium lowercase tracking-[0.22em] text-shell-ink/55">
            {active.template_name.toLowerCase()}
          </p>
        )}
        <h1 className="font-heading text-4xl lowercase leading-[1.02] text-shell-ink">
          {active.title?.toLowerCase()}
        </h1>
        {active.hook && (
          <p className="mt-4 font-body text-lg leading-relaxed lowercase text-shell-ink/75">
            {active.hook}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 font-body text-sm lowercase text-shell-ink/70 tabular-nums">
          <span className="font-semibold text-shell-ink">${Math.round(active.total_cost_pp)}</span>
          <span className="text-shell-ink/30">·</span>
          <span>{totalHr} hr</span>
          <span className="text-shell-ink/30">·</span>
          <span>{active.stops.length} stops</span>
        </div>
      </header>

      {/* stop 1 — fully visible */}
      {stop1 && (
        <div className="mt-9">
          <p className="mb-4 font-body text-xs font-medium lowercase tracking-[0.18em] text-shell-ink/55">
            your first stop
          </p>
          <ol>
            <StopCard stop={stop1} index={0} isLast />
          </ol>
        </div>
      )}

      {/* locked region — silhouette shapes only, nothing real, under the veil */}
      {active.stops.length > 1 && (
        <div className="relative mt-9 min-h-[260px] overflow-hidden rounded-3xl">
          <div aria-hidden className="space-y-4 p-2">
            {active.stops.slice(1).map((s) => (
              <div
                key={s.place_id}
                className="flex items-center gap-4 rounded-3xl border border-shell-ink/10 bg-shell-pink/50 p-4"
              >
                <div className="h-16 w-16 shrink-0 rounded-2xl bg-shell-ink/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-2/3 rounded-pill bg-shell-ink/10" />
                  <div className="h-3 w-1/3 rounded-pill bg-shell-ink/10" />
                </div>
              </div>
            ))}
          </div>
          <BlurGateOverlay onUnlock={() => {
            document.getElementById('unlock')?.scrollIntoView({ behavior: 'smooth' });
          }} />
        </div>
      )}

      {/* email-the-full-plan CTA */}
      <section id="unlock" className="mt-10 scroll-mt-6 rounded-3xl border border-shell-ink/10 bg-shell-pink/60 p-6 shadow-fun">
        {sent ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            <p className="font-heading text-2xl lowercase text-shell-ink">it&apos;s in your inbox.</p>
            <p className="mt-2 font-body text-sm lowercase text-shell-ink/70">
              the full plan — every venue, the route, the why.
            </p>
          </motion.div>
        ) : (
          <>
            <p className="font-heading text-2xl lowercase leading-tight text-shell-ink">
              email me the full plan
            </p>
            <p className="mt-2 font-body text-sm lowercase text-shell-ink/70">
              every venue, the route, the local tips — sent as a pdf. no account needed.
            </p>
            <div className="mt-5 space-y-3">
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="first name (optional)"
                aria-label="first name"
                className="block w-full rounded-pill border border-shell-ink/15 bg-shell-base px-5 py-3 font-body text-sm lowercase text-shell-ink outline-none transition-colors focus:border-shell-accent"
              />
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                aria-label="email"
                className="block w-full rounded-pill border border-shell-ink/15 bg-shell-base px-5 py-3 font-body text-sm text-shell-ink outline-none transition-colors focus:border-shell-accent"
              />
              <button
                type="button"
                onClick={emailMePlan}
                disabled={!emailValid || sending}
                className="w-full rounded-pill bg-shell-accent px-6 py-4 font-body text-base font-semibold lowercase text-white shadow-fun transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending ? 'sending…' : 'send it →'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function BackBar({ onRedo }: { onRedo: () => void }) {
  return (
    <button
      type="button"
      onClick={onRedo}
      className="mb-6 inline-flex items-center gap-1.5 font-body text-sm lowercase text-shell-ink/70 underline decoration-shell-ink/20 underline-offset-4 transition-colors hover:text-shell-accent"
    >
      ← start over
    </button>
  );
}

// Default a meetup ~2 days out at 6pm local; the publish UX can refine later.
function defaultStartsAt(): string {
  const d = new Date(Date.now() + 2 * 86400000);
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
}
