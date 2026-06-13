// apps/web/app/inbox/page.tsx
// Unified inbox (#84, spec §1). One tab, two zones over data we already write:
//   zone 1 — activity: grouped rows over the `notifications` table (the bell's
//            data, lifted out of the vaul sheet), newest first, top 5 inline.
//   zone 2 — messages: today's ThreadList, verbatim, recency-sorted.
// Both reads are RLS-bound under the viewer's SSR client (notifications:
// recipient-read; chat_threads: party-read). No new tables, no new write surface
// — the inbox is a read view. Mark-read still only touches `read_at` via the
// existing POST /api/notifications.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { BottomTabShell } from '@/components/BottomTabShell';
import { NotificationToast } from '@/components/NotificationToast';
import { isMatchEnabledForViewer } from '@/lib/match/flag';
import { groupActivity, type ActivityItem, type RawNotification } from '@/lib/after5/inbox-activity';
import { resolveMirrorPhotoSrc } from '@/lib/after5/photo-src';
import { metaFor } from '@/lib/after5/notif-map';
import { relativeTime } from '@/lib/relative-time';
import { Layers, Sparkles } from 'lucide-react';
import { InboxSummaryRow } from './InboxSummaryRow';
import { ThreadRow } from '../messages/ThreadList';
import {
  sortThreadsByRecency,
  unreadCount,
  lastMessagePreview,
  isMessageable,
  type ThreadSummary,
  type MessageRow,
} from '../messages/thread-view';
import { offerRevealsHostClear } from '@/lib/after5/offer-reveal';

export const dynamic = 'force-dynamic';

const ACTIVITY_SEED_LIMIT = 30;

