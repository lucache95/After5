// apps/web/app/onboarding/steps/PreferencesStep.tsx
'use client';
// Step 4 (preferences): orientation + age range + distance + dealbreakers. Validates
// with PreferencesInputSchema, persists via savePreferences (writes the flat profiles
// columns the S5 pre-filter reads), then advanceOnboarding('phone_verify').
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PreferencesInputSchema, GenderSchema, DealbreakerSchema } from '@after5/validators';
import { cn } from '@/lib/cn';
import { stickerRotation } from '@/lib/sticker';
import { browserAfter5Client, savePreferences, advanceOnboarding } from '@/lib/after5/client';

export interface PreferencesInitial {
  gender: string;
  gender_preferences: string[];
  age_min: number;
  age_max: number;
  distance_pref_km: number;
  dealbreakers: string[];
}

const GENDERS = GenderSchema.options;
const DEALBREAKERS = DealbreakerSchema.options;

// Sticker chip (DESIGN-SYSTEM §5b): slapped-on rotation + shadow; selected = pink fill.
function StickerChip({
  label, selected, onToggle, role,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
  role?: 'radio' | 'checkbox';
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      onClick={onToggle}
      style={{ transform: `rotate(${stickerRotation(label)}deg)` }}
      className={cn(
        'rounded-full px-4 py-2 font-body text-sm capitalize shadow-md transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
        'active:scale-95 hover:-translate-y-0.5',
        selected
          ? 'bg-shell-accent text-white'
          : 'bg-white text-shell-ink ring-1 ring-shell-ink/10 hover:ring-shell-accent/40',
      )}
    >
      {label}
    </button>
  );
}

export function PreferencesStep({ userId, initial }: { userId: string; initial: PreferencesInitial }) {
  const router = useRouter();
  const [gender, setGender] = useState(initial.gender || 'woman');
  const [wants, setWants] = useState<string[]>(initial.gender_preferences.length ? initial.gender_preferences : ['man']);
  const [ageMin, setAgeMin] = useState(initial.age_min || 25);
  const [ageMax, setAgeMax] = useState(initial.age_max || 40);
  const [distance, setDistance] = useState(initial.distance_pref_km || 40);
  const [dealbreakers, setDealbreakers] = useState<string[]>(initial.dealbreakers);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function toggle(list: string[], v: string, set: (n: string[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  async function handleContinue() {
    const candidate = { gender, gender_preferences: wants, age_min: ageMin, age_max: ageMax, distance_pref_km: distance, dealbreakers };
    const parsed = PreferencesInputSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrorMsg(parsed.error.issues[0]?.message ?? 'Please check your preferences.');
      setPhase('error');
      return;
    }
    setPhase('saving');
    setErrorMsg('');
    try {
      const client = browserAfter5Client();
      await savePreferences(client, userId, parsed.data);
      await advanceOnboarding(client, 'phone_verify');
      router.push('/onboarding/phone');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Something went wrong.');
      setPhase('error');
    }
  }

  const numberClass = cn(
    'mt-1.5 block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-3 py-2 font-body text-shell-ink',
    '[font-variant-numeric:tabular-nums] focus:outline-none focus:ring-2 focus:ring-shell-accent/60',
  );

  return (
    <div>
      <h1 className="font-heading text-3xl lowercase text-shell-ink">who you&apos;re into</h1>
      <p className="mt-3 font-body text-[15px] leading-relaxed text-shell-ink/70">this shapes who we line up for you. tweak it anytime.</p>

      <fieldset className="mt-7">
        <legend className="mb-3 font-body text-sm font-semibold lowercase text-shell-ink">i&apos;m a</legend>
        <div className="flex flex-wrap gap-2.5">
          {GENDERS.map((g) => (
            <StickerChip key={g} label={g} role="radio" selected={gender === g} onToggle={() => setGender(g)} />
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="mb-3 font-body text-sm font-semibold lowercase text-shell-ink">show me</legend>
        <div className="flex flex-wrap gap-2.5">
          {GENDERS.map((g) => (
            <StickerChip key={g} label={g} role="checkbox" selected={wants.includes(g)} onToggle={() => toggle(wants, g, setWants)} />
          ))}
        </div>
      </fieldset>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <label className="font-body text-sm font-semibold lowercase text-shell-ink">age from
          <input type="number" min={18} max={99} value={ageMin} onChange={(e) => setAgeMin(Number(e.target.value))}
            className={numberClass} />
        </label>
        <label className="font-body text-sm font-semibold lowercase text-shell-ink">age to
          <input type="number" min={18} max={99} value={ageMax} onChange={(e) => setAgeMax(Number(e.target.value))}
            className={numberClass} />
        </label>
      </div>

      <label className="mt-6 block font-body text-sm font-semibold lowercase text-shell-ink">within {distance} km
        <input type="range" min={1} max={150} value={distance} onChange={(e) => setDistance(Number(e.target.value))}
          className="mt-2 w-full accent-shell-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40" />
      </label>

      <fieldset className="mt-6">
        <legend className="mb-3 font-body text-sm font-semibold lowercase text-shell-ink">hard nos</legend>
        <div className="flex flex-wrap gap-2.5">
          {DEALBREAKERS.map((d) => (
            <StickerChip key={d} label={d.replace(/_/g, ' ')} role="checkbox"
              selected={dealbreakers.includes(d)} onToggle={() => toggle(dealbreakers, d, setDealbreakers)} />
          ))}
        </div>
      </fieldset>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-2xl border border-shell-accent/30 bg-white/70 px-4 py-3 font-body text-[13px] text-shell-ink">{errorMsg}</div>
      )}

      <button type="button" onClick={handleContinue} disabled={phase === 'saving'} aria-busy={phase === 'saving'}
        className={cn(
          'mt-7 flex min-h-[48px] items-center justify-center rounded-full px-8 font-body text-[16px] font-semibold lowercase transition',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
          phase === 'saving' ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35' : 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95')}>
        {phase === 'saving' ? 'saving…' : phase === 'error' ? 'try again' : 'next'}
      </button>
    </div>
  );
}
