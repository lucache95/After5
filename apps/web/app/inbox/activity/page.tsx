// apps/web/app/inbox/activity/page.tsx
// Standalone activity page (founder 2026-06-12, TikTok inbox pattern). The inbox
// shows a single "activity" summary row; tapping it lands here — the full
// notification history with a back button and infinite scroll. Server seeds the
// first grouped page (same RLS-bound keyset read as the inbox); ActivityFeed
// auto-loads the rest from /api/inbox/activity as you scroll.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { BottomTabShell } from '@/components/BottomTabShell';
import { DeepRouteHeader } from '@/components/DeepRouteHeader';
import { isMatchEnabledForViewer } from '@/lib/match/flag';
import { groupActivity, type RawNotification } from '@/lib/after5/inbox-activity';
import { ActivityFeed } from './ActivityFeed';

export const dynamic = 'force-dynamic';

const PAGE = 30;

export default async function ActivityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/inbox/activity');
  if (!(await isMatchEnabledForViewer(supabase))) return <ComingSoonBanner />;

  const { data: notifRows } = await supabase
    .from('notifications')
    .select('id,type,payload,read_at,created_at')
    .eq('user_id', user.id)
    .neq('type', 'new_message')
    .order('created_at', { ascending: false })
    .limit(PAGE + 1);

  const raw = (notifRows ?? []) as RawNotification[];
  const hasMore = raw.length > PAGE;
  const pageRows = hasMore ? raw.slice(0, PAGE) : raw;
  const items = groupActivity(pageRows);
  const cursor = hasMore ? pageRows[pageRows.length - 1]?.created_at ?? null : null;

  return (
    <main className="min-h-dvh bg-shell-base">
      <DeepRouteHeader backHref="/inbox" backLabel="back to inbox" title="activity" />
      <div className="mx-auto w-full max-w-[420px] px-4 pb-28 pt-5">
        <ActivityFeed userId={user.id} initialItems={items} initialCursor={cursor} />
      </div>
      <BottomTabShell userId={user.id} />
    </main>
  );
}
