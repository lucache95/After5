// Compact "x ago" formatter — used on date cards and the social-proof toast.
// Caps at "1y+" so we don't show absurd "73 weeks ago" type strings.
//
// Examples:
//   30s   = "just now"
//   90s   = "1 min ago"
//   45m   = "45 min ago"
//   3h    = "3 hr ago"
//   2d    = "2 days ago"
//   3w    = "3 weeks ago"
//   8mo   = "8 months ago"
//   2y    = "1y+ ago"

export function relativeTime(input: string | Date | null | undefined, now: Date = new Date()): string {
  if (!input) return '';
  const then = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(then.getTime())) return '';
  const sec = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));

  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 2) return '1 min ago';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 2) return '1 hr ago';
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.round(hr / 24);
  if (d < 2) return '1 day ago';
  if (d < 7) return `${d} days ago`;
  const w = Math.round(d / 7);
  if (w < 2) return '1 week ago';
  if (w < 5) return `${w} weeks ago`;
  const mo = Math.round(d / 30);
  if (mo < 2) return '1 month ago';
  if (mo < 12) return `${mo} months ago`;
  return '1y+ ago';
}
