import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { AggregatorView, type PlaceCardData, type DateCardData } from '@/components/AggregatorView';
import { findPlaceType, PLACE_TYPES } from '@/lib/taxonomy';

export const revalidate = 3600;
const SITE = 'https://tryafter5.app';

export async function generateStaticParams() {
  return PLACE_TYPES.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const t = findPlaceType(slug);
  if (!t) return {};
  return {
    title: `best ${t.label.toLowerCase()} in kelowna · after5`,
    description: `every ${t.label.toLowerCase().replace(/s$/, '')} we plan dates around in kelowna, hand-picked by locals.`,
    alternates: { canonical: `${SITE}/types/${t.slug}` },
  };
}

export default async function TypePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const t = findPlaceType(slug);
  if (!t) notFound();

  const supabase = await createClient();
  const [placesRes, datesRes] = await Promise.all([
    supabase
      .from('places')
      .select('id, slug, name, neighborhood, type, photo_url, price_tier, rating')
      .eq('is_active', true)
      .eq('approval_status', 'live')
      .eq('type', t.dbValue)
      .order('rating', { ascending: false, nullsFirst: false })
      .limit(60),
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
  const dates = allDates
    .filter((d) => {
      const stops = (Array.isArray(d.stops) ? d.stops : []) as Array<{ place_id?: string }>;
      return stops.some((s) => s.place_id && placeIds.has(s.place_id));
    })
    .slice(0, 9);

  const lower = t.label.toLowerCase();
  const singular = lower.replace(/s$/, '');
  return (
    <AggregatorView
      eyebrow="by category"
      title={lower}
      blurb={`every ${singular} we build dates around. pick one or browse the nights that feature them.`}
      ctaHref="/create"
      ctaLabel="build a date here"
      placesHeading={lower}
      datesHeading={`nights featuring a ${singular}`}
      places={places}
      dates={dates}
    />
  );
}
