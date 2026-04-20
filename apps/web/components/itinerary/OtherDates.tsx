import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { imageForStop } from '@/lib/place-image';

// "View other dates" strip at the bottom of /plan/i/[id]. Server-rendered so
// it's SEO-friendly and costs one DB roundtrip per page view (cached by
// Next.js for the revalidate window on the parent page).

interface OtherItineraryRow {
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
  place_name?: string;
}

export async function OtherDates({ excludeId }: { excludeId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('itineraries')
    .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops')
    .neq('id', excludeId)
    .eq('is_public', true)
    .not('title', 'is', null)
    .not('slug', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(6);

  const items = (data ?? []) as OtherItineraryRow[];
  if (items.length === 0) return null;

  return (
    <section className="border-t border-border bg-surface">
      <div className="mx-auto max-w-content px-6 py-20 md:px-10 md:py-28">
        <div className="mb-10 flex items-end justify-between md:mb-14">
          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Keep browsing
            </p>
            <h2 className="font-display text-2xl font-bold leading-tight tracking-[-0.01em] text-text md:text-3xl">
              Other dates locals are planning.
            </h2>
          </div>
          <Link
            href="/plan"
            className="hidden text-sm text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text md:inline"
          >
            Plan your own
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-7">
          {items.map((it) => {
            const stops = (Array.isArray(it.stops) ? it.stops : []) as StopLite[];
            const first = stops[0];
            const cover = first
              ? imageForStop({ photo_url: first.photo_url, place_type: first.place_type })
              : '/places/place-walk.jpg';
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
                  <div
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/30 to-transparent"
                  />
                  <div className="absolute bottom-4 left-5 right-5 text-white [text-shadow:0_1px_10px_rgba(0,0,0,0.5)]">
                    <h3 className="font-display text-lg font-semibold leading-tight md:text-xl">
                      {it.title}
                    </h3>
                    {it.hook && (
                      <p className="mt-1 line-clamp-1 text-xs text-white/85">{it.hook}</p>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-sm text-muted [font-variant-numeric:tabular-nums]">
                  <span className="text-text">
                    ${Math.round(it.total_cost_pp ?? 0)}
                  </span>
                  <span className="mx-1.5 text-border">·</span>
                  <span>{totalHr} hr</span>
                  <span className="mx-1.5 text-border">·</span>
                  <span>{stops.length} stops</span>
                </p>
              </Link>
            );
          })}
        </div>

        <div className="mt-12 flex items-center justify-center md:mt-14">
          <Link
            href="/plan"
            className="inline-flex items-center gap-2 rounded-pill bg-primary px-7 py-3.5 text-base font-medium text-background transition-opacity hover:opacity-85"
          >
            Plan your own — free
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </div>
      </div>
    </section>
  );
}
