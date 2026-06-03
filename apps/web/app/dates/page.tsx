import Link from 'next/link';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { DatesFilter, type DateRow } from '@/components/DatesFilter';

// Human-browseable index of every public date plan. Complements sitemap.xml:
// one is for crawlers, this is for humans who want to shop around.

// 60s ISR — cover-image backfill is ongoing, want new covers to appear
// within a minute of generation rather than waiting an hour.
export const revalidate = 60;

const SITE_URL = 'https://tryafter5.app';

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
    // pull `inputs` so the filter can read vibe + location off the original gen
    .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops, inputs, generated_at, cover_image_url')
    .eq('is_public', true)
    .not('title', 'is', null)
    .not('slug', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(120);

  // Cast through unknown — generated DB types haven't been regenerated since
  // cover_image_url was added; column exists in prod, type-gen is just stale.
  const items = ((data ?? []) as unknown) as DateRow[];

  return (
    <main className="min-h-screen bg-shell-base">
      <header className="sticky top-0 z-50 border-b border-shell-ink/10 bg-shell-base/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4 md:px-10 md:py-5">
          <Link
            href="/"
            className="font-heading text-xl lowercase tracking-tight text-shell-accent"
          >
            after5
          </Link>
          <Link
            href="/plan"
            className="inline-flex items-center gap-2 rounded-full bg-shell-accent px-5 py-2.5 font-body text-sm lowercase text-white transition-transform hover:-translate-y-0.5 md:px-6"
          >
            plan your own — free
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-content px-6 pb-10 pt-16 md:px-10 md:pb-14 md:pt-24">
        <p className="mb-3 font-body text-xs lowercase tracking-[0.14em] text-shell-ink/55">
          the catalog
        </p>
        <h1 className="font-heading text-4xl lowercase leading-[1.05] text-shell-ink md:text-6xl">
          every date plan we&apos;ve built
        </h1>
        <p className="mt-6 max-w-prose font-body text-base text-shell-ink/70 md:text-lg">
          {items.length} plans. real places, real timing, real costs. pick one or
          steal an idea before you build your own.
        </p>
      </section>

      <section className="mx-auto max-w-content px-6 pb-24 md:px-10 md:pb-32">
        <Suspense fallback={null}>
          <DatesFilter items={items} />
        </Suspense>

        <div className="mt-16 flex justify-center">
          <Link
            href="/plan"
            className="inline-flex items-center gap-2 rounded-full bg-shell-accent px-8 py-4 font-body text-base lowercase text-white shadow-fun transition-transform hover:-translate-y-0.5"
          >
            build your own — free
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-shell-ink/10">
        <div className="mx-auto flex max-w-content flex-col items-center gap-6 px-6 py-12 md:flex-row md:justify-between md:px-10 md:py-16">
          <p className="font-body text-xs lowercase text-shell-ink/55">
            made for people who actually go out.
          </p>
          <div className="flex items-center gap-6 font-body text-xs lowercase text-shell-ink/55">
            <Link href="/privacy" className="transition-colors hover:text-shell-accent">
              privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-shell-accent">
              terms
            </Link>
            <a href="mailto:hello@tryafter5.app" className="transition-colors hover:text-shell-accent">
              hello@tryafter5.app
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
