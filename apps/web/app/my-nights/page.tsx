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
import { CalendarHeart, Heart, Sparkles } from 'lucide-react';
import { LocalTime } from '@/components/LocalTime';
import { coverImageForNight } from '@/lib/place-image';
import { NightCardActions, type VenueOption, type AmbientOption } from './NightCardActions';
import { listAmbientSounds } from '@after5/api-client';

export const dynamic = 'force-dynamic';

interface NightRow {
  id: string;
  starts_at: string;
  status: string;
  duration_min: number | null;
  venue_id: string | null;
  ambient_sound_id: string | null;
  itinerary: {
    title: string | null;
    cover_image_url: string | null;
    inputs: { vibe?: string[] } | null;
  } | null;
}

const WHEN_OPTS: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

// Lifecycle label for the corner chip when a night isn't actively seeking.
function lifecycleLabel(status: string): string {
  switch (status) {
    case 'matched': return 'matched';
    case 'completed': return 'done';
    case 'cancelled': return 'cancelled';
    case 'seeking': return 'open';
    default: return status;
  }
}

function NightCard({ night, interested, venues, ambientSounds }: { night: NightRow; interested: number; venues: VenueOption[]; ambientSounds: AmbientOption[] }) {
  const title = night.itinerary?.title?.toLowerCase() ?? 'your night out';
  // Guarantee a tasteful, on-theme banner — never a flat pink placeholder.
  const cover = coverImageForNight({
    cover_image_url: night.itinerary?.cover_image_url,
    vibe_tags: night.itinerary?.inputs?.vibe,
    seedKey: night.id,
  });

  // Corner chip: a matched night reads "matched"; an open night with people in
  // the queue surfaces the count (more useful than "open"); everything else
  // shows its lifecycle label.
  const seeking = night.status === 'seeking';
  let chipText: string;
  let chipClass: string;
  if (night.status === 'matched') {
    chipText = 'matched';
    chipClass = 'bg-white text-shell-accent';
  } else if (seeking && interested > 0) {
    chipText = `${interested} interested`;
    chipClass = 'bg-shell-accent text-white';
  } else if (seeking) {
    chipText = 'open';
    chipClass = 'bg-white text-shell-ink';
  } else {
    chipText = lifecycleLabel(night.status);
    chipClass = 'bg-white text-shell-ink/55';
  }

  return (
    <div>
    <Link
      href={`/dates/${night.id}/interested`}
      className="group block overflow-hidden rounded-3xl border-2 border-shell-ink/10 bg-white shadow-fun transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 hover:border-shell-accent/40 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <div className="relative h-36 w-full overflow-hidden bg-shell-pink">
        <Image
          src={cover}
          alt=""
          fill
          sizes="420px"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          draggable={false}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(61,15,46,0) 45%, rgba(61,15,46,0.55) 100%)' }}
          aria-hidden
        />
        <span
          className={`absolute right-3 top-3 rounded-full px-3 py-1 font-body text-xs font-semibold lowercase shadow-md ${chipClass}`}
        >
          {chipText}
        </span>
      </div>

      <div className="px-4 pb-4 pt-3">
        <p className="line-clamp-2 font-heading text-xl leading-tight lowercase text-shell-ink">{title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-sm text-shell-ink/65">
          <span className="flex items-center gap-1.5">
            <CalendarHeart className="h-4 w-4 shrink-0 text-shell-accent" aria-hidden />
            <LocalTime iso={night.starts_at} opts={WHEN_OPTS} />
          </span>
          <span className="flex items-center gap-1.5">
            <Heart className="h-4 w-4 shrink-0 text-shell-accent" aria-hidden />
            {interested === 1 ? '1 interested' : `${interested} interested`}
          </span>
        </div>
      </div>
    </Link>

      {/* Host controls (E6/E7): cancel + edit, rendered ONLY on the host's own
          seeking night. NightCardActions returns null for any other status, so
          this row is invisible on matched/completed/expired/cancelled cards. */}
      {seeking && (
        <div className="mt-2.5">
          <NightCardActions
            night={{
              id: night.id,
              starts_at: night.starts_at,
              status: night.status,
              duration_min: night.duration_min,
              venue_id: night.venue_id,
              ambient_sound_id: night.ambient_sound_id,
            }}
            venues={venues}
            ambientSounds={ambientSounds}
          />
        </div>
      )}
    </div>
  );
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

        {nights.length === 0 ? (
          <div className="mt-10 rounded-3xl border-2 border-dashed border-shell-accent/30 bg-shell-pink/50 px-6 py-12 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-fun">
              <Sparkles className="h-8 w-8 text-shell-accent" strokeWidth={1.75} aria-hidden />
            </div>
            <p className="font-heading text-2xl lowercase text-shell-ink">nothing posted yet</p>
            <p className="mx-auto mt-2 max-w-[16rem] font-body text-sm text-shell-ink/65">
              put a night out there and people nearby can slide in.
            </p>
            <Link
              href="/nights/new"
              className="mt-6 inline-block rounded-full bg-shell-accent px-7 py-3 font-body font-semibold lowercase text-white shadow-fun transition hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100"
            >
              post your first night
            </Link>
          </div>
        ) : (
          <section aria-label="your posted nights" className="mt-6 space-y-4">
            {nights.map((night) => (
              <NightCard key={night.id} night={night} interested={counts.get(night.id) ?? 0} venues={venues} ambientSounds={ambientOpts} />
            ))}
          </section>
        )}
      </div>

      <NotificationToast userId={user.id} />
      <BottomTabShell userId={user.id} />
    </main>
  );
}
