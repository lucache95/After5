// Thin client boundary for the hub's "preview my profile" row (E3 / D-03). The
// hub page (account/page.tsx) stays a server component and fetches the owner's
// signed photos + identity fields, then passes them down here as props. This
// component owns ONLY the open/close state for SelfViewSheet — no data fetching.
'use client';

import { useState } from 'react';
import { Eye, ArrowRight } from 'lucide-react';
import { SelfViewSheet } from '@/components/SelfViewSheet';
import type { ProfileCardPrompt } from '@/components/ProfileCard';

export interface SelfViewTriggerProps {
  name: string;
  age: number | null;
  place: string | null;
  pronouns?: string | null;
  occupation?: string | null;
  height_cm?: number | null;
  photos: string[];
  vibe_tags: string[];
  prompts: ProfileCardPrompt[];
}

export function SelfViewTrigger(props: SelfViewTriggerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-4 rounded-3xl border-2 border-shell-ink/10 bg-white p-4 text-left transition hover:border-shell-ink/25 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-shell-pink">
          <Eye className="h-5 w-5 text-shell-accent" strokeWidth={2.25} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-heading text-xl lowercase leading-tight text-shell-ink">preview my profile</p>
          <p className="mt-0.5 font-body text-xs text-shell-ink/60">this is you when you come up in someone&apos;s feed.</p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-shell-ink/40" strokeWidth={2.25} aria-hidden />
      </button>

      <SelfViewSheet open={open} onOpenChange={setOpen} {...props} />
    </>
  );
}
