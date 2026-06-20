// apps/web/app/my-nights/DraftDeleteButton.tsx
// Client leaf: delete a single quiet draft from the /my-nights drafts list
// (DRFT-01). A draft is an itinerary that was never posted, so deleting it is a
// plain owner-scoped delete — but it's irreversible, so it goes through a vaul
// confirm like the cancel-night flow. Calls the DEFINER RPC delete_draft_itinerary
// (re-checks user_id = auth.uid() and refuses a posted itinerary server-side).
// Tokens only (DESIGN-SYSTEM §1): shell.*, font-heading/body, ≥44px targets,
// focus-visible:ring-shell-accent/40, motion-reduce:*.
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from 'vaul';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { browserAfter5Client, deleteDraftItinerary } from '@/lib/after5/client';
import { PendingButtonContent } from '@/components/PendingButtonContent';

// Map the RPC's PG errcode to dry, specific copy (matches NightCardActions).
function errorCopy(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  switch (e?.code) {
    case '42501':
      return "that's not your draft.";
    case 'P0002':
      return "that draft's already gone.";
    case 'P0001':
      // posted-night guard — the message is specific ("take the night down first").
      return e?.message ? e.message.toLowerCase() : "couldn't delete that one.";
    default:
      return "that didn't go through. try again?";
  }
}

export function DraftDeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await deleteDraftItinerary(browserAfter5Client(), { itinerary_id: id });
      toast.success('draft deleted.');
      setOpen(false);
      router.refresh();
    } catch (err) {
      console.error('[DraftDeleteButton] delete failed', err);
      toast.error(errorCopy(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={`delete draft: ${title}`}
        onClick={() => setOpen(true)}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-shell-ink/10 bg-shell-base text-shell-ink/40 transition hover:border-shell-accent/40 hover:text-shell-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>

      <Drawer.Root open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-shell-ink/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[420px] rounded-t-3xl bg-shell-base px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
            <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-shell-ink/20" />
            <Drawer.Title className="font-heading text-3xl lowercase text-shell-ink">
              delete this draft?
            </Drawer.Title>
            <Drawer.Description className="mt-1 font-body text-sm text-shell-ink/70">
              you never posted this one. deleting it can&apos;t be undone.
            </Drawer.Description>

            <button
              type="button"
              disabled={busy}
              onClick={() => void doDelete()}
              className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-full bg-shell-accent font-body font-semibold lowercase text-white transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-50"
            >
              <PendingButtonContent pending={busy} pendingLabel="deleting…" accessibilityLabel="deleting draft">
                delete it
              </PendingButtonContent>
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-full font-body lowercase text-shell-ink/70 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/30"
            >
              keep it
            </button>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
