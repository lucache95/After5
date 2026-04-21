'use client';

// Standardized hint render with a "What does this mean?" expander when an
// explainer is available. Used on the /plan flow inputs and (eventually)
// any other place we surface heuristic guidance.

import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { Hint } from '@/lib/plan-hints';

export function HintCard({ hint }: { hint: Hint }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        'rounded-card border px-5 py-4 text-sm leading-relaxed',
        hint.tone === 'warn'
          ? 'border-accent/40 bg-accent-soft/50 text-text'
          : 'border-border bg-surface text-secondary',
      )}
    >
      <div className="flex gap-3">
        <span aria-hidden className={hint.tone === 'warn' ? 'text-accent' : 'text-muted'}>
          {hint.tone === 'warn' ? '!' : 'i'}
        </span>
        <p className="flex-1">{hint.text}</p>
      </div>
      {hint.explainer && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 ml-6 text-xs text-muted underline decoration-border decoration-1 underline-offset-[5px] transition-colors hover:text-text hover:decoration-text"
          >
            {open ? 'Hide explanation' : 'I don\u2019t understand'}
          </button>
          {open && (
            <p className="mt-3 ml-6 text-sm leading-relaxed text-secondary">
              {hint.explainer}
            </p>
          )}
        </>
      )}
    </div>
  );
}
