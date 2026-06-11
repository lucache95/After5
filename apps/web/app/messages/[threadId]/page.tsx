// apps/web/app/messages/[threadId]/page.tsx
// Server entry for a single conversation (Phase 7, Task 11). chat_threads RLS
// (chat_threads_party_read) returns the row only to a party, so a non-party gets a
// null row → "not your conversation". The counterpart's Tier-3 fields are read via
// the offer embed (reveal-safe; offer parties may read each other's revealed
// profile), FK-hinted to disambiguate offers' two profiles FKs. Initial messages are
// read under messages_party_read RLS, oldest → newest. Everything live happens in
// the client Conversation child.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { UserRound, CalendarHeart } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { DeepRouteHeader } from '@/components/DeepRouteHeader';
import { isMatchEnabledForViewer } from '@/lib/match/flag';
import { resolveMirrorPhotoSrc } from '@/lib/after5/photo-src';
import { Conversation } from './Conversation';
import { isMessageable, type MessageRow } from '../thread-view';
import { offerRevealsHostClear } from '@/lib/after5/offer-reveal';

export const dynamic = 'force-dynamic';

// clear_photo_url is fetched but PROJECTED only post-lock or — candidate side —
// while the offer is live (reveal-at-pick 2026-06-10; gate below),
// the same contract as the unified inbox: profiles RLS opens the row at offer-stage
// with no column revoke, so the blind contract is this layer's job. Pre-lock the
// header avatar stays an initial chip.
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
      id, state, both_ready, revoked_at, lock_id,
      offer:offers!chat_threads_offer_id_fkey (
        creator_id, candidate_id, status, expires_at,
        creator:profiles!offers_creator_id_fkey ( id, first_name, clear_photo_url ),
        candidate:profiles!offers_candidate_id_fkey ( id, first_name, clear_photo_url )
      )
    `)
    .eq('id', threadId)
    .maybeSingle();

  const thread = row as unknown as {
    id: string; state: string; both_ready: boolean; revoked_at: string | null;
    lock_id: string | null;
    offer: {
      creator_id: string; candidate_id: string;
      status: string; expires_at: string | null;
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

  // E18: chat → profile + chat → night quick-links. Reveal-gated on lock_id — a
  // pre-lock thread (lock_id null) renders NO control, so no identity leak before the
  // reveal threshold (T-06-05). Post-lock identity is already revealed (Phase 5), so
  // both controls safely point at /matches/[lockId]. Icon-only → aria-label mandatory.
  const navEdgeClass =
    'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-shell-ink/70 transition hover:text-shell-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none';
  const navEdges = thread.lock_id ? (
    <div className="flex items-center gap-2">
      <Link href={`/matches/${thread.lock_id}`} aria-label="their profile" className={navEdgeClass}>
        <UserRound className="h-5 w-5" strokeWidth={2.25} aria-hidden />
      </Link>
      <Link href={`/matches/${thread.lock_id}`} aria-label="the night" className={navEdgeClass}>
        <CalendarHeart className="h-5 w-5" strokeWidth={2.25} aria-hidden />
      </Link>
    </div>
  ) : undefined;

  return (
    <>
      <DeepRouteHeader
        backHref="/inbox"
        backLabel="back to inbox"
        title={counterpart?.first_name ?? undefined}
        right={navEdges}
      />
      <Conversation
        threadId={thread.id}
        viewerId={user.id}
        counterpartName={counterpart?.first_name ?? 'someone'}
        locked={!!thread.lock_id}
        // Blind contract (same gate as the inbox ThreadRow; reveal-at-pick
        // 2026-06-10): clear photo once locked, OR — candidate side only — while
        // the thread's offer is live (active unexpired / accepted), matching
        // match_reveal_allowed_pair's offer branch. The HOST keeps the initial
        // chip pre-lock. resolveMirrorPhotoSrc signs a relative storage-path
        // mirror and passes rooted/absolute srcs through (seed fixtures).
        counterpartPhotoUrl={
          thread.lock_id || offerRevealsHostClear(user.id, offer)
            ? await resolveMirrorPhotoSrc(supabase, counterpart?.clear_photo_url, { width: 96 })
            : null
        }
        messageable={isMessageable(thread.state, thread.revoked_at)}
        bothReady={thread.both_ready}
        initialMessages={(msgs ?? []) as MessageRow[]}
      />
    </>
  );
}
