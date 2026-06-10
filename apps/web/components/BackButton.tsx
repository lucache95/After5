'use client';
// History-aware back button for light-background headers (e.g. /dates/[slug]).
// Mirrors the PlaceBackButton behavioural pattern (history pop → fallback href)
// but uses shell ink tokens so it's visible on the cream shell-base header.

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';

export function BackButton({
  fallbackHref,
  className,
}: {
  fallbackHref: string;
  className?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label="go back"
      onClick={() => {
        if (typeof window !== 'undefined' && window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      className={cn(
        'inline-flex min-h-[40px] items-center gap-1.5 rounded-pill border border-shell-ink/15 px-3.5 py-2',
        'font-body text-xs lowercase text-shell-ink/70 transition-colors hover:border-shell-ink/30 hover:text-shell-ink',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/30 motion-reduce:transition-none',
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4" strokeWidth={2.25} aria-hidden />
      back
    </button>
  );
}
