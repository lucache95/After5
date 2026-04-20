import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { coverImageFor } from '@/lib/place-image';

// Human-browseable index of every public date plan. Complements sitemap.xml:
// one is for crawlers, this is for humans who want to shop around.

export const revalidate = 3600;

const SITE_URL = 'https://after5.app';

export const metadata: Metadata = {
  title: 'Every Kelowna date plan we\'ve built | After5',
  description:
    'Browse hundreds of curated Kelowna date plans — romantic, chill, adventurous, cozy. Real places, real timing, real costs. Pick one or plan your own.',
  alternates: { canonical: `${SITE_URL}/dates` },
  openGraph: {
    title: 'Every Kelowna date plan we\'ve built',
    description:
      'Browse hundreds of curated Kelowna date plans — romantic, chill, adventurous, cozy.',
    url: `${SITE_URL}/dates`,
    siteName: 'After5',
    locale: 'en_CA',
    type: 'website',
    images: [{ url: `${SITE_URL}/og.jpg`, width: 1920, height: 1080 }],
  },
};

interface Row {
  id: string;
  slug: string | null;
  title: string | null;
  hook: string | null;
  total_cost_pp: number | null;
  total_duration_min: number | null;
  stops: unknown;
}

interface StopLite {
  place_type?: string;
  photo_url?: string | null;
}

export default async function DatesIndexPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('itineraries')
    .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops')
    .eq('is_public', true)
    .not('title', 'is', null)
    .not('slug', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(60);

  const items = (data ?? []) as Row[];

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-[2px]">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-5 md:px-10">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-text"
          >
            After5
          </Link>
          <Link
            href="/plan"
            className="inline-flex items-center gap-2 rounded-pill bg-primary px-6 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85"
          >
            Plan my date — free
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-content px-6 pb-10 pt-16 md:px-10 md:pb-14 md:pt-24">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
          The catalog · Kelowna · BC
        </p>
        <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-[-0.02em] text-text md:text-5xl">
          Every Kelowna date plan we&apos;ve built.
        </h1>
        <p className="mt-6 max-w-prose text-base text-secondary md:text-lg">
          {items.length} curated itineraries. Real places, real timing, real costs. Pick
          one outright or use them as inspiration before you plan your own.
        </p>
      </section>

      <section className="mx-auto max-w-content px-6 pb-24 md:px-10 md:pb-32">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-7">
          {items.map((it) => {
            const stops = (Array.isArray(it.stops) ? it.stops : []) as StopLite[];
            const cover = coverImageFor(stops);
            const totalHr =
              it.total_duration_min !== null
                ? Math.round((it.total_duration_min / 60) * 10) / 10
                : 0;
            return (
              <Link
                key={it.id}
                href={`/dates/${it.slug}`}
                className="group flex flex-col"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card bg-surface">
                  <Image
                    src={cover}
                    alt=""
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.03]"
                  />
                  <div
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/95 via-black/75 to-transparent"
                  />
                  <div className="absolute bottom-4 left-5 right-5 text-white [text-shadow:0_1px_10px_rgba(0,0,0,0.6)]">
                    <h2 className="font-display text-lg font-semibold leading-tight md:text-xl">
                      {it.title}
                    </h2>
                    {it.hook && (
                      <p className="mt-1 line-clamp-1 text-xs text-white/95">{it.hook}</p>
                    )}
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

        {items.length === 0 && (
          <p className="py-20 text-center text-base text-muted">
            No plans yet. Be the first — <Link href="/plan" className="underline">plan a date</Link>.
          </p>
        )}

        <div className="mt-16 flex justify-center">
          <Link
            href="/plan"
            className="inline-flex items-center gap-2 rounded-pill bg-primary px-8 py-4 text-base font-medium text-background transition-opacity hover:opacity-85"
          >
            Plan your own — free
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </div>
      </section>

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
            <a href="mailto:lucas@after5.app" className="transition-colors hover:text-text">
              lucas@after5.app
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
