'use client';
import { WIZARD_STEP_COUNT } from '@/lib/onboarding/steps';

export function ProgressBar({ current }: { current: number }) {
  const pct = Math.round((Math.min(current, WIZARD_STEP_COUNT) / WIZARD_STEP_COUNT) * 100);
  return (
    <div className="w-full" role="progressbar" aria-valuemin={1} aria-valuemax={WIZARD_STEP_COUNT} aria-valuenow={current}>
      <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        <span>Set up your profile</span>
        <span className="[font-variant-numeric:tabular-nums]">Step {Math.min(current, WIZARD_STEP_COUNT)} of {WIZARD_STEP_COUNT}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
