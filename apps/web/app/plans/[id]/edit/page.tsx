// M3 owner-only edit route. Loads the itinerary server-side; 404s if the row is
// missing or not owned by the signed-in user (defense-in-depth beside the RPC's
// own owner check). Renders the client ItineraryEditor with the loaded data.
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ItineraryEditor } from './ItineraryEditor';
import type { Stop } from '@/lib/itinerary-types';

export const dynamic = 'force-dynamic';

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/plans/${id}/edit`);

  const { data: it } = await supabase
    .from('itineraries')
    .select('id,user_id,title,cover_image_url,stops')
    .eq('id', id)
    .maybeSingle();
  if (!it || it.user_id !== user.id) notFound();

  return (
    <ItineraryEditor
      itineraryId={it.id}
      initialStops={(Array.isArray(it.stops) ? it.stops : []) as unknown as Stop[]}
      initialTitle={it.title}
      initialCover={it.cover_image_url}
    />
  );
}
