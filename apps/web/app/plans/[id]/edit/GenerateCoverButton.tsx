'use client';
// "generate a cover" — calls /api/generate-cover (owner-gated proxy to the
// generate-cover edge fn) and hands the new public URL back to the parent.
// Two looks: a full-width affordance for the empty cover state, and a small
// pill for regenerating once a cover exists.
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { PendingButtonContent } from '@/components/PendingButtonContent';

export function GenerateCoverButton({
  itineraryId,
  variant,
  onGenerated,
}: {
  itineraryId: string;
  variant: 'empty' | 'regenerate';
  onGenerated: (url: string) => void;
}) {
  const [pending, setPending] = useState(false);

  async function generate() {
    if (pending) return;
    setPending(true);
    try {
      const resp = await fetch('/api/generate-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itinerary_id: itineraryId }),
      });
      const data = await resp.json().catch(() => null) as
        | { cover_image_url?: string; error?: string }
        | null;
      if (!resp.ok || !data?.cover_image_url) {
        toast.error(data?.error ?? "couldn't generate a cover. try again?");
        return;
      }
      onGenerated(data.cover_image_url);
      toast.success('cover generated.');
    } catch {
      toast.error("couldn't reach the cover generator. try again?");
    } finally {
      setPending(false);
    }
  }

  const label = variant === 'empty' ? 'generate a cover' : 'regenerate with ai';

  return (
    <button
      type="button"
      onClick={generate}
      disabled={pending}
      aria-busy={pending}
      className={cn(
        'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border font-body text-sm lowercase transition',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-60',
        variant === 'empty'
          ? 'w-full border-shell-accent/40 bg-white/70 px-5 text-shell-ink hover:border-shell-accent'
          : 'border-shell-ink/15 bg-white/70 px-4 text-shell-ink hover:border-shell-accent/50',
      )}
    >
      <PendingButtonContent pending={pending} pendingLabel="dreaming one up..." accessibilityLabel="generating cover">
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-shell-accent" aria-hidden />
          {label}
        </span>
      </PendingButtonContent>
    </button>
  );
}
