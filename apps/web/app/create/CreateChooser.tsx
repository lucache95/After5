'use client';
// #85 — the two-door entry screen. The bottom-nav "+" lands here. One question:
// "want us to build it, or are you driving?" Door 1 (build it for me) → the existing
// generate funnel (/create/generate). Door 2 (start from scratch) → create an empty
// itinerary via create_blank_itinerary, then open the §2A canvas (/plans/[id]/edit)
// on it. Both converge on the same canvas. Anon never reaches this screen — the
// /create page renders the generate funnel directly for them (door 1 only).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Sparkles, PencilLine } from 'lucide-react';
import { toast } from 'sonner';
import { createBlankItinerary } from '@after5/api-client';
import { browserAfter5Client } from '@/lib/after5/client';

export function CreateChooser() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

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
          want us to build it, or are you driving?
        </p>

        <div className="mt-8 flex flex-col gap-4">
          {/* Door 1 — primary, pink */}
          <button
            type="button"
            onClick={() => router.push('/create/generate')}
            className="group flex w-full items-start gap-4 rounded-3xl bg-shell-accent px-5 py-5 text-left shadow-fun transition hover:opacity-95 active:scale-[0.99]"
          >
            <span className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/20">
              <Sparkles className="h-5 w-5 text-white" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block font-heading text-xl lowercase text-white">
                build it for me
              </span>
              <span className="mt-1 block font-body text-sm lowercase text-white/85">
                pick a vibe, we’ll plan the whole night.
              </span>
            </span>
          </button>

          {/* Door 2 — secondary, outline */}
          <button
            type="button"
            onClick={startFromScratch}
            disabled={starting}
            aria-busy={starting}
            className="group flex w-full items-start gap-4 rounded-3xl border border-shell-ink/15 bg-white/70 px-5 py-5 text-left transition hover:border-shell-accent/50 active:scale-[0.99] disabled:opacity-60"
          >
            <span className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-shell-accent/10">
              <PencilLine className="h-5 w-5 text-shell-accent" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block font-heading text-xl lowercase text-shell-ink">
                {starting ? 'opening a blank canvas…' : 'start from scratch'}
              </span>
              <span className="mt-1 block font-body text-sm lowercase text-shell-ink/70">
                you already know the move. just build it.
              </span>
            </span>
          </button>
        </div>
      </div>
    </main>
  );
}
