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
    title: 'stuck between two plans?',
    body: 'hit share on any results page, send the link, and they swipe to vote. you see the winner.',
    cta_label: 'try a vote-share',
    cta_path: '/plan',
  },
  {
    id: 'save_plans',
    title: 'save the ones you love',
    body: 'tap the heart on any plan and it lives in your dashboard. pull it back up next friday when "where should we go?" hits again.',
    cta_label: 'see your saves',
    cta_path: '/account',
  },
  {
    id: 'wow_factor_twist',
    title: 'every plan has a twist',
    body: "phones in a bag. two truths and a lie. the secret word. every plan ships with one quiet ritual baked in — skip it if it's not your night.",
    cta_label: 'build a plan',
    cta_path: '/plan',
  },
  {
    id: 'expandable_map',
    title: 'tap the map to zoom out',
    body: "on any plan detail page, the route map opens full-screen when you tap it. see the whole night at once.",
    cta_label: 'browse plans',
    cta_path: '/dates',
  },
  {
    id: 'pdf_download',
    title: 'take it offline',
    body: 'every plan has a pdf download — addresses, timing, drive minutes — for the car ride or when service drops.',
    cta_label: 'get a plan',
    cta_path: '/plan',
  },
  {
    id: 'browse_other_dates',
    title: "steal someone else's night",
    body: 'curious what other people are building? /dates is the public feed. find one you love, save it, head out.',
    cta_label: 'browse the catalog',
    cta_path: '/dates',
  },
  {
    id: 'things_to_know',
    title: 'heads-up panel',
    body: 'scroll past the timeline on any plan detail — there\'s a "before you head out" panel with reservation reminders, weather backups, and pacing tips.',
    cta_label: 'see an example',
    cta_path: '/dates',
  },
  {
    id: 'magic_link_login',
    title: 'no password ever',
    body: "forgot how you signed in? enter your email at /login. magic link in your inbox, one tap, you're back in.",
    cta_label: 'sign in',
    cta_path: '/login',
  },
  {
    id: 'similar_plans',
    title: 'same vibe, different night',
    body: 'bottom of every plan: "more plans like this." same template, different stops. for when you nailed last weekend and want a remix.',
    cta_label: 'pick a plan',
    cta_path: '/dates',
  },
  {
    id: 'try_a_different_one',
    title: "don't love the 3?",
    body: 'on the results page, hit "try a different one" — fresh batch, same inputs. no recycled stops.',
    cta_label: 'plan a date',
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
