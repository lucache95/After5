// apps/web/components/LocalTime.tsx
// Client component that renders a datetime in the viewer's local timezone.
// Server-renders using the server's UTC timezone; on hydration the client
// corrects it to local time. suppressHydrationWarning silences React #418 so
// the server/client text mismatch is intentional and expected.
'use client';

interface LocalTimeProps {
  /** ISO datetime string (e.g. "2026-06-04T00:40:00Z"). */
  iso: string | null;
  /** Intl.DateTimeFormat options passed to toLocaleString. */
  opts?: Intl.DateTimeFormatOptions;
  /** Rendered when iso is null or cannot be parsed. Defaults to "date tbd". */
  fallback?: string;
  /** Optional className forwarded to the wrapping <span>. */
  className?: string;
}

export function LocalTime({ iso, opts, fallback = 'date tbd', className }: LocalTimeProps) {
  if (!iso) return <span className={className}>{fallback}</span>;

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return <span className={className}>{fallback}</span>;

  return (
    <span suppressHydrationWarning className={className}>
      {d.toLocaleString(undefined, opts)}
    </span>
  );
}
