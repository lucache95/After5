import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { resolveCitySlug, type KnownCity } from '@/lib/create/cities';
import { CreateFlow } from './CreateFlow';

export const dynamic = 'force-dynamic';

export default async function CreatePage() {
  const h = await headers();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Load generatable cities + (when signed in) the dating-profile gate for
  // publish-to-feed. canPublish = authed && dating_enabled && verified.
  const [{ data: cityRows }, { data: profile }] = await Promise.all([
    supabase.from('cities').select('slug,name').eq('is_active', true).order('name'),
    user
      ? supabase.from('profiles').select('dating_enabled, verification').eq('id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const cities: KnownCity[] = (cityRows as KnownCity[] | null) ?? [{ slug: 'kelowna', name: 'Kelowna' }];
  const { slug, fellBack } = resolveCitySlug(h.get('x-vercel-ip-city'), cities);
  const canPublish = !!user && !!profile?.dating_enabled && profile.verification === 'verified';

  return (
    <CreateFlow
      initialCity={slug}
      fellBack={fellBack}
      authed={!!user}
      cities={cities}
      canPublish={canPublish}
    />
  );
}
