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
import { Drawer } from 'vaul';
import { toast } from 'sonner';
import { Check, GripVertical, Lock, UserMinus } from 'lucide-react';
import { Polaroid } from '@/components/Polaroid';
import { stickerRotation } from '@/lib/sticker';
import { cn } from '@/lib/cn';
import { shortlist as shortlistRpc, rejectCandidate, withdraw } from '@/lib/after5/match';
import { subscribeQueueInserts } from '@/lib/after5/realtime';
import { browserAfter5Client } from '@/lib/after5/client';
import { resolveMirrorPhotoSrc } from '@/lib/after5/photo-src';
import { MakeOfferModal } from './MakeOfferModal';
import { PendingButtonContent } from '@/components/PendingButtonContent';

const PAGE = 20;

export interface HostCandidate {
  candidate_id: string;
  // 'passed_by_host' added by E12 (20260605120100) to the queue_status enum so this
  // hand-typed union stays assignable from the regenerated DB row type. The reject /
  // silent-removal UI that consumes it lands in a later Phase-3 plan (03-02/03-06).
  status: 'interested' | 'shortlisted' | 'offer_active' | 'offer_passed' | 'offer_expired' | 'standby' | 'locked' | 'passed_by_host';
  rank: number | null;
  first_name: string;
  age: number | null;
  city: string | null;
  photo_url: string | null;
  can_enter_lock_flow: boolean;
}

// Candidate avatar: the clear photo in the sm dating polaroid when present;
// otherwise the brand initial-letter chip (same treatment as the matches list
// + inbox rows) in the SAME polaroid footprint. Never a stock landscape — a
// '/places/*' mood shot for a PERSON read as a wrong photo, not a placeholder.
function CandidateAvatar({ photo, name }: { photo: string | null; name: string }) {
  if (photo) return <Polaroid src={photo} alt={name} size="sm" tone="dating" />;
  const initial = (name.trim()[0] ?? '?').toLowerCase();
  return (
    <span
      aria-hidden
      className="relative inline-block w-[110px] shrink-0 bg-white px-2 pb-7 pt-1.5 shadow-md ring-1 ring-black/5"
      style={{ transform: `rotate(${stickerRotation(name)}deg)` }}
    >
      <span className="flex h-[96px] w-[100px] items-center justify-center bg-shell-pink">
        <span className="font-heading text-3xl lowercase text-shell-accent">{initial}</span>
      </span>
    </span>
  );
}

