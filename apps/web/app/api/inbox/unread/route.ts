// apps/web/app/api/inbox/unread/route.ts
// Combined inbox unread count for the bottom-tab badge (#84, spec §2). One number =
// unread activity (notifications, excluding new_message) + unread message threads.
// Both reads are RLS-bound under the viewer's SSR client (notifications:
// recipient-read; messages: party-read). Cheap: a head count for activity, and a
// thin messages select folded by the same unreadCount helper the thread list uses.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { unreadCount, type MessageRow } from '@/app/messages/thread-view';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { count: activity } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .neq('type', 'new_message')
    .is('read_at', null);

  // Threads the viewer is a party to (RLS scopes the join); count unread messages
  // sent BY the counterpart that the viewer hasn't read.
  const { data: threads } = await supabase.from('chat_threads').select('id');
  const threadIds = (threads ?? []).map((t) => t.id);
  let threadsUnread = 0;
  if (threadIds.length > 0) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('thread_id,sender_id,read_at')
      .in('thread_id', threadIds)
      .is('read_at', null);
    threadsUnread = unreadCount((msgs ?? []) as unknown as MessageRow[], user.id);
  }

  const activityUnread = activity ?? 0;
  return NextResponse.json({
    activity: activityUnread,
    threads: threadsUnread,
    total: activityUnread + threadsUnread,
  });
}
