import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { imageForStop } from '@/lib/place-image';

// Browseable catalog of every place in our Kelowna database. SEO + UX:
// crawlers index every spot; humans can scan before building a date.

export const revalidate = 3600;
const SITE = 'https://tryafter5.app';

export const metadata: Metadata = {
  title: 'every kelowna spot we plan with · after5',
  description:
    'browse every restaurant, bar, hike, viewpoint, and park after5 builds kelowna date plans around. hand-picked by locals.',
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
  generated_photo_url: string | null;
  price_tier: string;
}

const TYPE_GROUPS: Array<{ label: string; types: string[] }> = [
  { label: 'eat',     types: ['restaurant', 'cafe', 'bakery'] },
  { label: 'drink',   types: ['cocktail_bar', 'brewery', 'winery'] },
  { label: 'sweet',   types: ['dessert', 'ice_cream'] },
  { label: 'outside', types: ['hike', 'walk', 'park', 'beach', 'viewpoint', 'sunset_spot', 'garden'] },
  { label: 'do',      types: ['activity', 'gallery', 'market', 'shop'] },
];

export default async function PlacesIndexPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('places')
    .select('id, name, slug, neighborhood, type, vibe_tags, photo_url, generated_photo_url, price_tier')
    .eq('is_active', true)
    .order('name');
  const items = (data ?? []) as Row[];

  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="sticky top-0 z-50 border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-[2px]">
        <nav className="mx-auto flex w-full max-w-[480px] items-center justify-between px-6 py-4">
          <Link href="/" className="font-heading text-xl lowercase tracking-tight text-shell-accent">after5</Link>
          <Link href="/create" className="inline-flex items-center gap-1.5 rounded-pill bg-shell-accent px-5 py-2 font-body text-sm font-semibold lowercase text-white shadow-fun transition active:scale-95">
            make a night
            <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
          </Link>
        </nav>
      </header>

      <section className="mx-auto w-full max-w-[480px] px-6 pb-8 pt-10">
        <p className="mb-3 font-body text-xs font-semibold uppercase tracking-[0.18em] text-shell-accent">
          the catalog
        </p>
        <h1 className="font-heading text-4xl lowercase leading-[1.02] text-shell-ink">
          every spot we build with
        </h1>
        <p className="mt-5 font-body text-base leading-relaxed text-shell-ink/70">
          {items.length} hand-curated places — restaurants, bars, hikes, viewpoints, parks. tap a spot to see the dates that feature it.
        </p>
      </section>

      <section className="mx-auto w-full max-w-[480px] px-6 pb-10">
        {TYPE_GROUPS.map((group) => {
          const groupItems = items.filter((p) => group.types.includes(p.type));
          if (groupItems.length === 0) return null;
          return (
            <div key={group.label} className="mb-12">
              <h2 className="mb-5 font-heading text-2xl lowercase text-shell-ink">
                {group.label}
                <span className="ml-2 font-body text-sm font-normal text-shell-ink/45 [font-variant-numeric:tabular-nums]">
                  {groupItems.length}
                </span>
              </h2>
              <div className="grid grid-cols-2 gap-4">
                {groupItems.map((p) => {
                  const cover = imageForStop({ photo_url: p.photo_url, generated_photo_url: p.generated_photo_url, place_type: p.type });
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

      <section className="border-t border-shell-ink/10">
        <div className="mx-auto w-full max-w-[480px] px-6 py-16 text-center">
          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-pill bg-shell-accent px-8 py-4 font-body text-base font-semibold lowercase text-white shadow-fun transition active:scale-95"
          >
            make a night
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
