import { redirect } from 'next/navigation';
import { OnboardingShell } from '../OnboardingShell';
import { PreferencesStep, type PreferencesInitial } from '../steps/PreferencesStep';
import { createClient } from '@/lib/supabase/server';
import { parseAgePref } from '@/lib/after5/parseAgePref';

export const dynamic = 'force-dynamic';

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
