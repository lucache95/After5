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
    supabase.from('cities').select('slug,name').eq('is_active', true).order('name'),
    user
      ? supabase.from('profiles').select('dating_enabled, verification').eq('id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const cities: KnownCity[] = (cityRows as KnownCity[] | null) ?? [];
  const initialCity = initialCityText(h.get('x-vercel-ip-city'));
  const canPublish = !!user && !!profile?.dating_enabled && profile.verification === 'verified';

  return (
    <CreateFlow
      initialCity={initialCity}
      authed={!!user}
      cities={cities}
      canPublish={canPublish}
    />
  );
}
