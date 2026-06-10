// apps/web/app/reciprocal/[pairId]/ReciprocalChooser.tsx
// Host picks which of two competing nights to keep (spec §4.5). Side-by-side
// Polaroid covers + title + time. Pick → match.resolveReciprocal(pairId, chosen)
// → redirect to the chosen instance's interested list. reciprocal_stale (P5009)
// → toast + home. Tier-2 experience surface chrome, dating-tone polaroids.
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Link from 'next/link';
import { Polaroid } from '@/components/Polaroid';
import { DeepRouteHeader } from '@/components/DeepRouteHeader';
import { cn } from '@/lib/cn';
import { resolveReciprocal, MatchError, messageForCode } from '@/lib/after5/match';
import { LocalTime } from '@/components/LocalTime';

export interface ReciprocalInstance {
  id: string;
  title: string;
  starts_at: string;
  cover_image_url: string | null;
}

export function ReciprocalChooser({
  pairId,
  instanceA,
  instanceB,
}: {
  pairId: string;
  instanceA: ReciprocalInstance;
  instanceB: ReciprocalInstance;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function pick(instance: ReciprocalInstance) {
    if (busy) return;
    setBusy(instance.id);
    try {
      await resolveReciprocal(pairId, instance.id);
      toast.success(`locked in ${instance.title.toLowerCase()}.`);
      router.push(`/dates/${instance.id}/interested`);
    } catch (e) {
      if (e instanceof MatchError && e.code === 'reciprocal_stale') {
        toast.error(messageForCode('reciprocal_stale'));
        router.push('/home');
        return;
      }
      toast.error(e instanceof MatchError ? messageForCode(e.code) : "that didn't go through. try again?");
      setBusy(null);
    }
  }

  return (
    <>
      <DeepRouteHeader backHref="/home" backLabel="back to home" title="keep one night" />
      <main className="flex min-h-[calc(100dvh-56px)] flex-col bg-shell-base px-5 pb-16 pt-8">
        <div className="mx-auto w-full max-w-[420px]">
          <h1 className="font-heading text-4xl lowercase leading-[1.05] text-shell-ink">you can only keep one</h1>
          <p className="mt-3 font-body text-base text-shell-ink/70">
            two of your nights matched the same person. pick the one to keep — the other lets them go.
          </p>

          <div className="mt-8 space-y-5">
            {[instanceA, instanceB].map((inst) => (
              <div key={inst.id} className="rounded-3xl border-2 border-shell-ink/10 bg-white p-4 shadow-warm">
                <div className="flex items-center gap-4">
                  <Polaroid src={inst.cover_image_url ?? '/places/place-walk.jpg'} alt={inst.title} size="md" tone="dating" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-heading text-2xl lowercase leading-tight text-shell-ink">{inst.title.toLowerCase()}</p>
                    <LocalTime
                      iso={inst.starts_at}
                      opts={{ weekday: 'short', hour: 'numeric', minute: '2-digit' }}
                      className="font-body text-sm text-shell-ink/65"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  aria-label={`keep ${inst.title}`}
                  onClick={() => void pick(inst)}
                  className={cn(
                    'mt-4 flex min-h-[48px] w-full items-center justify-center rounded-full bg-shell-accent font-body font-semibold lowercase text-white transition',
                    'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-50',
                  )}
                >
                  keep this one
                </button>
              </div>
            ))}
          </div>

          <div className="mt-6 text-center">
            <Link
              href="/home"
              className="font-body text-sm lowercase text-shell-ink/50 underline underline-offset-2 hover:text-shell-ink/70"
            >
              decide later
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
