import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { verifyFeedbackToken } from '@/lib/email/feedback-token';
import { createAdminClient } from '@/lib/supabase/admin';
import { FeedbackForm } from './FeedbackForm';
import type { Stop } from '@/lib/itinerary-types';

export const metadata: Metadata = {
  title: 'How was your date?',
  robots: { index: false, follow: false },
};

interface ItineraryRow {
  id: string;
  title: string | null;
  stops: unknown;
  cover_image_url: string | null;
}

export default async function FeedbackPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const decoded = verifyFeedbackToken(decodeURIComponent(token));
  if (!decoded) return notFound();

  const admin = createAdminClient();
  const { data: itinerary } = await admin
    .from('itineraries')
    .select('id, title, stops, cover_image_url')
    .eq('id', decoded.itineraryId)
    .maybeSingle();

  if (!itinerary) return notFound();

  const row = itinerary as unknown as ItineraryRow;
  const stops: Stop[] = Array.isArray(row.stops) ? (row.stops as Stop[]) : [];

  return (
    <FeedbackForm
      token={token}
      itineraryId={row.id}
      dateTitle={row.title ?? 'Your date'}
      coverImageUrl={row.cover_image_url}
      stops={stops.map((s) => ({
        place_id: s.place_id,
        place_name: s.place_name,
        place_type: s.place_type ?? null,
        photo_url: s.photo_url ?? null,
        what_to_do: s.what_to_do ?? null,
      }))}
    />
  );
}
