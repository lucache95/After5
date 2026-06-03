import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { imageForStop, coverImageFor } from '@/lib/place-image';

// Shared barbiecore layout for /vibes/[v], /neighborhoods/[n], /types/[t].
// Each takes a hero (eyebrow, title, blurb), an optional places grid, an
// optional dates grid, and a primary CTA into /create. SEO browse content is
// preserved; only the chrome is restyled.

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
  cover_image_url?: string | null;
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
  placesHeading = 'the spots',
  datesHeading = 'dates that fit',
  emptyNote = 'nothing here yet. check back soon.',
}: Props) {
  const showEmpty = places.length === 0 && dates.length === 0;
  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="sticky top-0 z-50 border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-[2px]">
        <nav className="mx-auto flex w-full max-w-[480px] items-center justify-between px-6 py-4">
          <Link href="/" className="font-heading text-xl lowercase tracking-tight text-shell-accent">
            after5
          </Link>
          <Link
            href={ctaHref}
            className="inline-flex items-center gap-1.5 rounded-pill bg-shell-accent px-5 py-2 font-body text-sm font-semibold lowercase text-white shadow-fun transition active:scale-95"
          >
            {ctaLabel}
            <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
          </Link>
        </nav>
      </header>

      <section className="mx-auto w-full max-w-[480px] px-6 pb-8 pt-10">
        <p className="mb-3 font-body text-xs font-semibold uppercase tracking-[0.18em] text-shell-accent">
          {eyebrow}
        </p>
        <h1 className="font-heading text-4xl lowercase leading-[1.02] text-shell-ink">
          {title}
        </h1>
        <p className="mt-5 font-body text-base leading-relaxed text-shell-ink/70">{blurb}</p>
      </section>

      {showEmpty && (
        <section className="mx-auto w-full max-w-[480px] px-6 pb-16">
          <p className="rounded-3xl border border-dashed border-shell-ink/15 bg-shell-pink/40 px-6 py-12 text-center font-body text-base text-shell-ink/65">
            {emptyNote}
          </p>
        </section>
      )}

      {places.length > 0 && (
        <section className="mx-auto w-full max-w-[480px] px-6 pb-10">
          <p className="mb-5 font-body text-xs font-semibold uppercase tracking-[0.18em] text-shell-ink/55">
            {placesHeading} · {places.length}
          </p>
          <div className="grid grid-cols-2 gap-4">
            {places.map((p) => {
              const cover = imageForStop({ photo_url: p.photo_url, place_type: p.type });
              return (
                <Link key={p.id} href={`/places/${p.slug}`} className="group flex flex-col">
                  <div className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl bg-shell-pink/50">
                    <Image
                      src={cover}
                      alt=""
                      fill
                      sizes="(max-width: 480px) 50vw, 240px"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                  </div>
                  <h3 className="mt-3 font-body text-sm font-semibold leading-tight text-shell-ink">
                    {p.name}
                  </h3>
                  <p className="mt-0.5 font-body text-xs lowercase text-shell-ink/55">
                    {[p.neighborhood?.replace(/_/g, ' '), p.price_tier].filter(Boolean).join(' · ')}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {dates.length > 0 && (
        <section className="mx-auto w-full max-w-[480px] border-t border-shell-ink/10 px-6 py-10">
          <p className="mb-5 font-body text-xs font-semibold uppercase tracking-[0.18em] text-shell-ink/55">
            {datesHeading} · {dates.length}
          </p>
          <div className="grid grid-cols-1 gap-6">
            {dates.map((it) => {
              const cover = coverImageFor(it.stops, { itineraryCover: it.cover_image_url });
              const totalHr = it.total_duration_min !== null
                ? Math.round((it.total_duration_min / 60) * 10) / 10
                : 0;
              return (
                <Link key={it.id} href={`/dates/${it.slug}`} className="group flex flex-col">
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl bg-shell-pink/50">
                    <Image
                      src={cover}
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
                    <span>{it.stops.length} stops</span>
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="border-t border-shell-ink/10">
        <div className="mx-auto w-full max-w-[480px] px-6 py-16 text-center">
          <Link
            href={ctaHref}
            className="inline-flex items-center gap-2 rounded-pill bg-shell-accent px-8 py-4 font-body text-base font-semibold lowercase text-white shadow-fun transition active:scale-95"
          >
            {ctaLabel}
            <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
          </Link>
        </div>
      </section>

      <footer className="mx-auto w-full max-w-[480px] px-6 pb-16 pt-6">
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
