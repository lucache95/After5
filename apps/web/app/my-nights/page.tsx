// apps/web/app/my-nights/page.tsx
// Server entry for the host's posted-nights list (punch-list #5 / dates tab).
// Pattern: createClient() → getUser() → redirect if signed out → query own
// date_instances (creator_id = auth.uid() via RLS policy "date_instances_creator_all")
// joined to itineraries for title + cover, plus a per-instance interested tally
// from queue_entries (creator-readable via "queue_creator_read"). Cards link to
// the interested list.
//
// This is the HOST's own surface (Tier-1 shell), not the blind feed — so it
// shows the real title, real local date/time, and how many people slid in.
import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BottomTabShell } from '@/components/BottomTabShell';
import { NotificationToast } from '@/components/NotificationToast';
import { type VenueOption, type AmbientOption } from './NightCardActions';
import { NightsSegments, type NightRow } from './NightsSegments';
import { DraftDeleteButton } from './DraftDeleteButton';
import { listAmbientSounds } from '@after5/api-client';

export const dynamic = 'force-dynamic';

// Quiet drafts row shape: an itinerary the viewer owns that was never posted
// as a date_instance. Editor saves (update_itinerary_stops) never publish, so
// "draft" simply means "no instance yet".
interface DraftRow {
  id: string;
  title: string | null;
  cover_image_url: string | null;
  stops: unknown;
  total_cost_pp: number | null;
  total_duration_min: number | null;
}

