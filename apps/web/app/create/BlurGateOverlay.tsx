'use client';

import { Lock } from 'lucide-react';

// Barbiecore lock overlay shown over silhouetted/locked sections for anon users.
// The premium copy is already stripped server-side (blur-gate.ts), so nothing
// behind this veil is real — it's a shape with a backdrop-blur over it. This
// component only invites the unlock; it never reveals what's underneath.
export function BlurGateOverlay({
  onUnlock,
  label = 'see the full plan',
}: {
  onUnlock: () => void;
  label?: string;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center">
      {/* warm veil over the silhouette */}
      <div aria-hidden className="absolute inset-0 rounded-3xl bg-shell-base/60 backdrop-blur-md" />
      <div className="relative z-10 mx-auto flex max-w-xs flex-col items-center gap-3 rounded-3xl border border-shell-ink/10 bg-shell-base/90 px-6 py-7 text-center shadow-fun">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-shell-pink">
          <Lock className="h-5 w-5 text-shell-accent" strokeWidth={2.5} aria-hidden />
        </span>
        <p className="font-heading text-xl lowercase leading-tight text-shell-ink">
          the rest is locked
        </p>
        <p className="font-body text-sm lowercase text-shell-ink/70">
          the venues, the why, the route — email yourself the whole night.
        </p>
        <button
          type="button"
          onClick={onUnlock}
          className="mt-1 rounded-pill bg-shell-accent px-6 py-3 font-body text-sm font-semibold lowercase text-white shadow-fun transition-opacity hover:opacity-90"
        >
          {label}
        </button>
      </div>
    </div>
  );
}
