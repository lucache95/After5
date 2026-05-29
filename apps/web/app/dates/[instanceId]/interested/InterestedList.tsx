// apps/web/app/dates/[instanceId]/interested/InterestedList.tsx
// Host's interested-list (spec §4.2). Two sections: a draggable Reorder.Group
// shortlist (status='shortlisted', ordered by rank) and non-draggable new-interest
// cards (status='interested'). Drag-rank persists each changed row via
// match.shortlist(instance, candidate, index+1) sequentially with optimistic UI +
// rollback. Rank-1 is frozen while an offer is active (A's frozen-slot rule) and
// shows the make-offer CTA otherwise. can_enter_lock_flow=false → muted (seam 4).
// Realtime appends genuinely-new inserts (seam 5, user-id scoped). R3: initial
// page caps at 20 with a load-more affordance. Tier-1 shell chrome; Tier-3 person
// data via Polaroid tone="dating" + stickerRotation.
'use client';
import { useEffect, useMemo, useState } from 'react';
import { Reorder, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { GripVertical, Lock } from 'lucide-react';
import { Polaroid } from '@/components/Polaroid';
import { stickerRotation } from '@/lib/sticker';
import { cn } from '@/lib/cn';
import { shortlist as shortlistRpc } from '@/lib/after5/match';
import { subscribeQueueInserts } from '@/lib/after5/realtime';
import { MakeOfferModal } from './MakeOfferModal';

const PAGE = 20;

export interface HostCandidate {
  candidate_id: string;
  status: 'interested' | 'shortlisted' | 'offer_active' | 'offer_passed' | 'offer_expired' | 'standby' | 'locked';
  rank: number | null;
  first_name: string;
  age: number | null;
  city: string | null;
  photo_url: string | null;
  can_enter_lock_flow: boolean;
}

export function InterestedList({
  instanceId,
  userId,
  offerWindowHours,
  activeOffer,
  candidates,
}: {
  instanceId: string;
  userId: string;
  offerWindowHours: number;
  activeOffer: { candidate_id: string } | null;
  candidates: HostCandidate[];
}) {
  const reduceMotion = useReducedMotion();
  const [rows, setRows] = useState<HostCandidate[]>(candidates);
  const [visible, setVisible] = useState(PAGE);
  const [offerFor, setOfferFor] = useState<HostCandidate | null>(null);
  const offerActive = activeOffer !== null;

  // Seam 5: append genuinely-new inserts (skip rows we already hold).
  useEffect(() => {
    return subscribeQueueInserts(userId, instanceId, (row) => {
      setRows((prev) =>
        prev.some((r) => r.candidate_id === row.candidate_id)
          ? prev
          : [
              ...prev,
              {
                candidate_id: row.candidate_id,
                status: row.status,
                rank: row.rank,
                first_name: 'someone new',
                age: null,
                city: null,
                photo_url: null,
                can_enter_lock_flow: true,
              },
            ],
      );
    });
  }, [userId, instanceId]);

  const shortlisted = useMemo(
    () => rows.filter((r) => r.status === 'shortlisted' || r.status === 'offer_active')
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
    [rows],
  );
  const interested = useMemo(
    () => rows.filter((r) => r.status === 'interested').slice(0, visible),
    [rows, visible],
  );
  const interestedTotal = rows.filter((r) => r.status === 'interested').length;

  async function persistOrder(next: HostCandidate[]) {
    const prev = rows;
    // Optimistic: assign ranks by index, keep the other sections intact.
    const reranked = next.map((c, i) => ({ ...c, rank: i + 1 }));
    const others = rows.filter((r) => r.status !== 'shortlisted' && r.status !== 'offer_active');
    setRows([...reranked, ...others]);
    try {
      for (let i = 0; i < reranked.length; i++) {
        if (prev.find((p) => p.candidate_id === reranked[i].candidate_id)?.rank !== i + 1) {
          await shortlistRpc(instanceId, reranked[i].candidate_id, i + 1);
        }
      }
    } catch {
      setRows(prev);
      toast.error("couldn't save that order. try again?");
    }
  }

  function onReorder(next: HostCandidate[]) {
    // Frozen slot: never let rank-1 move while an offer is out.
    if (offerActive && next[0]?.candidate_id !== shortlisted[0]?.candidate_id) return;
    void persistOrder(next);
  }

  async function addToShortlist(c: HostCandidate) {
    if (!c.can_enter_lock_flow) {
      toast(`${c.first_name.toLowerCase()}'s already booked elsewhere.`);
      return;
    }
    const prev = rows;
    const nextRank = shortlisted.length + 1;
    setRows((r) => r.map((x) => (x.candidate_id === c.candidate_id ? { ...x, status: 'shortlisted', rank: nextRank } : x)));
    try {
      await shortlistRpc(instanceId, c.candidate_id, nextRank);
    } catch {
      setRows(prev);
      toast.error("couldn't shortlist them. try again?");
    }
  }

  const rank1 = shortlisted[0];

  return (
    <main className="flex min-h-dvh flex-col bg-shell-base px-5 pb-24 pt-7">
      <div className="mx-auto w-full max-w-[420px]">
        <h1 className="font-heading text-3xl lowercase text-shell-ink">who's interested</h1>

        <section className="mt-6">
          <h2 className="font-heading text-2xl lowercase text-shell-ink/90">shortlist</h2>
          {shortlisted.length === 0 ? (
            <p className="mt-2 font-body text-sm text-shell-ink/60">nobody shortlisted yet. drag people up from below.</p>
          ) : (
            <Reorder.Group axis="y" values={shortlisted} onReorder={onReorder} className="mt-3 space-y-2">
              {shortlisted.map((c) => {
                const isRank1 = c.candidate_id === rank1?.candidate_id;
                const frozen = offerActive && isRank1;
                return (
                  <Reorder.Item
                    key={c.candidate_id}
                    value={c}
                    drag={frozen ? false : 'y'}
                    dragListener={!frozen}
                    className="list-none"
                  >
                    <div
                      className={cn(
                        'flex min-h-[44px] items-center gap-3 rounded-3xl border-2 border-shell-ink/10 bg-white px-3 py-2 shadow-warm',
                        frozen && 'opacity-90',
                      )}
                      style={{ transform: `rotate(${stickerRotation(c.candidate_id)}deg)` }}
                    >
                      {frozen ? (
                        <span className="flex items-center gap-1 rounded-full bg-shell-pink px-2 py-1 font-body text-xs lowercase text-shell-ink">
                          <Lock className="h-3.5 w-3.5" aria-hidden /> offer out
                        </span>
                      ) : (
                        <GripVertical className="h-5 w-5 shrink-0 text-shell-ink/40" aria-hidden />
                      )}
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-shell-accent font-body text-sm font-semibold text-white">
                        {c.rank}
                      </span>
                      <Polaroid src={c.photo_url ?? '/places/place-walk.jpg'} alt={c.first_name} size="sm" tone="dating" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-body font-semibold lowercase text-shell-ink">
                          {c.first_name.toLowerCase()}{c.age ? `, ${c.age}` : ''}
                        </p>
                        {c.city && <p className="truncate font-body text-sm text-shell-ink/65">{c.city.toLowerCase()}</p>}
                      </div>
                      {isRank1 && !offerActive && (
                        <button
                          type="button"
                          aria-label={`make offer to ${c.first_name}`}
                          onClick={() => setOfferFor(c)}
                          className="shrink-0 rounded-full bg-shell-accent px-4 py-2 font-body text-sm font-semibold lowercase text-white transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
                        >
                          send it
                        </button>
                      )}
                    </div>
                  </Reorder.Item>
                );
              })}
            </Reorder.Group>
          )}
        </section>

        <section className="mt-8">
          <h2 className="font-heading text-2xl lowercase text-shell-ink/90">new interest</h2>
          {interested.length === 0 ? (
            <p className="mt-2 font-body text-sm text-shell-ink/60">no new right-swipes yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {interested.map((c) => {
                const booked = !c.can_enter_lock_flow;
                return (
                  <li key={c.candidate_id}>
                    <button
                      type="button"
                      aria-label={booked ? `${c.first_name} is already booked` : `add ${c.first_name} to shortlist`}
                      onClick={() => void addToShortlist(c)}
                      className={cn(
                        'flex min-h-[44px] w-full items-center gap-3 rounded-3xl border-2 px-3 py-2 text-left transition',
                        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                        booked
                          ? 'cursor-not-allowed border-shell-ink/10 bg-shell-ink/5 opacity-60'
                          : 'border-shell-ink/10 bg-white hover:border-shell-accent',
                      )}
                    >
                      <Polaroid src={c.photo_url ?? '/places/place-walk.jpg'} alt={c.first_name} size="sm" tone="dating" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-body font-semibold lowercase text-shell-ink">
                          {c.first_name.toLowerCase()}{c.age ? `, ${c.age}` : ''}
                        </p>
                        {booked && <p className="font-body text-xs lowercase text-shell-ink/55">already booked</p>}
                      </div>
                      {!booked && <span className="shrink-0 font-body text-sm font-semibold lowercase text-shell-accent">shortlist</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {interestedTotal >= visible && (
            <button
              type="button"
              onClick={() => setVisible((v) => v + PAGE)}
              className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-full border-2 border-shell-ink/15 font-body lowercase text-shell-ink transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/30"
            >
              load more
            </button>
          )}
        </section>
      </div>

      {offerFor && (
        <MakeOfferModal
          open
          instanceId={instanceId}
          candidate={{
            candidate_id: offerFor.candidate_id,
            first_name: offerFor.first_name,
            age: offerFor.age,
            city: offerFor.city,
            photo_url: offerFor.photo_url,
          }}
          offerWindowHours={offerWindowHours}
          onOffered={(id) => setRows((r) => r.map((x) => (x.candidate_id === id ? { ...x, status: 'offer_active' } : x)))}
          onClose={() => setOfferFor(null)}
        />
      )}
      <span className="sr-only" aria-hidden>{reduceMotion ? 'reduced-motion' : ''}</span>
    </main>
  );
}
