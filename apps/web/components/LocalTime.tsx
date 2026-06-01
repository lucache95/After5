// apps/web/components/LocalTime.tsx
// Client component that renders a datetime in the VIEWER'S local timezone.
//
// SSR-safe local time, done right. A Server Component renders this in the server
// TZ (UTC). Two earlier approaches failed: (1) raw toLocaleString → React #418
// hydration error; (2) suppressHydrationWarning on an always-rendered value →
// silences the warning but React keeps the server (UTC) text and never swaps to
// local, even after a state-triggered re-render.
//
// Correct pattern: GATE THE OUTPUT on a mounted flag. Pre-mount (SSR + the
// hydration render) we render an empty span — server and client agree, so there
// is no hydration mismatch. After mount, `mounted` flips and the render output
// genuinely changes (empty → formatted), so React reconciles and writes the
// client-computed LOCAL value into the DOM. No #418, and the value is local.
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
   */
  format?: (d: Date) => string;
  /** Rendered when iso is null or cannot be parsed. Defaults to "date tbd". */
  fallback?: string;
  /** Optional className forwarded to the wrapping <span>. */
  className?: string;
}

export function LocalTime({ iso, opts, format, fallback = 'date tbd', className }: LocalTimeProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!iso) return <span className={className}>{fallback}</span>;

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return <span className={className}>{fallback}</span>;

  // Pre-mount: empty (matches between server and hydration → no #418).
  // Post-mount: the client-computed local value.
  return (
    <span className={className} suppressHydrationWarning>
      {mounted ? (format ? format(d) : d.toLocaleString(undefined, opts)) : ''}
    </span>
  );
}
