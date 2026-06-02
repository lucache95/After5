'use client';

// Phase 3: end-to-end plan flow.
// 5 questions → call generate-plan Edge Function → 3 itinerary cards → detail.
// Single client component for now; split into smaller files when adding tests.

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, ArrowLeft, Check, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/cn';
import { track } from '@/app/PostHogProvider';
import { ItineraryView } from '@/components/itinerary/ItineraryView';
import { ChooserCards } from '@/components/itinerary/ChooserCards';
import { RadiusMap } from '@/components/RadiusMap';
import { HintCard } from '@/components/HintCard';
import { FeedbackPulse } from '@/components/itinerary/FeedbackPulse';
import { ShareSheet } from '@/components/itinerary/ShareSheet';
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
  // Time-of-day frame for the plan. Drives slot-start time + which places
  // are open + LLM tone. 'all_day' implies a long duration; 'morning' /
  // 'evening' are the typical patterns.
  time_of_day: 'morning' | 'evening' | 'all_day';
  // M1: which city to generate for. Default 'kelowna' — threaded into the
  // generate-plan body so a no-override request behaves exactly as before.
  city_slug: string;
}

const PRONOUN_OPTIONS: { id: Pronouns; label: string }[] = [
  { id: 'she/her',   label: 'She / her' },
  { id: 'he/him',    label: 'He / him' },
  { id: 'they/them', label: 'They / them' },
];

// Intent options are occasion-aware. Same underlying IDs (so the LLM tone
// hints stay stable) but the labels and subs reframe to fit the context —
// "Reconnect" with whom, on a solo day? "Impress" your friends? Awkward.
type IntentOption = { id: Inputs['intent']; label: string; sub: string };
function intentOptionsFor(occasion: Occasion): IntentOption[] {
  if (occasion === 'solo') {
    return [
      { id: 'impress',           label: 'Treat yourself',     sub: 'Splurge, no guilt' },
      { id: 'chill',             label: 'Recharge',           sub: 'Quiet, slow, restorative' },
      { id: 'reconnect',         label: 'Get out of your head', sub: 'Move, breathe, reset' },
      { id: 'try_something_new', label: 'Try something new',  sub: 'Spots you haven\u2019t been to' },
    ];
  }
  if (occasion === 'friends') {
    return [
      { id: 'impress',           label: 'Big night out',      sub: 'Memorable, talk-about-it later' },
      { id: 'chill',             label: 'Easy hangout',       sub: 'Low-key, just be together' },
      { id: 'reconnect',         label: 'Catch up properly',  sub: 'Real conversation, no rush' },
      { id: 'try_something_new', label: 'Try something new together', sub: 'Spots none of you have been to' },
    ];
  }
  return [
    { id: 'impress',           label: 'Impress',            sub: 'You want this to land' },
    { id: 'chill',             label: 'Chill out',          sub: 'Low-key, no pressure' },
    { id: 'reconnect',         label: 'Reconnect',          sub: 'Real conversation, no distractions' },
    { id: 'try_something_new', label: 'Try something new',  sub: 'Spots you haven\u2019t been to' },
  ];
}

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
  { min: 120, label: '2 hr'     },
  { min: 180, label: '3 hr'     },
  { min: 240, label: '4 hr'     },
  { min: 360, label: 'Half day' },
  { min: 600, label: 'Full day' },
];

