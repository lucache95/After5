'use client';

// Phase 3: end-to-end plan flow.
// 5 questions → call generate-plan Edge Function → 3 itinerary cards → detail.
// Single client component for now; split into smaller files when adding tests.

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ArrowLeft, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/cn';
import { track } from '@/app/PostHogProvider';
import { ItineraryView } from '@/components/itinerary/ItineraryView';
import { ChooserCards } from '@/components/itinerary/ChooserCards';
import type { Itinerary, Stop } from '@/lib/itinerary-types';

const ALLOWED_VIBES = new Set(['romantic', 'chill', 'adventurous', 'boujee', 'cozy', 'spontaneous', 'free']);
function vibeFromUrl(raw: string | null): string[] {
  if (!raw) return [];
  // 'free' isn't a vibe in our DB (it's a budget filter) — translate to chill
  if (raw === 'free') return ['chill'];
  return ALLOWED_VIBES.has(raw) ? [raw] : [];
}
function budgetFromUrl(raw: string | null): number {
  if (raw === 'free') return 0;
  return 50;
}
function startStepFromUrl(raw: string | null): number {
  // If user came in with a vibe pre-filled, jump past the first 2 steps
  return raw && ALLOWED_VIBES.has(raw) ? 4 : 1;
}

// ─── Types & options ─────────────────────────────────────────────────

type Occasion = 'date' | 'solo' | 'friends';
type Effort = 'low' | 'moderate' | 'high';

interface Inputs {
  occasion: Occasion;
  duration_min: number;
  budget_per_person: number;
  vibe: string[];
  must_includes: string[];
  drive_tolerance_min: number;
  effort: Effort;
}

const OCCASIONS: { id: Occasion; label: string; sub: string }[] = [
  { id: 'date',    label: 'Date',    sub: 'Just the two of you'    },
  { id: 'solo',    label: 'Solo',    sub: 'A day for yourself'     },
  { id: 'friends', label: 'Friends', sub: 'Three or more'          },
];

const DURATIONS = [
  { min: 120, label: '2 hr',       sub: 'Quick'        },
  { min: 180, label: '3 hr',       sub: 'Standard'     },
  { min: 240, label: '4 hr',       sub: 'Long evening' },
  { min: 360, label: 'Half day',   sub: '6 hr'         },
  { min: 600, label: 'Full day',   sub: '10 hr'        },
];

const VIBES = [
  'romantic', 'chill', 'adventurous', 'boujee', 'cozy', 'spontaneous',
];

const BUDGET_ANCHORS = [
  { value: 0,   label: '$0'   },
  { value: 25,  label: '$25'  },
  { value: 50,  label: '$50'  },
  { value: 100, label: '$100' },
  { value: 200, label: '$200' },
];

const EFFORTS: { id: Effort; label: string; sub: string }[] = [
  { id: 'low',      label: 'Low effort',   sub: 'Walkable, no reservations'  },
  { id: 'moderate', label: 'Some planning', sub: 'A reservation or two'      },
  { id: 'high',     label: 'Make it count', sub: 'Worth the organizing'      },
];

const MUST_INCLUDES = [
  'food', 'drinks', 'walk', 'view', 'activity', 'dessert', 'hidden_gem', 'lake', 'outdoors', 'indoors',
];

// ─── Page ────────────────────────────────────────────────────────────

type Phase = 'inputs' | 'loading' | 'results' | 'error';

const TOTAL_STEPS = 5;

export default function PlanPage() {
  return (
    <Suspense fallback={null}>
      <PlanFlow />
    </Suspense>
  );
}

