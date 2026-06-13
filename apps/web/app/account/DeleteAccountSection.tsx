// apps/web/app/account/DeleteAccountSection.tsx
// ACCT-01 client boundary for the /account hub. Two states driven by the server-
// passed account_state:
//   - 'active' (or anything not pending): a quiet "delete my account" row that opens
//     a vaul confirm drawer. Confirm → request_account_deletion RPC → pending state.
//   - 'deletion_pending': a banner explaining the 7-day window with a "cancel
//     deletion" button → cancel_account_deletion RPC → back to active.
// Copy is lowercase Barbiecore, stop-slop (no filler/adverbs/em-dashes, specific).
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from 'vaul';
import { Trash2, Clock } from 'lucide-react';
import { browserAfter5Client } from '@/lib/after5/client';
import { PendingButtonContent } from '@/components/PendingButtonContent';

export function DeleteAccountSection({ accountState }: { accountState: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'working' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function requestDeletion() {
    if (phase === 'working') return;
    setPhase('working');
    setErrorMsg('');
    const { error } = await browserAfter5Client().rpc('request_account_deletion');
    if (error) {
      setErrorMsg('that didn’t go through. try again?');
      setPhase('error');
      return;
    }
    setOpen(false);
    setPhase('idle');
    router.refresh();
  }

  async function cancelDeletion() {
    if (phase === 'working') return;
    setPhase('working');
    setErrorMsg('');
    const { error } = await browserAfter5Client().rpc('cancel_account_deletion');
    if (error) {
      setErrorMsg('that didn’t go through. try again?');
      setPhase('error');
      return;
    }
    setPhase('idle');
    router.refresh();
  }

  // Pending state: a banner with the 7-day window + a way back.
  if (accountState === 'deletion_pending') {
    return (
      <div role="alert" className="mt-6 rounded-3xl border-2 border-shell-accent/40 bg-shell-pink/40 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-white">
            <Clock className="h-4.5 w-4.5 text-shell-accent" strokeWidth={2.25} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-xl lowercase text-shell-ink">deletion scheduled</p>
            <p className="mt-1 font-body text-sm text-shell-ink/70">
              we wipe your profile in 7 days. your matches and chats are already cleared.
              change your mind before then and you keep your account.
            </p>
            <button
              type="button"
              onClick={() => void cancelDeletion()}
              disabled={phase === 'working'}
              className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-full bg-shell-accent px-5 font-body text-sm font-semibold lowercase text-white transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-50"
            >
              <PendingButtonContent pending={phase === 'working'} pendingLabel="bringing it back…" accessibilityLabel="cancelling deletion" size={14}>
                cancel deletion
              </PendingButtonContent>
            </button>
            {phase === 'error' && errorMsg && (
              <p className="mt-2 font-body text-[13px] text-shell-accent">{errorMsg}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Active state: the quiet delete row + confirm drawer.
  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 font-body text-sm lowercase text-shell-ink/55 underline decoration-shell-ink/20 underline-offset-4 transition hover:text-shell-accent hover:decoration-shell-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 rounded-full"
      >
        <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
        delete my account
      </button>

      <Drawer.Root open={open} onOpenChange={(o) => { if (!o && phase !== 'working') setOpen(false); }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-shell-ink/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[420px] rounded-t-3xl bg-shell-base px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
            <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-shell-ink/20" />
            <Drawer.Title className="font-heading text-3xl lowercase text-shell-ink">
              delete your account?
            </Drawer.Title>
            <Drawer.Description className="mt-2 font-body text-sm leading-relaxed text-shell-ink/70">
              we cancel your matches and chats now, then wipe your profile in 7 days.
              cancel any time in those 7 days and you keep everything. after that it&apos;s gone.
            </Drawer.Description>

            <button
              type="button"
              disabled={phase === 'working'}
              onClick={() => void requestDeletion()}
              className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-full bg-shell-accent font-body font-semibold lowercase text-white transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-50"
            >
              <PendingButtonContent pending={phase === 'working'} pendingLabel="scheduling…" accessibilityLabel="requesting deletion">
                delete my account
              </PendingButtonContent>
            </button>
            <button
              type="button"
              disabled={phase === 'working'}
              onClick={() => setOpen(false)}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-full font-body lowercase text-shell-ink/70 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/30 disabled:opacity-50"
            >
              keep my account
            </button>
            {phase === 'error' && errorMsg && (
              <p className="mt-3 text-center font-body text-[13px] text-shell-accent" role="alert">{errorMsg}</p>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
