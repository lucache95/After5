// apps/web/components/LocalTime.tsx
// Client component that renders a datetime in the VIEWER'S local timezone.
//
// Why the mounted-state dance: a Server Component renders this in the server's
// timezone (UTC). `suppressHydrationWarning` alone is NOT enough — it silences
// the #418 warning but React keeps the server (UTC) text and never swaps to the
// client value, because hydration with a suppressed mismatch does not patch the
// node and nothing triggers a re-render. So we force exactly one re-render after
// mount (useEffect → setState); that render reconciles NORMALLY (not hydration)
// and updates the text node to the client-computed LOCAL value. The
// suppressHydrationWarning covers the hydration instant; the re-render delivers
// local time.
'use client';

import { useEffect, useState } from 'react';

interface LocalTimeProps {
  /** ISO datetime string (e.g. "2026-06-04T00:40:00Z"). */
  iso: string | null;
  /** Intl.DateTimeFormat options passed to toLocaleString. */
  opts?: Intl.DateTimeFormatOptions;
  /**
   * Optional custom formatter. When provided, called with the parsed Date and
   * its return value is rendered instead of toLocaleString(undefined, opts).
   * Respects the fallback and the local-time re-render.
   */
  format?: (d: Date) => string;
  /** Rendered when iso is null or cannot be parsed. Defaults to "date tbd". */
  fallback?: string;
  /** Optional className forwarded to the wrapping <span>. */
  className?: string;
}

export function LocalTime({ iso, opts, format, fallback = 'date tbd', className }: LocalTimeProps) {
  // false during SSR + the hydration render (server and client agree → no real
  // mismatch beyond the timestamp text), true after mount → forces the local re-render.
  const [, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!iso) return <span className={className}>{fallback}</span>;

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return <span className={className}>{fallback}</span>;

  return (
    <span suppressHydrationWarning className={className}>
      {format ? format(d) : d.toLocaleString(undefined, opts)}
    </span>
  );
}
