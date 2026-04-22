import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { imageForStop } from '@/lib/place-image';

// Browseable catalog of every place in our Kelowna database. SEO + UX:
// crawlers index every spot; humans can scan before planning.

export const revalidate = 3600;
const SITE = 'https://tryafter5.app';

export const metadata: Metadata = {
  title: 'Every Kelowna spot we plan with | After5',
  description:
    'Browse every restaurant, bar, hike, viewpoint, and park After5 builds Kelowna date plans around. Hand-curated by locals.',
  alternates: { canonical: `${SITE}/places` },
};

interface Row {
  id: string;
  name: string;
  slug: string;
  neighborhood: string;
  type: string;
  vibe_tags: string[];
  photo_url: string | null;
  price_tier: string;
}

const TYPE_GROUPS: Array<{ label: string; types: string[] }> = [
  { label: 'Eat',     types: ['restaurant', 'cafe', 'bakery'] },
  { label: 'Drink',   types: ['cocktail_bar', 'brewery', 'winery'] },
  { label: 'Sweet',   types: ['dessert', 'ice_cream'] },
  { label: 'Outside', types: ['hike', 'walk', 'park', 'beach', 'viewpoint', 'sunset_spot', 'garden'] },
  { label: 'Do',      types: ['activity', 'gallery', 'market', 'shop'] },
];

export default async function PlacesIndexPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('places')
    .select('id, name, slug, neighborhood, type, vibe_tags, photo_url, price_tier')
    .eq('is_active', true)
    .order('name');
  const items = (data ?? []) as Row[];

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-[2px]">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-5 md:px-10">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight text-text">
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
          Every spot we plan with.
        </h1>
        <p className="mt-6 max-w-prose text-base text-secondary md:text-lg">
          {items.length} hand-curated places — restaurants, bars, hikes, viewpoints, parks.
          Tap a spot to see the dates that feature it.
        </p>
      </section>

      <section className="mx-auto max-w-content px-6 pb-24 md:px-10 md:pb-32">
        {TYPE_GROUPS.map((group) => {
          const groupItems = items.filter((p) => group.types.includes(p.type));
          if (groupItems.length === 0) return null;
          return (
            <div key={group.label} className="mb-16 md:mb-20">
              <h2 className="mb-6 font-display text-xl font-semibold text-text md:text-2xl">
                {group.label}
                <span className="ml-2 text-sm font-normal text-muted [font-variant-numeric:tabular-nums]">
                  {groupItems.length}
                </span>
              </h2>
              <div className="grid grid-cols-2 gap-5 md:grid-cols-4 md:gap-6">
                {groupItems.map((p) => {
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
                        {p.neighborhood} · {p.price_tier}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-content flex-col items-center gap-6 px-6 py-12 md:flex-row md:justify-between md:px-10 md:py-16">
          <p className="text-xs text-muted">
            Built in Kelowna. Coming to Kamloops, Vernon, Penticton.
          </p>
          <div className="flex items-center gap-6 text-xs text-muted">
            <Link href="/privacy" className="transition-colors hover:text-text">Privacy</Link>
            <Link href="/terms" className="transition-colors hover:text-text">Terms</Link>
            <a href="mailto:lucas@lucassenechal.com" className="transition-colors hover:text-text">lucas@lucassenechal.com</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