function PlanFlow() {
  const searchParams = useSearchParams();
  const vibeParam = searchParams.get('vibe');

  const [phase, setPhase] = useState<Phase>('inputs');
  const [step, setStep] = useState(() => startStepFromUrl(vibeParam));
  const [inputs, setInputs] = useState<Inputs>({
    occasion: 'date',
    duration_min: 180,
    budget_per_person: budgetFromUrl(vibeParam),
    vibe: vibeFromUrl(vibeParam),
    must_includes: [],
    drive_tolerance_min: 20,
    effort: 'low',
  });
  const [results, setResults] = useState<Itinerary[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  // Analytics: fire plan_started once when the flow first mounts
  useEffect(() => {
    track.planStarted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Analytics: fire plan_step_advanced when step changes
  useEffect(() => {
    if (phase === 'inputs') track.planStepAdvanced(step);
  }, [step, phase]);

  const canAdvance = (): boolean => {
    if (step === 3) return inputs.vibe.length >= 1;
    return true;
  };

  const next = () => {
    if (!canAdvance()) return;
    if (step < TOTAL_STEPS) setStep(step + 1);
    else generate();
  };
  const back = () => { if (step > 1) setStep(step - 1); };

  const generate = async () => {
    setPhase('loading');
    setErrorMsg('');
    try {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke<{ itineraries: Itinerary[] }>(
        'generate-plan',
        { body: inputs }
      );
      if (error) throw error;
      if (!data?.itineraries?.length) throw new Error('No itineraries returned');
      setResults(data.itineraries);
      setActiveIdx(0);
      setPhase('results');
      data.itineraries.forEach((it) =>
        track.planGenerated({
          template_id: it.template_id,
          vibe: inputs.vibe,
          budget: inputs.budget_per_person,
        })
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong.';
      setErrorMsg(msg);
      setPhase('error');
    }
  };

  return (
    <main className="min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-[2px]">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-5 md:px-10">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-text"
          >
            After5
          </Link>
          {phase === 'inputs' && (
            <span className="text-xs text-muted [font-variant-numeric:tabular-nums]">
              {step} / {TOTAL_STEPS}
            </span>
          )}
        </nav>
      </header>

      {phase === 'inputs' && (
        <InputsView
          step={step}
          inputs={inputs}
          setInputs={setInputs}
          onNext={next}
          onBack={back}
          canAdvance={canAdvance()}
        />
      )}

      {phase === 'loading' && <LoadingView />}

      {phase === 'results' && (
        <ResultsView
          itineraries={results}
          activeIdx={activeIdx}
          setActiveIdx={setActiveIdx}
          onRedo={() => { setPhase('inputs'); setStep(1); }}
        />
      )}

      {phase === 'error' && (
        <ErrorView
          message={errorMsg}
          onBack={() => setPhase('inputs')}
          onRetry={generate}
        />
      )}
    </main>
  );
}

// ─── Inputs view ─────────────────────────────────────────────────────

function InputsView(props: {
  step: number;
  inputs: Inputs;
  setInputs: React.Dispatch<React.SetStateAction<Inputs>>;
  onNext: () => void;
  onBack: () => void;
  canAdvance: boolean;
}) {
  const { step, inputs, setInputs, onNext, onBack, canAdvance } = props;

  return (
    <div className="mx-auto max-w-content px-6 py-12 md:px-10 md:py-20">
      {/* Progress dots */}
      <div className="mb-12 flex gap-2">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-pill transition-colors',
              i + 1 <= step ? 'bg-text' : 'bg-border'
            )}
          />
        ))}
      </div>

      <div className="max-w-2xl">
        {step === 1 && (
          <Step
            eyebrow="Step 1"
            title="Who's this for?"
            sub="Pick the occasion. Date is the most polished today; solo and friends are getting better every week."
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {OCCASIONS.map((o) => (
                <Choice
                  key={o.id}
                  selected={inputs.occasion === o.id}
                  onClick={() => setInputs((s) => ({ ...s, occasion: o.id }))}
                  label={o.label}
                  sub={o.sub}
                />
              ))}
            </div>
          </Step>
        )}

        {step === 2 && (
          <Step
            eyebrow="Step 2"
            title="How long?"
            sub="We'll pace the plan to fit. Drive time is included."
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {DURATIONS.map((d) => (
                <Choice
                  key={d.min}
                  selected={inputs.duration_min === d.min}
                  onClick={() => setInputs((s) => ({ ...s, duration_min: d.min }))}
                  label={d.label}
                  sub={d.sub}
                />
              ))}
            </div>
          </Step>
        )}

        {step === 3 && (
          <Step
            eyebrow="Step 3"
            title="What's the vibe?"
            sub="Pick one or two. The more specific you are, the sharper the plan."
          >
            <div className="flex flex-wrap gap-3">
              {VIBES.map((v) => {
                const on = inputs.vibe.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setInputs((s) => ({
                      ...s,
                      vibe: on ? s.vibe.filter((x) => x !== v) : (s.vibe.length < 3 ? [...s.vibe, v] : s.vibe),
                    }))}
                    className={cn(
                      'rounded-pill border px-5 py-2.5 text-base transition-colors',
                      on
                        ? 'border-text bg-text text-background'
                        : 'border-border text-secondary hover:border-text/40 hover:text-text'
                    )}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
            <p className="mt-6 text-sm text-muted">
              {inputs.vibe.length === 0 ? 'Pick at least one.' : `${inputs.vibe.length} of 3 picked.`}
            </p>
          </Step>
        )}

        {step === 4 && (
          <Step
            eyebrow="Step 4"
            title="Per-person budget?"
            sub="Slide for what you'd happily spend each. We respect it."
          >
            <div className="rounded-card border border-border bg-surface p-7 md:p-9">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-4xl font-bold text-text [font-variant-numeric:tabular-nums]">
                  ${inputs.budget_per_person}
                </span>
                <span className="text-sm text-muted">per person</span>
              </div>
              <input
                type="range"
                min={0}
                max={300}
                step={5}
                value={inputs.budget_per_person}
                onChange={(e) => setInputs((s) => ({ ...s, budget_per_person: Number(e.target.value) }))}
                className="mt-8 w-full accent-accent"
              />
              <div className="mt-3 flex justify-between text-xs text-muted [font-variant-numeric:tabular-nums]">
                {BUDGET_ANCHORS.map((a) => <span key={a.value}>{a.label}</span>)}
                <span>$300+</span>
              </div>
            </div>

            <div className="mt-10">
              <p className="mb-4 text-sm font-medium text-text">Effort level</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {EFFORTS.map((e) => (
                  <Choice
                    key={e.id}
                    selected={inputs.effort === e.id}
                    onClick={() => setInputs((s) => ({ ...s, effort: e.id }))}
                    label={e.label}
                    sub={e.sub}
                  />
                ))}
              </div>
            </div>
          </Step>
        )}

        {step === 5 && (
          <Step
            eyebrow="Step 5"
            title="What should it include?"
            sub="Optional. Pick anything that matters. Skip if you trust us."
          >
            <div className="flex flex-wrap gap-3">
              {MUST_INCLUDES.map((m) => {
                const on = inputs.must_includes.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setInputs((s) => ({
                      ...s,
                      must_includes: on
                        ? s.must_includes.filter((x) => x !== m)
                        : [...s.must_includes, m],
                    }))}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-pill border px-4 py-2 text-sm transition-colors',
                      on
                        ? 'border-text bg-text text-background'
                        : 'border-border text-secondary hover:border-text/40 hover:text-text'
                    )}
                  >
                    {on && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
                    {m.replace('_', ' ')}
                  </button>
                );
              })}
            </div>
          </Step>
        )}

        {/* Nav */}
        <div className="mt-16 flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            disabled={step === 1}
            className={cn(
              'inline-flex items-center gap-2 text-sm transition-opacity',
              step === 1 ? 'invisible' : 'text-secondary hover:text-text'
            )}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <button
            type="button"
            onClick={onNext}
            disabled={!canAdvance}
            className={cn(
              'inline-flex items-center gap-2 rounded-pill px-7 py-3.5 text-base font-medium transition-opacity',
              canAdvance
                ? 'bg-primary text-background hover:opacity-85'
                : 'bg-border text-muted cursor-not-allowed'
            )}
          >
            {step === TOTAL_STEPS ? 'Generate three plans' : 'Next'}
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Step(props: { eyebrow: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">{props.eyebrow}</p>
      <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
        {props.title}
      </h1>
      <p className="mt-4 max-w-prose text-base text-secondary">{props.sub}</p>
      <div className="mt-10">{props.children}</div>
    </div>
  );
}