// Lowercase outcome pill for an offered candidate's terminal state (E12/D-05).
// No harsh language: a pass reads as "they passed", never "rejected". offer_active
// keeps the existing pink "offer out" badge (rendered inline in the row, not here).
function OutcomePill({ status }: { status: HostCandidate['status'] }) {
  if (status === 'locked') {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-shell-pink px-2 py-1 font-body text-xs lowercase text-shell-accent">
        <Check className="h-3.5 w-3.5" aria-hidden /> accepted
      </span>
    );
  }
  if (status === 'offer_passed') {
    return <span className="shrink-0 rounded-full bg-shell-ink/5 px-2 py-1 font-body text-xs lowercase text-shell-ink/55">they passed</span>;
  }
  if (status === 'offer_expired') {
    return <span className="shrink-0 rounded-full bg-shell-ink/5 px-2 py-1 font-body text-xs lowercase text-shell-ink/55">expired</span>;
  }
  return null;
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
  // E12 triage: candidate pending a silent decline (confirm sheet open) and the
  // active-offer row pending a withdraw confirm. Both null = sheets closed.
  const [declineFor, setDeclineFor] = useState<HostCandidate | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // One active offer per instance (match_make_offer step 8 raises P5003
  // offer_already_active). Derive the gate from BOTH seams so it survives an
  // optimistic send without a reload: the server prop (offers row with
  // status='active') AND any row already flipped to offer_active — the RPC
  // promotes the offered queue_entry to offer_active/rank-1 (step 13), and
  // MakeOfferModal's onOffered mirrors that flip locally on success.
  const offerActive = activeOffer !== null || rows.some((r) => r.status === 'offer_active');

  // Seam 5: append genuinely-new inserts (skip rows we already hold). The realtime
  // payload is the raw queue_entries row — no joined profile — so we append a
  // "someone new" placeholder for instant feedback, then enrich it with the
  // candidate's Tier-3 profile (RLS profiles_select_revealed) so the real name and
  // photo fill in live, matching the server fetch on load.
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
      // Fire-and-forget profile fetch; patches the row in place when it resolves.
      // Idempotent, so a duplicate insert event just re-applies the same values.
      // The clear_photo_url mirror can be a relative storage path (real users)
      // — resolve it to a signed URL (browser-side direct sign) like the SSR
      // loader does, so next/image never sees a raw path.
      void (async () => {
        const client = browserAfter5Client();
        const { data } = await client
          .from('profiles')
          .select('first_name, age, city, clear_photo_url')
          .eq('id', row.candidate_id)
          .maybeSingle();
        if (!data) return;
        const photo = await resolveMirrorPhotoSrc(client, data.clear_photo_url, { width: 128 });
        setRows((cur) =>
          cur.map((r) =>
            r.candidate_id === row.candidate_id
              ? {
                  ...r,
                  first_name: data.first_name ?? r.first_name,
                  age: data.age ?? r.age,
                  city: data.city ?? r.city,
                  photo_url: photo ?? r.photo_url,
                }
              : r,
          ),
        );
      })();
    });
  }, [userId, instanceId]);

  // The shortlist section also carries terminal-outcome rows (the candidate who
  // was offered) so their outcome pill stays visible: offer_active (live),
  // locked (accepted), offer_passed (they passed), offer_expired. passed_by_host
  // is silently excluded everywhere (D-04).
  const SHORTLIST_STATUSES = ['shortlisted', 'offer_active', 'locked', 'offer_passed', 'offer_expired'] as const;
  const shortlisted = useMemo(
    () => rows.filter((r) => (SHORTLIST_STATUSES as readonly string[]).includes(r.status))
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

  // E12 silent decline (D-04). Optimistic-mutate-with-rollback: flip the row to
  // passed_by_host (which the section memos exclude, so it vanishes), then call
  // the silent reject RPC. On failure, restore the prior rows. The candidate is
  // NEVER notified — no candidate-facing copy lives anywhere in this flow.
  async function confirmDecline(c: HostCandidate) {
    if (busy) return;
    setBusy(true);
    const prev = rows;
    setRows((r) => r.map((x) => (x.candidate_id === c.candidate_id ? { ...x, status: 'passed_by_host' } : x)));
    setDeclineFor(null);
    try {
      await rejectCandidate(instanceId, c.candidate_id);
      toast.success('passed. off your list.');
    } catch {
      setRows(prev);
      toast.error("couldn't pass on them. try again?");
    } finally {
      setBusy(false);
    }
  }

  // E12 withdraw an outstanding offer (D-05). Routes through the existing
  // candidate-agnostic match-withdraw wrapper; a router refresh would re-fetch,
  // but the realtime/SSR seam already drives the row state, so we just toast.
  async function confirmWithdraw() {
    if (busy) return;
    setBusy(true);
    try {
      await withdraw(instanceId);
      toast.success('offer pulled.');
      setWithdrawOpen(false);
    } catch {
      toast.error("couldn't pull the offer. try again?");
    } finally {
      setBusy(false);
    }
  }

  const rank1 = shortlisted[0];

  return (
    // pb-28 clears the fixed BottomTabShell the page mounts under this list.
    <main className="flex min-h-dvh flex-col bg-shell-base px-5 pb-28 pt-7">
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
                // The row holding the live offer: optimistic flip (onOffered) or
                // server-derived (offers row / queue status on load).
                const offered = c.status === 'offer_active' || c.candidate_id === activeOffer?.candidate_id;
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
                        // Lock replaces the drag grip — rank-1 can't move while the
                        // offer is out. The "offer sent" pill on the right carries
                        // the text, so the icon stays quiet.
                        <Lock className="h-5 w-5 shrink-0 text-shell-ink/40" aria-hidden />
                      ) : (
                        <GripVertical className="h-5 w-5 shrink-0 text-shell-ink/40" aria-hidden />
                      )}
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-shell-accent font-body text-sm font-semibold text-white">
                        {c.rank}
                      </span>
                      <CandidateAvatar photo={c.photo_url} name={c.first_name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-body font-semibold lowercase text-shell-ink">
                          {c.first_name.toLowerCase()}{c.age ? `, ${c.age}` : ''}
                        </p>
                        {c.city && <p className="truncate font-body text-sm text-shell-ink/65">{c.city.toLowerCase()}</p>}
                        {frozen && (
                          <button
                            type="button"
                            aria-label={`pull the offer back from ${c.first_name}`}
                            onClick={() => setWithdrawOpen(true)}
                            className="mt-0.5 font-body text-sm lowercase text-shell-ink/55 underline-offset-2 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 focus-visible:ring-offset-1"
                          >
                            withdraw
                          </button>
                        )}
                      </div>
                      <OutcomePill status={c.status} />
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
                      {offered && offerActive && (
                        // Inert pill where "send it" was — the offer went out;
                        // a live-looking button here invites a double-tap.
                        <span className="shrink-0 rounded-full bg-shell-pink px-4 py-2 font-body text-sm font-semibold lowercase text-shell-ink/70">
                          offer sent
                        </span>
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
                  <li
                    key={c.candidate_id}
                    className={cn(
                      'flex min-h-[44px] items-center gap-1 rounded-3xl border-2 pr-2 transition',
                      booked ? 'border-shell-ink/10 bg-shell-ink/5 opacity-60' : 'border-shell-ink/10 bg-white',
                    )}
                  >
                    <button
                      type="button"
                      aria-label={booked ? `${c.first_name} is already booked` : `add ${c.first_name} to shortlist`}
                      onClick={() => void addToShortlist(c)}
                      className={cn(
                        'flex min-h-[44px] flex-1 items-center gap-3 rounded-3xl px-3 py-2 text-left transition',
                        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                        booked ? 'cursor-not-allowed' : 'hover:opacity-90',
                      )}
                    >
                      <CandidateAvatar photo={c.photo_url} name={c.first_name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-body font-semibold lowercase text-shell-ink">
                          {c.first_name.toLowerCase()}{c.age ? `, ${c.age}` : ''}
                        </p>
                        {booked && <p className="font-body text-xs lowercase text-shell-ink/55">already booked</p>}
                      </div>
                      {!booked && <span className="shrink-0 font-body text-sm font-semibold lowercase text-shell-accent">shortlist</span>}
                    </button>
                    <button
                      type="button"
                      aria-label={`pass on ${c.first_name}`}
                      onClick={() => setDeclineFor(c)}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-shell-ink/40 transition hover:text-shell-accent focus-visible:text-shell-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
                    >
                      <UserMinus className="h-5 w-5" aria-hidden />
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

      {/* ── Decline confirm (silent — D-04) ───────────────────────────────── */}
      <Drawer.Root open={declineFor !== null} onOpenChange={(o) => { if (!o) setDeclineFor(null); }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-shell-ink/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[420px] rounded-t-3xl bg-shell-base px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
            <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-shell-ink/20" />
            <Drawer.Title className="font-heading text-3xl lowercase text-shell-ink">
              pass on {declineFor?.first_name.toLowerCase()}?
            </Drawer.Title>
            <Drawer.Description className="mt-1 font-body text-sm text-shell-ink/70">
              they drop off your list. they won&apos;t be told. no awkwardness.
            </Drawer.Description>
            <button
              type="button"
              disabled={busy}
              onClick={() => { if (declineFor) void confirmDecline(declineFor); }}
              className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-full bg-shell-accent font-body font-semibold lowercase text-white transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-50"
            >
              <PendingButtonContent pending={busy} pendingLabel="passing…" accessibilityLabel="passing candidate">
                pass
              </PendingButtonContent>
            </button>
            <button
              type="button"
              onClick={() => setDeclineFor(null)}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-full font-body lowercase text-shell-ink/70 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/30"
            >
              keep them
            </button>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* ── Withdraw confirm ──────────────────────────────────────────────── */}
      <Drawer.Root open={withdrawOpen} onOpenChange={(o) => { if (!o) setWithdrawOpen(false); }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-shell-ink/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[420px] rounded-t-3xl bg-shell-base px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
            <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-shell-ink/20" />
            <Drawer.Title className="font-heading text-3xl lowercase text-shell-ink">
              pull this offer back?
            </Drawer.Title>
            <Drawer.Description className="mt-1 font-body text-sm text-shell-ink/70">
              they lose the offer. you can send a new one.
            </Drawer.Description>
            <button
              type="button"
              disabled={busy}
              onClick={() => void confirmWithdraw()}
              className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-full bg-shell-accent font-body font-semibold lowercase text-white transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-50"
            >
              <PendingButtonContent pending={busy} pendingLabel="pulling…" accessibilityLabel="withdrawing offer">
                pull it
              </PendingButtonContent>
            </button>
            <button
              type="button"
              onClick={() => setWithdrawOpen(false)}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-full font-body lowercase text-shell-ink/70 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/30"
            >
              leave it
            </button>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

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
