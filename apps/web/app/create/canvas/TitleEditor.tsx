'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { browserAfter5Client } from '@/lib/after5/client';
import { Sheet } from './Sheet';

type Tone = 'romantic' | 'playful' | 'casual';

export function TitleEditor({ itineraryId, current, onApply, onClose }: {
  itineraryId: string;
  current: { title: string; hook: string };
  onApply: (t: { title: string; hook: string }) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(current.title);

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const { data, error } = await browserAfter5Client().functions.invoke<{
        ok: boolean;
        title?: string;
        hook?: string;
        issues?: { message: string }[];
        error?: string;
      }>('generate-plan', { body });
      if (error || !data?.ok || !data.title) {
        toast.error(data?.issues?.[0]?.message ?? data?.error ?? 'that one slipped away. try again?');
        return;
      }
      onApply({ title: data.title, hook: data.hook ?? current.hook });
      toast.success('new title.');
    } finally {
      setBusy(false);
    }
  }

  const btn =
    'min-h-[44px] rounded-pill px-4 font-body text-sm lowercase ring-1 ring-shell-ink/15 bg-white/80 text-shell-ink active:scale-95 disabled:opacity-40';

  return (
    <Sheet onClose={onClose} title="the title">
      <button
        className={btn}
        disabled={busy}
        onClick={() => call({ action: 'regenerate_title', itinerary_id: itineraryId })}
      >
        another take
      </button>
      <div className="mt-3 flex flex-wrap gap-2">
        {(['romantic', 'playful', 'casual'] as Tone[]).map((t) => (
          <button
            key={t}
            className={btn}
            disabled={busy}
            onClick={() => call({ action: 'regenerate_title', itinerary_id: itineraryId, tone: t })}
          >
            more {t}
          </button>
        ))}
      </div>
      <div className="mt-4">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          aria-label="title"
          className="block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-4 py-3 font-body text-[15px] text-shell-ink"
        />
        <button
          className={cn(btn, 'mt-2')}
          disabled={busy || !manual.trim()}
          onClick={() => {
            onApply({ title: manual.trim(), hook: current.hook });
            toast.success('saved.');
          }}
        >
          write my own
        </button>
      </div>
    </Sheet>
  );
}

