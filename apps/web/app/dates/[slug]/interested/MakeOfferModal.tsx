// apps/web/app/dates/[instanceId]/interested/MakeOfferModal.tsx
// vaul bottom sheet for sending an offer to the rank-1 candidate. Shows the
// Tier-3 preview + expiry preview (offer_window_hours read server-side, passed
// in). Confirm → match.makeOffer (idem_key minted in the wrapper). makeOffer
// returns discriminated jsonb (commit ab4d087): a 'reciprocal' result is a
// NORMAL success — we route to /reciprocal/[pair_id]; an 'offer' result fires
// the optimistic offer-active callback. Genuine failures throw MatchError and
// map through messageForCode (DESIGN-SYSTEM §4 / spec §4.3).
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from 'vaul';
import { toast } from 'sonner';
import { Polaroid } from '@/components/Polaroid';
import { makeOffer, MatchError, messageForCode } from '@/lib/after5/match';

export interface OfferCandidate {
  candidate_id: string;
  first_name: string;
  age: number | null;
  city: string | null;
  photo_url: string | null;
}

function deadlineCopy(hours: number): string {
  const at = new Date(Date.now() + hours * 3600_000);
  return at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export function MakeOfferModal({
  open,
  instanceId,
  candidate,
  offerWindowHours,
  onOffered,
  onClose,
}: {
  open: boolean;
  instanceId: string;
  candidate: OfferCandidate;
  offerWindowHours: number;
  onOffered: (candidateId: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await makeOffer(instanceId, candidate.candidate_id);
      // Reciprocal is a NORMAL success response, not an error: route to the chooser.
      if (result.kind === 'reciprocal') {
        router.push(`/reciprocal/${result.pair_id}`);
        return;
      }
      // result.kind === 'offer' → optimistic offer-active.
      toast.success(`offer's out to ${candidate.first_name.toLowerCase()}.`);
      onOffered(candidate.candidate_id);
      onClose();
    } catch (e) {
      // Genuine failures (account_gated / offer_already_active / time_conflict /
      // feature_disabled / …) arrive as MatchError keyed on the string `code`.
      toast.error(e instanceof MatchError ? messageForCode(e.code) : "that didn't send. try again?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-shell-ink/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[420px] rounded-t-3xl bg-shell-base px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
          <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-shell-ink/20" />
          <Drawer.Title className="font-heading text-3xl lowercase text-shell-ink">
            send it to {candidate.first_name.toLowerCase()}?
          </Drawer.Title>
          <Drawer.Description className="mt-1 font-body text-sm text-shell-ink/70">
            they&apos;ll have {offerWindowHours} hours to accept — until {deadlineCopy(offerWindowHours)}.
          </Drawer.Description>

          <div className="mt-5 flex items-center gap-4">
            <Polaroid
              src={candidate.photo_url ?? '/places/place-walk.jpg'}
              alt={`${candidate.first_name}`}
              size="sm"
              tone="dating"
            />
            <div>
              <p className="font-body text-lg font-semibold lowercase text-shell-ink">
                {candidate.first_name.toLowerCase()}{candidate.age ? `, ${candidate.age}` : ''}
              </p>
              {candidate.city && (
                <p className="font-body text-sm text-shell-ink/65">{candidate.city.toLowerCase()}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void confirm()}
            className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-full bg-shell-accent font-body font-semibold lowercase text-white transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-50"
          >
            send the offer
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-full font-body lowercase text-shell-ink/70 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/30"
          >
            not yet
          </button>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
