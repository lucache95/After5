// Full saved-plans collection — a flat, scannable grid.
// No polaroid frames here, no rotation: the dashboard handles the
// "atmosphere" view. This page is for someone with 20+ saves who
// just wants to find the one they remember.
//
// Sort: most recently saved first. Pagination via ?page=N (24 per page)
// so URLs stay shareable and the back button works as expected.

import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, ArrowRight, Heart } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { coverImageFor } from '@/lib/place-image';
import { relativeTime } from '@/lib/relative-time';
import type { Stop } from '@/lib/itinerary-types';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;

interface SavedRow {
  id: string;
  saved_at: string;
  itinerary: {
    id: string;
    slug: string | null;
    title: string | null;
    hook: string | null;
    total_cost_pp: number | null;
    total_duration_min: number | null;
    stops: unknown;
    cover_image_url: string | null;
  } | null;
}

export default async function SavedPlansPage(props: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await props.searchParams;
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account/saved');

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const [{ data, count }] = await Promise.all([
    supabase
      .from('saved_plans')
      .select(
        'id, saved_at, itinerary:itineraries(id, slug, title, hook, total_cost_pp, total_duration_min, stops, cover_image_url)',
        { count: 'exact' },
      )
      .eq('user_id', user.id)
      .order('saved_at', { ascending: false })
      .range(from, to),
  ]);

  const rows = (data ?? []) as unknown as SavedRow[];
  const total = count ?? 0;
  if (page > 1 && rows.length === 0) notFound();

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between gap-6 px-6 py-4 md:px-10">
          <Link
            href="/account"
            className="inline-flex items-center gap-2 text-sm font-medium text-secondary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2.25} />
            Back to dashboard
          </Link>
          <Link
            href="/plan"
            className="inline-flex items-center gap-2 rounded-pill bg-text px-5 py-2 text-sm font-medium text-background transition-transform hover:-translate-y-0.5"
          >
            Plan a new one
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </nav>
      </header>

      <div className="mx-auto max-w-content px-6 py-12 md:px-10 md:py-16">
        <div className="mb-10 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
              Your collection
            </p>
            <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-5xl">
              Saved <em className="font-display font-semibold not-italic text-accent" style={{ fontStyle: 'italic' }}>dates.</em>
            </h1>
          </div>
          {total > 0 && (
            <p className="text-sm text-muted [font-variant-numeric:tabular-nums]">
              {total} {total === 1 ? 'plan' : 'plans'}
            </p>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="rounded-card border border-border bg-surface p-10 text-center">
            <Heart className="mx-auto h-7 w-7 text-muted" strokeWidth={1.75} />
            <p className="mt-4 font-display text-xl font-semibold text-text">
              Nothing saved yet.
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-secondary">
              Tap the heart on any plan to keep it here for later.
            </p>
            <Link
              href="/plan"
              className="mt-6 inline-flex items-center gap-2 rounded-pill bg-text px-6 py-2.5 text-sm font-medium text-background"
            >
              Plan tonight
              <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {rows.map((s) => {
              if (!s.itinerary) return null;
              const stops = (Array.isArray(s.itinerary.stops) ? s.itinerary.stops : []) as Stop[];
              const cover = coverImageFor(stops, { itineraryCover: s.itinerary.cover_image_url });
              const hr = Math.round(((s.itinerary.total_duration_min ?? 0) / 60) * 10) / 10;
              const href = s.itinerary.slug ? `/dates/${s.itinerary.slug}` : `/plan/i/${s.itinerary.id}`;
              return (
                <Link
                  key={s.id}
                  href={href}
                  className="group flex flex-col overflow-hidden rounded-card border border-border bg-background transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)]"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-surface">
                    <Image
                      src={cover}
                      alt={s.itinerary.title ?? 'Saved plan'}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 33vw, 25vw"
                      className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.03]"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <h2 className="line-clamp-2 font-display text-base font-semibold leading-snug text-text">
                      {s.itinerary.title ?? 'Untitled plan'}
                    </h2>
                    {s.itinerary.hook && (
                      <p className="mt-1 line-clamp-2 text-xs text-secondary">
                        {s.itinerary.hook}
                      </p>
                    )}
                    <p className="mt-3 text-[11px] text-muted [font-variant-numeric:tabular-nums]">
                      ${Math.round(s.itinerary.total_cost_pp ?? 0)} · {hr} hr · saved {relativeTime(s.saved_at)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <nav className="mt-12 flex items-center justify-center gap-2" aria-label="Pagination">
            <PageLink page={page - 1} disabled={page === 1} label="Previous" />
            <span className="px-4 text-sm text-muted [font-variant-numeric:tabular-nums]">
              Page {page} of {totalPages}
            </span>
            <PageLink page={page + 1} disabled={page === totalPages} label="Next" />
          </nav>
        )}
      </div>
    </main>
  );
}

function PageLink({ page, disabled, label }: { page: number; disabled: boolean; label: string }) {
  if (disabled) {
    return (
      <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-pill border border-border bg-surface px-4 py-2 text-sm text-muted">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={page === 1 ? '/account/saved' : `/account/saved?page=${page}`}
      className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-background px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-surface"
    >
      {label}
    </Link>
  );
}
