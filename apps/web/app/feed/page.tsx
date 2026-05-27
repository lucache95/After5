import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { browseFeed } from '@after5/api-client';
import { feedColdStartTier } from '@after5/business';
import { SwipeDeck } from './SwipeDeck';

export const dynamic = 'force-dynamic';

export default async function FeedPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/feed');
  const { data: p } = await supabase
    .from('profiles').select('dating_enabled, verification').eq('id', user.id).maybeSingle();
  if (!p?.dating_enabled || p.verification !== 'verified') redirect('/onboarding');

  const nights = await browseFeed(supabase, { limit: 20 }).catch(() => []);
  const tier = feedColdStartTier({ compatibleOpen: nights.length, totalOpen: nights.length });
  return <SwipeDeck initial={nights} tier={tier} />;
}
