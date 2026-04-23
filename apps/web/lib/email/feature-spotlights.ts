// Hidden-feature spotlights surfaced one-per-week in the digest. Edit the
// list to add/reorder. The weekly digest picks the spotlight by week-of-year
// modulo length so it cycles deterministically.

export interface FeatureSpotlight {
  id: string;
  title: string;
  body: string;
  cta_label?: string;
  cta_path?: string;
}

export const FEATURE_SPOTLIGHTS: FeatureSpotlight[] = [
  {
    id: 'vote_with_friends',
    title: 'Stuck between two plans?',
    body: 'Hit the share button on any plan results page, send the link to a friend, and they swipe to vote. You see the winner.',
    cta_label: 'Try a vote-share',
    cta_path: '/plan',
  },
  {
    id: 'save_plans',
    title: 'Save the ones you love',
    body: 'Tap the heart on any plan and it lives in your dashboard forever. Pull it back up next Friday when "where should we go?" hits again.',
    cta_label: 'See your saves',
    cta_path: '/account',
  },
  {
    id: 'wow_factor_twist',
    title: 'Every plan has a twist',
    body: "Phones in a bag. Two truths and a lie. The secret word. Every itinerary ships with one quiet ritual baked in — skip it if it's not your night.",
    cta_label: 'Build a plan',
    cta_path: '/plan',
  },
  {
    id: 'expandable_map',
    title: 'Tap the map to zoom out',
    body: "On any plan detail page, the route map opens full-screen when you tap it. See the whole night at once.",
    cta_label: 'Browse plans',
    cta_path: '/dates',
  },
  {
    id: 'pdf_download',
    title: 'Take it offline',
    body: 'Every plan has a PDF download — addresses, timing, drive minutes — for the car ride or when service is spotty up the hill.',
    cta_label: 'Get a plan',
    cta_path: '/plan',
  },
  {
    id: 'browse_other_dates',
    title: 'Steal someone else\'s night',
    body: 'Curious what other Kelownans are building? /dates is the public feed. Find one you love, save it, head out.',
    cta_label: 'Browse the catalog',
    cta_path: '/dates',
  },
  {
    id: 'things_to_know',
    title: 'Heads-up panel',
    body: 'Scroll past the timeline on any plan detail — there\'s a "before you head out" panel with reservation reminders, weather backups, and pacing tips.',
    cta_label: 'See an example',
    cta_path: '/dates',
  },
  {
    id: 'magic_link_login',
    title: 'No password ever',
    body: 'Forgot how you signed in? Just enter your email at /login. Magic link in your inbox, one tap, you\'re back in.',
    cta_label: 'Sign in',
    cta_path: '/login',
  },
  {
    id: 'similar_plans',
    title: 'Same vibe, different night',
    body: 'Bottom of every plan: "more plans like this." Same template, different stops. For when you nailed last weekend and want a remix.',
    cta_label: 'Pick a plan',
    cta_path: '/dates',
  },
  {
    id: 'try_a_different_one',
    title: "Don't love the 3?",
    body: 'On the results page, hit "try a different one" — totally fresh batch, same inputs. We won\'t recycle the same stops.',
    cta_label: 'Plan a date',
    cta_path: '/plan',
  },
];

export function pickWeeklySpotlight(date = new Date()): FeatureSpotlight {
  // ISO week number — same week → same spotlight regardless of timezone drift.
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return FEATURE_SPOTLIGHTS[week % FEATURE_SPOTLIGHTS.length];
}
