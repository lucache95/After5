import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  MapPin,
  Lightbulb,
  ExternalLink,
  Star,
  Clock,
  Phone,
  Globe,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { imageForStop, coverImageFor } from '@/lib/place-image';
import { placeMapUrl } from '@/lib/maps';
import { PhotoLightbox } from '@/components/PhotoLightbox';
import { PlaceBackButton } from '@/components/PlaceBackButton';

// Rich SEO-canonical page for a single Kelowna spot. Backed by enriched
// Google Places data (rating, reviews, photos, hours, phone, website) plus
// our curated layer (vibe_tags, pairing_tags, local_insight). Cross-links
// to date plans that include this place.

export const revalidate = 3600;
const SITE = 'https://tryafter5.app';

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
  generated_photo_url: string | null;
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
  cover_image_url: string | null;
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
    .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops, cover_image_url')
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
  if (!p) return { title: 'place not found' };

  const cover = imageForStop({ photo_url: p.photo_url, generated_photo_url: p.generated_photo_url, place_type: p.type });
  const ogImage = cover.startsWith('http') ? cover : `${SITE}${cover}`;
  const desc = (
    p.llm_summary ??
    p.local_insight ??
    p.notes ??
    `${p.name} is a ${p.neighborhood} ${p.type.replace(/_/g, ' ')} in Kelowna.`
  ).slice(0, 160);

  return {
    title: `${p.name} — ${(TYPE_LABEL[p.type] ?? 'spot').toLowerCase()} in ${p.neighborhood.toLowerCase()} kelowna`,
    description: desc,
    alternates: { canonical: `${SITE}/places/${p.slug}` },
    openGraph: {
      title: p.name,
      description: desc,
      url: `${SITE}/places/${p.slug}`,
      siteName: 'after5',
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

export default async function PlacePage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { slug } = await props.params;
  const { from } = await props.searchParams;
  const p = await loadPlace(slug);
  if (!p) notFound();

  // Sanitize the back-link: must be a path on our own domain.
  const safeBackHref = from && from.startsWith('/') && !from.startsWith('//') ? from : null;

  const dates = await loadDatesFeaturing(p.id);
  const cover = imageForStop({ photo_url: p.photo_url, generated_photo_url: p.generated_photo_url, place_type: p.type });
  // Prefer the exact Google place page (query_place_id) so "open in maps"
  // lands on hours/reviews/photos; else the coord pin; else name search.
  const directionsUrl = p.google_place_id
    ? placeMapUrl({ name: p.name, googlePlaceId: p.google_place_id })
    : p.lat && p.lng
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
    <main className="min-h-dvh bg-shell-base">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />

      <header className="absolute inset-x-0 top-0 z-50">
        <nav className="mx-auto flex w-full max-w-[480px] items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            {/* Always-visible back affordance (F1) — history-aware, never a dead end. */}
            <PlaceBackButton backHref={safeBackHref} />
            <Link
              href="/"
              className="font-heading text-xl lowercase tracking-tight text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.35)]"
            >
              after5
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative isolate min-h-[58vh] w-full overflow-hidden bg-shell-pink/50">
        <Image src={cover} alt="" fill priority sizes="100vw" className="object-cover" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-shell-ink/90 via-shell-ink/40 to-shell-ink/15" />
        <div className="relative mx-auto flex h-full min-h-[58vh] w-full max-w-[480px] flex-col justify-end px-6 pb-10 pt-32">
          <p className="mb-3 font-body text-xs font-semibold uppercase tracking-[0.2em] text-white/85">
            {p.neighborhood.replace(/_/g, ' ')} · kelowna
          </p>
          <h1 className="font-heading text-4xl lowercase leading-[1.02] text-white">
            {p.name}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 font-body text-sm lowercase text-white/90">
            <span>{(TYPE_LABEL[p.type] ?? p.type.replace(/_/g, ' ')).toLowerCase()}</span>
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
                <span className={openNow ? 'font-semibold text-white' : 'text-white/70'}>
                  {openNow ? 'open now' : 'closed now'}
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[480px] px-6 py-12">
        <div className="flex flex-col gap-10">
          <div>
            {/* Story */}
            {summary && (
              <p className="font-body text-base leading-relaxed text-shell-ink/75">
                {summary}
              </p>
            )}

            {/* Local insight */}
            {p.local_insight && (
              <div className="mt-8 flex gap-4 rounded-3xl bg-shell-pink/60 p-5 ring-1 ring-shell-accent/10">
                <Lightbulb className="mt-1 h-5 w-5 shrink-0 text-shell-accent" strokeWidth={2} />
                <div>
                  <p className="font-body text-xs font-semibold uppercase tracking-[0.18em] text-shell-accent">
                    local tip
                  </p>
                  <p className="mt-2 font-body text-base leading-relaxed text-shell-ink">
                    {p.local_insight}
                  </p>
                </div>
              </div>
            )}

            {/* What to know — vibe + duration + effort + energy */}
            <div className="mt-10 grid grid-cols-2 gap-6 border-y border-shell-ink/10 py-8">
              <Stat label="visit time" value={`${p.typical_duration_min} min`} />
              <Stat
                label="per person"
                value={
                  p.typical_per_person && p.typical_per_person > 0
                    ? `~$${Math.round(p.typical_per_person)}`
                    : 'free'
                }
              />
              <Stat label="effort" value={p.effort} />
              <Stat label="energy" value={p.energy} />
            </div>

            {/* Vibe + pairing chips */}
            {(p.vibe_tags.length > 0 || p.pairing_tags.length > 0) && (
              <div className="mt-9">
                <p className="mb-4 font-body text-xs font-semibold uppercase tracking-[0.18em] text-shell-ink/55">
                  the vibe
                </p>
                <div className="flex flex-wrap gap-2">
                  {p.vibe_tags.map((v) => (
                    <span
                      key={v}
                      className="rounded-pill bg-white/70 px-3 py-1 font-body text-sm lowercase text-shell-ink ring-1 ring-shell-ink/10"
                    >
                      {v}
                    </span>
                  ))}
                  {p.pairing_tags.map((v) => (
                    <span
                      key={v}
                      className="rounded-pill bg-shell-pink/60 px-3 py-1 font-body text-sm lowercase text-shell-ink ring-1 ring-shell-accent/15"
                    >
                      {v.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Hours table — irrelevant for at-home things (always "open"). */}
            {!p.at_home && p.hours_week && p.hours_week.length > 0 && (
              <div className="mt-9">
                <p className="mb-4 flex items-center gap-2 font-body text-xs font-semibold uppercase tracking-[0.18em] text-shell-ink/55">
                  <Clock className="h-3.5 w-3.5" strokeWidth={2} />
                  hours
                </p>
                <ul className="space-y-2 font-body text-sm text-shell-ink/70">
                  {p.hours_week.map((line, i) => (
                    <li key={i} className="grid grid-cols-[120px_1fr] gap-3">
                      <span className="text-shell-ink">{line.split(':')[0]}</span>
                      <span className="text-shell-ink/70 [font-variant-numeric:tabular-nums]">
                        {line.split(':').slice(1).join(':').trim()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Reviews */}
            {p.reviews && p.reviews.length > 0 && (
              <div className="mt-10">
                <p className="mb-5 font-body text-xs font-semibold uppercase tracking-[0.18em] text-shell-ink/55">
                  what people say · via google
                </p>
                <div className="grid grid-cols-1 gap-4">
                  {p.reviews.slice(0, 4).map((r, i) => (
                    <div key={i} className="rounded-3xl bg-white/70 p-5 ring-1 ring-shell-ink/10">
                      <div className="flex items-baseline justify-between">
                        <p className="font-body text-sm font-semibold text-shell-ink">{r.author}</p>
                        <p className="font-body text-xs lowercase text-shell-ink/50">{r.relative_time}</p>
                      </div>
                      {r.rating !== null && (
                        <div className="mt-1 inline-flex items-center gap-0.5" aria-label={`${r.rating} out of 5 stars`}>
                          {Array.from({ length: 5 }).map((_, n) => (
                            <Star
                              key={n}
                              className={
                                n < Math.round(r.rating!)
                                  ? 'h-3.5 w-3.5 fill-shell-accent text-shell-accent'
                                  : 'h-3.5 w-3.5 fill-shell-ink/15 text-shell-ink/15'
                              }
                              strokeWidth={0}
                            />
                          ))}
                        </div>
                      )}
                      <p className="mt-3 line-clamp-6 font-body text-sm leading-relaxed text-shell-ink/70">
                        {r.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Photo gallery */}
            {p.photos && p.photos.length > 0 && (
              <div className="mt-10">
                <p className="mb-5 font-body text-xs font-semibold uppercase tracking-[0.18em] text-shell-ink/55">
                  more photos · via google
                </p>
                <PhotoLightbox
                  photos={p.photos}
                  pinterestQuery={`${p.name} kelowna`}
                />
              </div>
            )}
          </div>

          {/* Action rail — different for at-home vs out-of-the-house. At-home
              has no address/maps/phone; just a build-a-date CTA. */}
          <aside>
            <div className="space-y-3 rounded-3xl bg-white/70 p-6 ring-1 ring-shell-ink/10">
              {p.at_home ? (
                <>
                  <p className="font-body text-xs font-semibold uppercase tracking-[0.18em] text-shell-ink/55">
                    at-home idea
                  </p>
                  <p className="font-body text-sm leading-relaxed text-shell-ink/70">
                    no reservations, no driving. everything you need is at your place, or a quick stop on the way home.
                  </p>
                </>
              ) : (
                <>
                  {p.address && (
                    <p className="mb-1 font-body text-sm leading-relaxed text-shell-ink/70">
                      {p.address}
                    </p>
                  )}
                  <a
                    href={directionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center gap-2 rounded-pill bg-shell-accent px-5 py-3 font-body text-sm font-semibold lowercase text-white shadow-fun transition active:scale-95"
                  >
                    <MapPin className="h-4 w-4" strokeWidth={2} />
                    open in maps
                  </a>
                  {p.website && (
                    <a
                      href={p.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full items-center justify-center gap-2 rounded-pill bg-white px-5 py-3 font-body text-sm font-semibold lowercase text-shell-ink ring-1 ring-shell-ink/15 transition active:scale-95 hover:ring-shell-ink/30"
                    >
                      <Globe className="h-4 w-4" strokeWidth={2} />
                      visit website
                    </a>
                  )}
                  {p.phone && (
                    <a
                      href={`tel:${p.phone.replace(/[^+\d]/g, '')}`}
                      className="flex w-full items-center justify-center gap-2 rounded-pill bg-white px-5 py-3 font-body text-sm font-semibold lowercase text-shell-ink ring-1 ring-shell-ink/15 transition active:scale-95 hover:ring-shell-ink/30"
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
                      className="flex w-full items-center justify-center gap-2 rounded-pill bg-shell-ink px-5 py-3 font-body text-sm font-semibold lowercase text-white transition active:scale-95 hover:opacity-90"
                    >
                      book — required
                      <ExternalLink className="h-4 w-4" strokeWidth={2} />
                    </a>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* Cross-link to dates featuring this place */}
      {dates.length > 0 && (
        <section className="border-t border-shell-ink/10">
          <div className="mx-auto w-full max-w-[480px] px-6 py-16">
            <p className="mb-2 font-body text-xs font-semibold uppercase tracking-[0.18em] text-shell-ink/55">
              nights featuring {p.name.toLowerCase()}
            </p>
            <h2 className="font-heading text-3xl lowercase leading-tight text-shell-ink">
              build a night around it
            </h2>

            <div className="mt-8 grid grid-cols-1 gap-6">
              {dates.map((it) => {
                const stops = (Array.isArray(it.stops) ? it.stops : []) as StopLite[];
                // Exclude the current place so each card shows a DIFFERENT
                // photo (the next stop in the plan, not just the same lake/bar
                // we're already looking at).
                const cover2 = coverImageFor(stops, { excludePlaceId: p.id, itineraryCover: it.cover_image_url });
                const totalHr = it.total_duration_min !== null
                  ? Math.round((it.total_duration_min / 60) * 10) / 10
                  : 0;
                return (
                  <Link key={it.id} href={`/dates/${it.slug}`} className="group flex flex-col">
                    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl bg-shell-pink/50">
                      <Image
                        src={cover2}
                        alt=""
                        fill
                        sizes="(max-width: 480px) 100vw, 420px"
                        className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      />
                    </div>
                    <h3 className="mt-4 font-heading text-xl lowercase leading-tight text-shell-ink">
                      {it.title}
                    </h3>
                    {it.hook && <p className="mt-1 line-clamp-2 font-body text-sm text-shell-ink/70">{it.hook}</p>}
                    <p className="mt-3 font-body text-sm lowercase text-shell-ink/55 [font-variant-numeric:tabular-nums]">
                      <span className="text-shell-ink">${Math.round(it.total_cost_pp ?? 0)}</span>
                      <span className="mx-1.5 text-shell-ink/30">·</span>
                      <span>{totalHr} hr</span>
                      <span className="mx-1.5 text-shell-ink/30">·</span>
                      <span>{stops.length} stops</span>
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <footer className="mx-auto w-full max-w-[480px] px-6 pb-16 pt-10">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-body text-xs lowercase text-shell-ink/45">
          <Link href="/about" className="hover:text-shell-ink">about</Link>
          <Link href="/privacy" className="hover:text-shell-ink">privacy</Link>
          <Link href="/terms" className="hover:text-shell-ink">terms</Link>
          <a href="mailto:hello@tryafter5.app" className="hover:text-shell-ink">hello@tryafter5.app</a>
        </div>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-shell-ink/55">{label}</p>
      <p className="mt-1.5 font-heading text-lg lowercase text-shell-ink">
        {value}
      </p>
    </div>
  );
}
