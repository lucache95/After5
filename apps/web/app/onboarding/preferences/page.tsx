import { redirect } from 'next/navigation';
import { OnboardingShell } from '../OnboardingShell';
import { PreferencesStep, type PreferencesInitial } from '../steps/PreferencesStep';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// age_pref is stored canonical as '[lo,hi)' (upper exclusive). Parse to inclusive min/max.
function parseAgePref(raw: unknown): { min: number; max: number } {
  if (typeof raw !== 'string') return { min: 25, max: 40 };
  const m = raw.match(/^\[(\d+),(\d+)\)$/) ?? raw.match(/^\[(\d+),(\d+)\]$/);
  if (!m) return { min: 25, max: 40 };
  const lo = Number(m[1]); const hiRaw = Number(m[2]);
  const inclusiveHi = raw.endsWith(')') ? hiRaw - 1 : hiRaw;
  return { min: lo, max: inclusiveHi };
}

export default async function PreferencesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/onboarding');

  const { data: p } = await supabase
    .from('profiles')
    .select('gender, gender_preferences, age_pref, distance_pref_km, dealbreakers')
    .eq('id', user.id).maybeSingle();

  const age = parseAgePref(p?.age_pref);
  const initial: PreferencesInitial = {
    gender: p?.gender ?? 'woman',
    gender_preferences: (p?.gender_preferences as string[] | null) ?? ['man'],
    age_min: age.min, age_max: age.max,
    distance_pref_km: p?.distance_pref_km ?? 40,
    dealbreakers: (p?.dealbreakers as string[] | null) ?? [],
  };

  return <OnboardingShell step={4}><PreferencesStep userId={user.id} initial={initial} /></OnboardingShell>;
}
