import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { routeForStep } from '@/lib/onboarding/steps';
import type { OnboardingStep } from '@after5/validators';

export const dynamic = 'force-dynamic';

export default async function OnboardingIndex() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/onboarding');

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_step')
    .eq('id', user.id)
    .maybeSingle();

  const step = (profile?.onboarding_step ?? 'age_gate') as OnboardingStep;
  redirect(routeForStep(step));
}
