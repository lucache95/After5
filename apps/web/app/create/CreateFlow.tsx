'use client';

// M2 date-first landing — the fast funnel.
// A condensed single-screen input (vibe required + budget + time-of-day + city)
// → POST /api/create-plan → the active plan. Authed users see the full
// ItineraryView; anon users see the hero + stop 1 with the rest behind the
// BlurGateOverlay and an email-the-full-plan CTA. The blur-gate is enforced
// server-side, so the locked copy never reaches this component for anon.
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { ItineraryView } from '@/components/itinerary/ItineraryView';
import { StopCard } from '@/components/itinerary/StopCard';
import { BlurGateOverlay } from './BlurGateOverlay';
import { PublishToFeedButton } from './PublishToFeedButton';
import { ImproveControls } from './ImproveControls';
import { PolaroidLoader } from '@/components/create/PolaroidLoader';
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
  authed,
  cities,
  canPublish = false,
  prefillCityId = null,
  prefillCityName = null,
}: {
  initialCity: string;
  authed: boolean;
  cities: KnownCity[];
  canPublish?: boolean;
  /** The signed-in user's saved primary_city_id (Area 2), prefilled + changeable. */
  prefillCityId?: string | null;
  /** The saved city's display name, used to seed the picker. */
  prefillCityName?: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('input');
  const [vibe, setVibe] = useState<string[]>([]);
  const [budget, setBudget] = useState(50);
  const [timeOfDay, setTimeOfDay] = useState<'morning' | 'evening' | 'all_day'>('evening');
  // Returning authed users see their saved city prefilled; otherwise fall back to
  // the geo-seeded initial text. A curated re-pick re-POSTs (handled in pickCity).
  const [city, setCity] = useState(prefillCityName || initialCity);
  const [itineraries, setItineraries] = useState<GatedItinerary[]>([]);
  const [resultAuthed, setResultAuthed] = useState(authed);
  const [errorMsg, setErrorMsg] = useState('');

  const canGenerate = vibe.length >= 1 && city.trim().length >= 2 && phase !== 'loading';

  function toggleVibe(id: string) {
    setVibe((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  }

  // Tapping a curated chip seeds the city text always; for a signed-in user it
  // also writes their primary_city_id + warms the city (Area 2). The save is
  // fire-and-forget: a failure shows a quiet notice and NEVER blocks generation.
  function pickCity(c: KnownCity) {
    setCity(c.name);
    if (!authed) return;
    fetch('/api/profile/city', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cityId: c.id }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('city_save_failed');
      })
      .catch(() => {
        toast.error('couldn’t save your city — your date will still generate.');
      });
  }

  async function generate() {
    const cityText = city.trim();
    if (vibe.length === 0 || cityText.length < 2) return;
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
          city_query: cityText,
          occasion: 'date',
          duration_min: timeOfDay === 'all_day' ? 360 : 180,
        }),
      });
      if (!res.ok) throw new Error('generation_failed');
      const data: {
        itineraries: GatedItinerary[];
        authed: boolean;
        city: string;
      } = await res.json();
      if (!data.itineraries?.length) throw new Error('no_itineraries');
      // Generated nights land on the canvas (/plans/[id]/edit) — the converged
      // customization surface (#85 door 1 = door 2). Leave phase at 'loading'
      // so the polaroid loader stays up during navigation.
      if (data.authed && data.itineraries[0]?.id) {
        router.push(`/plans/${data.itineraries[0].id}/edit`);
        return;
      }
      setItineraries(data.itineraries);
      setResultAuthed(data.authed);
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
            firstNameCity={city.trim()}
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
            city={city}
            setCity={setCity}
            cities={cities}
            onPickCity={pickCity}
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
  city: string;
  setCity: (s: string) => void;
  cities: KnownCity[];
  onPickCity: (c: KnownCity) => void;
  canGenerate: boolean;
  loading: boolean;
  errorMsg: string;
  onGenerate: () => void;
}) {
  const { vibe, toggleVibe, budget, setBudget, timeOfDay, setTimeOfDay, city, setCity, cities, onPickCity, canGenerate, loading, errorMsg, onGenerate } = props;

  // While a night generates, take over the screen with the polaroid loader.
  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <PolaroidLoader city={city.trim() || 'your city'} />
      </div>
    );
  }

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

      {/* city — free text, geocoded edge-side. any city works. */}
      <p className="mt-9 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-ink/55">
        where?
      </p>
      <input
        type="text"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        placeholder="city, state"
        aria-label="city"
        autoComplete="address-level2"
        className="mt-3 block w-full rounded-pill border border-shell-ink/15 bg-shell-base px-5 py-3 font-body text-sm lowercase text-shell-ink outline-none transition-colors placeholder:text-shell-ink/35 focus:border-shell-accent"
      />
      {cities.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {cities.map((c) => {
            const on = city.trim().toLowerCase() === c.name.toLowerCase();
            return (
              <button
                key={c.slug}
                type="button"
                aria-pressed={on}
                onClick={() => onPickCity(c)}
                className={cn(
                  'rounded-pill border px-3.5 py-2 font-body text-xs lowercase transition-colors',
                  on
                    ? 'border-shell-accent bg-shell-accent text-white'
                    : 'border-shell-ink/15 bg-shell-base text-shell-ink/70 hover:border-shell-accent/50',
                )}
              >
                {c.name.toLowerCase()}
              </button>
            );
          })}
        </div>
      )}

      {errorMsg && (
        <p className="mt-6 rounded-3xl border border-shell-accent/30 bg-shell-pink px-4 py-3 font-body text-sm lowercase text-shell-ink">
          {errorMsg}
        </p>
      )}

      {/* CTA — neutral (not pale-pink) when disabled so it never reads as a
          low-contrast active button; a hint names what's still needed (F2). */}
      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        className={cn(
          'mt-10 w-full rounded-pill px-6 py-4 font-body text-base font-semibold lowercase transition',
          canGenerate
            ? 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-[0.98]'
            : 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35',
        )}
      >
        {loading ? 'building your night…' : 'make my date'}
      </button>
      {!canGenerate && !loading && (
        <p className="mt-3 text-center font-body text-xs lowercase text-shell-ink/55">
          {vibe.length < 1 ? 'pick a vibe to start' : 'add a city'}
        </p>
      )}
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
    return <AuthedResult active={active} canPublish={canPublish} onRedo={onRedo} />;
  }

  // Anon: hero + stop 1, then the locked region behind the overlay. The premium
  // copy is already stripped server-side, so there's nothing real underneath.
  const stop1 = active.stops[0];
  return <AnonTeaser active={active} stop1={stop1 ? asStop(stop1) : null} onRedo={onRedo} city={firstNameCity} />;
}

