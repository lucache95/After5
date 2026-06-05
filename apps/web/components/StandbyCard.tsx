// apps/web/components/StandbyCard.tsx
// Client leaf (E24 / REQ-E24): the candidate's standby/waitlist card for ONE of
// their plain `interested` queue rows. Mounted by /inbox StandbyList. Shows the
// queue position + a soft no-promise sub-line, and a neutral `pull my interest`
// control behind a vaul confirm that calls the withdraw_interest DEFINER RPC.
//
// Tier-1 SHELL surface (warm-cream / shell.* tokens) — this is app chrome, NOT a
// per-vibe experience surface (UI-SPEC §E24 / DESIGN-SYSTEM §1). The position
// line makes NO auto-promotion promise (promotion logic is deferred); the
// sub-line keeps it soft. The withdraw is low-stakes: a NEUTRAL secondary button
// (border-shell-ink/20, text-shell-ink/70) — never an accent fill, never red.
//
// The UI gate is convenience only: withdraw_interest re-checks p_actor =
// auth.uid() server-side and deletes ONLY the actor's own interested row.
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from 'vaul';
import { toast } from 'sonner';
import { browserAfter5Client, withdrawInterest } from '@/lib/after5/client';
import { cn } from '@/lib/cn';

/** One of the candidate's own pending-interest queue rows, plus a display label. */
export interface StandbyEntry {
  /** date_instances.id — the night this interest is on. */
  instance_id: string;
  /** creator-assigned rank; null until shortlisted. */
  rank: number | null;
  /** queue lifecycle status (always 'interested' on the standby surface). */
  status: string;
  /** human, lowercase night label (e.g. "thursday's pottery night"). */
  night_label: string;
}

// Map a withdraw RPC error to dry, specific candidate copy. The RPC raises with a
// PG errcode (.code) + short message (.message); fall back to a generic line. No
// filler, no adverbs (stop-slop).
function errorCopy(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  switch (e?.code) {
    case 'P0002':
      return "that night's gone.";
    case 'P0001':
      // already off the list, or nothing to pull — the RPC message is specific.
      return "you're already off this one.";
    default:
      return "that didn't go through. try again?";
  }
}

function positionLine(rank: number | null): string {
  if (rank === 1) return "you're next in line";
  if (rank != null && rank > 1) return `you're #${rank} in line`;
  // no rank yet (not shortlisted) — still soft, no promise.
  return "you're in line";
}

export function StandbyCard({ entry }: { entry: StandbyEntry }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doWithdraw() {
    if (busy) return;
    setBusy(true);
    try {
      await withdrawInterest(browserAfter5Client(), { instance_id: entry.instance_id });
      toast.success("pulled. you're off this one.");
      setConfirmOpen(false);
      router.refresh();
    } catch (err) {
      console.error('[StandbyCard] withdraw failed', err);
      toast.error(errorCopy(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-3xl bg-shell-ink/5 p-5 shadow-warm">
      <p className="font-body text-[13px] font-semibold lowercase tracking-[0.16em] text-shell-ink/50">
        {entry.night_label}
      </p>
      <p className="mt-1 font-heading text-xl lowercase leading-tight text-shell-ink">
        {positionLine(entry.rank)}
      </p>
      <p className="mt-1 font-body text-[15px] leading-relaxed text-shell-ink/70">
        if the spot opens up, you&apos;re up.
      </p>

      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-full border-2 border-shell-ink/20 px-6 py-3 font-body font-semibold lowercase text-shell-ink/70 transition hover:border-shell-ink/30 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none"
      >
        pull my interest
      </button>

      <Drawer.Root open={confirmOpen} onOpenChange={(o) => { if (!o) setConfirmOpen(false); }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[420px] rounded-t-3xl bg-shell-base px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3 outline-none">
            <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-shell-ink/20" />
            <Drawer.Title className="font-heading text-3xl lowercase text-shell-ink">
              pull your interest?
            </Drawer.Title>
            <Drawer.Description className="mt-1 font-body text-sm text-shell-ink/70">
              you&apos;ll drop off this night&apos;s list. you can always slide back in later.
            </Drawer.Description>

            <button
              type="button"
              disabled={busy}
              onClick={() => void doWithdraw()}
              className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-full border-2 border-shell-ink/20 font-body font-semibold lowercase text-shell-ink/70 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-50"
            >
              {busy ? 'pulling…' : 'yep, pull it'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-full font-body lowercase text-shell-ink/70 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/30"
            >
              never mind
            </button>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </article>
  );
}