function Choice(props: { selected: boolean; onClick: () => void; label: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        'group flex flex-col items-start rounded-card border p-5 text-left transition-colors',
        props.selected
          ? 'border-text bg-text text-background'
          : 'border-border bg-surface text-text hover:border-text/40'
      )}
    >
      <span className="text-base font-medium">{props.label}</span>
      <span className={cn('mt-1 text-sm', props.selected ? 'text-background/70' : 'text-secondary')}>
        {props.sub}
      </span>
    </button>
  );
}

// ─── Loading view ────────────────────────────────────────────────────
// Stepped status feed: each step ticks at calibrated timing matching the ~10s
// Edge Function call. The final step never auto-completes — it stays "active"
// until the parent flips phase from 'loading' to 'results', so a slow API
// never leaves the user staring at a fully-complete-but-still-spinning UI.

const LOAD_STEPS = [
  { label: 'Reading 50 Kelowna spots',         doneAt: 1500 },
  { label: 'Matching your vibe',                doneAt: 3500 },
  { label: 'Grouping by neighborhood',          doneAt: 6000 },
  { label: 'Writing your night',                doneAt: Infinity }, // hold until results land
] as const;

function LoadingView() {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setNow(Date.now() - start), 120);
    return () => clearInterval(id);
  }, []);

  // Determine the index of the currently-active step (first step not yet done)
  const activeIdx = LOAD_STEPS.findIndex((s) => now < s.doneAt);

  return (
    <div className="mx-auto flex max-w-content flex-col items-start px-6 py-32 md:px-10 md:py-44">
      <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
        Pulling it together
      </p>
      <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
        Building three plans for you.
      </h1>

      {/* Stepped status feed */}
      <ol className="mt-10 w-full max-w-xl space-y-4">
        {LOAD_STEPS.map((step, i) => {
          const isDone = now >= step.doneAt;
          const isActive = i === activeIdx;
          const isPending = !isDone && !isActive;
          return (
            <li
              key={step.label}
              className={cn(
                'flex items-center gap-4 text-base transition-opacity duration-300',
                isPending && 'opacity-40',
              )}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                {isDone ? (
                  <Check className="h-5 w-5 text-accent" strokeWidth={2.5} />
                ) : isActive ? (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
                  </span>
                ) : (
                  <span className="h-2 w-2 rounded-full border border-border" />
                )}
              </span>
              <span
                className={cn(
                  'transition-colors',
                  isDone && 'text-secondary',
                  isActive && 'text-text font-medium',
                  isPending && 'text-muted',
                )}
              >
                {step.label}
                {isActive && <span className="ml-1 inline-block animate-pulse">…</span>}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Skeleton cards beneath, so the eye has something to land on */}
      <div className="mt-14 grid w-full max-w-3xl grid-cols-1 gap-5 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-card border border-border bg-surface p-7 animate-pulse"
            style={{ animationDelay: `${i * 200}ms` }}
          >
            <div className="h-3 w-16 rounded bg-border" />
            <div className="mt-5 h-6 w-44 rounded bg-border" />
            <div className="mt-7 space-y-3 border-t border-border pt-5">
              <div className="h-3 w-3/4 rounded bg-border" />
              <div className="h-3 w-2/3 rounded bg-border" />
              <div className="h-3 w-3/5 rounded bg-border" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Results view ────────────────────────────────────────────────────

function ResultsView(props: {
  itineraries: Itinerary[];
  activeIdx: number;
  setActiveIdx: (i: number) => void;
  onRedo: () => void;
}) {
  const { itineraries, activeIdx, setActiveIdx, onRedo } = props;
  const active = itineraries[activeIdx];

  return (
    <>
      {/* Image-first chooser strip */}
      <div className="mx-auto max-w-content px-6 pb-10 pt-12 md:px-10 md:pb-12 md:pt-16">
        <div className="mb-8 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
            Three plans, your call
          </p>
          <button
            type="button"
            onClick={onRedo}
            className="text-sm text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
          >
            Try a different one
          </button>
        </div>
        <ChooserCards itineraries={itineraries} activeIdx={activeIdx} onPick={setActiveIdx} />
      </div>

      {/* Full rich detail view of the active pick */}
      {active && <ItineraryView itinerary={active} />}
    </>
  );
}

// ─── Error view ──────────────────────────────────────────────────────

function ErrorView(props: { message: string; onBack: () => void; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-content px-6 py-32 md:px-10 md:py-44">
      <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
        Something didn't land
      </p>
      <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
        We couldn't build a plan this time.
      </h1>
      <p className="mt-6 max-w-prose text-base text-secondary">{props.message}</p>
      <div className="mt-10 flex gap-6">
        <button
          type="button"
          onClick={props.onRetry}
          className="rounded-pill bg-primary px-7 py-3.5 text-base font-medium text-background transition-opacity hover:opacity-85"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={props.onBack}
          className="text-base text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
        >
          Change inputs
        </button>
      </div>
    </div>
  );
}
