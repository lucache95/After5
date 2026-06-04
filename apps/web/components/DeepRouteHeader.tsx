// Shared contextual back-chrome for DEEP (non-tab) routes (E1 / D-07-nav).
//
// D-08 / Pitfall 1 — the back target is a STATIC <Link href={backHref}>, never a
// browser-history pop. Every deep route is a cold-entry point (each has a
// `redirect('/login?next=...')` gate, so it's reachable from a notification
// deep-link or a direct URL with an empty history stack). A blind history pop
// would exit the app or land on /login; a static parent route is deterministic.
//
// Pure <Link>, so this stays a SERVER component (no client directive, no
// navigation hooks) and drops straight into the SSR deep-route pages + their
// guard/error branches — mirroring how /account renders its masthead server-side.
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface DeepRouteHeaderProps {
  /** STATIC parent route (D-08) — e.g. '/matches'. Resolved by the page, not by the browser. */
  backHref: string;
  /** Accessible label for the back control, e.g. 'back to matches'. */
  backLabel: string;
  /** Optional visible flow title (e.g. the match counterpart's first name). */
  title?: string;
  /** Optional right-aligned action slot (rare — e.g. a rate CTA). */
  right?: React.ReactNode;
  className?: string;
}

export function DeepRouteHeader({ backHref, backLabel, title, right, className }: DeepRouteHeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-md',
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[420px] items-center gap-3 px-4 py-3">
        <Link
          href={backHref}
          aria-label={backLabel}
          className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-shell-ink/70 transition hover:text-shell-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none"
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={2.25} aria-hidden />
        </Link>
        {title && (
          <h1 className="min-w-0 flex-1 font-heading text-xl lowercase leading-tight text-shell-ink line-clamp-1">
            {title}
          </h1>
        )}
        {right && <div className="ml-auto shrink-0">{right}</div>}
      </div>
    </header>
  );
}
