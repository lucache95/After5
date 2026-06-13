// apps/web/app/inbox/queue/page.tsx
// Standalone queue page (founder 2026-06-12, TikTok inbox pattern). The inbox
// shows a single "your queue" summary row; tapping it lands here — every night
// you're in line for, full StandbyCard rows, with a back button. Reuses the
// StandbyList server component verbatim (it already renders all rows + their
// blind-safe night summaries); this page just frames it with chrome.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { BottomTabShell } from '@/components/BottomTabShell';
import { DeepRouteHeader } from '@/components/DeepRouteHeader';
import { isMatchEnabledForViewer } from '@/lib/match/flag';
import { StandbyList } from '../StandbyList';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/inbox/queue');
  if (!(await isMatchEnabledForViewer(supabase))) return <ComingSoonBanner />;

  // Head-count so the empty state is honest (StandbyList itself returns null at
  // zero, which would otherwise render a chrome-only blank page).
  const { count } = await supabase
    .from('queue_entries')
    .select('date_instance_id', { count: 'exact', head: true })
    .eq('candidate_id', user.id)
    .eq('status', 'interested');

  return (
    <main className="min-h-dvh bg-shell-base">
      <DeepRouteHeader backHref="/inbox" backLabel="back to inbox" title="your queue" />
      <div className="mx-auto w-full max-w-[420px] px-4 pb-28 pt-5">
        {(count ?? 0) === 0 ? (
          <div className="px-2 py-20 text-center">
            <p className="font-heading text-2xl lowercase text-shell-ink">no nights in line</p>
            <p className="mt-2 font-body text-sm text-shell-ink/60">swipe right on a night to join its queue.</p>
            <Link
              href="/feed"
              className="mt-6 inline-block rounded-full bg-shell-accent px-6 py-3 font-body font-semibold lowercase text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
            >
              browse dates
            </Link>
          </div>
        ) : (
          <StandbyList supabase={supabase} userId={user.id} />
        )}
      </div>
      <BottomTabShell userId={user.id} />
    </main>
  );
}
