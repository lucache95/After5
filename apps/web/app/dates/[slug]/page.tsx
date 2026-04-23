import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { ItineraryView } from '@/components/itinerary/ItineraryView';
import { FeedbackPulse } from '@/components/itinerary/FeedbackPulse';
import { OtherDates } from '@/components/itinerary/OtherDates';
import { imageForStop } from '@/lib/place-image';
import { loadItineraryStats } from '@/lib/itinerary-stats';
import { loadSimilarPlans } from '@/lib/itinerary-similar';
import type { Itinerary, Stop } from '@/lib/itinerary-types';

// Canonical SEO page for a generated date.
// Per the SEO plan: every itinerary becomes a standalone, indexable page that
// pulls long-tail Kelowna search traffic ("date with sandrine and skinny duke's").

export const revalidate = 3600;

const SITE_URL = 'https://tryafter5.app';

interface ItineraryRow {
  id: string;
  slug: string | null;
  template_id: string | null;
  title: string | null;
  hook: string | null;
  why_it_works: string | null;
  total_cost_pp: number | null;
  total_duration_min: number | null;
  stops: unknown;
  is_public: boolean;
  generated_at: string | null;
  modifier_id: string | null;
  modifier?: {
    id: string;
    label: string;
    body: string;
    difficulty: 'tame' | 'spicy' | 'chaos';
  } | null;
}

async function loadBySlug(slug: string): Promise<ItineraryRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('itineraries')
    .select('*, modifier:modifiers(id, label, body, difficulty)')
    .eq('slug', slug)
    .eq('is_public', true)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as ItineraryRow;
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const row = await loadBySlug(slug);
  if (!row) return { title: 'After5' };

  const stops = (Array.isArray(row.stops) ? row.stops : []) as Stop[];
  const stopNames = stops.map((s) => s.place_name).filter(Boolean);
  const cover = stops[0]
    ? imageForStop({ photo_url: stops[0].photo_url, place_type: stops[0].place_type })
    : '/og.jpg';
  const ogImage = cover.startsWith('http') ? cover : `${SITE_URL}${cover}`;

  const title = row.title ?? 'A Kelowna date plan';
  const desc = [
    row.hook,
    stopNames.length > 0 ? `Stops: ${stopNames.join(' · ')}.` : null,
    `Curated by After5 — date plans built by people who actually live in Kelowna.`,
  ]
    .filter(Boolean)
    .join(' ');

  const canonical = `${SITE_URL}/dates/${slug}`;

  return {
    title: `${title} — A Kelowna date plan | After5`,
    description: desc.slice(0, 160),
    alternates: { canonical },
    openGraph: {
      title,
      description: desc.slice(0, 200),
      url: canonical,
      siteName: 'After5',
      images: [{ url: ogImage, width: 1200, height: 900, alt: title }],
      locale: 'en_CA',
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: desc.slice(0, 200),
      images: [ogImage],
    },
  };
}

export default async function DatePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const row = await loadBySlug(slug);
  if (!row) notFound();

  const stops = (Array.isArray(row.stops) ? row.stops : []) as Stop[];

  const itinerary: Itinerary = {
    id: row.id,
    slug: row.slug ?? undefined,
    modifier: row.modifier ?? null,
    template_id: row.template_id ?? '',
    template_name: '',
    title: row.title ?? 'A plan for tonight',
    hook: row.hook ?? '',
    why_it_works: row.why_it_works ?? '',
    stops,
    total_cost_pp: row.total_cost_pp ?? 0,
    total_duration_min: row.total_duration_min ?? 0,
    vibe: [],
  };

  // Aggregate review stats + sibling plans, fetched in parallel since they
  // both block render and don't depend on each other.
  const [stats, similar] = await Promise.all([
    loadItineraryStats(
      row.id,
      stops.map((s) => ({ place_id: s.place_id, place_name: s.place_name })),
    ),
    loadSimilarPlans({ id: row.id, template_id: row.template_id ?? '' }),
  ]);

  // schema.org structured data — TouristTrip is the closest fit. Helps Google
  // understand this is a curated experience with a route + itemList of places.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: itinerary.title,
    description: itinerary.hook || itinerary.why_it_works,
    url: `${SITE_URL}/dates/${slug}`,
    touristType: ['Couples', 'Date'],
    itinerary: {
      '@type': 'ItemList',
      itemListElement: stops.map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: s.place_name,
        item: {
          '@type': 'Place',
          name: s.place_name,
          ...(s.lat && s.lng
            ? {
                geo: {
                  '@type': 'GeoCoordinates',
                  latitude: s.lat,
                  longitude: s.lng,
                },
              }
            : {}),
          ...(s.neighborhood
            ? { address: { '@type': 'PostalAddress', addressLocality: s.neighborhood, addressRegion: 'BC' } }
            : {}),
        },
      })),
    },
    ...(row.total_cost_pp
      ? {
          offers: {
            '@type': 'Offer',
            price: row.total_cost_pp,
            priceCurrency: 'CAD',
          },
        }
      : {}),
  };

  return (
    <main className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />

      <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4 md:px-10 md:py-5">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-text"
          >
            After5
          </Link>
          <Link
            href="/plan"
            className="inline-flex items-center gap-2 rounded-pill bg-text px-5 py-2.5 text-sm font-medium text-background transition-transform hover:-translate-y-0.5 md:px-6"
          >
            Plan your own — free
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </nav>
      </header>

      <ItineraryView
        itinerary={itinerary}
        stats={stats}
        similar={similar}
        fromHref={`/dates/${slug}`}
      />

      <div className="mx-auto max-w-content px-6 pb-16 md:px-10">
        <FeedbackPulse
          itineraryId={row.id}
          stops={itinerary.stops.map((s) => ({ place_id: s.place_id, place_name: s.place_name }))}
          source="public_date"
        />
      </div>

      <OtherDates excludeId={row.id} />

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-content flex-col items-center gap-6 px-6 py-12 md:flex-row md:justify-between md:px-10 md:py-16">
          <p className="text-xs text-muted">
            Built in Kelowna. Coming to Kamloops, Vernon, Penticton.
          </p>
          <div className="flex items-center gap-6 text-xs text-muted">
            <Link href="/privacy" className="transition-colors hover:text-text">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-text">
              Terms
            </Link>
            <a href="mailto:hello@tryafter5.app" className="transition-colors hover:text-text">
              hello@tryafter5.app
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
