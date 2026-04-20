// Generate an .ics calendar file from an itinerary so users can drop the whole
// night into their phone calendar in one tap. We assume "today" if no date is
// supplied — Edge Function doesn't currently capture the date.

import type { Itinerary, Stop } from './itinerary-types';

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

// Build a UTC iCal timestamp like "20260420T013000Z" from a date + "HH:mm" PT.
function toUtcStamp(date: Date, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  // Pacific Time → UTC: PT is UTC-7 (PDT) most of the year; UTC-8 (PST) in winter.
  // Quick & dirty: use the device's interpretation since most users plan for today.
  const local = new Date(date);
  local.setHours(h, m, 0, 0);
  const u = new Date(local.toISOString());
  return (
    u.getUTCFullYear().toString() +
    pad(u.getUTCMonth() + 1) +
    pad(u.getUTCDate()) +
    'T' +
    pad(u.getUTCHours()) +
    pad(u.getUTCMinutes()) +
    '00Z'
  );
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

export function buildIcs(it: Itinerary, date: Date = new Date()): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//After5//Date Plan//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const stop of it.stops) {
    const start = toUtcStamp(date, stop.start_time);
    const endHHMM = addMinutes(stop.start_time, stop.duration_min);
    const end = toUtcStamp(date, endHHMM);
    const uid = `${it.id ?? it.template_id}-${stop.place_id}@after5.app`;
    const desc = [
      stop.what_to_do ?? '',
      stop.local_insight ? `\nLocal tip: ${stop.local_insight}` : '',
      `\nFrom your After5 plan: ${it.title}`,
    ]
      .filter(Boolean)
      .join('');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${toUtcStamp(date, '00:00')}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeIcs(stop.place_name)}`,
      `LOCATION:${escapeIcs((stop.address ?? stop.neighborhood ?? '') + ', Kelowna BC')}`,
      `DESCRIPTION:${escapeIcs(desc)}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + mins;
  const hh = Math.floor((total / 60) % 24);
  const mm = total % 60;
  return `${pad(hh)}:${pad(mm)}`;
}

export function downloadIcs(it: Itinerary): void {
  const ics = buildIcs(it);
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeTitle = it.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
  a.download = `after5-${safeTitle}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
