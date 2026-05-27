import { redirect } from 'next/navigation';
import { OnboardingShell } from '../OnboardingShell';
import { DoneStep } from '../steps/DoneStep';
import { createClient } from '@/lib/supabase/server';
import { badgeFor } from '@after5/business';

export const dynamic = 'force-dynamic';

export default async function DonePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/onboarding');

  const { data: p } = await supabase
    .from('profiles')
    .select('verification, reliability_score')
    .eq('id', user.id).maybeSingle();

  const badge = badgeFor({
    verification: (p?.verification ?? 'unverified') as Parameters<typeof badgeFor>[0]['verification'],
    reliability_score: p?.reliability_score ?? null,
  });

  return <OnboardingShell step={7}><DoneStep userId={user.id} badge={badge} /></OnboardingShell>;
}
