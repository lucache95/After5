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
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col items-center justify-center bg-shell-base px-8 text-center">
      <p className="mb-3 font-body text-sm font-semibold uppercase tracking-wide text-shell-ink/45">
        hiccup
      </p>
      <h1 className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">
        give that another tap
      </h1>
      <p className="mt-4 max-w-prose font-body text-lg text-shell-ink/70">
        something blinked out for a second. most things sort themselves on a retry. if it sticks,
        email hello@tryafter5.app and i&apos;ll fix it.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 rounded-full bg-shell-accent px-7 py-3.5 font-body font-semibold lowercase text-white transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
      >
        try again
      </button>
      <a
        href="/home"
        className="mt-4 font-body text-sm text-shell-ink/60 underline decoration-shell-ink/20 underline-offset-4 transition-colors hover:text-shell-ink"
      >
        back to home
      </a>
    </main>
  );
}
