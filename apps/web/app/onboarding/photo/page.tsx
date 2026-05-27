import { redirect } from 'next/navigation';
import { OnboardingShell } from '../OnboardingShell';
import { PhotoStep } from '../steps/PhotoStep';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function PhotoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/onboarding');
  return <OnboardingShell step={3}><PhotoStep userId={user.id} /></OnboardingShell>;
}
