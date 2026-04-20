import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { coverImageFor } from '@/lib/place-image';

// Homepage discovery surface — the most recent public date plans rendered as
// image-first cards. Surfaces the SEO catalog at /dates/[slug] without making
// a first-time visitor navigate through to find them. Server-rendered.

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

export async function ExploreDatesStrip() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('itineraries')
    .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops')
    .eq('is_public', true)
    .not('title', 'is', null)
    .not('slug', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(6);

  const items = (data ?? []) as Row[];
  if (items.length === 0) return null;

  return (
    <section className="border-t border-border bg-surface">
      <div className="mx-auto max-w-content px-6 py-20 md:px-10 md:py-28">
        <div className="mb-10 flex items-end justify-between md:mb-14">
          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Browse the catalog
            </p>
            <h2 className="font-display text-2xl font-bold leading-tight tracking-[-0.01em] text-text md:text-4xl">
              Real dates other people planned.
            </h2>
            <p className="mt-4 max-w-prose text-base text-secondary md:text-lg">
              Every plan we generate gets saved as a standalone page —
              shareable, bookmarkable, free to steal. Pick one outright or
              just pull ideas before you build your own.
            </p>
          </div>
          <Link
            href="/dates"
            className="hidden whitespace-nowrap text-sm text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text md:inline"
          >
            See all
          </Link>
        </div>

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
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card bg-background">
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
                {it.hook && (
                  <p className="mt-1 line-clamp-2 text-sm text-secondary">{it.hook}</p>
                )}
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

        <div className="mt-12 flex justify-center md:mt-14">
          <Link
            href="/dates"
            className="inline-flex items-center gap-2 rounded-pill border border-border bg-background px-6 py-3 text-sm font-medium text-text transition-colors hover:border-text/40"
          >
            Browse every date plan
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </div>
      </div>
    </section>
  );
}
