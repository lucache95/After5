// Placeholder. Phase 3 (TECH_PLAN.md) will replace this with the
// 5-step generation flow that calls the generate-plan Edge Function.

import Link from 'next/link';

export default function PlanPage() {
  return (
    <main className="mx-auto max-w-content px-6 py-32 md:px-10 md:py-40">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
        Coming soon
      </p>
      <h1 className="mt-6 font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
        The plan flow lands next.
      </h1>
      <p className="mt-6 max-w-[520px] text-lg text-secondary">
        Five questions, three perfect itineraries. Building it now.
      </p>
      <Link
        href="/"
        className="mt-12 inline-block text-base text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
      >
        ← Back home
      </Link>
    </main>
  );
}
