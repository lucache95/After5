// Server-safe pure helpers for sub-project F. NO 'use client' — these are imported
// by the server pages (matches/page.tsx, [lockId]/page.tsx, rate/page.tsx) and by
// client components; a 'use client' module's functions can't be called from a
// server component (bug class 5, the E deriveGateReason lesson).
import type { Database } from '@after5/types';

type LockStatus = Database['public']['Enums']['lock_status'];

export interface PartyProfile {
  id: string;
  first_name: string | null;
  age: number | null;
  city: string | null;
  neighborhood: string | null;
  clear_photo_url: string | null;
  vibe_tags: string[];
  // M6 reveal additions. prompt_answers is the raw jsonb; pronouns is plain text.
  prompt_answers?: { prompt_id: string; answer: string }[];
  pronouns?: string | null;
  // E17 reliability badge inputs for the revealed ProfileCard pill.
  verification?: Database['public']['Enums']['verification_state'];
  reliability_score?: number | null;
}

// A prompt answer joined to its (active) prompt label, ready for the ProfileCard.
export interface RevealPrompt {
  label: string;
  answer: string;
}

export interface LockRowWithParties {
  id: string;
  status: LockStatus;
  locked_at: string;
  rating_closed_at: string | null;
  cancel_reason: string | null;
  creator_id: string;
  matched_user_id: string;
  date_instance_id: string;
  creator: PartyProfile | null;
  matched: PartyProfile | null;
  // E13: itinerary_id lets [lockId]/page.tsx do the second RLS read of the
  // forked itinerary's stops (itineraries_readable_by_id USING(true)).
  // The list page instead embeds the itinerary TITLE inline (same FK, one query,
  // itineraries select is USING(true)) so the card can sell the night.
  instance: {
    id: string;
    starts_at: string;
    time_range: string | null;
    itinerary_id?: string | null;
    itinerary?: { title: string | null } | null;
  } | null;
}

const RATING_GRACE_MIN = 120;
const DEFAULT_DURATION_MIN = 150;

export function pickCounterpart(
  lock: Pick<LockRowWithParties, 'creator_id' | 'matched_user_id' | 'creator' | 'matched'>,
  viewerId: string,
): PartyProfile | null {
  return lock.creator_id === viewerId ? lock.matched : lock.creator;
}

/**
 * Buckets locks for the dates tab: `upcoming` = a live (active) lock whose
 * night hasn't started yet (or has no start at all — "date tbd" still counts
 * as a plan); everything else — past-dated, completed, cancelled, no-show —
 * is history. Time-based, not status-based, so an active lock whose night
 * already happened reads as past instead of forever "upcoming".
 */
export function bucketLocksByStart<
  T extends { status: LockStatus; instance: { starts_at: string } | null },
>(rows: T[], now: Date = new Date()): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const r of rows) {
    const starts = r.instance?.starts_at ? new Date(r.instance.starts_at) : null;
    const startsKnown = starts != null && !Number.isNaN(starts.getTime());
    const inFuture = startsKnown && starts.getTime() > now.getTime();
    if (r.status === 'active' && (inFuture || !startsKnown)) upcoming.push(r);
    else past.push(r);
  }
  return { upcoming, past };
}

// Parse the upper bound of a Postgres tstzrange literal: ["lower","upper") or [lower,upper).
function upperOfRange(range: string): Date | null {
  const m = range.match(/[,]\s*"?([^",)\]]+)"?\s*[\)\]]\s*$/);
  if (!m) return null;
  const d = new Date(m[1].replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function ratingOpensAt(instance: { starts_at: string; time_range: string | null } | null): Date | null {
  if (!instance) return null;
  let end: Date | null = instance.time_range ? upperOfRange(instance.time_range) : null;
  if (!end) {
    const start = new Date(instance.starts_at);
    if (Number.isNaN(start.getTime())) return null;
    end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60_000);
  }
  return new Date(end.getTime() + RATING_GRACE_MIN * 60_000);
}

export function isRatingOpen(
  instance: { starts_at: string; time_range: string | null } | null,
  now: Date = new Date(),
): boolean {
  const opens = ratingOpensAt(instance);
  return opens != null && now.getTime() >= opens.getTime();
}

/**
 * The dates-tab card chip. An upcoming bucket always reads "upcoming"; a past
 * card reads by how it ended. An active-but-past-dated lock reads "done" —
 * the night happened, the completion job just hasn't swept it yet.
 */
export function matchChipLabel(status: LockStatus, upcoming: boolean): string {
  if (upcoming) return 'upcoming';
  switch (status) {
    case 'cancelled': return 'cancelled';
    case 'no_show': return 'no-show';
    default: return 'done';
  }
}
