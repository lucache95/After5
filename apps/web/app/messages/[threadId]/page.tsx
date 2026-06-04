// apps/web/app/messages/[threadId]/page.tsx
// Server entry for a single conversation (Phase 7, Task 11). chat_threads RLS
// (chat_threads_party_read) returns the row only to a party, so a non-party gets a
// null row → "not your conversation". The counterpart's Tier-3 fields are read via
// the offer embed (reveal-safe; offer parties may read each other's revealed
// profile), FK-hinted to disambiguate offers' two profiles FKs. Initial messages are
// read under messages_party_read RLS, oldest → newest. Everything live happens in
// the client Conversation child.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { DeepRouteHeader } from '@/components/DeepRouteHeader';
import { isMatchEnabledForViewer } from '@/lib/match/flag';
import { Conversation } from './Conversation';
import { isMessageable, type MessageRow } from '../thread-view';

export const dynamic = 'force-dynamic';

type ProfileLite = { id: string; first_name: string | null; clear_photo_url: string | null };

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/messages/${threadId}`);

  if (!(await isMatchEnabledForViewer(supabase))) return <ComingSoonBanner />;

  const { data: row } = await supabase
    .from('chat_threads')
    .select(`
      id, state, both_ready, revoked_at,
      offer:offers!chat_threads_offer_id_fkey (
        creator_id, candidate_id,
        creator:profiles!offers_creator_id_fkey ( id, first_name, clear_photo_url ),
        candidate:profiles!offers_candidate_id_fkey ( id, first_name, clear_photo_url )
      )
    `)
    .eq('id', threadId)
    .maybeSingle();

  const thread = row as unknown as {
    id: string; state: string; both_ready: boolean; revoked_at: string | null;
    offer: {
      creator_id: string; candidate_id: string;
      creator: ProfileLite | ProfileLite[] | null;
      candidate: ProfileLite | ProfileLite[] | null;
    } | null;
  } | null;

  if (!thread || !thread.offer) {
    return (
      <>
        <DeepRouteHeader backHref="/inbox" backLabel="back to inbox" />
        <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">
          <div className="mx-auto max-w-[420px]">
            <h1 className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">not your conversation</h1>
            <p className="mt-4 font-body text-lg text-shell-ink/70">this one belongs to someone else.</p>
          </div>
        </main>
      </>
    );
  }

  const offer = thread.offer;
  const counterpartIsCreator = offer.candidate_id === user.id;
  const counterpart = one(counterpartIsCreator ? offer.creator : offer.candidate);

  const { data: msgs } = await supabase
    .from('messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });

  return (
    <>
      <DeepRouteHeader
        backHref="/inbox"
        backLabel="back to inbox"
        title={counterpart?.first_name ?? undefined}
      />
      <Conversation
        threadId={thread.id}
        viewerId={user.id}
        counterpartName={counterpart?.first_name ?? 'someone'}
        messageable={isMessageable(thread.state, thread.revoked_at)}
        bothReady={thread.both_ready}
        initialMessages={(msgs ?? []) as MessageRow[]}
      />
    </>
  );
}
