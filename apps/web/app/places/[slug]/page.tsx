import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowRight, MapPin, Info, Lightbulb, ExternalLink } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { imageForStop } from '@/lib/place-image';
import { coverImageFor } from '@/lib/place-image';

// SEO-canonical page for a single Kelowna spot. Cross-links to the dates
// that include it, so a long-tail "skinny duke's kelowna" search lands here
// and discovers our curated date plans organically.

export const revalidate = 3600;
const SITE = 'https://after5.app';

interface PlaceRow {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  neighborhood: string;
  type: string;
  vibe_tags: string[];
  pairing_tags: string[];
  effort: string;
  energy: string;
  typical_duration_min: number;
  price_tier: string;
  typical_per_person: number | null;
  reservation_required: boolean;
  reservation_url: string | null;
  photo_url: string | null;
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
  local_insight: string | null;
  notes: string | null;
}

interface ItineraryRow {
  id: string;
  slug: string | null;
  title: string | null;
  hook: string | null;
  total_cost_pp: number | null;
  total_duration_min: number | null;
  stops: unknown;
}

interface StopLite {
  place_id: string;
  place_type?: string;
  photo_url?: string | null;
}

async function loadPlace(slug: string): Promise<PlaceRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('places')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();
  return (data ?? null) as PlaceRow | null;
}

