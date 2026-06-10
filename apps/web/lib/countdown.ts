// Human countdown to a night's start — the standby row's urgency line. A
// night's starts_at is its de-facto expiry (it leaves the feed once starts_at
// passes), so "in 3 days" reads as time-left, not just scheduling.
//
// Buckets are LOCAL CALENDAR DAYS (not 24h windows): a night at 1am counts as
// "tomorrow" even when it's 5 hours away. Render through <LocalTime format>
// so the day math runs in the viewer's timezone, not the server's.
//
// Examples:
//   starts later today      = "tonight"
//   starts next calendar day = "tomorrow"
//   starts 3 days out        = "in 3 days"
//   already started / bad    = "" (caller omits the line)

export function nightCountdown(input: string | Date | null | undefined, now: Date = new Date()): string {
  if (!input) return '';
  const then = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(then.getTime())) return '';
  if (then.getTime() < now.getTime()) return ''; // started/expired — nothing to count down to

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(then) - startOfDay(now)) / 86_400_000);

  if (days <= 0) return 'tonight';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
