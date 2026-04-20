import { Sparkles } from 'lucide-react';
import type { Modifier } from '@/lib/itinerary-types';

// Wow-Factor card — the quirky modifier applied to a date. Surfaced near the
// top of the detail page so it sets the tone before the timeline.

const DIFFICULTY_LABEL: Record<Modifier['difficulty'], string> = {
  tame: 'Easy mode',
  spicy: 'Spicy',
  chaos: 'Full chaos',
};

const DIFFICULTY_TONE: Record<Modifier['difficulty'], string> = {
  tame: 'border-border bg-surface',
  spicy: 'border-accent/30 bg-accent-soft/60',
  chaos: 'border-accent bg-accent text-white',
};

export function ModifierCard({ modifier }: { modifier: Modifier }) {
  const isChaos = modifier.difficulty === 'chaos';
  return (
    <div
      className={`flex gap-4 rounded-card border p-5 md:p-6 ${DIFFICULTY_TONE[modifier.difficulty]}`}
    >
      <div className="shrink-0">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-full ${isChaos ? 'bg-white/20' : 'bg-accent'}`}
        >
          <Sparkles className="h-4 w-4 text-white" strokeWidth={2} />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p
            className={`text-xs font-medium uppercase tracking-[0.18em] ${isChaos ? 'text-white/85' : 'text-accent'}`}
          >
            Wow-Factor
          </p>
          <span
            className={`text-[11px] uppercase tracking-[0.15em] ${isChaos ? 'text-white/70' : 'text-muted'}`}
          >
            {DIFFICULTY_LABEL[modifier.difficulty]}
          </span>
        </div>
        <h3
          className={`mt-2 font-display text-xl font-semibold leading-tight md:text-2xl ${isChaos ? 'text-white' : 'text-text'}`}
        >
          {modifier.label}
        </h3>
        <p
          className={`mt-2 text-base leading-relaxed md:text-lg ${isChaos ? 'text-white/95' : 'text-secondary'}`}
        >
          {modifier.body}
        </p>
      </div>
    </div>
  );
}
