import { redirect } from 'next/navigation';
import { OnboardingShell } from '../OnboardingShell';
import { BasicsStep, type BasicsInitial } from '../steps/BasicsStep';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function BasicsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/onboarding');

  const [{ data: profile }, { data: priv }] = await Promise.all([
    supabase.from('profiles').select('first_name, vibe_tags, prompt_answers').eq('id', user.id).maybeSingle(),
    supabase.from('profiles_private').select('bio').eq('user_id', user.id).maybeSingle(),
  ]);

  const initial: BasicsInitial = {
    first_name: profile?.first_name ?? '',
    bio: priv?.bio ?? '',
    vibe_tags: (profile?.vibe_tags as string[] | null) ?? [],
    prompts: (profile?.prompt_answers as { prompt_id: string; answer: string }[] | null) ?? [],
  };

  return <OnboardingShell step={2}><BasicsStep userId={user.id} initial={initial} /></OnboardingShell>;
}
