import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { browseFeed, type FeedFilters } from '@after5/api-client';
import { feedColdStartTier } from '@after5/business';
import { SwipeDeck } from './SwipeDeck';

export const dynamic = 'force-dynamic';

export default async function FeedPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/feed');
  // Seed feed_filters alongside the gate read so SwipeDeck knows whether a HARD
  // filter is active (filtered-empty vs genuinely-empty) and the chips reflect values.
  const { data: p } = await supabase
    .from('profiles').select('dating_enabled, verification, feed_filters').eq('id', user.id).maybeSingle();
  if (!p?.dating_enabled || p.verification !== 'verified') redirect('/onboarding');

  // feed_filters is jsonb; the inclusive default is an empty object.
  const filters = (p.feed_filters ?? {}) as FeedFilters;
  const nights = await browseFeed(supabase, { limit: 20 }).catch(() => []);
  const tier = feedColdStartTier({ compatibleOpen: nights.length, totalOpen: nights.length });
  return <SwipeDeck initial={nights} tier={tier} userId={user.id} filters={filters} />;
}