// Same meta idiom as the plan picker: `3 stops · ~2.5 hr · $45 pp`, segments
// drop when missing, null when nothing is derivable.
function draftMetaLine(d: DraftRow): string | null {
  const parts: string[] = [];
  const stopCount = Array.isArray(d.stops) ? d.stops.length : 0;
  if (stopCount > 0) parts.push(`${stopCount} ${stopCount === 1 ? 'stop' : 'stops'}`);
  if (d.total_duration_min != null && d.total_duration_min > 0) {
    parts.push(`~${Math.round((d.total_duration_min / 60) * 10) / 10} hr`);
  }
  if (d.total_cost_pp != null) parts.push(`$${Math.round(d.total_cost_pp)} pp`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// First usable thumb url: cover image, else the first stop photo if the stops
// json carries one. Returns null rather than ever risking a broken <img>.
function draftThumb(d: DraftRow): string | null {
  if (d.cover_image_url) return d.cover_image_url;
  if (Array.isArray(d.stops)) {
    for (const s of d.stops as Array<Record<string, unknown>>) {
      const url = (s?.photo_url ?? s?.image_url) as string | undefined;
      if (typeof url === 'string' && url.length > 0) return url;
    }
  }
  return null;
}

export default async function MyNightsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/my-nights');

  // Scope to the viewer's own posted nights. RLS on date_instances now ORs
  // three permissive SELECT policies (creator_all, owner_select,
  // select_offer_recipient added in migration 127500), so trusting RLS alone
  // leaks nights the viewer only RECEIVED an offer for — tapping those routes
  // to an interested list the guard correctly rejects ("not your date"). The
  // explicit creator_id filter keeps this list to nights the viewer posted.
  // Join itinerary for title + cover. Columns confirmed from migration 120300.
  const { data: rows } = await supabase
    .from('date_instances')
    .select('id, starts_at, status, duration_min, venue_id, ambient_sound_id, itinerary_id, itinerary:itineraries(title, cover_image_url, inputs)')
    .eq('creator_id', user.id)
    .order('starts_at', { ascending: false })
    .limit(50);

  const nights = (rows ?? []) as unknown as NightRow[];

  // Per-night interested tally. queue_entries is creator-readable for the
  // viewer's own instances (RLS policy "queue_creator_read"); every row is a
  // person who slid in (status starts at 'interested' and only moves forward),
  // so a plain row count per instance is the count we want. One scoped query,
  // tallied client-side, avoids N round-trips.
  const counts = new Map<string, number>();
  if (nights.length > 0) {
    const { data: queueRows } = await supabase
      .from('queue_entries')
      .select('date_instance_id')
      .eq('creator_id', user.id);
    for (const row of (queueRows ?? []) as Array<{ date_instance_id: string }>) {
      counts.set(row.date_instance_id, (counts.get(row.date_instance_id) ?? 0) + 1);
    }
  }

  // Active-offer flag per night ("offer sent" chip — founder 2026-06-12).
  // offers is creator-readable; one scoped query.
  const offerSent: Record<string, boolean> = {};
  if (nights.length > 0) {
    const { data: offerRows } = await supabase
      .from('offers')
      .select('date_instance_id')
      .eq('creator_id', user.id)
      .eq('status', 'active');
    for (const row of (offerRows ?? []) as Array<{ date_instance_id: string }>) {
      offerSent[row.date_instance_id] = true;
    }
  }

  // Quiet drafts: itineraries the viewer owns with no date_instance anywhere.
  // Two cheap scoped queries (own itineraries, then which of those ids appear
  // in date_instances) instead of a server-side anti-join; both are small and
  // index-friendly. Empty result → the section renders nothing at all.
  let drafts: DraftRow[] = [];
  {
    const { data: ownPlans } = await supabase
      .from('itineraries')
      .select('id, title, cover_image_url, stops, total_cost_pp, total_duration_min')
      .eq('user_id', user.id)
      .order('generated_at', { ascending: false })
      .limit(40);
    const candidates = (ownPlans ?? []) as unknown as DraftRow[];
    if (candidates.length > 0) {
      const { data: posted } = await supabase
        .from('date_instances')
        .select('itinerary_id')
        .in('itinerary_id', candidates.map((c) => c.id));
      const postedIds = new Set(
        ((posted ?? []) as Array<{ itinerary_id: string | null }>).map((r) => r.itinerary_id),
      );
      drafts = candidates.filter((c) => !postedIds.has(c.id)).slice(0, 20);
    }
  }

  // E7 edit pickers (SC3): the host can re-pin the venue + ambient when editing a
  // seeking night. Load the live/active venue list (mirrors update_night's
  // `approval_status='live' and is_active` validation) + the ambient library so
  // NightCardActions renders the venue/ambient <select>s. Only meaningful when a
  // seeking night exists; cheap enough to load unconditionally.
  const hasSeeking = nights.some((n) => n.status === 'seeking');
  let venues: VenueOption[] = [];
  let ambientOpts: AmbientOption[] = [];
  if (hasSeeking) {
    const [venuesRes, ambientSounds] = await Promise.all([
      supabase.from('places').select('id, name').eq('approval_status', 'live').eq('is_active', true).order('name').limit(200),
      listAmbientSounds(supabase as never),
    ]);
    venues = ((venuesRes.data ?? []) as Array<{ id: string; name: string }>).map((v) => ({ id: v.id, name: v.name }));
    ambientOpts = ((ambientSounds ?? []) as Array<{ id: string; name: string }>).map((s) => ({ id: s.id, name: s.name }));
  }

  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="sticky top-0 z-30 border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-md">
        <nav aria-label="masthead" className="mx-auto flex w-full max-w-[420px] items-center justify-between px-5 py-3.5">
          <Link href="/" className="font-heading text-2xl lowercase text-shell-accent">after5</Link>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-[420px] px-5 pb-28 pt-8">
        <h1 className="font-heading text-4xl lowercase text-shell-ink">your nights</h1>
        <p className="mt-2 font-body text-sm text-shell-ink/60">nights you&apos;ve posted. tap one to see who slid in.</p>

        {/* E25 (D-02): upcoming/archive segment toggle. Buckets the already-fetched
            rows in memory (no second DB query) — upcoming = seeking/matched/active,
            archive = completed/expired/cancelled. The empty states (no nights at all
            vs nothing archived) both live in the client leaf. */}
        <NightsSegments
        offerSent={offerSent}
          nights={nights}
          counts={Object.fromEntries(counts)}
          venues={venues}
          ambientSounds={ambientOpts}
        />

        {/* Quiet drafts: plans saved in the editor but never posted. Low-key by
            design — renders nothing when there are no drafts. */}
        {drafts.length > 0 && (
          <section aria-label="drafts" className="mt-10">
            <h2 className="font-heading text-lg lowercase text-shell-ink/70">drafts</h2>
            <p className="mt-1 font-body text-xs text-shell-ink/50">plans you started but haven&apos;t posted yet.</p>
            <ul className="mt-3 space-y-2">
              {drafts.map((d) => {
                const thumb = draftThumb(d);
                const meta = draftMetaLine(d);
                return (
                  <li key={d.id} className="flex items-center gap-2">
                    <Link
                      href={`/plans/${d.id}/edit`}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-shell-ink/10 bg-shell-base px-3 py-2.5 transition-colors hover:border-shell-ink/25"
                    >
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt=""
                          width={44}
                          height={44}
                          className="h-11 w-11 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div aria-hidden className="h-11 w-11 shrink-0 rounded-lg bg-shell-ink/10" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-body text-sm text-shell-ink">{d.title ?? 'untitled night'}</p>
                        {meta && <p className="mt-0.5 truncate font-body text-xs text-shell-ink/50">{meta}</p>}
                      </div>
                    </Link>
                    <DraftDeleteButton id={d.id} title={d.title ?? 'untitled night'} />
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <NotificationToast userId={user.id} />
      <BottomTabShell userId={user.id} />
    </main>
  );
}