// Authed result: the full plan + the improve loop. Stops live in local state so
// a single-stop swap / NL tweak updates the rendered night in place (PLAN-02).
function AuthedResult({
  active,
  canPublish,
  onRedo,
}: {
  active: GatedItinerary;
  canPublish: boolean;
  onRedo: () => void;
}) {
  const [stops, setStops] = useState<Stop[]>(active.stops.map(asStop));
  const full = { ...active, stops } as unknown as Itinerary;

  return (
    <div>
      <BackBar onRedo={onRedo} />
      <ItineraryView itinerary={full} />
      {active.id && (
        <>
          <ImproveControls
            itineraryId={active.id}
            stops={stops}
            onUpdated={setStops}
          />
          <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <p className="font-body text-sm lowercase text-shell-ink/70">
              want someone to actually go on it?
            </p>
            <PublishToFeedButton
              itineraryId={active.id}
              canPublish={canPublish}
              startsAt={defaultStartsAt()}
            />
            {/* #85 — converge door 1 onto the same §2A canvas door 2 uses, so the host
                can reshape the generated night before posting. */}
            <Link
              href={`/plans/${active.id}/edit`}
              className="font-body text-sm lowercase text-shell-ink/60 underline decoration-shell-ink/25 underline-offset-4 transition hover:text-shell-ink"
            >
              or tweak it on the canvas first
            </Link>
          </div>
        </>
      )}
    </div>
  );
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
