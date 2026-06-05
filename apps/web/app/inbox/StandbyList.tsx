// apps/web/app/inbox/StandbyList.tsx
// E24 (REQ-E24): the candidate-facing standby/waitlist read view. Server
// component, mounted on /inbox (the candidate's "what's happening to me"
// surface — 07-PATTERNS Q1). Reads the candidate's OWN pending-interest queue
// rows and renders one StandbyCard per row under a `your queue` eyebrow.
//
// SECURITY (T-07-14): the select is scoped `candidate_id = user.id` AND
// `status = 'interested'`, and queue_entries RLS (queue_candidate_read_own)
// independently enforces candidate_id = auth.uid() — a candidate can only ever
// see their own rows. The plain `interested` filter keeps this to PRE-offer
// standby rows (shortlisted/offer_active/locked move to their own surfaces).
//
// BLIND CONTRACT (T-07-16): a candidate with a plain interested row has NO RLS
// read on the night's date_instances/itineraries row (creator/offer-recipient
// only — 20260527127500). So the card shows only the candidate's OWN rank/status
// plus a generic, identity-free night label. No host name, photo, or title is
// rendered or even queryable here. The section is hidden entirely when the
// candidate has no pending-interest rows (UI-SPEC §States).
import type { SupabaseClient } from '@supabase/supabase-js';
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

  const entries: StandbyEntry[] = queue.map((r) => ({
    instance_id: r.date_instance_id,
    rank: r.rank,
    status: r.status,
    // identity-free label — the night's title is not readable pre-offer.
    night_label: 'a night you slid in on',
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
