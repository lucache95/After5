// Server entry for /matches/[lockId] (spec §4.2). Loads the lock with FK-hinted
// embeds (locks has 3 profiles FKs — bug class 4), gates to participants (RLS
// locks_party_read already hides non-party rows; the id check is defense-in-depth),
// derives the counterpart + rating-window state, and renders LockDetail.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { isMatchEnabledForViewer } from '@/lib/match/flag';
import { LockDetail } from './LockDetail';
import { pickCounterpart, isRatingOpen, type LockRowWithParties } from '../lock-view';

export const dynamic = 'force-dynamic';

export default async function LockPage({
  params, searchParams,
}: {
  params: Promise<{ lockId: string }>;
  searchParams: Promise<{ just?: string }>;
}) {
  const { lockId } = await params;
  const { just } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/matches/${lockId}`);

  if (!(await isMatchEnabledForViewer(supabase))) return <ComingSoonBanner />;

  const { data: row } = await supabase
    .from('locks')
    .select(`
      id, status, locked_at, rating_closed_at, cancel_reason, creator_id, matched_user_id, date_instance_id,
      creator:profiles!locks_creator_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
      matched:profiles!locks_matched_user_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
      instance:date_instances!locks_date_instance_id_fkey ( id, starts_at, time_range ),
      thread:chat_threads!chat_threads_lock_id_fkey ( id )
    `)
    .eq('id', lockId)
    .maybeSingle();

  const lock = row as unknown as LockRowWithParties | null;
  if (!lock || (lock.creator_id !== user.id && lock.matched_user_id !== user.id)) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">
        <div className="mx-auto max-w-[420px]">
          <h1 className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">not your match</h1>
          <p className="mt-4 font-body text-lg text-shell-ink/70">this one belongs to someone else.</p>
        </div>
      </main>
    );
  }

  // chat_threads.lock_id is a one-to-one back-reference; the embed comes back as an
  // array (or object) — normalize to the single promoted thread for this lock.
  const threadEmbed = (row as unknown as { thread?: { id: string } | { id: string }[] | null }).thread;
  const threadId = Array.isArray(threadEmbed) ? threadEmbed[0]?.id ?? null : threadEmbed?.id ?? null;

  const counterpart = pickCounterpart(lock, user.id);
  if (!counterpart) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">
        <p className="font-body text-shell-ink/70">couldn&apos;t load this match. try again in a moment.</p>
      </main>
    );
  }

  return (
    <LockDetail
      lockId={lock.id}
      status={lock.status}
      counterpart={counterpart}
      threadId={threadId}
      startsAt={lock.instance?.starts_at ?? null}
      ratingOpen={isRatingOpen(lock.instance)}
      justLocked={just === '1'}
    />
  );
}
