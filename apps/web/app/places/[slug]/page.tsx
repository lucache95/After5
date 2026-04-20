import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  ArrowRight,
  MapPin,
  Lightbulb,
  ExternalLink,
  Star,
  Clock,
  Phone,
  Globe,
  Sparkles,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { imageForStop, coverImageFor } from '@/lib/place-image';
import { PhotoLightbox } from '@/components/PhotoLightbox';

// Rich SEO-canonical page for a single Kelowna spot. Backed by enriched
// Google Places data (rating, reviews, photos, hours, phone, website) plus
// our curated layer (vibe_tags, pairing_tags, local_insight). Cross-links
// to date plans that include this place.

export const revalidate = 3600;
const SITE = 'https://after5.app';

interface Review {
  author: string;
  rating: number | null;
  text: string;
  relative_time: string | null;
}

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
  photos: string[];
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
  opens: string | null;
  closes: string | null;
  hours_week: string[] | null;
  rating: number | null;
  review_count: number | null;
  reviews: Review[];
  phone: string | null;
  website: string | null;
  local_insight: string | null;
  llm_summary: string | null;
  notes: string | null;
  at_home: boolean;
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

const TYPE_LABEL: Record<string, string> = {
  restaurant: 'Restaurant',
  cafe: 'Cafe',
  winery: 'Winery',
  brewery: 'Brewery',
  cocktail_bar: 'Cocktail Bar',
  bakery: 'Bakery',
  dessert: 'Dessert',
  ice_cream: 'Ice Cream',
  hike: 'Hike',
  walk: 'Walk',
  park: 'Park',
  garden: 'Garden',
  beach: 'Beach',
  viewpoint: 'Viewpoint',
  sunset_spot: 'Sunset Spot',
  gallery: 'Gallery',
  market: 'Market',
  shop: 'Shop',
  activity: 'Activity',
};

async function loadPlace(slug: string): Promise<PlaceRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('places')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .eq('approval_status', 'live')
    .maybeSingle();
  return (data ?? null) as PlaceRow | null;
}

async function loadDatesFeaturing(placeId: string): Promise<ItineraryRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('itineraries')
    .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops')
    .eq('is_public', true)
    .not('slug', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(120);
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
  const desc = (
    p.llm_summary ??
    p.local_insight ??
    p.notes ??
    `${p.name} is a ${p.neighborhood} ${p.type.replace(/_/g, ' ')} in Kelowna.`
  ).slice(0, 160);

  return {
    title: `${p.name} — ${TYPE_LABEL[p.type] ?? 'Spot'} in ${p.neighborhood} Kelowna | After5`,
    description: desc,
    alternates: { canonical: `${SITE}/places/${p.slug}` },
    openGraph: {
      title: p.name,
      description: desc,
      url: `${SITE}/places/${p.slug}`,
      siteName: 'After5',
      images: [{ url: ogImage, width: 1200, height: 900, alt: p.name }],
      type: 'website',
    },
  };
}

function formatTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function isOpenNow(opens: string | null, closes: string | null): boolean | null {
  if (!opens || !closes) return null;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = opens.split(':').map(Number);
  const [ch, cm] = closes.split(':').map(Number);
  const o = oh * 60 + om;
  const c = ch * 60 + cm;
  if (c > o) return cur >= o && cur < c;
  return cur >= o || cur < c;
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
  const openNow = p.at_home ? null : isOpenNow(p.opens, p.closes);
  const summary = p.llm_summary ?? p.notes ?? null;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: p.name,
    description: summary ?? undefined,
    image: cover.startsWith('http') ? cover : `${SITE}${cover}`,
    url: `${SITE}/places/${p.slug}`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: p.address ?? undefined,
      addressLocality: p.neighborhood,
      addressRegion: 'BC',
      addressCountry: 'CA',
    },
    ...(p.lat && p.lng
      ? { geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng } }
      : {}),
    ...(p.rating
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: p.rating,
            reviewCount: p.review_count ?? 0,
          },
        }
      : {}),
    ...(p.phone ? { telephone: p.phone } : {}),
    ...(p.website ? { sameAs: [p.website] } : {}),
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
            {p.neighborhood.replace(/_/g, ' ')} · Kelowna
          </p>
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-[-0.025em] text-white md:text-6xl">
            {p.name}
          </h1>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-base text-white/90">
            <span>{TYPE_LABEL[p.type] ?? p.type.replace(/_/g, ' ')}</span>
            <span aria-hidden className="text-white/50">·</span>
            <span>{p.price_tier}</span>
            {p.rating && (
              <>
                <span aria-hidden className="text-white/50">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <Star className="h-4 w-4 fill-white text-white" strokeWidth={0} />
                  {p.rating} <span className="text-white/70">({p.review_count?.toLocaleString() ?? 0})</span>
                </span>
              </>
            )}
            {openNow !== null && (
              <>
                <span aria-hidden className="text-white/50">·</span>
                <span className={openNow ? 'text-emerald-300' : 'text-rose-300'}>
                  {openNow ? 'Open now' : 'Closed now'}
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-content px-6 py-16 md:px-10 md:py-20">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-[1fr_320px] md:gap-16">
          <div>
            {/* Story */}
            {summary && (
              <p className="max-w-prose text-lg leading-relaxed text-secondary md:text-xl">
                {summary}
              </p>
            )}

            {/* Local insight */}
            {p.local_insight && (
              <div className="mt-10 flex gap-4 rounded-card border border-accent/30 bg-accent-soft/60 p-5 md:p-6">
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

            {/* What to know — vibe + duration + effort + energy */}
            <div className="mt-12 grid grid-cols-2 gap-6 border-y border-border py-8 md:grid-cols-4">
              <Stat label="Visit time" value={`${p.typical_duration_min} min`} />
              <Stat
                label="Per person"
                value={
                  p.typical_per_person && p.typical_per_person > 0
                    ? `~$${Math.round(p.typical_per_person)}`
                    : 'Free'
                }
              />
              <Stat label="Effort" value={p.effort} />
              <Stat label="Energy" value={p.energy} />
            </div>

            {/* Vibe + pairing chips */}
            {(p.vibe_tags.length > 0 || p.pairing_tags.length > 0) && (
              <div className="mt-10">
                <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                  The vibe
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
                  {p.pairing_tags.map((v) => (
                    <span
                      key={v}
                      className="rounded-pill border border-accent/30 bg-accent-soft/40 px-3 py-1 text-sm text-text"
                    >
                      {v.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Hours table — irrelevant for at-home things (always "open"). */}
            {!p.at_home && p.hours_week && p.hours_week.length > 0 && (
              <div className="mt-10">
                <p className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                  <Clock className="h-3.5 w-3.5" strokeWidth={2} />
                  Hours
                </p>
                <ul className="space-y-2 text-sm text-secondary">
                  {p.hours_week.map((line, i) => (
                    <li key={i} className="grid grid-cols-[120px_1fr] gap-3">
                      <span className="text-text">{line.split(':')[0]}</span>
                      <span className="text-secondary [font-variant-numeric:tabular-nums]">
                        {line.split(':').slice(1).join(':').trim()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Reviews */}
            {p.reviews && p.reviews.length > 0 && (
              <div className="mt-12">
                <p className="mb-5 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                  What people say · via Google
                </p>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  {p.reviews.slice(0, 4).map((r, i) => (
                    <div key={i} className="rounded-card border border-border bg-background p-5">
                      <div className="flex items-baseline justify-between">
                        <p className="text-sm font-medium text-text">{r.author}</p>
                        <p className="text-xs text-muted">{r.relative_time}</p>
                      </div>
                      {r.rating !== null && (
                        <div className="mt-1 inline-flex items-center gap-0.5" aria-label={`${r.rating} out of 5 stars`}>
                          {Array.from({ length: 5 }).map((_, n) => (
                            <Star
                              key={n}
                              className={
                                n < Math.round(r.rating!)
                                  ? 'h-3.5 w-3.5 fill-accent text-accent'
                                  : 'h-3.5 w-3.5 fill-border text-border'
                              }
                              strokeWidth={0}
                            />
                          ))}
                        </div>
                      )}
                      <p className="mt-3 line-clamp-6 text-sm leading-relaxed text-secondary">
                        {r.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Photo gallery */}
            {p.photos && p.photos.length > 0 && (
              <div className="mt-12">
                <p className="mb-5 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                  More photos · via Google
                </p>
                <PhotoLightbox photos={p.photos.slice(0, 6)} />
              </div>
            )}
          </div>

          {/* Side rail — different for at-home vs out-of-the-house. At-home
              has no address/maps/phone; just a "plan a date" CTA. */}
          <aside className="md:sticky md:top-8 md:self-start">
            <div className="space-y-3 rounded-card border border-border bg-surface p-6 md:p-7">
              {p.at_home ? (
                <>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
                    At-home idea
                  </p>
                  <p className="text-sm leading-relaxed text-secondary">
                    No reservations, no driving. Everything you need is at your
                    place — or a quick stop on the way home.
                  </p>
                  <Link
                    href="/plan"
                    className="flex w-full items-center justify-center gap-2 rounded-pill bg-primary px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85"
                  >
                    <Sparkles className="h-4 w-4" strokeWidth={2} />
                    Plan a date with this idea
                  </Link>
                </>
              ) : (
                <>
                  {p.address && (
                    <p className="mb-1 text-sm leading-relaxed text-secondary">
                      {p.address}
                    </p>
                  )}
                  <a
                    href={directionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center gap-2 rounded-pill bg-primary px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85"
                  >
                    <MapPin className="h-4 w-4" strokeWidth={2} />
                    Open in Maps
                  </a>
                  {p.website && (
                    <a
                      href={p.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full items-center justify-center gap-2 rounded-pill border border-border bg-background px-5 py-3 text-sm font-medium text-text transition-colors hover:border-text/40"
                    >
                      <Globe className="h-4 w-4" strokeWidth={2} />
                      Visit website
                    </a>
                  )}
                  {p.phone && (
                    <a
                      href={`tel:${p.phone.replace(/[^+\d]/g, '')}`}
                      className="flex w-full items-center justify-center gap-2 rounded-pill border border-border bg-background px-5 py-3 text-sm font-medium text-text transition-colors hover:border-text/40"
                    >
                      <Phone className="h-4 w-4" strokeWidth={2} />
                      {p.phone}
                    </a>
                  )}
                  {p.reservation_required && (
                    <a
                      href={p.reservation_url ?? p.website ?? directionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full items-center justify-center gap-2 rounded-pill bg-text px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85"
                    >
                      Book — required
                      <ExternalLink className="h-4 w-4" strokeWidth={2} />
                    </a>
                  )}
                  <Link
                    href="/plan"
                    className="flex w-full items-center justify-center gap-2 rounded-pill border border-accent/40 bg-accent-soft/60 px-5 py-3 text-sm font-medium text-text transition-colors hover:bg-accent-soft"
                  >
                    <Sparkles className="h-4 w-4 text-accent" strokeWidth={2} />
                    Plan a date with this spot
                  </Link>
                </>
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
                // Exclude the current place so each card shows a DIFFERENT
                // photo (the next stop in the plan, not just the same lake/bar
                // we're already looking at).
                const cover2 = coverImageFor(stops, { excludePlaceId: p.id });
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
                    </div>
                    <h3 className="mt-4 font-display text-lg font-semibold leading-tight text-text md:text-xl">
                      {it.title}
                    </h3>
                    {it.hook && <p className="mt-1 line-clamp-2 text-sm text-secondary">{it.hook}</p>}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className="mt-1.5 font-display text-lg font-semibold capitalize text-text md:text-xl">
        {value}
      </p>
    </div>
  );
}
