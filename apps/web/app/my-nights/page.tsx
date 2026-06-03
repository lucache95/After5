// apps/web/app/my-nights/page.tsx
// Server entry for the host's posted-nights list (punch-list #5 / dates tab).
// Pattern: createClient() → getUser() → redirect if signed out → query own
// date_instances (creator_id = auth.uid() via RLS policy "date_instances_creator_all")
// joined to itineraries for title + cover. Cards link to the interested list.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BottomTabShell } from '@/components/BottomTabShell';
import { NotificationBell } from '@/components/NotificationBell';
import { Polaroid } from '@/components/Polaroid';
import { CalendarHeart } from 'lucide-react';
import { LocalTime } from '@/components/LocalTime';
import { coverImageForNight } from '@/lib/place-image';

export const dynamic = 'force-dynamic';

interface NightRow {
  id: string;
  starts_at: string;
  status: string;
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

function statusPill(status: string): string {
  switch (status) {
    case 'seeking': return 'open';
    case 'matched': return 'matched';
    case 'completed': return 'done';
    case 'cancelled': return 'cancelled';
    default: return status;
  }
}

function pillColor(status: string): string {
  switch (status) {
    case 'matched': return 'bg-shell-accent/20 text-shell-accent';
    case 'completed': return 'bg-shell-ink/10 text-shell-ink/60';
    case 'cancelled': return 'bg-shell-ink/10 text-shell-ink/40';
    default: return 'bg-shell-pink text-shell-ink'; // seeking
  }
}

function NightCard({ night }: { night: NightRow }) {
  const title = night.itinerary?.title ?? 'your night out';
  // Guarantee a tasteful, on-theme thumbnail — never a flat pink placeholder.
  const cover = coverImageForNight({
    cover_image_url: night.itinerary?.cover_image_url,
    vibe_tags: night.itinerary?.inputs?.vibe,
    seedKey: night.id,
  });

  return (
    <Link
      href={`/dates/${night.id}/interested`}
      className="flex items-center gap-4 rounded-3xl border-2 border-shell-ink/10 bg-white p-3 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 hover:border-shell-ink/25"
    >
      <Polaroid src={cover} alt={title} size="sm" tone="dating" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-heading text-xl lowercase text-shell-ink">{title}</p>
        <p className="truncate font-body text-sm text-shell-ink/65">
          <LocalTime iso={night.starts_at} opts={WHEN_OPTS} />
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full px-3 py-1 font-body text-xs font-semibold lowercase ${pillColor(night.status)}`}
      >
        {statusPill(night.status)}
      </span>
    </Link>
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
    .select('id, starts_at, status, itinerary:itineraries(title, cover_image_url, inputs)')
    .eq('creator_id', user.id)
    .order('starts_at', { ascending: false })
    .limit(50);

  const nights = (rows ?? []) as unknown as NightRow[];

  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="sticky top-0 z-30 border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-md">
        <nav aria-label="masthead" className="mx-auto flex w-full max-w-[420px] items-center justify-between px-5 py-3.5">
          <Link href="/" className="font-heading text-2xl lowercase text-shell-accent">after5</Link>
          <NotificationBell />
        </nav>
      </header>

      <div className="mx-auto w-full max-w-[420px] px-5 pb-28 pt-8">
        <h1 className="font-heading text-4xl lowercase text-shell-ink">your nights</h1>
        <p className="mt-2 font-body text-sm text-shell-ink/60">nights you&apos;ve posted. tap to see who&apos;s interested.</p>

        {nights.length === 0 ? (
          <div className="mt-14 text-center">
            <CalendarHeart
              className="mx-auto mb-4 h-12 w-12 text-shell-ink/20"
              strokeWidth={1.5}
              aria-hidden
            />
            <p className="font-heading text-2xl lowercase text-shell-ink">no nights yet</p>
            <p className="mt-2 font-body text-sm text-shell-ink/60">post a night and people nearby can slide in.</p>
            <Link
              href="/nights/new"
              className="mt-6 inline-block rounded-full bg-shell-accent px-6 py-3 font-body font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100"
            >
              post a night
            </Link>
          </div>
        ) : (
          <section aria-label="your posted nights" className="mt-6 space-y-3">
            {nights.map((night) => (
              <NightCard key={night.id} night={night} />
            ))}
          </section>
        )}
      </div>

      <BottomTabShell />
    </main>
  );
}
