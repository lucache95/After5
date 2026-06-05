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
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BottomTabShell } from '@/components/BottomTabShell';
import { NotificationToast } from '@/components/NotificationToast';
import { type VenueOption, type AmbientOption } from './NightCardActions';
import { NightsSegments, type NightRow } from './NightsSegments';
import { listAmbientSounds } from '@after5/api-client';

export const dynamic = 'force-dynamic';

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
    .select('id, starts_at, status, duration_min, venue_id, ambient_sound_id, itinerary:itineraries(title, cover_image_url, inputs)')
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
          nights={nights}
          counts={Object.fromEntries(counts)}
          venues={venues}
          ambientSounds={ambientOpts}
        />
      </div>

      <NotificationToast userId={user.id} />
      <BottomTabShell userId={user.id} />
    </main>
  );
}
