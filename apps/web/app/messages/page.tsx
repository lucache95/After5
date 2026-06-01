// apps/web/app/messages/page.tsx
// Server entry for the messages tab (Phase 7, Task 10). Mirrors the matches/offer
// pattern: createClient() → getUser() → flag → render the client child. chat_threads
// RLS (chat_threads_party_read) scopes the select to the viewer's own threads, so no
// explicit party filter is needed here. The counterpart's Tier-3 fields
// (first_name/clear_photo_url) are read through the offer embed — the same
// reveal-safe path OfferDetail/InterestedList use (offer parties may read each
// other's revealed profile; FK-hinted to disambiguate the two profiles FKs on
// offers). Unread + last message come from one extra messages select, folded in by
// the thread-view helpers.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { isMatchEnabledForViewer } from '@/lib/match/flag';
import { ThreadList } from './ThreadList';
import {
  sortThreadsByRecency,
  unreadCount,
  lastMessagePreview,
  isMessageable,
  type ThreadSummary,
  type MessageRow,
} from './thread-view';

export const dynamic = 'force-dynamic';

type ProfileLite = { id: string; first_name: string | null; clear_photo_url: string | null };
type ThreadRow = {
  id: string;
  state: string;
  revoked_at: string | null;
  offer: {
    creator_id: string;
    candidate_id: string;
    creator: ProfileLite | ProfileLite[] | null;
    candidate: ProfileLite | ProfileLite[] | null;
    instance: { starts_at: string | null } | { starts_at: string | null }[] | null;
  } | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export default async function MessagesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/messages');

  if (!(await isMatchEnabledForViewer(supabase))) return <ComingSoonBanner />;

  const { data: rows } = await supabase
    .from('chat_threads')
    .select(`
      id, state, revoked_at,
      offer:offers!chat_threads_offer_id_fkey (
        creator_id, candidate_id,
        creator:profiles!offers_creator_id_fkey ( id, first_name, clear_photo_url ),
        candidate:profiles!offers_candidate_id_fkey ( id, first_name, clear_photo_url ),
        instance:date_instances!offers_date_instance_id_fkey ( starts_at )
      )
    `);

  const threadRows = (rows ?? []) as unknown as ThreadRow[];

  // Messages for the viewer's threads in one pass (RLS scopes to party-read rows);
  // grouped client-side to derive unread + last preview per thread.
  const threadIds = threadRows.map((r) => r.id);
  let byThread = new Map<string, MessageRow[]>();
  if (threadIds.length > 0) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('*')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true });
    byThread = (msgs ?? []).reduce((acc, m) => {
      const list = acc.get(m.thread_id) ?? [];
      list.push(m as MessageRow);
      acc.set(m.thread_id, list);
      return acc;
    }, new Map<string, MessageRow[]>());
  }

  const summaries: ThreadSummary[] = threadRows.map((r) => {
    const offer = r.offer;
    const counterpartIsCreator = offer ? offer.candidate_id === user.id : false;
    const counterpart = offer ? one(counterpartIsCreator ? offer.creator : offer.candidate) : null;
    const instance = offer ? one(offer.instance) : null;
    const msgs = byThread.get(r.id) ?? [];
    const preview = lastMessagePreview(msgs);
    return {
      threadId: r.id,
      counterpartName: counterpart?.first_name ?? null,
      counterpartPhotoUrl: counterpart?.clear_photo_url ?? null,
      startsAt: instance?.starts_at ?? null,
      lastMessage: preview?.body ?? null,
      lastAt: preview?.at ?? null,
      unread: unreadCount(msgs, user.id),
      messageable: isMessageable(r.state, r.revoked_at),
    };
  });

  return <ThreadList threads={sortThreadsByRecency(summaries)} />;
}
