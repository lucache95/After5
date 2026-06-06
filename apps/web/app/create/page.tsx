import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { initialCityText, type KnownCity } from '@/lib/create/cities';
import { CreateFlow } from './CreateFlow';
import { CreateChooser } from './CreateChooser';

export const dynamic = 'force-dynamic';

// #85 — /create is the "+" landing. Authed users get the two-door chooser (build it
// for me vs. start from scratch). Anon users see door 1 only (the generate funnel) —
// door 2 needs an owned itinerary + verification to post, so it stays behind sign-in.
// Marketing links into /create therefore still drop anon straight onto the funnel.
export default async function CreatePage() {
  const h = await headers();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) return <CreateChooser />;

  // Anon: the free-try generate funnel (door 1). Curated cities power the quick-pick
  // chips; the city field itself is free text (open-city), so any typed city generates.
  const { data: cityRows } = await supabase
    .from('cities')
    .select('id,slug,name')
    .eq('is_active', true)
    .order('name');

  const cities: KnownCity[] = (cityRows as KnownCity[] | null) ?? [];
  const initialCity = initialCityText(h.get('x-vercel-ip-city'));

  return (
    <CreateFlow
      initialCity={initialCity}
      authed={false}
      cities={cities}
      canPublish={false}
    />
  );
}