type ProfileLite = { id: string; first_name: string | null; clear_photo_url: string | null };
type ThreadRecord = {
  id: string;
  state: string;
  revoked_at: string | null;
  lock_id: string | null;
  offer: {
    creator_id: string;
    candidate_id: string;
    status: string;
    expires_at: string | null;
    creator: ProfileLite | ProfileLite[] | null;
    candidate: ProfileLite | ProfileLite[] | null;
    instance: { starts_at: string | null } | { starts_at: string | null }[] | null;
  } | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

// One-line preview for the collapsed activity row: the latest item's label
// (counted when grouped) + its relative time, e.g. "3 someone's into your
// night · 4m".
function previewOf(item: ActivityItem): string {
  const meta = metaFor(item.type);
  const count = item.kind === 'group' ? item.count : 1;
  const label = count > 1 ? `${count} ${meta.label}` : meta.label;
  return `${label} · ${relativeTime(item.created_at)}`;
}

export default async function InboxPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/inbox');

  if (!(await isMatchEnabledForViewer(supabase))) return <ComingSoonBanner />;

  // Zone 1 seed — same RLS-bound, keyset-ordered select the activity route uses,
  // grouped server-side so the first paint already shows collapsed rows.
  const { data: notifRows } = await supabase
    .from('notifications')
    .select('id,type,payload,read_at,created_at')
    .eq('user_id', user.id)
    .neq('type', 'new_message')
    .order('created_at', { ascending: false })
    .limit(ACTIVITY_SEED_LIMIT + 1);

  const rawNotifs = (notifRows ?? []) as RawNotification[];
  const hasMoreActivity = rawNotifs.length > ACTIVITY_SEED_LIMIT;
  const activityPage = hasMoreActivity ? rawNotifs.slice(0, ACTIVITY_SEED_LIMIT) : rawNotifs;
  const activityItems = groupActivity(activityPage);

  // Collapsed activity row (TikTok pattern): the latest item drives the one-line
  // preview ("3 someone's into your night · 4m"); an unread head-count badges it.
  const activityPreview = activityItems.length > 0 ? previewOf(activityItems[0]) : null;
  const { count: activityUnread } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .neq('type', 'new_message')
    .is('read_at', null);

  // Zone 2 — the messages tab query, verbatim (chat_threads party-read RLS scopes
  // to the viewer; counterpart Tier-3 read via the reveal-safe offer embed).
  // lock_id is the reveal gate: profiles RLS opens the counterpart ROW at
  // offer-stage (match_reveal_allowed_pair) with NO column revoke, so projecting
  // clear_photo_url is THIS layer's responsibility — clear only post-lock (E16),
  // same contract as the thread page's E18 lock_id-gated nav edges.
  const { data: rows } = await supabase
    .from('chat_threads')
    .select(`
      id, state, revoked_at, lock_id,
      offer:offers!chat_threads_offer_id_fkey (
        creator_id, candidate_id, status, expires_at,
        creator:profiles!offers_creator_id_fkey ( id, first_name, clear_photo_url ),
        candidate:profiles!offers_candidate_id_fkey ( id, first_name, clear_photo_url ),
        instance:date_instances!offers_date_instance_id_fkey ( starts_at )
      )
    `);

  const threadRows = (rows ?? []) as unknown as ThreadRecord[];
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

  const summaries: ThreadSummary[] = await Promise.all(threadRows.map(async (r) => {
    const offer = r.offer;
    const counterpartIsCreator = offer ? offer.candidate_id === user.id : false;
    const counterpart = offer ? one(counterpartIsCreator ? offer.creator : offer.candidate) : null;
    const instance = offer ? one(offer.instance) : null;
    const msgs = byThread.get(r.id) ?? [];
    const preview = lastMessagePreview(msgs);
    return {
      threadId: r.id,
      counterpartName: counterpart?.first_name ?? null,
      // Blind contract (reveal-at-pick, 2026-06-10): clear photo once locked, OR
      // — candidate side only — while the thread's offer is live (active unexpired
      // / accepted), matching match_reveal_allowed_pair's offer branch exactly.
      // The HOST keeps the initial avatar pre-lock (their reveal stays the lock).
      // The mirror can be a relative storage path — resolveMirrorPhotoSrc signs it
      // (rooted/absolute pass through) so the Avatar never gets a bad path.
      counterpartPhotoUrl: r.lock_id || offerRevealsHostClear(user.id, offer)
        ? await resolveMirrorPhotoSrc(supabase, counterpart?.clear_photo_url, { width: 96 })
        : null,
      startsAt: instance?.starts_at ?? null,
      lastMessage: preview?.body ?? null,
      lastAt: preview?.at ?? null,
      unread: unreadCount(msgs, user.id),
      messageable: isMessageable(r.state, r.revoked_at),
    };
  }));
  const threads = sortThreadsByRecency(summaries);

  // E24 (REQ-E24): does the candidate have any pending-interest standby rows? A
  // head-count keeps the empty-state decision honest — a queue-only inbox must
  // NOT read "quiet in here". RLS (queue_candidate_read_own) scopes to the
  // viewer; the explicit candidate_id + interested filter mirrors StandbyList.
  const { count: standbyCount } = await supabase
    .from('queue_entries')
    .select('date_instance_id', { count: 'exact', head: true })
    .eq('candidate_id', user.id)
    .eq('status', 'interested');
  const hasStandby = (standbyCount ?? 0) > 0;

  const bothEmpty = activityItems.length === 0 && threads.length === 0 && !hasStandby;

  return (
    <main className="min-h-dvh bg-shell-base">
      <NotificationToast userId={user.id} />
      <div className="mx-auto w-full max-w-[420px] px-4 pb-28 pt-6">
        <h1 className="mb-5 font-heading text-4xl lowercase text-shell-ink">inbox</h1>

        {bothEmpty ? (
          <div className="px-2 py-16 text-center">
            <p className="font-heading text-3xl lowercase leading-tight text-shell-ink">quiet in here</p>
            <p className="mt-3 font-body text-shell-ink/70">go lock eyes on a night.</p>
            <Link
              href="/feed"
              className="mt-6 inline-block rounded-full bg-shell-accent px-6 py-3 font-body font-semibold lowercase text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
            >
              browse dates
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Collapsed category rows (TikTok pattern): queue + activity each
                fold to one glanceable, tappable row that opens its own page.
                Messages stay the primary list below — the high-intent visit. */}
            {(hasStandby || activityItems.length > 0) && (
              <div className="space-y-2">
                {hasStandby && (
                  <InboxSummaryRow
                    href="/inbox/queue"
                    Icon={Layers}
                    label="your queue"
                    tone="accent"
                    preview={
                      standbyCount === 1
                        ? "1 night you're in line for"
                        : `${standbyCount} nights you're in line for`
                    }
                  />
                )}
                {activityItems.length > 0 && activityPreview && (
                  <InboxSummaryRow
                    href="/inbox/activity"
                    Icon={Sparkles}
                    label="activity"
                    preview={activityPreview}
                    count={activityUnread ?? 0}
                  />
                )}
              </div>
            )}
            {threads.length > 0 && (
              <section aria-labelledby="inbox-messages-heading" className="space-y-3">
                <h2 id="inbox-messages-heading" className="px-1 font-heading text-2xl lowercase text-shell-ink">
                  💬 messages
                </h2>
                <ul aria-label="conversations" className="space-y-3">
                  {threads.map((t) => (
                    <li key={t.threadId}>
                      <ThreadRow thread={t} basePath="/inbox" />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
      <BottomTabShell />
    </main>
  );
}
