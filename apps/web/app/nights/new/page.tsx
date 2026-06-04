import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listAmbientSounds } from '@after5/api-client';
import { PostNightForm } from './PostNightForm';

export const dynamic = 'force-dynamic';

export default async function NewNightPage({
  searchParams,
}: {
  searchParams: Promise<{ itinerary?: string }>;
}) {
  const { itinerary } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/nights/new');

  const { data: p } = await supabase
    .from('profiles')
    .select('dating_enabled, verification, primary_city_id, cities:primary_city_id (name)')
    .eq('id', user.id)
    .maybeSingle();
  if (!p?.dating_enabled || p.verification !== 'verified') redirect('/onboarding');

  // E10/D-01: the host's home city scopes the reach-preview count.
  const primaryCityId = p.primary_city_id ?? null;
  const city = p.cities as { name?: string | null } | { name?: string | null }[] | null;
  const cityName = (Array.isArray(city) ? city[0]?.name : city?.name) ?? null;

  const { data: plans } = await supabase
    .from('itineraries')
    .select('id, title, cover_image_url, vibe_tags')
    .or(`user_id.eq.${user.id},is_public.eq.true`)
    .order('generated_at', { ascending: false })
    .limit(30);

  const ambientSounds = await listAmbientSounds(supabase as never);

  return (
    <PostNightForm
      plans={plans ?? []}
      ambientSounds={ambientSounds}
      itineraryId={itinerary}
      primaryCityId={primaryCityId}
      cityName={cityName}
    />
  );
}
