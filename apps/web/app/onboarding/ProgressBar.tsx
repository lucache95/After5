'use client';
// Wizard progress. Track is a soft plum tint; the FILL is hot-pink (an active-state
// accent per DESIGN-SYSTEM §1). Lowercase, dry label.
import { WIZARD_STEP_COUNT } from '@/lib/onboarding/steps';

export function ProgressBar({ current }: { current: number }) {
  const clamped = Math.min(current, WIZARD_STEP_COUNT);
  const pct = Math.round((clamped / WIZARD_STEP_COUNT) * 100);
  return (
    <div className="w-full" role="progressbar" aria-valuemin={1} aria-valuemax={WIZARD_STEP_COUNT} aria-valuenow={current}>
      <div className="mb-2 flex items-center justify-between font-body text-[11px] font-medium lowercase tracking-wide text-shell-ink/55">
        <span>building your profile</span>
        <span className="[font-variant-numeric:tabular-nums]">{clamped} / {WIZARD_STEP_COUNT}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-shell-ink/10">
        <div
          className="h-full rounded-full bg-shell-accent transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
