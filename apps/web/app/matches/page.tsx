// Server entry for /matches (spec §4.1). Lists the viewer's locks under their own
// RLS client (locks_party_read restricts to creator_id|matched_user_id=auth.uid()).
// Each lock embeds BOTH party profiles FK-hinted (locks has 3 FKs to profiles —
// bug class 4) so the counterpart's name/photo render in one query; the date
// instance is embedded via its FK for the time label (readable post-lock via the
// 127500 lock-stage policy).
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { isMatchEnabledForViewer } from '@/lib/match/flag';
import { MatchesList, type MatchCard } from './MatchesList';
import { bucketLocks, pickCounterpart, type LockRowWithParties } from './lock-view';

export const dynamic = 'force-dynamic';

export default async function MatchesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/matches');

  if (!(await isMatchEnabledForViewer(supabase))) return <ComingSoonBanner />;

  const { data: rows } = await supabase
    .from('locks')
    .select(`
      id, status, locked_at, rating_closed_at, cancel_reason, creator_id, matched_user_id, date_instance_id,
      creator:profiles!locks_creator_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
      matched:profiles!locks_matched_user_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
      instance:date_instances!locks_date_instance_id_fkey ( id, starts_at, time_range )
    `)
    .order('locked_at', { ascending: false });

  const locks = (rows ?? []) as unknown as LockRowWithParties[];
  const toCard = (l: LockRowWithParties): MatchCard => ({
    id: l.id,
    status: l.status,
    counterpart: pickCounterpart(l, user.id),
    startsAt: l.instance?.starts_at ?? null,
  });
  const { active, past } = bucketLocks(locks);
  return <MatchesList active={active.map(toCard)} past={past.map(toCard)} />;
}
