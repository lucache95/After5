// Time formatting helpers.
// Plans live in Kelowna time (Pacific). Stop times come back as "HH:mm" 24-hour
// strings from the Edge Function — we render them as 12-hour with a single
// timezone label at the top of the timeline rather than repeating PT per row.

export function to12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, '0');
  return `${h12}:${mm} ${period}`;
}

export const TIMEZONE_LABEL = 'Pacific Time';
