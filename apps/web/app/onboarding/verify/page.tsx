import { redirect } from 'next/navigation';
import { OnboardingShell } from '../OnboardingShell';
import { IdentityVerifyStep } from '../steps/IdentityVerifyStep';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function VerifyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/onboarding');

  // A verified or fully-onboarded user must NOT re-enter the verify step:
  // re-minting a Persona inquiry would re-seed 'pending' and un-verify them.
  const { data: p } = await supabase
    .from('profiles')
    .select('verification, onboarding_step')
    .eq('id', user.id)
    .maybeSingle();
  if ((p?.onboarding_step ?? 'age_gate') === 'done') redirect('/home');
  if (p?.verification === 'verified') redirect('/onboarding/done');

  return <OnboardingShell step={6}><IdentityVerifyStep /></OnboardingShell>;
}
