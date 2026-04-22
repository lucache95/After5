'use client';

import { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Phase 6 wires Sentry here.
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.error('After5 error boundary:', error);
    }
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-content flex-col justify-center px-6 py-32 md:px-10">
      <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
        Something didn't land
      </p>
      <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
        We hit a snag.
      </h1>
      <p className="mt-6 max-w-prose text-base text-secondary">
        Not your fault. Try again — most things resolve on a retry. If it persists,
        email lucas@lucassenechal.com and I'll fix it directly.
      </p>
      <div className="mt-12 flex flex-wrap gap-6">
        <button
          type="button"
          onClick={reset}
          className="rounded-pill bg-primary px-7 py-3.5 text-base font-medium text-background transition-opacity hover:opacity-85"
        >
          Try again
        </button>
        <a
          href="/"
          className="text-base text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
        >
          Go home
        </a>
      </div>
    </main>
  );
}
