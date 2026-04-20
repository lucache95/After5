import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { imageForStop, coverImageFor } from '@/lib/place-image';

// Shared layout for /vibes/[v], /neighborhoods/[n], /types/[t], /wow/[id],
// /templates/[id]. Each takes a hero (eyebrow, title, blurb), an optional
// places grid, an optional dates grid, and a primary CTA href.

export interface PlaceCardData {
  id: string;
  slug: string;
  name: string;
  neighborhood?: string;
  price_tier?: string;
  type: string;
  photo_url?: string | null;
  rating?: number | null;
}

export interface DateCardData {
  id: string;
  slug: string | null;
  title: string | null;
  hook: string | null;
  total_cost_pp: number | null;
  total_duration_min: number | null;
  stops: Array<{ photo_url?: string | null; place_type?: string }>;
}

interface Props {
  eyebrow: string;
  title: string;
  blurb: string;
  ctaHref: string;
  ctaLabel: string;
  places?: PlaceCardData[];
  dates?: DateCardData[];
  placesHeading?: string;
  datesHeading?: string;
  emptyNote?: string;
}

export function AggregatorView({
  eyebrow,
  title,
  blurb,
  ctaHref,
  ctaLabel,
  places = [],
  dates = [],
  placesHeading = 'The spots',
  datesHeading = 'Dates that fit',
  emptyNote = 'Nothing here yet — generate a few and they\'ll show up.',
}: Props) {
  const showEmpty = places.length === 0 && dates.length === 0;
  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-[2px]">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-5 md:px-10">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight text-text">
            After5
          </Link>
          <Link
            href={ctaHref}
            className="inline-flex items-center gap-2 rounded-pill bg-primary px-6 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85"
          >
            {ctaLabel}
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-content px-6 pb-10 pt-16 md:px-10 md:pb-14 md:pt-24">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">{eyebrow}</p>
        <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-[-0.02em] text-text md:text-5xl">
          {title}
        </h1>
        <p className="mt-6 max-w-prose text-base text-secondary md:text-lg">{blurb}</p>
      </section>

      {showEmpty && (
        <section className="mx-auto max-w-content px-6 pb-20 md:px-10">
          <p className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center text-base text-muted">
            {emptyNote}
          </p>
        </section>
      )}

      {places.length > 0 && (
        <section className="mx-auto max-w-content px-6 pb-12 md:px-10 md:pb-16">
          <p className="mb-6 text-xs font-medium uppercase tracking-[0.18em] text-muted">
            {placesHeading} · {places.length}
          </p>
          <div className="grid grid-cols-2 gap-5 md:grid-cols-4 md:gap-6">
            {places.map((p) => {
              const cover = imageForStop({ photo_url: p.photo_url, place_type: p.type });
              return (
                <Link key={p.id} href={`/places/${p.slug}`} className="group flex flex-col">
                  <div className="relative aspect-[4/5] w-full overflow-hidden rounded-card bg-surface">
                    <Image
                      src={cover}
                      alt=""
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.04]"
                    />
                  </div>
                  <h3 className="mt-3 font-display text-sm font-semibold leading-tight text-text md:text-base">
                    {p.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted">
                    {[p.neighborhood?.replace(/_/g, ' '), p.price_tier].filter(Boolean).join(' · ')}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {dates.length > 0 && (
        <section className="mx-auto max-w-content border-t border-border px-6 py-16 md:px-10 md:py-24">
          <p className="mb-6 text-xs font-medium uppercase tracking-[0.18em] text-muted">
            {datesHeading} · {dates.length}
          </p>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-7">
            {dates.map((it) => {
              const cover = coverImageFor(it.stops);
              const totalHr = it.total_duration_min !== null
                ? Math.round((it.total_duration_min / 60) * 10) / 10
                : 0;
              return (
                <Link key={it.id} href={`/dates/${it.slug}`} className="group flex flex-col">
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card bg-surface">
                    <Image
                      src={cover}
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
                    <span>{it.stops.length} stops</span>
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="border-t border-border">
        <div className="mx-auto max-w-content px-6 py-20 text-center md:px-10 md:py-28">
          <Link
            href={ctaHref}
            className="inline-flex items-center gap-2 rounded-pill bg-primary px-8 py-4 text-base font-medium text-background transition-opacity hover:opacity-85"
          >
            {ctaLabel}
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-content flex-col items-center gap-6 px-6 py-12 md:flex-row md:justify-between md:px-10 md:py-16">
          <p className="text-xs text-muted">Built in Kelowna. Coming to Kamloops, Vernon, Penticton.</p>
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
