// Server entry for /matches/[lockId]/rate (spec §4.5). Gates to participants,
// HARD-gates the route on the rating window (derived: time_range.upper + 2h —
// no rating_visible_at column exists), and short-circuits to an "already rated"
// state when a match_ratings row already exists for this rater (RLS
// match_ratings_rater_read_own allows the self-read).
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { RatingForm } from './RatingForm';
import { pickCounterpart, isRatingOpen, ratingOpensAt, type LockRowWithParties } from '../../lock-view';

export const dynamic = 'force-dynamic';

export default async function RatePage({ params }: { params: Promise<{ lockId: string }> }) {
  const { lockId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/matches/${lockId}/rate`);

  const { data: flagRow } = await supabase
    .from('feature_config').select('value').eq('key', 'match_v2_enabled').maybeSingle();
  if (flagRow?.value !== true) return <ComingSoonBanner />;

  const { data: row } = await supabase
    .from('locks')
    .select(`
      id, status, creator_id, matched_user_id, date_instance_id,
      creator:profiles!locks_creator_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
      matched:profiles!locks_matched_user_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
      instance:date_instances!locks_date_instance_id_fkey ( id, starts_at, time_range )
    `)
    .eq('id', lockId)
    .maybeSingle();

  const lock = row as unknown as LockRowWithParties | null;
  if (!lock || (lock.creator_id !== user.id && lock.matched_user_id !== user.id)) {
    redirect('/matches');
  }
  const counterpart = pickCounterpart(lock!, user.id);
  if (!counterpart) redirect(`/matches/${lockId}`);

  if (!isRatingOpen(lock!.instance)) {
    const opens = ratingOpensAt(lock!.instance);
    return (
      <main className="mx-auto max-w-[420px] px-4 py-16 text-center">
        <h1 className="font-heading text-3xl lowercase text-shell-ink">not yet</h1>
        <p className="mt-3 font-body text-shell-ink/70">
          you can rate this once the date&apos;s done{opens ? `, after ${opens.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })}` : ''}.
        </p>
      </main>
    );
  }

  const { data: existing } = await supabase
    .from('match_ratings')
    .select('id')
    .eq('lock_id', lockId)
    .eq('rater_id', user.id)
    .maybeSingle();

  if (existing) {
    return (
      <main className="mx-auto max-w-[420px] px-4 py-16 text-center">
        <h1 className="font-heading text-3xl lowercase text-shell-ink">you already rated this date</h1>
        <p className="mt-3 font-body text-shell-ink/70">thanks for the feedback.</p>
      </main>
    );
  }

  return <RatingForm lockId={lockId} rateeId={counterpart!.id} />;
}
