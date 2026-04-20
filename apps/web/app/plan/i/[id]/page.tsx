import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, MapPin } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { to12h, TIMEZONE_LABEL } from '@/lib/format';

// Public itinerary detail page.
// Anyone with the UUID can read; SEO-indexed pages come in Phase 5
// (gated by 3+ "loved" feedback in is_public flag).

export const revalidate = 3600;
export const dynamic = 'force-dynamic';

interface Stop {
  place_id: string;
  place_name: string;
  start_time: string;
  duration_min: number;
  estimated_cost_pp: number;
  what_to_do?: string;
  drive_to_next_min?: number;
}

interface ItineraryRow {
  id: string;
  template_id: string | null;
  title: string | null;
  hook: string | null;
  why_it_works: string | null;
  total_cost_pp: number | null;
  total_duration_min: number | null;
  stops: unknown;
  is_public: boolean;
}

export default async function PublicItineraryPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('itineraries')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) notFound();

  const it = data as unknown as ItineraryRow;
  const stops = (Array.isArray(it.stops) ? it.stops : []) as Stop[];

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
            Plan your own — free
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </nav>
      </header>

      <article className="mx-auto max-w-content px-6 py-16 md:px-10 md:py-24">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
          Kelowna · BC
        </p>
        <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-[-0.02em] text-text md:text-5xl">
          {it.title ?? 'A plan for tonight'}
        </h1>
        {it.hook && (
          <p className="mt-6 max-w-prose text-lg text-secondary">{it.hook}</p>
        )}
        {it.why_it_works && (
          <p className="mt-10 max-w-prose text-base text-secondary">{it.why_it_works}</p>
        )}

        <div className="mt-16 grid grid-cols-1 gap-12 md:grid-cols-[1fr_300px]">
          {/* Timeline */}
          <div>
            <p className="mb-5 text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Timeline · {TIMEZONE_LABEL}
            </p>
            <ol className="space-y-10">
            {stops.map((s, i) => (
              <li key={s.place_id} className="grid grid-cols-[72px_1fr] gap-6">
                <div className="text-sm text-muted [font-variant-numeric:tabular-nums]">
                  {to12h(s.start_time)}
                </div>
                <div>
                  <div className="flex items-baseline gap-3">
                    <h3 className="font-display text-xl font-semibold text-text">
                      {s.place_name}
                    </h3>
                    <span className="text-sm text-muted [font-variant-numeric:tabular-nums]">
                      {s.duration_min} min
                    </span>
                  </div>
                  {s.what_to_do && (
                    <p className="mt-3 max-w-prose text-base text-secondary">
                      {s.what_to_do}
                    </p>
                  )}
                  <div className="mt-4 flex items-center gap-4 text-sm text-muted">
                    <span className="[font-variant-numeric:tabular-nums]">
                      {s.estimated_cost_pp > 0 ? `$${Math.round(s.estimated_cost_pp)} pp` : 'Free'}
                    </span>
                    {i < stops.length - 1 &&
                      s.drive_to_next_min !== undefined &&
                      s.drive_to_next_min > 0 && (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
                          <span className="[font-variant-numeric:tabular-nums]">
                            {s.drive_to_next_min} min to next
                          </span>
                        </span>
                      )}
                  </div>
                </div>
              </li>
            ))}
            </ol>
          </div>

          {/* Side panel */}
          <aside className="rounded-card border border-border bg-surface p-7 md:sticky md:top-28 md:self-start">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Total</p>
            <p className="mt-3 font-display text-3xl font-bold text-text [font-variant-numeric:tabular-nums]">
              ${Math.round(it.total_cost_pp ?? 0)}{' '}
              <span className="text-base font-normal text-muted">/ pp</span>
            </p>
            <p className="mt-1 text-sm text-muted [font-variant-numeric:tabular-nums]">
              {Math.round((it.total_duration_min ?? 0) / 60 * 10) / 10} hr · {stops.length} stops
            </p>

            <a
              href={mapsUrl(stops)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 block rounded-pill bg-primary px-5 py-3 text-center text-sm font-medium text-background transition-opacity hover:opacity-85"
            >
              Open route in Maps
            </a>

            <Link
              href="/plan"
              className="mt-4 block text-center text-sm text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
            >
              Plan your own
            </Link>
          </aside>
        </div>
      </article>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-content px-6 py-12 md:px-10 md:py-16">
          <p className="text-center text-xs text-muted">
            Built in Kelowna. Coming to Kamloops, Vernon, Penticton.
          </p>
        </div>
      </footer>
    </main>
  );
}

function mapsUrl(stops: Stop[]): string {
  const encoded = stops.map((s) => encodeURIComponent(`${s.place_name}, Kelowna BC`));
  if (encoded.length === 0) return 'https://maps.google.com';
  if (encoded.length === 1) return `https://www.google.com/maps/search/?api=1&query=${encoded[0]}`;
  const origin = encoded[0];
  const destination = encoded[encoded.length - 1];
  const waypoints = encoded.slice(1, -1).join('|');
  const wp = waypoints ? `&waypoints=${waypoints}` : '';
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${wp}`;
}
