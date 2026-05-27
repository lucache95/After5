// Pure first-session-home logic: state selection, the single primary action per
// state (anti-dead-end), and itinerary-row → teaser-card mapping. NO I/O.
import type { VerificationState } from '@after5/validators';

export type HomeState = 'verified' | 'pending' | 'failed' | 'dating_off';

export function homeState(p: { verification: VerificationState; dating_enabled: boolean }): HomeState {
  if (p.verification === 'failed' || p.verification === 'appeal') return 'failed';
  if (p.verification === 'pending' || p.verification === 'unverified') return 'pending';
  return p.dating_enabled ? 'verified' : 'dating_off';
}

export type PrimaryAction =
  | { kind: 'explore'; label: string; href: string }
  | { kind: 'enable_dating'; label: string }
  | { kind: 'look_around'; label: string; href: string }
  | { kind: 'retry_verification'; label: string; href: string };

export function primaryActionFor(state: HomeState): PrimaryAction {
  switch (state) {
    case 'verified': return { kind: 'explore', label: 'Explore a Kelowna night', href: '/dates' };
    case 'dating_off': return { kind: 'enable_dating', label: 'Turn dating on' };
    case 'pending': return { kind: 'look_around', label: 'Look around while we verify', href: '/dates' };
    case 'failed': return { kind: 'retry_verification', label: 'Finish verifying', href: '/onboarding/verify' };
  }
}

export interface ItineraryRow {
  id: string;
  slug: string | null;
  title: string | null;
  hook: string | null;
  total_cost_pp: number | null;
  total_duration_min: number | null;
  stops: unknown;
  cover_image_url: string | null;
}
export interface TeaserCard {
  id: string; href: string; title: string; hook: string | null; cover: string | null; costPp: number | null; durationMin: number | null;
}
export function itineraryToTeaser(row: ItineraryRow): TeaserCard {
  return {
    id: row.id,
    href: row.slug ? `/dates/${row.slug}` : '/dates',
    title: row.title ?? 'A Kelowna night',
    hook: row.hook,
    cover: row.cover_image_url,
    costPp: row.total_cost_pp,
    durationMin: row.total_duration_min,
  };
}
