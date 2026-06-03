import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { initialCityText, type KnownCity } from '@/lib/create/cities';
import { CreateFlow } from './CreateFlow';

export const dynamic = 'force-dynamic';

export default async function CreatePage() {
  const h = await headers();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Curated cities power the quick-pick chips; the city field itself is free
  // text now (open-city), so any typed city generates. When signed in we also
  // load the dating-profile gate for publish-to-feed.
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
