// apps/web/app/inbox/StandbyList.tsx
// E24 (REQ-E24): the candidate-facing standby/waitlist read view. Server
// component, mounted on /inbox (the candidate's "what's happening to me"
// surface — 07-PATTERNS Q1). Reads the candidate's OWN pending-interest queue
// rows, hydrates each with the night's blind-safe summary (title / starts_at /
// cover) via get_night_detail, and renders one compact StandbyCard row per
// entry under a `your queue` eyebrow.
//
// SECURITY (T-07-14): the select is scoped `candidate_id = user.id` AND
// `status = 'interested'`, and queue_entries RLS (queue_candidate_read_own)
// independently enforces candidate_id = auth.uid() — a candidate can only ever
// see their own rows. The plain `interested` filter keeps this to PRE-offer
// standby rows (shortlisted/offer_active/locked move to their own surfaces).
//
// BLIND CONTRACT (T-07-16): a candidate with a plain interested row STILL has
// no RLS read on the night's date_instances/itineraries rows (creator /
// offer-recipient only — 20260527127500), so a client embed returns nothing.
// The night summary comes from get_night_detail instead (DEFINER,
// authenticated-only), whose projection is blind-safe by construction —
// title / cover / vibe / hour-truncated time, never creator_id, host name, or
// photo. Queued nights pass its gates (the viewer is a candidate, not the
// creator; status='seeking'; starts_at > now()); a night that has since
// expired or been pulled resolves to null and the row degrades to the
// identity-free fallback label. The section is hidden entirely when the
// candidate has no pending-interest rows (UI-SPEC §States).
import type { SupabaseClient } from '@supabase/supabase-js';
import { getNightDetail, type After5Client } from '@after5/api-client';
import { StandbyCard, type StandbyEntry } from '@/components/StandbyCard';

interface QueueRow {
  date_instance_id: string;
  status: string;
  rank: number | null;
}

export async function StandbyList({
  supabase,
  userId,
}: {
  // The viewer's RLS-bound SSR client (createClient()). Typed loosely to avoid
  // pulling the generated Database type into this leaf; the query is RLS-safe.
  supabase: SupabaseClient;
  userId: string;
}) {
  const { data: rows } = await supabase
    .from('queue_entries')
    .select('date_instance_id, status, rank')
    .eq('candidate_id', userId)
    .eq('status', 'interested')
    .order('rank', { ascending: true, nullsFirst: false });

  const queue = (rows ?? []) as QueueRow[];
  if (queue.length === 0) return null; // hidden until a queue entry exists

  // One get_night_detail per row, in parallel (no waterfall) — standby queues
  // run 1–3 rows, so a batch RPC isn't warranted. .catch(null) keeps one broken
  // night from blanking the whole section.
  const details = await Promise.all(
    queue.map((r) =>
      getNightDetail(supabase as After5Client, r.date_instance_id).catch(() => null),
    ),
  );

  const entries: StandbyEntry[] = queue.map((r, i) => ({
    instance_id: r.date_instance_id,
    rank: r.rank,
    status: r.status,
    title: details[i]?.title ?? null,
    starts_at: details[i]?.time_window_start ?? null,
    cover_image_url: details[i]?.cover_image_url ?? null,
    vibe_tags: details[i]?.vibe_tags ?? null,
  }));

  return (
    <section aria-labelledby="inbox-standby-heading" className="space-y-3">
      <h2
        id="inbox-standby-heading"
        className="px-1 font-body text-[11px] font-bold lowercase tracking-[0.16em] text-shell-ink/50"
      >
        your queue
      </h2>
      <ul className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.instance_id}>
            <StandbyCard entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  );
}
