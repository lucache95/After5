import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { AggregatorView, type PlaceCardData, type DateCardData } from '@/components/AggregatorView';
import { findVibe, VIBES } from '@/lib/taxonomy';

export const revalidate = 3600;
const SITE = 'https://tryafter5.app';

export async function generateStaticParams() {
  return VIBES.map((v) => ({ vibe: v.slug }));
}

export async function generateMetadata(props: { params: Promise<{ vibe: string }> }): Promise<Metadata> {
  const { vibe } = await props.params;
  const v = findVibe(vibe);
  if (!v) return {};
  return {
    title: `${v.label.toLowerCase()} dates in kelowna · after5`,
    description: `${v.blurb} real ${v.label.toLowerCase()} spots and date plans in kelowna, picked by locals.`,
    alternates: { canonical: `${SITE}/vibes/${v.slug}` },
  };
}

export default async function VibePage(props: { params: Promise<{ vibe: string }> }) {
  const { vibe } = await props.params;
  const v = findVibe(vibe);
  if (!v) notFound();

  const supabase = await createClient();
  const [placesRes, datesRes] = await Promise.all([
    supabase
      .from('places')
      .select('id, slug, name, neighborhood, type, photo_url, price_tier, rating')
      .eq('is_active', true)
      .eq('approval_status', 'live')
      .contains('vibe_tags', [v.slug])
      .order('rating', { ascending: false, nullsFirst: false })
      .limit(48),
    supabase
      .from('itineraries')
      .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops, inputs, cover_image_url')
      .eq('is_public', true)
      .not('slug', 'is', null)
      .order('generated_at', { ascending: false })
      .limit(80),
  ]);
  const places = (placesRes.data ?? []) as PlaceCardData[];
  const allDates = (datesRes.data ?? []) as Array<DateCardData & { inputs?: { vibe?: string[] } }>;
  const dates = allDates
    .filter((d) => d.inputs?.vibe?.includes(v.slug))
    .slice(0, 9);

  const lower = v.label.toLowerCase();
  return (
    <AggregatorView
      eyebrow={`vibe · ${lower}`}
      title={lower}
      blurb={v.blurb}
      ctaHref="/create"
      ctaLabel="build a date here"
      placesHeading={`${lower} spots`}
      datesHeading={`${lower} nights`}
      places={places}
      dates={dates}
    />
  );
}
