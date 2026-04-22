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
    title: `Best ${t.label.toLowerCase()} in Kelowna | After5`,
    description: `Every ${t.label.toLowerCase().replace(/s$/, '')} we plan dates around in Kelowna — hand-curated by locals.`,
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
      .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops')
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

  return (
    <AggregatorView
      eyebrow={`Type · Kelowna`}
      title={`Kelowna ${t.label.toLowerCase()}.`}
      blurb={`Every ${t.label.toLowerCase().replace(/s$/, '')} we plan dates around. Pick one or browse the dates that feature them.`}
      ctaHref="/plan"
      ctaLabel="Plan a date"
      placesHeading={t.label}
      datesHeading={`Dates featuring a ${t.label.toLowerCase().replace(/s$/, '')}`}
      places={places}
      dates={dates}
    />
  );
}