// Sub-labels are time-of-day aware so "4 hr" doesn't say "Long evening"
// when Morning is selected.
function durationSubFor(min: number, tod: 'morning' | 'evening' | 'all_day'): string {
  if (tod === 'morning') {
    if (min === 120) return 'Brunch';
    if (min === 180) return 'Slow morning';
    if (min === 240) return 'Long brunch';
    if (min === 360) return 'Morning + lunch';
  }
  if (tod === 'evening') {
    if (min === 120) return 'Quick';
    if (min === 180) return 'Standard';
    if (min === 240) return 'Long evening';
    if (min === 360) return '6 hr';
  }
  if (tod === 'all_day') {
    if (min === 240) return '4 hr';
    if (min === 360) return '6 hr';
    if (min === 600) return '10 hr';
  }
  return `${min} min`;
}

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
  const themeParam = searchParams.get('theme');
  const surpriseParam = searchParams.get('surprise');
  // Resolve theme preset once at mount. If themeParam matches a known
  // theme, the preset overrides the defaults below.
  const themePreset = themeParam ? THEMES.find((t) => t.id === themeParam)?.preset ?? null : null;

  const [phase, setPhase] = useState<Phase>('inputs');
  const [step, setStep] = useState(() => themePreset ? 5 : startStepFromUrl(vibeParam));
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
    time_of_day: 'evening',
    city_slug: 'kelowna',
    ...(themePreset ?? {}),
  } as Inputs);
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

  // Scroll to top whenever the step or phase changes. Without this, mobile
  // users land mid-scroll on the next step (especially when a long step like
  // Step 4 with the radius map sets a deep scroll position).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step, phase]);

  // Preflight against the loaded templates. If we KNOW the combo will fail,
  // surface a blocker on the relevant step + disable the next/generate button.
  const verdict = useMemo(
    () => preflight(inputs, templates, hintsForStep(step, inputs)),
    [inputs, templates, step],
  );
  const stepHints = hintsForStep(step, inputs);
  // Only surface a blocker once the user has actually reached the step
  // that owns the conflicting input. Showing a "vibe + duration doesn't
  // fit" blocker on Step 1 (when vibe is still the default empty value)
  // is noise — the user hasn't picked vibe yet.
  const stepBlocker = verdict.blocker && verdict.blocker.step <= step
    ? verdict.blocker
    : null;

  const canAdvance = (): boolean => {
    if (step === 3) return inputs.vibe.length >= 1;
    // Hard block forward navigation only for blockers tied to a step the
    // user has already reached or is on. Future-step blockers will surface
    // naturally when they arrive at that step.
    if (verdict.blocker && verdict.blocker.step <= step) return false;
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

  // Auto-trigger surprise flow when landing via ?surprise=true (hero CTA).
  useEffect(() => {
    if (surpriseParam === 'true' && phase === 'inputs') {
      surpriseMe();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surpriseParam]);

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

      // Email gate is for anonymous users — captures lead at peak excitement.
      // Logged-in users have already given us email/name/city, so we skip
      // straight to the results reveal.
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Mirror profile to localStorage so the personalized header reads
        // ("Built three plans for you, Sarah.") on first paint.
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name, city')
          .eq('id', user.id)
          .maybeSingle();
        if (typeof window !== 'undefined' && profile) {
          if (profile.first_name) localStorage.setItem('after5_first_name', profile.first_name);
          if (profile.city) localStorage.setItem('after5_city', profile.city);
        }
        setPhase('results');
      } else {
        setPhase('gate');
      }

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
          note={inputs.note}
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
            title={<>Who&apos;s <span className="italic font-semibold text-accent">this</span> for?</>}
            sub="Pick the occasion. We tune the plan for two, alone, or a group."
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
                  <span className="text-text">Optional.</span>
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
                {intentOptionsFor(inputs.occasion).map((it) => (
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
            title={<>When in the <span className="italic font-semibold text-accent">day?</span></>}
            sub="Pick the frame, then how long. We'll match places open at that time."
          >
            {/* Time-of-day frame — drives slot start time + place hours filter */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {([
                { id: 'morning' as const,  label: 'Morning',  sub: 'Brunch energy, ~10am start' },
                { id: 'evening' as const,  label: 'Evening',  sub: 'After-work, ~6pm start' },
                { id: 'all_day' as const,  label: 'All day',  sub: 'Big day, morning to night' },
              ]).map((t) => (
                <Choice
                  key={t.id}
                  selected={inputs.time_of_day === t.id}
                  onClick={() => setInputs((s) => {
                    // All-day implies a long duration; bump up if currently set short.
                    const dur = t.id === 'all_day' && s.duration_min < 360 ? 360 : s.duration_min;
                    return { ...s, time_of_day: t.id, duration_min: dur };
                  })}
                  label={t.label}
                  sub={t.sub}
                />
              ))}
            </div>

            {/* Duration — filtered to match the time-of-day frame */}
            <div className="mt-10">
              <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted">
                How long?
              </p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {DURATIONS
                  .filter((d) => {
                    if (inputs.time_of_day === 'all_day') return d.min >= 240;
                    if (inputs.time_of_day === 'morning' || inputs.time_of_day === 'evening') return d.min <= 360;
                    return true;
                  })
                  .map((d) => (
                    <Choice
                      key={d.min}
                      selected={inputs.duration_min === d.min}
                      onClick={() => setInputs((s) => ({ ...s, duration_min: d.min }))}
                      label={d.label}
                      sub={durationSubFor(d.min, inputs.time_of_day)}
                    />
                  ))}
              </div>
            </div>
          </Step>
        )}

        {step === 3 && (
          <Step
            eyebrow="Step 3"
            title={<>What&apos;s the <span className="italic font-semibold text-accent">vibe?</span></>}
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
            title={<>Per-person <span className="italic font-semibold text-accent">budget?</span></>}
            sub="Slide for what you'd happily spend each. We respect it."
          >
            <div className="rounded-card border border-border bg-surface p-7 md:p-9">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-4xl font-bold text-text [font-variant-numeric:tabular-nums]">
                  ${inputs.budget_per_person}
                </span>
                <span className="text-sm text-muted">per person</span>
              </div>
              <p className="mt-1 text-sm text-secondary [font-variant-numeric:tabular-nums]">
                ≈ <span className="font-medium text-text">${inputs.budget_per_person * 2}</span> total for two
              </p>
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
                  selected={false}
                  disabled
                  badge="Coming soon"
                  onClick={() => { /* disabled */ }}
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
            title={<>What should it <span className="italic font-semibold text-accent">include?</span></>}
            sub="Optional. Pick anything that matters. Skip if you trust us."
          >
            <p className="-mt-2 mb-6 text-sm text-secondary">
              Pick up to <span className="text-text">3</span> — more than that and no single plan can cover it all.
            </p>

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
                      // Hard cap at 3 real must-haves. hidden_gem doesn't
                      // constrain templates so it doesn't count toward the cap.
                      // For exclusive groups, turning one on REPLACES siblings
                      // so the cap math nets to zero — those are always allowed.
                      const realCount = inputs.must_includes.filter((x) => x !== 'hidden_gem').length;
                      const counts = m !== 'hidden_gem';
                      const isReplaceInGroup = group.exclusive && group.items.some((x) => inputs.must_includes.includes(x));
                      const atCap = !on && counts && realCount >= 3 && !isReplaceInGroup;
                      return (
                        <button
                          key={m}
                          type="button"
                          disabled={atCap}
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
                              : atCap
                              ? 'border-border bg-surface text-muted/60 cursor-not-allowed opacity-50'
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

function Step(props: { eyebrow: string; title: React.ReactNode; sub: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">{props.eyebrow}</p>
      <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-[-0.025em] text-text md:text-[44px]">
        {props.title}
      </h1>
      <p className="mt-5 max-w-prose text-base text-secondary md:text-lg">{props.sub}</p>
      <div className="mt-10">{props.children}</div>
    </div>
  );
}

function Choice(props: {
  selected: boolean;
  onClick: () => void;
  label: string;
  sub: string;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={props.disabled ? undefined : props.onClick}
      disabled={props.disabled}
      className={cn(
        'group relative flex flex-col items-start rounded-card border p-5 text-left transition-colors',
        props.disabled
          ? 'cursor-not-allowed border-dashed border-border bg-surface/50 text-muted'
          : props.selected
            ? 'border-text bg-text text-background'
            : 'border-border bg-surface text-text hover:border-text/40',
      )}
    >
      <span className={cn('text-base font-medium', props.disabled && 'opacity-60')}>{props.label}</span>
      <span
        className={cn(
          'mt-1 text-sm',
          props.disabled
            ? 'text-muted/80'
            : props.selected
              ? 'text-background/70'
              : 'text-secondary',
        )}
      >
        {props.sub}
      </span>
      {props.badge && (
        <span className="absolute right-3 top-3 rounded-pill bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 ring-1 ring-amber-200">
          {props.badge}
        </span>
      )}
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

// Cycled through the polaroid stack. More images than steps so the
// stack always shows different scenes as it rotates. Real Okanagan shots.
const LOAD_IMAGES = [
  '/pins/couple-trail.jpg',
  '/pins/couple-lake-kiss.jpg',
  '/pins/couple-wakeboard.jpg',
  '/pins/couple-field.jpg',
  '/vibes/vibe-romantic.jpg',
  '/vibes/vibe-cozy.jpg',
  '/vibes/vibe-boujee.jpg',
  '/vibes/vibe-adventurous.jpg',
  '/vibes/vibe-chill.jpg',
] as const;

const LOAD_LABELS_KELOWNA = [
  'KELOWNA · 26',
  'LAKESIDE',
  'OKANAGAN',
  'WEST KELOWNA',
  'PANDOSY',
  'GLENMORE',
  'MISSION',
  'KNOX HILL',
  'DOWNTOWN',
] as const;

function LoadingView() {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setNow(Date.now() - start), 120);
    return () => clearInterval(id);
  }, []);

  // Determine the index of the currently-active step (first step not yet done)
  const rawIdx = LOAD_STEPS.findIndex((s) => now < s.doneAt);
  const activeIdx = rawIdx === -1 ? LOAD_STEPS.length - 1 : rawIdx;
  const total = LOAD_STEPS.length;

  return (
    <div className="relative mx-auto flex min-h-[calc(100vh-80px)] max-w-content flex-col items-center justify-center overflow-hidden px-6 py-16 md:px-10 md:py-24">
      {/* Ambient warm gradient — same family as /login + /account so the
          loading screen feels continuous with the brand. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 top-0 h-[420px] w-[420px] rounded-full bg-gradient-to-br from-amber-200/40 via-orange-200/20 to-transparent blur-3xl" />
        <div className="absolute -right-32 bottom-0 h-[420px] w-[420px] rounded-full bg-gradient-to-tl from-rose-200/40 via-amber-100/20 to-transparent blur-3xl" />
      </div>

      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center text-center">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
          Pulling it together
        </p>
        <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-[-0.025em] text-text md:text-[44px]">
          Building three{' '}
          <span className="italic font-semibold text-accent">plans</span>
          {' '}for you.
        </h1>
        <p className="mt-4 max-w-md text-sm text-secondary md:text-base">
          We&apos;re shuffling through every Kelowna spot we know to find the night that fits.
        </p>

        {/* Polaroid stack — the centerpiece. Multiple polaroids fanned
            slightly behind each other; the front one carries the current
            "thinking step" text and re-keys on activeIdx so it animates
            in fresh each rotation. */}
        <PolaroidStack activeIdx={activeIdx} />

        {/* Progress dots — one per step. Subtle, gives a sense of how
            far along we are without re-introducing a long checklist. */}
        <div className="mt-10 flex items-center gap-1.5">
          {LOAD_STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i < activeIdx ? 'w-1.5 bg-accent' : i === activeIdx ? 'w-6 bg-accent' : 'w-1.5 bg-border',
              )}
            />
          ))}
        </div>
        <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-muted [font-variant-numeric:tabular-nums]">
          Step {Math.min(activeIdx + 1, total)} of {total}
        </p>
      </div>
    </div>
  );
}

function PolaroidStack({ activeIdx }: { activeIdx: number }) {
  const total = LOAD_STEPS.length;

  // Render the active polaroid + the next two as a fanned stack behind.
  // Each "slot" position (front / mid / back) gets its own transform.
  // Re-keying the front on activeIdx triggers the entrance animation.
  function imgFor(stepIdx: number): string {
    return LOAD_IMAGES[stepIdx % LOAD_IMAGES.length];
  }
  function labelFor(stepIdx: number): string {
    return LOAD_LABELS_KELOWNA[stepIdx % LOAD_LABELS_KELOWNA.length];
  }

  return (
    <div className="relative mt-12 flex h-[360px] w-full items-center justify-center md:h-[400px]">
      {/* Two background polaroids fanned out — give the stack depth. */}
      {activeIdx + 2 < total && (
        <PolaroidLayer
          src={imgFor(activeIdx + 2)}
          label={labelFor(activeIdx + 2)}
          step={LOAD_STEPS[activeIdx + 2]?.label ?? ''}
          z={1}
          rotate={-8}
          translateX={-30}
          translateY={20}
          scale={0.9}
          opacity={0.55}
        />
      )}
      {activeIdx + 1 < total && (
        <PolaroidLayer
          src={imgFor(activeIdx + 1)}
          label={labelFor(activeIdx + 1)}
          step={LOAD_STEPS[activeIdx + 1]?.label ?? ''}
          z={2}
          rotate={5}
          translateX={20}
          translateY={10}
          scale={0.95}
          opacity={0.78}
        />
      )}
      {/* Active polaroid — front, full opacity, re-keys on each step so the
          enter animation plays. */}
      <PolaroidLayer
        key={`active-${activeIdx}`}
        src={imgFor(activeIdx)}
        label={labelFor(activeIdx)}
        step={LOAD_STEPS[activeIdx]?.label ?? ''}
        z={3}
        rotate={-2}
        translateX={0}
        translateY={0}
        scale={1}
        opacity={1}
        active
      />
    </div>
  );
}

function PolaroidLayer({
  src,
  label,
  step,
  z,
  rotate,
  translateX,
  translateY,
  scale,
  opacity,
  active = false,
}: {
  src: string;
  label: string;
  step: string;
  z: number;
  rotate: number;
  translateX: number;
  translateY: number;
  scale: number;
  opacity: number;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        'absolute transition-all duration-500 ease-out',
        active && 'animate-[polaroidIn_.6s_cubic-bezier(0.2,0.8,0.2,1)_both]',
      )}
      style={{
        zIndex: z,
        transform: `translate(${translateX}px, ${translateY}px) rotate(${rotate}deg) scale(${scale})`,
        opacity,
      }}
    >
      <div className="relative w-[260px] rounded-[3px] bg-white px-3 pb-12 pt-3 shadow-[0_24px_56px_-16px_rgba(80,40,20,0.32)] ring-1 ring-black/5 md:w-[300px]">
        {/* Photo */}
        <div className="relative h-[260px] w-full overflow-hidden bg-surface md:h-[300px]">
          <Image
            src={src}
            alt=""
            fill
            sizes="(max-width: 768px) 260px, 300px"
            className="object-cover"
          />
          {/* Subtle bottom gradient so the step-text overlay is always legible. */}
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/65 via-black/15 to-transparent"
          />
          {/* The active "thinking step" — overlaid on the photo. */}
          {active && (
            <p className="absolute inset-x-3 bottom-3 text-left text-[15px] font-medium leading-snug text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
              {step}
              <span className="ml-1 inline-block animate-pulse">…</span>
            </p>
          )}
        </div>
        {/* Polaroid bottom label */}
        <p className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap font-display text-[11px] font-medium tracking-[0.14em] text-text/70">
          {label}
        </p>
      </div>

      {/* Keyframes — defined once globally so re-keying the active layer
          replays them. */}
      <style jsx global>{`
        @keyframes polaroidIn {
          0%   { opacity: 0; transform: translate(0, -24px) rotate(-8deg) scale(0.92); }
          100% { opacity: 1; transform: translate(0, 0) rotate(-2deg) scale(1); }
        }
      `}</style>
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
  const [city, setCity] = useState('');
  const [firstName, setFirstName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  // Fires once on the FIRST step submit. Creates the auth.user (unconfirmed)
  // and sends the magic link. shouldCreateUser=true means new emails get an
  // account silently — they see plans immediately and the link in their
  // inbox is for coming back. Existing emails just get a sign-in link.
  async function sendMagicLink() {
    if (magicLinkSent) return;
    try {
      const supabase = createClient();
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${origin}/auth/callback?next=/account`,
          data: {
            first_name: firstName || undefined,
            city: city || undefined,
          },
        },
      });
      setMagicLinkSent(true);
    } catch (err) {
      console.error('magic link failed', err);
    }
  }

  // Saves whatever we have so far. Called at each advance so partial submits
  // still get captured even if the user bails on a later step. Also writes
  // claim_email on the itineraries so /auth/callback can attach them.
  async function persist(extra: Record<string, unknown> = {}) {
    if (!emailValid) return;
    if (typeof window !== 'undefined') {
      if (firstName) localStorage.setItem('after5_first_name', firstName);
      if (city) localStorage.setItem('after5_city', city);
    }
    try {
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
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
    // Run subscribe + magic-link in parallel so the user doesn't wait twice.
    // Magic link only fires the first time — repeat sends would spam.
    await Promise.all([persist(), sendMagicLink()]);
    setSubmitting(false);
    if (nextSub === 'done') onContinue();
    else setSubstep(nextSub);
  }

  // Rotate the side image per substep so it doesn't feel static through the
  // 3-step gate. All shots are verified Okanagan.
  const SIDE_IMAGES: Record<Sub, { src: string; alt: string }> = {
    1: { src: '/pins/couple-trail.jpg',     alt: 'Couple walking a trail above Okanagan Lake' },
    2: { src: '/pins/couple-lake-kiss.jpg', alt: 'Couple in Okanagan Lake' },
    3: { src: '/pins/couple-wakeboard.jpg', alt: 'Couple wakeboarding at sunset on Okanagan Lake' },
  };
  const side = SIDE_IMAGES[substep];

  return (
    <div className="mx-auto grid max-w-content gap-10 px-6 py-16 md:grid-cols-[1fr_minmax(380px,520px)] md:gap-14 md:px-10 md:py-24 lg:gap-20">
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
              Save your plans to your <em className="font-display font-semibold not-italic text-accent" style={{ fontStyle: 'italic' }}>account.</em>
            </h1>
            <p className="mt-5 text-base text-secondary md:text-lg">
              Drop your email — we'll send a one-tap link so you can come back to
              these plans any time. No password, no waiting on the email.
              You'll see your plans on the next screen.
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

              <div className="rounded-card border border-border bg-surface px-5 py-4">
                <p className="text-sm text-secondary">
                  <span className="font-medium text-text">What you get:</span>{' '}
                  Your three plans saved to your dashboard, the ability to share
                  + revisit them, and a sign-in link for next time.
                </p>
              </div>

              <div className="flex items-center gap-4 pt-2">
                <button
                  type="submit"
                  disabled={!emailValid || submitting}
                  className="inline-flex items-center justify-center gap-2 rounded-pill bg-primary px-7 py-3.5 text-base font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-40"
                >
                  {submitting ? 'Creating your account…' : 'Create account →'}
                </button>
              </div>
              <p className="pt-1 text-xs text-muted">
                Free forever for the first 100 Kelownans. No credit card.
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
              Which neighborhood — or just "Kelowna" works. Helps us tune plans to your side of town.
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
                placeholder="e.g. Glenmore, Lower Mission, Rutland…"
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

      {/* Side imagery — Okanagan couples shots, rotates per substep */}
      <aside className="relative hidden h-full min-h-[480px] overflow-hidden rounded-card bg-surface md:block">
        <Image
          src={side.src}
          alt={side.alt}
          fill
          sizes="(max-width: 768px) 0px, 520px"
          className="object-cover"
        />
      </aside>
    </div>
  );
}

// ─── Results view ────────────────────────────────────────────────────

function ResultsView(props: {
  itineraries: Itinerary[];
  activeIdx: number;
  setActiveIdx: (i: number) => void;
  onRedo: () => void;
  note?: string;
}) {
  const { itineraries, activeIdx, setActiveIdx, onRedo, note } = props;
  const active = itineraries[activeIdx];

  // Hyper-personalized header — pull first_name + city stashed by the gate
  // and weave them into the copy. Falls back to the generic version when
  // we don't have the data (user skipped name, or pre-gate render).
  const [firstName, setFirstName] = useState('');
  const [city, setCity] = useState('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setFirstName(localStorage.getItem('after5_first_name') ?? '');
    setCity(localStorage.getItem('after5_city') ?? '');
  }, []);

  // Detect a few common note themes so we can call them out specifically
  // without showing the user's raw text on the page (privacy-respecting).
  // Order matters — relationship words come first because they're the most
  // emotionally specific signal we can reflect back.
  const noteLower = (note ?? '').toLowerCase();
  let noteHook: string | null = null;
  if (/\bwife\b/.test(noteLower))                                noteHook = 'for you and your wife';
  else if (/\bhusband\b/.test(noteLower))                        noteHook = 'for you and your husband';
  else if (/\bgirlfriend\b|\bgf\b/.test(noteLower))              noteHook = 'for you and your girlfriend';
  else if (/\bboyfriend\b|\bbf\b/.test(noteLower))               noteHook = 'for you and your boyfriend';
  else if (/\bpartner\b/.test(noteLower))                        noteHook = 'for you and your partner';
  else if (/\bfianc[eé]e?\b/.test(noteLower))                    noteHook = 'for you and your fiancé';
  else if (/anniversary|annivers/.test(noteLower))               noteHook = 'with your anniversary in mind';
  else if (/birthday|bday|b-day/.test(noteLower))                noteHook = 'with the birthday in mind';
  else if (/vegetarian|vegan|gluten|allerg/.test(noteLower))     noteHook = 'with your dietary note in mind';
  else if (/pregnan/.test(noteLower))                            noteHook = 'with the pregnancy in mind';
  else if (/first time|new to/.test(noteLower)) noteHook = 'as a first-time intro to Kelowna';
  else if (note && note.trim().length > 12) noteHook = 'with your note in mind';

  // Compute differentiation labels: "Most ambitious" (longest duration),
  // "Best value" (cheapest), "Quickest" (shortest duration). Any card that
  // doesn't win a unique superlative gets "Our pick".
  const cardLabels = useMemo(() => {
    if (itineraries.length === 0) return [];
    if (itineraries.length === 1) return ['Our pick'];
    const labels = new Array<string>(itineraries.length).fill('Our pick');
    const used = new Set<number>();

    // Longest duration -> "Most ambitious"
    let longestIdx = 0;
    for (let i = 1; i < itineraries.length; i++) {
      if (itineraries[i].total_duration_min > itineraries[longestIdx].total_duration_min) longestIdx = i;
    }
    labels[longestIdx] = 'Most ambitious';
    used.add(longestIdx);

    // Cheapest -> "Best value"
    let cheapestIdx = -1;
    for (let i = 0; i < itineraries.length; i++) {
      if (used.has(i)) continue;
      if (cheapestIdx === -1 || itineraries[i].total_cost_pp < itineraries[cheapestIdx].total_cost_pp) cheapestIdx = i;
    }
    if (cheapestIdx >= 0) {
      labels[cheapestIdx] = 'Best value';
      used.add(cheapestIdx);
    }

    // Shortest duration -> "Quickest"
    let shortestIdx = -1;
    for (let i = 0; i < itineraries.length; i++) {
      if (used.has(i)) continue;
      if (shortestIdx === -1 || itineraries[i].total_duration_min < itineraries[shortestIdx].total_duration_min) shortestIdx = i;
    }
    if (shortestIdx >= 0) {
      labels[shortestIdx] = 'Quickest';
    }

    return labels;
  }, [itineraries]);

  const headline = firstName
    ? `Built three plans for you, ${firstName}.`
    : 'Built three plans just for you.';
  const subtitle = (() => {
    const parts: string[] = [];
    parts.push('We checked every Kelowna spot we know');
    if (city) parts.push(`(your ${city} side counts too)`);
    parts.push('sequenced them so nothing closes mid-date');
    if (noteHook) parts.push(`and picked the three that fit you best — ${noteHook}.`);
    else parts.push('and picked the three that fit you best.');
    return parts.join(', ').replace(', and', ' and');
  })();

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
              {headline}
            </h2>
            <p className="mt-1.5 text-sm text-secondary">
              {subtitle}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-3">
            <ShareSheet
              shareUrl={typeof window !== 'undefined' && active?.slug
                ? `${window.location.origin}/dates/${active.slug}`
                : typeof window !== 'undefined' && active?.id
                  ? `${window.location.origin}/plan/i/${active.id}`
                  : ''}
              title={active?.title ?? 'Three Kelowna date plans'}
              hook={active?.hook ?? 'Three plans built for tonight — pick one or vote with friends.'}
              itineraryIds={itineraries.map((it) => it.id).filter((id): id is string => Boolean(id))}
              variant="emphasis"
              label="Share"
            />
            <button
              type="button"
              onClick={onRedo}
              className="text-sm text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
            >
              Try a different one
            </button>
          </div>
        </div>
        <ChooserCards itineraries={itineraries} activeIdx={activeIdx} onPick={setActiveIdx} labels={cardLabels} />
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
