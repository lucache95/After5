'use client';

// Phase 3: end-to-end plan flow.
// 5 questions → call generate-plan Edge Function → 3 itinerary cards → detail.
// Single client component for now; split into smaller files when adding tests.

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ArrowLeft, Check, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/cn';
import { track } from '@/app/PostHogProvider';
import { ItineraryView } from '@/components/itinerary/ItineraryView';
import { ChooserCards } from '@/components/itinerary/ChooserCards';
import { RadiusMap } from '@/components/RadiusMap';
import { HintCard } from '@/components/HintCard';
import { FeedbackPulse } from '@/components/itinerary/FeedbackPulse';
import { hintsForStep } from '@/lib/plan-hints';
import { preflight, type TemplateLite } from '@/lib/preflight';
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

// One-line label that gives the radius slider a sense of place.
// 5km is roughly Knox Mountain to Pandosy — actual walking is more like 1-2km.
function radiusBlurb(km: number): string {
  if (km <= 5)  return 'Downtown + just outside the core';
  if (km <= 15) return 'Central Kelowna';
  if (km <= 25) return 'Most of Kelowna proper';
  if (km <= 40) return 'Includes West Kelowna + Lake Country';
  if (km <= 60) return 'Adds Peachland + Big White';
  if (km <= 80) return 'Reaches Vernon';
  return 'Wide net — full Okanagan';
}

