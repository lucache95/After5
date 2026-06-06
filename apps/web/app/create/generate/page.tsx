import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { initialCityText, type KnownCity } from '@/lib/create/cities';
import { CreateFlow } from '../CreateFlow';

export const dynamic = 'force-dynamic';

// #85 door 1 ("build it for me") — the AI generate funnel reached from the chooser.
// Same CreateFlow the anon free-try uses; authed result lands on the §2A canvas via
// the "tweak it on the canvas" CTA. Authed-only entry (the chooser only routes signed-in
// users here); anon hits /create's funnel directly.
export default async function GenerateNightPage() {
  const h = await headers();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: cityRows }, { data: profile }] = await Promise.all([
    supabase.from('cities').select('id,slug,name').eq('is_active', true).order('name'),
    user
      ? supabase
          .from('profiles')
          .select('dating_enabled, verification, primary_city_id, primary_city:cities!profiles_primary_city_id_fkey(name)')
          .eq('id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const cities: KnownCity[] = (cityRows as KnownCity[] | null) ?? [];
  const initialCity = initialCityText(h.get('x-vercel-ip-city'));
  const canPublish = !!user && !!profile?.dating_enabled && profile.verification === 'verified';

  // Prefill the saved home-city for a returning user (Area 2). The join may come
  // back as an object or a single-element array depending on the FK shape; read
  // the name defensively.
  const prefillCityId = (profile?.primary_city_id as string | null) ?? null;
  const joined = (profile as { primary_city?: { name?: string } | { name?: string }[] } | null)?.primary_city;
  const prefillCityName = Array.isArray(joined) ? (joined[0]?.name ?? null) : (joined?.name ?? null);

  return (
    <CreateFlow
      initialCity={initialCity}
      authed={!!user}
      cities={cities}
      canPublish={canPublish}
      prefillCityId={prefillCityId}
      prefillCityName={prefillCityName}
    />
  );
}
