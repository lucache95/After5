import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { AggregatorView, type PlaceCardData, type DateCardData } from '@/components/AggregatorView';
import { findNeighborhood, neighborhoodFromSlug, NEIGHBORHOODS } from '@/lib/taxonomy';

export const revalidate = 3600;
const SITE = 'https://tryafter5.app';

export async function generateStaticParams() {
  return NEIGHBORHOODS.map((n) => ({ slug: n.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const n = findNeighborhood(slug);
  if (!n) return {};
  return {
    title: `things to do in ${n.label.toLowerCase()}, kelowna · after5`,
    description: `${n.blurb} hand-picked ${n.label.toLowerCase()} restaurants, bars, walks, and date plans.`,
    alternates: { canonical: `${SITE}/neighborhoods/${n.slug}` },
  };
}

export default async function NeighborhoodPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const n = findNeighborhood(slug);
  if (!n) notFound();
  const dbValue = neighborhoodFromSlug(slug);

  const supabase = await createClient();
  const [placesRes, datesRes] = await Promise.all([
    supabase
      .from('places')
      .select('id, slug, name, neighborhood, type, photo_url, price_tier, rating')
      .eq('is_active', true)
      .eq('approval_status', 'live')
      .eq('neighborhood', dbValue)
      .order('rating', { ascending: false, nullsFirst: false })
      .limit(48),
    supabase
      .from('itineraries')
      .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops, cover_image_url')
      .eq('is_public', true)
      .not('slug', 'is', null)
      .order('generated_at', { ascending: false })
      .limit(120),
  ]);
  const places = (placesRes.data ?? []) as PlaceCardData[];
  const placeIds = new Set(places.map((p) => p.id));
  const allDates = (datesRes.data ?? []) as DateCardData[];
  // A date "fits" the neighborhood if any of its stops are there.
  const dates = allDates
    .filter((d) => {
      const stops = (Array.isArray(d.stops) ? d.stops : []) as Array<{ place_id?: string }>;
      return stops.some((s) => s.place_id && placeIds.has(s.place_id));
    })
    .slice(0, 9);

  const lower = n.label.toLowerCase();
  return (
    <AggregatorView
      eyebrow="by area"
      title={lower}
      blurb={n.blurb}
      ctaHref="/create"
      ctaLabel="build a date here"
      placesHeading={`${lower} spots`}
      datesHeading={`nights featuring ${lower}`}
      places={places}
      dates={dates}
    />
  );
}
