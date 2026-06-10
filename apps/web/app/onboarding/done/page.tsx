import { redirect } from 'next/navigation';
import { OnboardingShell } from '../OnboardingShell';
import { DoneStep } from '../steps/DoneStep';
import { createClient } from '@/lib/supabase/server';
import { badgeFor, canEnableDating } from '@after5/business';
import type { VerificationState } from '@after5/validators';
import { displayGateReason } from '@/lib/onboarding/dating-gate';

export const dynamic = 'force-dynamic';

export default async function DonePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/onboarding');

  const [{ data: p }, { data: priv }] = await Promise.all([
    supabase.from('profiles').select('verification, reliability_score, onboarding_step').eq('id', user.id).maybeSingle(),
    supabase.from('profiles_private').select('birthdate').eq('user_id', user.id).maybeSingle(),
  ]);

  const verification = (p?.verification ?? 'unverified') as VerificationState;
  const badge = badgeFor({ verification, reliability_score: p?.reliability_score ?? null });
  const gate = canEnableDating({
    birthdate: (priv?.birthdate as string | null) ?? null,
    verification,
    onboarding_step: p?.onboarding_step ?? 'age_gate',
  });

  // P2 (skip-to-done): a user who never scanned an id must see "not verified
  // yet", not an invented "couldn't read your date of birth" failure.
  const reason = displayGateReason(gate.reason, verification);

  return <OnboardingShell step={7}><DoneStep userId={user.id} badge={badge} gate={{ ok: gate.ok, reason }} /></OnboardingShell>;
}
