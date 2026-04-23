import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { ItineraryView } from '@/components/itinerary/ItineraryView';
import { OtherDates } from '@/components/itinerary/OtherDates';
import { loadSimilarPlans } from '@/lib/itinerary-similar';
import type { Itinerary, Stop } from '@/lib/itinerary-types';

// Legacy UUID-based public URL. The canonical route is /dates/[slug] for SEO.
// We render the same content here (so old shared links keep working) but
// declare the /dates/[slug] URL as canonical via <link rel=canonical>. Google
// consolidates PageRank on the slug URL. The visible "Share" button also
// prefers the slug URL so new links carry the canonical directly.

export const revalidate = 3600;
export const dynamic = 'force-dynamic';

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
  modifier?: { id: string; label: string; body: string; difficulty: 'tame'|'spicy'|'chaos' } | null;
}

async function loadById(id: string): Promise<ItineraryRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('itineraries')
    .select('*, modifier:modifiers(id, label, body, difficulty)')
    .eq('id', id)
    .maybeSingle();
  return (data ?? null) as ItineraryRow | null;
}

export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await props.params;
  const row = await loadById(id);
  if (!row?.slug) return {};
  return { alternates: { canonical: `https://tryafter5.app/dates/${row.slug}` } };
}

export default async function PublicItineraryPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const row = await loadById(id);
  if (!row) notFound();
  const stops = (Array.isArray(row.stops) ? row.stops : []) as Stop[];

  // Derive vibe set from stop neighborhoods/types as a quiet fallback for older
  // rows that don't have a vibe column. The Edge Function output now carries it.
  const similar = await loadSimilarPlans({
    id: row.id,
    template_id: row.template_id ?? '',
  });

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

  return (
    <main className="min-h-screen">
      {/* Header sits over the dark hero, transparent + white */}
      <header className="absolute inset-x-0 top-0 z-50">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-6 md:px-10 md:py-7">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.35)]"
          >
            After5
          </Link>
          <Link
            href="/plan"
            className="inline-flex items-center gap-2 rounded-pill bg-white px-5 py-2.5 text-sm font-medium text-text transition-transform hover:-translate-y-0.5 md:px-6 md:py-3"
          >
            Plan your own — free
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </nav>
      </header>

      <ItineraryView itinerary={itinerary} similar={similar} />

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
