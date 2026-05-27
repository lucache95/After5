import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Auth gate for the whole /onboarding/* subtree. Step routing lives in page.tsx
// (the index), which sends a `done` user to /home on normal entry. We do NOT
// bounce `done` here, because /onboarding/done is the legitimate terminal
// celebration the verified user lands on right after VerificationStatus advances.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/onboarding');
  return <>{children}</>;
}
