// apps/web/app/onboarding/steps/PreferencesStep.tsx
'use client';
// Step 4 (preferences): orientation + age range + distance + dealbreakers. Validates
// with PreferencesInputSchema, persists via savePreferences (writes the flat profiles
// columns the S5 pre-filter reads), then advanceOnboarding('phone_verify').
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PreferencesInputSchema, GenderSchema, DealbreakerSchema } from '@after5/validators';
import { cn } from '@/lib/cn';
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

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-text">Who you&apos;re looking for</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-secondary">This shapes who we match you with.</p>

      <fieldset className="mt-7">
        <legend className="mb-2 text-sm font-medium text-text">I am</legend>
        <div className="flex flex-wrap gap-2">
          {GENDERS.map((g) => (
            <button key={g} type="button" onClick={() => setGender(g)}
              className={cn('rounded-pill border px-4 py-2 text-sm capitalize',
                gender === g ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-white text-secondary')}>{g}</button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="mb-2 text-sm font-medium text-text">Interested in</legend>
        <div className="flex flex-wrap gap-2">
          {GENDERS.map((g) => (
            <button key={g} type="button" onClick={() => toggle(wants, g, setWants)}
              className={cn('rounded-pill border px-4 py-2 text-sm capitalize',
                wants.includes(g) ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-white text-secondary')}>{g}</button>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <label className="text-sm font-medium text-text">Age from
          <input type="number" min={18} max={99} value={ageMin} onChange={(e) => setAgeMin(Number(e.target.value))}
            className="mt-1.5 block w-full rounded-card border border-border bg-white px-3 py-2 [font-variant-numeric:tabular-nums] focus:border-accent" />
        </label>
        <label className="text-sm font-medium text-text">Age to
          <input type="number" min={18} max={99} value={ageMax} onChange={(e) => setAgeMax(Number(e.target.value))}
            className="mt-1.5 block w-full rounded-card border border-border bg-white px-3 py-2 [font-variant-numeric:tabular-nums] focus:border-accent" />
        </label>
      </div>

      <label className="mt-6 block text-sm font-medium text-text">Within {distance} km
        <input type="range" min={1} max={150} value={distance} onChange={(e) => setDistance(Number(e.target.value))} className="mt-2 w-full accent-accent" />
      </label>

      <fieldset className="mt-6">
        <legend className="mb-2 text-sm font-medium text-text">Dealbreakers</legend>
        <div className="flex flex-wrap gap-2">
          {DEALBREAKERS.map((d) => (
            <button key={d} type="button" onClick={() => toggle(dealbreakers, d, setDealbreakers)}
              className={cn('rounded-pill border px-3 py-1.5 text-[13px]',
                dealbreakers.includes(d) ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-white text-secondary')}>{d.replace(/_/g, ' ')}</button>
          ))}
        </div>
      </fieldset>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{errorMsg}</div>
      )}

      <button type="button" onClick={handleContinue} disabled={phase === 'saving'}
        className={cn('mt-7 inline-flex items-center justify-center rounded-pill px-7 py-3 text-[15px] font-medium transition-all',
          phase === 'saving' ? 'cursor-not-allowed bg-border text-muted' : 'bg-text text-background hover:-translate-y-0.5')}>
        {phase === 'saving' ? 'Saving…' : phase === 'error' ? 'Try again' : 'Continue'}
      </button>
    </div>
  );
}