async function loadDatesFeaturing(placeId: string): Promise<ItineraryRow[]> {
  // Fetch a wider set then filter client-side because Postgres JSONB array
  // contains is awkward; with ~hundreds of plans the client-side filter is fine.
  const supabase = await createClient();
  const { data } = await supabase
    .from('itineraries')
    .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops')
    .eq('is_public', true)
    .not('slug', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(100);
  const all = (data ?? []) as ItineraryRow[];
  return all
    .filter((it) => {
      const stops = (Array.isArray(it.stops) ? it.stops : []) as Array<{ place_id?: string }>;
      return stops.some((s) => s.place_id === placeId);
    })
    .slice(0, 6);
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const p = await loadPlace(slug);
  if (!p) return { title: 'Place not found · After5' };

  const cover = imageForStop({ photo_url: p.photo_url, place_type: p.type });
  const ogImage = cover.startsWith('http') ? cover : `${SITE}${cover}`;

  return {
    title: `${p.name} — ${p.neighborhood} ${p.type.replace(/_/g, ' ')} | After5`,
    description: `${p.name} is a ${p.neighborhood} ${p.type.replace(/_/g, ' ')} in Kelowna. ${p.local_insight ?? p.notes ?? ''} Featured in After5 date plans.`.slice(0, 160),
    alternates: { canonical: `${SITE}/places/${p.slug}` },
    openGraph: {
      title: `${p.name} · After5`,
      description: p.local_insight ?? p.notes ?? `${p.neighborhood} ${p.type.replace(/_/g, ' ')} in Kelowna`,
      url: `${SITE}/places/${p.slug}`,
      siteName: 'After5',
      images: [{ url: ogImage, width: 1200, height: 900, alt: p.name }],
      type: 'website',
    },
  };
}

export default async function PlacePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const p = await loadPlace(slug);
  if (!p) notFound();

  const dates = await loadDatesFeaturing(p.id);
  const cover = imageForStop({ photo_url: p.photo_url, place_type: p.type });
  const directionsUrl = p.lat && p.lng
    ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ', Kelowna BC')}`;
  const moreInfoUrl = `https://www.google.com/search?q=${encodeURIComponent(p.name + ' Kelowna')}`;

  // schema.org Place — gives Google address, geo, image, etc.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: p.name,
    description: p.local_insight ?? p.notes ?? undefined,
    image: cover.startsWith('http') ? cover : `${SITE}${cover}`,
    url: `${SITE}/places/${p.slug}`,
    address: { '@type': 'PostalAddress', addressLocality: p.neighborhood, addressRegion: 'BC', addressCountry: 'CA' },
    ...(p.lat && p.lng
      ? { geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng } }
      : {}),
  };

  return (
    <main className="min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />

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
            Plan a date — free
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative isolate min-h-[60vh] w-full overflow-hidden bg-surface md:min-h-[70vh]">
        <Image src={cover} alt="" fill priority sizes="100vw" className="object-cover" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/20" />
        <div className="relative mx-auto flex h-full min-h-[60vh] w-full max-w-content flex-col justify-end px-6 pb-12 pt-32 md:min-h-[70vh] md:px-10 md:pb-16 md:pt-40">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.22em] text-white/85">
            {p.neighborhood} · Kelowna
          </p>
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-[-0.025em] text-white md:text-6xl">
            {p.name}
          </h1>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-base text-white/90">
            <span className="capitalize">{p.type.replace(/_/g, ' ')}</span>
            <span aria-hidden className="text-white/50">·</span>
            <span>{p.price_tier}</span>
            {p.typical_per_person !== null && p.typical_per_person > 0 && (
              <>
                <span aria-hidden className="text-white/50">·</span>
                <span>~${Math.round(p.typical_per_person)} pp</span>
              </>
            )}
            <span aria-hidden className="text-white/50">·</span>
            <span>{p.typical_duration_min} min visit</span>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-content px-6 py-16 md:px-10 md:py-20">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-[1fr_320px] md:gap-16">
          <div>
            {p.local_insight && (
              <div className="flex gap-4 rounded-card border border-accent/30 bg-accent-soft/60 p-5 md:p-6">
                <Lightbulb className="mt-1 h-5 w-5 shrink-0 text-accent" strokeWidth={2} />
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
                    Local tip
                  </p>
                  <p className="mt-2 text-base leading-relaxed text-text md:text-lg">
                    {p.local_insight}
                  </p>
                </div>
              </div>
            )}

            {p.notes && (
              <div className="mt-10">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Notes</p>
                <p className="mt-3 max-w-prose text-base leading-relaxed text-secondary">
                  {p.notes}
                </p>
              </div>
            )}

            {p.vibe_tags.length > 0 && (
              <div className="mt-10">
                <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                  Vibe
                </p>
                <div className="flex flex-wrap gap-2">
                  {p.vibe_tags.map((v) => (
                    <span
                      key={v}
                      className="rounded-pill border border-border bg-surface px-3 py-1 text-sm text-text"
                    >
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Side rail */}
          <aside className="md:sticky md:top-8 md:self-start">
            <div className="space-y-3 rounded-card border border-border bg-surface p-6 md:p-7">
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-pill bg-primary px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85"
              >
                <MapPin className="h-4 w-4" strokeWidth={2} />
                Open in Maps
              </a>
              <a
                href={moreInfoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-pill border border-border bg-background px-5 py-3 text-sm font-medium text-text transition-colors hover:border-text/40"
              >
                <Info className="h-4 w-4" strokeWidth={2} />
                Hours / reviews
              </a>
              {p.reservation_required && (
                <a
                  href={p.reservation_url ?? moreInfoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-pill bg-text px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85"
                >
                  Book — required
                  <ExternalLink className="h-4 w-4" strokeWidth={2} />
                </a>
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* Cross-link to dates featuring this place */}
      {dates.length > 0 && (
        <section className="border-t border-border bg-surface">
          <div className="mx-auto max-w-content px-6 py-20 md:px-10 md:py-28">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Date plans featuring {p.name}
            </p>
            <h2 className="font-display text-2xl font-bold leading-tight tracking-[-0.01em] text-text md:text-3xl">
              Build a night around it.
            </h2>

            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-7">
              {dates.map((it) => {
                const stops = (Array.isArray(it.stops) ? it.stops : []) as StopLite[];
                const cover2 = coverImageFor(stops);
                const totalHr = it.total_duration_min !== null
                  ? Math.round((it.total_duration_min / 60) * 10) / 10
                  : 0;
                return (
                  <Link key={it.id} href={`/dates/${it.slug}`} className="group flex flex-col">
                    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card bg-background">
                      <Image
                        src={cover2}
                        alt=""
                        fill
                        sizes="(max-width: 768px) 100vw, 33vw"
                        className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.03]"
                      />
                      <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/95 via-black/75 to-transparent" />
                      <div className="absolute bottom-4 left-5 right-5 text-white [text-shadow:0_1px_10px_rgba(0,0,0,0.6)]">
                        <h3 className="font-display text-lg font-semibold leading-tight md:text-xl">
                          {it.title}
                        </h3>
                        {it.hook && <p className="mt-1 line-clamp-1 text-xs text-white/95">{it.hook}</p>}
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-muted [font-variant-numeric:tabular-nums]">
                      <span className="text-text">${Math.round(it.total_cost_pp ?? 0)}</span>
                      <span className="mx-1.5 text-border">·</span>
                      <span>{totalHr} hr</span>
                      <span className="mx-1.5 text-border">·</span>
                      <span>{stops.length} stops</span>
                    </p>
                  </Link>
                );
              })}
            </div>

            <div className="mt-12 flex justify-center">
              <Link
                href="/plan"
                className="inline-flex items-center gap-2 rounded-pill bg-primary px-7 py-3.5 text-base font-medium text-background transition-opacity hover:opacity-85"
              >
                Plan a date around {p.name}
                <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
              </Link>
            </div>
          </div>
        </section>
      )}

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-content flex-col items-center gap-6 px-6 py-12 md:flex-row md:justify-between md:px-10 md:py-16">
          <p className="text-xs text-muted">
            Built in Kelowna. Coming to Kamloops, Vernon, Penticton.
          </p>
          <div className="flex items-center gap-6 text-xs text-muted">
            <Link href="/privacy" className="transition-colors hover:text-text">Privacy</Link>
            <Link href="/terms" className="transition-colors hover:text-text">Terms</Link>
            <a href="mailto:lucas@after5.app" className="transition-colors hover:text-text">lucas@after5.app</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
