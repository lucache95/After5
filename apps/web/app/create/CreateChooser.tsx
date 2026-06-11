'use client';
// #85 / Phase 10 — the create entry screen. The bottom-nav "+" now lands directly on
// the generate funnel (/create/generate); this chooser stays reachable for hosts who
// navigate to /create. Generation is the primary path: "build it for me" is the one
// dominant pink action → the existing generate funnel. The manual-from-scratch path is
// DEMOTED to a quiet secondary "or build from scratch" link (not a co-equal door) that
// still works end-to-end — createBlankItinerary → open the §2A canvas (/plans/[id]/edit).
// Anon never reaches this screen — the /create page renders the generate funnel directly.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { createBlankItinerary } from '@after5/api-client';
import { browserAfter5Client } from '@/lib/after5/client';
import { PendingButtonContent } from '@/components/PendingButtonContent';
import { HeartLoader } from '@/components/HeartLoader';

export function CreateChooser() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [openingGenerate, setOpeningGenerate] = useState(false);

  async function startFromScratch() {
    if (starting) return;
    setStarting(true);
    const t = toast.loading('clearing a blank canvas…');
    try {
      const id = await createBlankItinerary(browserAfter5Client());
      toast.dismiss(t);
      router.push(`/plans/${id}/edit`);
    } catch {
      toast.error('couldn’t start a blank one. try again?', { id: t });
      setStarting(false);
    }
  }

  return (
    <main className="min-h-screen bg-shell-base">
      <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col px-5 py-6 font-body text-shell-ink">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="back"
          className="-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-shell-ink/70 transition hover:bg-shell-ink/5 active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>

        <h1 className="mt-6 font-heading text-4xl lowercase leading-[1.05] text-shell-ink">
          make a night
        </h1>
        <p className="mt-3 font-body text-base lowercase text-shell-ink/70">
          pick a vibe, we’ll plan the whole night.
        </p>

        <div className="mt-8 flex flex-col items-start gap-5">
          {/* Primary — generate. The one dominant pink action. */}
          <button
            type="button"
            onClick={() => {
              setOpeningGenerate(true);
              router.push('/create/generate');
            }}
            disabled={openingGenerate}
            className="group flex w-full items-start gap-4 rounded-3xl bg-shell-accent px-5 py-5 text-left shadow-fun transition hover:opacity-95 active:scale-[0.99]"
          >
            <span className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/20">
              {openingGenerate ? (
                <HeartLoader size={20} color="white" accessibilityLabel="opening generator" />
              ) : (
                <Sparkles className="h-5 w-5 text-white" aria-hidden />
              )}
            </span>
            <span className="min-w-0">
              <span className="block font-heading text-xl lowercase text-white">
                {openingGenerate ? 'opening…' : 'build it for me'}
              </span>
              <span className="mt-1 block font-body text-sm lowercase text-white/85">
                a full night, planned for you in a tap.
              </span>
            </span>
          </button>

          {/* Demoted manual path — a quiet secondary link, not a co-equal door.
              Still works: createBlankItinerary → /plans/[id]/edit. ≥44px tap via py-3. */}
          <button
            type="button"
            onClick={startFromScratch}
            disabled={starting}
            aria-busy={starting}
            className="inline-flex min-h-[44px] items-center px-1 py-3 font-body text-sm lowercase text-shell-ink/60 underline decoration-shell-ink/20 underline-offset-4 transition hover:text-shell-ink hover:decoration-shell-accent disabled:opacity-60"
          >
            <PendingButtonContent pending={starting} pendingLabel="opening a blank canvas…" accessibilityLabel="opening blank canvas" size={14}>
              or build from scratch
            </PendingButtonContent>
          </button>
        </div>
      </div>
    </main>
  );
}
