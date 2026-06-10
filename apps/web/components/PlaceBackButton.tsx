'use client';
// Never-trap back affordance for the PUBLIC /places/[slug] page (F1, v2.0 UX-02).
//
// Unlike the authed deep routes (which use DeepRouteHeader's STATIC <Link> because
// each has a login gate and a deterministic parent), this page is public + SEO-
// canonical and reachable three ways: from a matched-night stop (?from=/...), from
// the /places index, or cold from Google/a deep-link. So:
//   - with a sanitized ?from= → a static link back to that exact surface, and
//   - without one → a history-aware pop, falling back to /places (the route's
//     natural parent) when there is no in-app history (a cold SEO entry).
// Rendered at ALL widths (the old chip was sm:-only → invisible on mobile = the trap).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';

const CLS = cn(
  'inline-flex min-h-[40px] items-center gap-1.5 rounded-pill bg-white/15 px-3.5 py-2',
  'font-body text-xs lowercase text-white backdrop-blur-md transition-colors hover:bg-white/25',
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40 motion-reduce:transition-none',
);

export function PlaceBackButton({
  backHref,
  fallbackHref = '/places',
}: {
  backHref: string | null;
  /** Where to push when there's no in-app history. Defaults to /places. */
  fallbackHref?: string;
}) {
  const router = useRouter();

  if (backHref) {
    return (
      <Link href={backHref} aria-label="back to your plan" className={CLS}>
        <ArrowLeft className="h-4 w-4" strokeWidth={2.25} aria-hidden />
        back to your plan
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-label="go back"
      onClick={() => {
        if (typeof window !== 'undefined' && window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      className={CLS}
    >
      <ArrowLeft className="h-4 w-4" strokeWidth={2.25} aria-hidden />
      back
    </button>
  );
}
