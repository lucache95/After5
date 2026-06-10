// apps/web/app/account/preferences/page.tsx
// Editable dating preferences settings (E4 / D-09 / REQ-E4). Auth-gated SSR route
// that hydrates the viewer's current prefs + dating_enabled and renders the shared
// <PreferencesForm mode="account">. This is a DEEP route — DeepRouteHeader (E1),
// no tab bar — and a first-class entry point, so it keeps the V2 auth gate.
//
// Security: userId is derived SERVER-SIDE from getUser() (never client-supplied,
// V4 / T-03-02); savePreferences + the dating toggle write .eq('id', userId) under
// RLS (auth.uid() backstop). Validation is V5 inside the form (PreferencesInputSchema).
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { DeepRouteHeader } from '@/components/DeepRouteHeader';
import { PreferencesForm, type PreferencesInitial } from '@/components/PreferencesForm';
import { parseAgePref } from '@/lib/after5/parseAgePref';

export const dynamic = 'force-dynamic';

export default async function AccountPreferencesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account/preferences');

  const { data: p } = await supabase
    .from('profiles')
    .select('gender, gender_preferences, age_pref, distance_pref_km, dealbreakers, smokes, drinks, has_pets, wants_kids, dating_enabled')
    .eq('id', user.id)
    .maybeSingle();

  const age = parseAgePref(p?.age_pref);
  const initial: PreferencesInitial = {
    gender: p?.gender ?? 'woman',
    gender_preferences: (p?.gender_preferences as string[] | null) ?? ['man'],
    age_min: age.min,
    age_max: age.max,
    distance_pref_km: p?.distance_pref_km ?? 40,
    dealbreakers: (p?.dealbreakers as string[] | null) ?? [],
    smokes: p?.smokes ?? null,
    drinks: p?.drinks ?? null,
    has_pets: p?.has_pets ?? null,
    wants_kids: p?.wants_kids ?? null,
  };

  return (
    <>
      <DeepRouteHeader title="preferences" backHref="/account" backLabel="back to your account" />
      {/* deep route: pb-20 (no bottom-nav clearance), per UI-SPEC §Spacing */}
      <main className="mx-auto w-full max-w-[420px] px-5 pb-20 pt-8">
        <h1 className="font-heading text-3xl lowercase text-shell-ink">settings</h1>
        <p className="mt-1 font-body text-sm text-shell-ink/70">who we line up for you. tweak it whenever.</p>
        <PreferencesForm
          mode="account"
          userId={user.id}
          initial={initial}
          datingEnabled={p?.dating_enabled ?? false}
        />
      </main>
    </>
  );
}