// Supabase's FunctionsHttpError swallows the body; dig it out so the user
// sees "Not enough places match those filters" instead of "non-2xx status".
async function extractEdgeError(error: unknown): Promise<string> {
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.clone().json();
      if (typeof body?.message === 'string' && body.message.length > 0) {
        return body.message;
      }
      if (typeof body?.error === 'string') return body.error;
    }
  } catch {
    // fall through
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

// ─── Types & options ─────────────────────────────────────────────────

type Occasion = 'date' | 'solo' | 'friends';
type Effort = 'low' | 'moderate' | 'high';

type Pronouns = 'she/her' | 'he/him' | 'they/them' | '';

interface Inputs {
  occasion: Occasion;
  duration_min: number;
  budget_per_person: number;
  vibe: string[];
  must_includes: string[];
  drive_tolerance_min: number;
  max_radius_km: number;
  location: 'out' | 'home';
  effort: Effort;
  // Optional context. Date-only: who's going. All occasions: free-text note
  // that the LLM uses to tailor the "why this works" copy ("anniversary",
  // "vegetarian", "with my mom for her birthday"...).
  you_pronouns: Pronouns;
  partner_pronouns: Pronouns;
  note: string;
  // When the date is happening. "tonight" = hard hours filter + low-friction
  // bias. "future" = wider scope, reservations OK. future_date is ISO yyyy-mm-dd.
  when: 'tonight' | 'future';
  future_date: string;
  // Emotional goal — distinct from vibe (vibe = aesthetic, intent = why).
  // Empty = generic. Used as an LLM tone hint; scoring impact comes later.
  intent: 'impress' | 'chill' | 'reconnect' | 'try_something_new' | '';
}

const PRONOUN_OPTIONS: { id: Pronouns; label: string }[] = [
  { id: 'she/her',   label: 'She / her' },
  { id: 'he/him',    label: 'He / him' },
  { id: 'they/them', label: 'They / them' },
];

const INTENT_OPTIONS: { id: Inputs['intent']; label: string; sub: string }[] = [
  { id: 'impress',            label: 'Impress',           sub: 'You want this to land' },
  { id: 'chill',              label: 'Chill out',         sub: 'Low-key, no pressure' },
  { id: 'reconnect',          label: 'Reconnect',         sub: 'Real conversation, no distractions' },
  { id: 'try_something_new',  label: 'Try something new', sub: 'Spots you haven\u2019t been to' },
];

// Themes: preset bundles that fill multiple inputs at once. Each theme is a
// narrative ("Rom-com night", "Slow Sunday") rather than a vibe. Picking a
// theme jumps the user to step 5 with everything pre-filled — they can tweak
// must-haves or just hit Generate.
interface Theme {
  id: string;
  label: string;
  desc: string;
  preset: Partial<Inputs>;
}
const THEMES: Theme[] = [
  {
    id: 'first_date_safe',
    label: 'First date, safe play',
    desc: 'Coffee → walk → small dinner. Easy out, no pressure.',
    preset: { vibe: ['chill', 'romantic'], duration_min: 180, budget_per_person: 50, effort: 'low', must_includes: ['food'], intent: 'reconnect' },
  },
  {
    id: 'rom_com_night',
    label: 'Rom-com night',
    desc: 'Cozy at-home: dinner-in, slow movie, dessert.',
    preset: { vibe: ['cozy', 'romantic'], duration_min: 180, budget_per_person: 30, effort: 'low', location: 'home', must_includes: [], intent: 'chill' },
  },
  {
    id: 'main_character_day',
    label: 'Main character day',
    desc: 'Big day: hike, view, sunset wine, late dinner.',
    preset: { vibe: ['adventurous', 'boujee'], duration_min: 360, budget_per_person: 100, effort: 'moderate', must_includes: ['view', 'food'], intent: 'impress' },
  },
  {
    id: 'slow_sunday',
    label: 'Slow Sunday',
    desc: 'Brunch, lakeside walk, long lazy afternoon.',
    preset: { vibe: ['chill', 'cozy'], duration_min: 240, budget_per_person: 50, effort: 'low', must_includes: ['food'], intent: 'reconnect' },
  },
  {
    id: 'no_phones',
    label: 'No phones',
    desc: 'Activity-first, conversation-led, screens-down.',
    preset: { vibe: ['intimate', 'spontaneous'], duration_min: 180, budget_per_person: 60, effort: 'moderate', must_includes: ['activity'], intent: 'reconnect' },
  },
];

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

// Grouped for Step 5 UI. Items in the same "exclusive" group fight for the
// same template slot — we only let users pick one per exclusive group at the
// UI level so they don't over-constrain. Non-exclusive groups can stack freely.
const MUST_INCLUDE_GROUPS: { name: string; items: string[]; exclusive: boolean; hint?: string }[] = [
  { name: 'Food & drink',  items: ['food', 'drinks', 'dessert'],          exclusive: false },
  { name: 'Outdoors',      items: ['walk', 'view', 'lake', 'outdoors'],   exclusive: true,  hint: 'Pick one — they all need the outdoor slot.' },
  { name: 'Indoors',       items: ['indoors'],                            exclusive: false },
  { name: 'Other',         items: ['activity', 'hidden_gem'],             exclusive: false },
];

// ─── Page ────────────────────────────────────────────────────────────

type Phase = 'inputs' | 'loading' | 'gate' | 'results' | 'error';

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
    max_radius_km: 30,
    location: 'out',
    effort: 'low',
    you_pronouns: '',
    partner_pronouns: '',
    note: '',
    when: 'tonight',
    future_date: '',
    intent: '',
  });
  const [results, setResults] = useState<Itinerary[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [templates, setTemplates] = useState<TemplateLite[]>([]);

  // Pull active templates once on mount so we can preflight the user's
  // selections client-side and never ship them to the loader for nothing.
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('templates')
      .select('id, name, duration_min, suitable_for, vibe, slots')
      .eq('is_active', true)
      .then(({ data }) => {
        if (data) setTemplates(data as TemplateLite[]);
      });
  }, []);

  // Analytics: fire plan_started once when the flow first mounts
  useEffect(() => {
    track.planStarted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Analytics: fire plan_step_advanced when step changes
  useEffect(() => {
    if (phase === 'inputs') track.planStepAdvanced(step);
  }, [step, phase]);

  // Preflight against the loaded templates. If we KNOW the combo will fail,
  // surface a blocker on the relevant step + disable the next/generate button.
  const verdict = useMemo(
    () => preflight(inputs, templates, hintsForStep(step, inputs)),
    [inputs, templates, step],
  );
  const stepHints = hintsForStep(step, inputs);
  const stepBlocker = verdict.blocker?.step === step ? verdict.blocker : null;

  const canAdvance = (): boolean => {
    if (step === 3) return inputs.vibe.length >= 1;
    if (step === TOTAL_STEPS && verdict.blocker) return false;
    return true;
  };

  // Apply a theme preset, jump to step 5 (must-haves) so user can tweak.
  // The preset already covers vibe/duration/budget/effort/intent so the
  // intermediate steps are skipped — we just need the user to confirm or
  // adjust must-haves before generating.
  const applyTheme = (theme: Theme) => {
    setInputs((s) => ({ ...s, ...theme.preset } as Inputs));
    setStep(5);
  };

  // Surprise me: keep the user's occasion + when, randomize everything else,
  // submit immediately. The vibe/duration/budget/effort/must_includes are
  // all picked from sensible defaults so the plan is wild but not chaotic.
  const surpriseMe = () => {
    const VIBE_PALETTE = ['romantic', 'chill', 'adventurous', 'cozy', 'spontaneous'];
    const DURATION_POOL = [120, 180, 240];
    const BUDGET_POOL = [25, 50, 75, 100];
    const MUST_POOL: string[][] = [[], ['food'], ['drinks'], ['food', 'drinks'], ['walk', 'food'], ['view']];
    const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
    // 1-2 vibes for variety without over-constraining
    const vCount = Math.random() < 0.5 ? 1 : 2;
    const vibePool = [...VIBE_PALETTE];
    const vibe: string[] = [];
    for (let i = 0; i < vCount; i++) {
      const idx = Math.floor(Math.random() * vibePool.length);
      vibe.push(vibePool.splice(idx, 1)[0]);
    }
    const surprise: Inputs = {
      ...inputs,
      vibe,
      duration_min: pick(DURATION_POOL),
      budget_per_person: pick(BUDGET_POOL),
      must_includes: pick(MUST_POOL),
      effort: pick(['low', 'moderate']) as Effort,
      location: 'out',
      max_radius_km: pick([15, 30, 50]),
    };
    generate(surprise);
  };

  const next = () => {
    if (!canAdvance()) return;
    if (step < TOTAL_STEPS) setStep(step + 1);
    else generate();
  };
  const back = () => { if (step > 1) setStep(step - 1); };

  const generate = async (override?: Inputs) => {
    setPhase('loading');
    setErrorMsg('');
    const body = override ?? inputs;
    if (override) setInputs(override);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke<{ itineraries: Itinerary[] }>(
        'generate-plan',
        { body }
      );
      if (error) {
        // Supabase wraps HTTP !2xx as FunctionsHttpError; the real message
        // lives in error.context (a Response). Extract it so the user sees
        // "Not enough places match those filters" instead of a stack trace.
        const friendly = await extractEdgeError(error);
        throw new Error(friendly);
      }
      if (!data?.itineraries?.length) throw new Error('No itineraries returned');
      setResults(data.itineraries);
      setActiveIdx(0);
      // Email gate sits between generation and reveal — captures the lead while
      // the user is at peak excitement to see what we made for them.
      setPhase('gate');
      data.itineraries.forEach((it) =>
        track.planGenerated({
          template_id: it.template_id,
          vibe: body.vibe,
          budget: body.budget_per_person,
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
          stepHints={stepHints}
          stepBlocker={stepBlocker}
          onSurpriseMe={surpriseMe}
          onApplyTheme={applyTheme}
        />
      )}

      {phase === 'loading' && <LoadingView />}
      {phase === 'gate' && (
        <EmailGate
          itineraryId={results[0]?.id}
          itineraryIds={results.map((r) => r.id).filter((id): id is string => Boolean(id))}
          onContinue={() => setPhase('results')}
          onBack={() => { setPhase('inputs'); }}
        />
      )}

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
  stepHints: import('@/lib/plan-hints').Hint[];
  stepBlocker: { step: number; message: string } | null;
  onSurpriseMe: () => void;
  onApplyTheme: (theme: Theme) => void;
}) {
  const { step, inputs, setInputs, onNext, onBack, canAdvance, stepHints, stepBlocker, onSurpriseMe, onApplyTheme } = props;

  return (
    <div className="mx-auto max-w-content px-6 py-12 md:px-10 md:py-20">
      {/* Progress stepper — numbered circles, emerald = locked in, accent = active */}
      <div className="mb-12 flex items-center">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
          const n = i + 1;
          const isDone = n < step;
          const isActive = n === step;
          return (
            <div key={i} className="flex flex-1 items-center last:flex-none">
              <div
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-all duration-300 [font-variant-numeric:tabular-nums]',
                  isDone && 'bg-emerald-500 text-white shadow-sm',
                  isActive && 'bg-text text-background ring-4 ring-text/10 scale-110',
                  !isDone && !isActive && 'bg-background border border-border text-muted',
                )}
              >
                {isDone ? (
                  <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
                    <path
                      d="M2.5 6.5l2.5 2.5 4.5-5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                ) : (
                  n
                )}
              </div>
              {n < TOTAL_STEPS && (
                <div
                  className={cn(
                    'mx-2 h-[2px] flex-1 rounded-full transition-colors duration-300',
                    isDone ? 'bg-emerald-500' : 'bg-border',
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="max-w-2xl">
        {step === 1 && (
          <Step
            eyebrow="Step 1"
            title="Who's this for?"
            sub="Pick the occasion. Date is the most polished today; solo and friends are getting better every week."
          >
            {/* Themes — the fast path. Each one bundles vibe + duration +
                budget + effort + intent. Click → jump to step 5 with
                everything pre-filled, just confirm or tweak must-haves. */}
            <div className="mb-10 rounded-card border border-border bg-surface p-5 md:p-6">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-[0.14em] text-muted">
                Or start from a theme
              </p>
              <p className="mb-4 text-sm text-secondary">
                Pick the kind of night and we'll handle the rest.
              </p>
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onApplyTheme(t)}
                    className="group flex flex-col items-start gap-1 rounded-card border border-border bg-background px-4 py-3 text-left transition-colors hover:border-text/40"
                  >
                    <span className="text-sm font-medium text-text group-hover:text-text">
                      {t.label}
                    </span>
                    <span className="text-xs leading-snug text-muted">{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>

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

            {/* Surprise me — skip steps 2-5 and just go. We pick everything
                else with deliberately wide stochasticity for variety. */}
            <button
              type="button"
              onClick={onSurpriseMe}
              className="mt-6 inline-flex items-center gap-2 text-sm text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} />
              Or surprise me — pick everything else for me
            </button>

            {/* Pronoun pickers — Date only. Both fully optional; we use them
                to color the "why this works" copy ("she'll love the sunset"
                vs "they'll appreciate the brewery"). Skip = generic copy. */}
            {inputs.occasion === 'date' && (
              <div className="mt-10 space-y-6 rounded-card border border-border bg-surface p-6 md:p-7">
                <p className="text-sm leading-relaxed text-secondary">
                  <span className="text-text">Optional:</span> tells us how to write the plan
                  ("she'll love the sunset" vs "he'll appreciate the brewery"). Skip and we'll keep it neutral.
                </p>

                <div>
                  <p className="mb-2.5 text-xs font-medium uppercase tracking-[0.14em] text-muted">You</p>
                  <div className="flex flex-wrap gap-2.5">
                    {PRONOUN_OPTIONS.map((p) => {
                      const on = inputs.you_pronouns === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setInputs((s) => ({ ...s, you_pronouns: on ? '' : p.id }))}
                          className={cn(
                            'rounded-pill border px-4 py-2 text-sm transition-colors',
                            on
                              ? 'border-text bg-text text-background'
                              : 'border-border text-secondary hover:border-text/40 hover:text-text',
                          )}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="mb-2.5 text-xs font-medium uppercase tracking-[0.14em] text-muted">Your date</p>
                  <div className="flex flex-wrap gap-2.5">
                    {PRONOUN_OPTIONS.map((p) => {
                      const on = inputs.partner_pronouns === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setInputs((s) => ({ ...s, partner_pronouns: on ? '' : p.id }))}
                          className={cn(
                            'rounded-pill border px-4 py-2 text-sm transition-colors',
                            on
                              ? 'border-text bg-text text-background'
                              : 'border-border text-secondary hover:border-text/40 hover:text-text',
                          )}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* When — affects scoring downstream. Tonight = hard hours filter
                + low-friction bias. Future = wider scope, reservations OK. */}
            <div className="mt-12">
              <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted">
                When?
              </p>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                <Choice
                  selected={inputs.when === 'tonight'}
                  onClick={() => setInputs((s) => ({ ...s, when: 'tonight', future_date: '' }))}
                  label="Tonight"
                  sub="Open now, low effort"
                />
                <Choice
                  selected={inputs.when === 'future'}
                  onClick={() => setInputs((s) => ({
                    ...s,
                    when: 'future',
                    future_date: s.future_date || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
                  }))}
                  label="A future date"
                  sub="Pick a day"
                />
              </div>
              {inputs.when === 'future' && (
                <input
                  type="date"
                  value={inputs.future_date}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setInputs((s) => ({ ...s, future_date: e.target.value }))}
                  className="mt-4 block rounded-card border border-border bg-background px-5 py-3 text-base text-text outline-none transition-colors focus:border-accent"
                />
              )}
            </div>

            {/* Intent — emotional goal, distinct from vibe (vibe = aesthetic).
                Optional. Used as LLM tone hint and (later) for template bias. */}
            <div className="mt-12">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-[0.14em] text-muted">
                What’s the goal? <span className="ml-1 normal-case tracking-normal text-muted/70">(optional)</span>
              </p>
              <p className="mb-4 text-sm text-secondary">
                Different from the vibe — this is the emotional outcome, not the aesthetic.
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {INTENT_OPTIONS.map((it) => (
                  <Choice
                    key={it.id}
                    selected={inputs.intent === it.id}
                    onClick={() => setInputs((s) => ({ ...s, intent: s.intent === it.id ? '' : it.id }))}
                    label={it.label}
                    sub={it.sub}
                  />
                ))}
              </div>
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

            {/* Where — out and about (real venues) or at-home night
                (cooking, fondue, fort etc). At-home plans skip the radius
                question entirely. */}
            <div className="mt-10">
              <p className="mb-4 text-sm font-medium text-text">Where?</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Choice
                  selected={inputs.location === 'out'}
                  onClick={() => setInputs((s) => ({ ...s, location: 'out' }))}
                  label="Out and about"
                  sub="Real venues, real places"
                />
                <Choice
                  selected={inputs.location === 'home'}
                  onClick={() => setInputs((s) => ({ ...s, location: 'home' }))}
                  label="At home tonight"
                  sub="Cooking, movies, board games"
                />
              </div>
            </div>

            {/* Radius — only relevant for out-and-about plans. Map shows the
                circle visually; slider drives the value. Map updates live. */}
            {inputs.location === 'out' && (
              <div className="mt-10">
                <p className="mb-4 text-sm font-medium text-text">How far from Kelowna?</p>
                <div className="overflow-hidden rounded-card border border-border bg-surface">
                  <RadiusMap radiusKm={inputs.max_radius_km} />
                  <div className="px-7 py-7 md:px-9 md:py-8">
                    <div className="flex items-baseline justify-between">
                      <span className="font-display text-3xl font-bold text-text [font-variant-numeric:tabular-nums]">
                        {inputs.max_radius_km} km
                      </span>
                      <span className="text-sm text-muted">{radiusBlurb(inputs.max_radius_km)}</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={100}
                      step={5}
                      value={inputs.max_radius_km}
                      onChange={(e) => setInputs((s) => ({ ...s, max_radius_km: Number(e.target.value) }))}
                      className="mt-6 w-full accent-accent"
                    />
                    <div className="mt-3 flex justify-between text-xs text-muted [font-variant-numeric:tabular-nums]">
                      <span>5 km</span>
                      <span>25</span>
                      <span>50</span>
                      <span>75</span>
                      <span>100 km</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Step>
        )}

        {step === 5 && (
          <Step
            eyebrow="Step 5"
            title="What should it include?"
            sub="Optional. Pick anything that matters. Skip if you trust us."
          >
            <div className="space-y-7">
              {MUST_INCLUDE_GROUPS.map((group) => (
                <div key={group.name}>
                  <p className="mb-2.5 text-xs font-medium uppercase tracking-[0.14em] text-muted">
                    {group.name}
                    {group.hint && (
                      <span className="ml-2 normal-case tracking-normal text-muted/70">{group.hint}</span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2.5">
                    {group.items.map((m) => {
                      const on = inputs.must_includes.includes(m);
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setInputs((s) => {
                            // Exclusive group: turning one on clears the others in the same group.
                            if (group.exclusive && !on) {
                              return {
                                ...s,
                                must_includes: [
                                  ...s.must_includes.filter((x) => !group.items.includes(x)),
                                  m,
                                ],
                              };
                            }
                            return {
                              ...s,
                              must_includes: on
                                ? s.must_includes.filter((x) => x !== m)
                                : [...s.must_includes, m],
                            };
                          })}
                          className={cn(
                            'inline-flex items-center gap-2 rounded-pill border px-4 py-2 text-sm transition-colors',
                            on
                              ? 'border-text bg-text text-background'
                              : 'border-border text-secondary hover:border-text/40 hover:text-text',
                          )}
                        >
                          {on && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
                          {m.replace('_', ' ')}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Free-text context. Fed to the LLM that writes the why-it-works
                copy so plans can speak to anniversaries, dietary needs, etc. */}
            <div className="mt-10">
              <label htmlFor="plan-note" className="mb-2.5 block text-xs font-medium uppercase tracking-[0.14em] text-muted">
                Anything else? <span className="ml-1 normal-case tracking-normal text-muted/70">(optional)</span>
              </label>
              <textarea
                id="plan-note"
                value={inputs.note}
                onChange={(e) => setInputs((s) => ({ ...s, note: e.target.value.slice(0, 280) }))}
                rows={3}
                placeholder="e.g. anniversary, vegetarian, allergic to seafood, 7 months pregnant, first time in Kelowna…"
                className="block w-full resize-none rounded-card border border-border bg-background px-5 py-4 text-base text-text outline-none transition-colors focus:border-accent"
              />
              <p className="mt-2 text-right text-xs text-muted [font-variant-numeric:tabular-nums]">
                {inputs.note.length} / 280
              </p>
            </div>
          </Step>
        )}

        {/* Inline hints + hard blocker for the current step. Hints are soft
            warnings with optional "I don't understand" expanders; a blocker
            disables forward navigation so we never let the user submit an
            unbuildable combo. */}
        {(stepHints.length > 0 || stepBlocker) && (
          <div className="mt-10 space-y-3">
            {stepHints.map((h, i) => (
              <HintCard key={i} hint={h} />
            ))}
            {stepBlocker && (
              <div className="flex gap-3 rounded-card border-2 border-accent bg-accent-soft px-5 py-4 text-sm leading-relaxed text-text">
                <span aria-hidden className="font-bold text-accent">×</span>
                <p>{stepBlocker.message}</p>
              </div>
            )}
          </div>
        )}

        {/* Nav */}
        <div className="mt-12 flex items-center justify-between">
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
  { label: 'Pulling 200+ vetted Kelowna spots',           doneAt: 1500 },
  { label: 'Checking what\u2019s actually open tonight',   doneAt: 3000 },
  { label: 'Filtering for your vibe and budget',           doneAt: 4500 },
  { label: 'Calculating drive time between every pair',    doneAt: 6500 },
  { label: 'Sequencing so nothing closes mid-date',        doneAt: 8500 },
  { label: 'Surfacing the hidden gems most people miss',   doneAt: 10500 },
  { label: 'Pairing food, drinks and a wow moment',        doneAt: 12500 },
  { label: 'Writing why each plan works for you tonight',  doneAt: 15000 },
  { label: 'Adding the small details that turn it into a story', doneAt: Infinity }, // hold until results land
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

// ─── Email gate ──────────────────────────────────────────────────────
// 3-step wizard between generation and reveal: email → city → first name.
// Each step is its own screen for focus. "Skip" advances without saving the
// current field. Back-to-inputs link is always visible so users who want to
// regenerate with different inputs aren't trapped.

function EmailGate({
  itineraryId,
  itineraryIds,
  onContinue,
  onBack,
}: {
  itineraryId: string | undefined;
  itineraryIds: string[];
  onContinue: () => void;
  onBack: () => void;
}) {
  type Sub = 1 | 2 | 3;
  const [substep, setSubstep] = useState<Sub>(1);
  const [email, setEmail] = useState('');
  const [inKelowna, setInKelowna] = useState(true);
  const [city, setCity] = useState('');
  const [firstName, setFirstName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  // Saves whatever we have so far. Called at each advance so partial submits
  // still get captured even if the user bails on a later step.
  async function persist(extra: Record<string, unknown> = {}) {
    if (!emailValid) return;
    try {
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          location: inKelowna ? 'kelowna' : 'other',
          city: city || null,
          first_name: firstName || null,
          source: 'plan_gate',
          itinerary_id: itineraryId,
          itinerary_ids: itineraryIds,
          ...extra,
        }),
      });
    } catch (err) {
      console.error('subscribe failed', err);
    }
  }

  async function advance(nextSub: Sub | 'done') {
    setSubmitting(true);
    await persist();
    setSubmitting(false);
    if (nextSub === 'done') onContinue();
    else setSubstep(nextSub);
  }

  return (
    <div className="mx-auto flex max-w-content flex-col items-start px-6 py-24 md:px-10 md:py-32">
      <div className="w-full max-w-xl">
        <button
          type="button"
          onClick={onBack}
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
        >
          ← Change my selections and regenerate
        </button>

        {/* Substep dots */}
        <div className="mb-8 flex items-center gap-2">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={cn(
                'h-1.5 w-8 rounded-pill transition-colors',
                n === substep
                  ? 'bg-accent'
                  : n < substep
                  ? 'bg-emerald-500'
                  : 'bg-border',
              )}
            />
          ))}
        </div>

        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-accent">
          Your dates are ready
        </p>

        {substep === 1 && (
          <>
            <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
              One quick thing before you see them.
            </h1>
            <p className="mt-5 text-base text-secondary md:text-lg">
              We're testing how After5 works for real Kelowna couples. Drop your
              email and we'll send you new date plans + the occasional local
              insider tip. Unsubscribe whenever.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (emailValid) advance(2);
              }}
              className="mt-10 space-y-4"
            >
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="block w-full rounded-card border border-border bg-background px-5 py-4 text-base text-text outline-none transition-colors focus:border-accent"
                required
                autoFocus
              />

              <label className="flex cursor-pointer items-start gap-3 rounded-card border border-border bg-surface px-5 py-4 transition-colors has-[:checked]:border-accent">
                <input
                  type="checkbox"
                  checked={inKelowna}
                  onChange={(e) => setInKelowna(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-accent"
                />
                <span className="text-sm text-secondary">
                  <span className="text-text">I'm in or near Kelowna.</span>{' '}
                  These plans are Kelowna-specific. If you're elsewhere we'll let
                  you know when we expand to your city.
                </span>
              </label>

              <div className="flex items-center gap-4 pt-2">
                <button
                  type="submit"
                  disabled={!emailValid || submitting}
                  className="inline-flex items-center justify-center gap-2 rounded-pill bg-primary px-7 py-3.5 text-base font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-40"
                >
                  {submitting ? 'One sec…' : 'Continue →'}
                </button>
              </div>
              <p className="pt-1 text-xs text-muted">
                Email is required to view your plans. Steps after this are optional.
              </p>
            </form>
          </>
        )}

        {substep === 2 && (
          <>
            <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
              Where are you based?
            </h1>
            <p className="mt-5 text-base text-secondary md:text-lg">
              {inKelowna
                ? 'Which Kelowna neighborhood — or just "Kelowna" works. Helps us tune plans to your side of town.'
                : 'Where do you live? When we expand to your city, you\'ll be the first to know.'}
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                advance(3);
              }}
              className="mt-10 space-y-4"
            >
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder={inKelowna ? 'e.g. Glenmore, Lower Mission, Rutland…' : 'e.g. Vernon, Penticton, Vancouver…'}
                className="block w-full rounded-card border border-border bg-background px-5 py-4 text-base text-text outline-none transition-colors focus:border-accent"
                autoFocus
              />

              <div className="flex items-center gap-4 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-2 rounded-pill bg-primary px-7 py-3.5 text-base font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-40"
                >
                  {submitting ? 'One sec…' : 'Continue →'}
                </button>
                <button
                  type="button"
                  onClick={() => advance(3)}
                  className="text-sm text-muted underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-secondary"
                >
                  Skip
                </button>
              </div>
            </form>
          </>
        )}

        {substep === 3 && (
          <>
            <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
              Last one — what should we call you?
            </h1>
            <p className="mt-5 text-base text-secondary md:text-lg">
              First name is fine. We use it in the email subject line — feels less
              like spam and more like a friend with a tip.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                advance('done');
              }}
              className="mt-10 space-y-4"
            >
              <input
                type="text"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Sarah"
                className="block w-full rounded-card border border-border bg-background px-5 py-4 text-base text-text outline-none transition-colors focus:border-accent"
                autoFocus
              />

              <div className="flex items-center gap-4 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-2 rounded-pill bg-primary px-7 py-3.5 text-base font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-40"
                >
                  {submitting ? 'One sec…' : 'Show my dates →'}
                </button>
                <button
                  type="button"
                  onClick={() => advance('done')}
                  className="text-sm text-muted underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-secondary"
                >
                  Skip
                </button>
              </div>
            </form>
          </>
        )}
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
        <div className="mb-8 flex items-start justify-between gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Three plans, your call
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold leading-tight tracking-[-0.01em] text-text md:text-[28px]">
              Built three plans just for you.
            </h2>
            <p className="mt-1.5 text-sm text-secondary">
              We checked every Kelowna spot we know, sequenced them so nothing closes mid-date, and picked the three that fit you best.
            </p>
          </div>
          <button
            type="button"
            onClick={onRedo}
            className="shrink-0 text-sm text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
          >
            Try a different one
          </button>
        </div>
        <ChooserCards itineraries={itineraries} activeIdx={activeIdx} onPick={setActiveIdx} />
      </div>

      {/* Full rich detail view of the active pick */}
      {active && <ItineraryView itinerary={active} />}

      {/* Three-question feedback pulse below the active plan. Only renders
          when we have an itinerary id (skipped if persistence failed). */}
      {active?.id && (
        <div className="mx-auto max-w-content px-6 pb-20 md:px-10">
          <FeedbackPulse
            itineraryId={active.id}
            stops={active.stops.map((s) => ({ place_id: s.place_id, place_name: s.place_name }))}
            source="plan_results"
          />
        </div>
      )}
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
