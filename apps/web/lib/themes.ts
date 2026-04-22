// Narrative themes — bundles of preset inputs. Used as a quick-start path
// from the homepage. /plan?theme=ID applies the preset and jumps the user
// past the early steps.
//
// The shape of `preset` is intentionally loose so it can include any subset
// of plan inputs without coupling to the full Inputs interface here.

export interface PlanTheme {
  id: string;
  label: string;
  desc: string;
  preset: {
    occasion?: 'date' | 'solo' | 'friends';
    vibe?: string[];
    duration_min?: number;
    budget_per_person?: number;
    effort?: 'low' | 'moderate' | 'high';
    must_includes?: string[];
    location?: 'out' | 'home';
    intent?: 'impress' | 'chill' | 'reconnect' | 'try_something_new' | '';
  };
}

export const PLAN_THEMES: PlanTheme[] = [
  {
    id: 'first_date_safe',
    label: 'First date, safe play',
    desc: 'Coffee → walk → small dinner. Easy out, no pressure.',
    preset: { occasion: 'date', vibe: ['chill', 'romantic'], duration_min: 180, budget_per_person: 50, effort: 'low', must_includes: ['food'], intent: 'reconnect' },
  },
  {
    id: 'rom_com_night',
    label: 'Rom-com night',
    desc: 'Wine bar → cozy dinner → dessert walk. Slow and warm.',
    preset: { occasion: 'date', vibe: ['cozy', 'romantic'], duration_min: 180, budget_per_person: 60, effort: 'low', location: 'out', must_includes: ['food'], intent: 'chill' },
  },
  {
    id: 'main_character_day',
    label: 'Main character day',
    desc: 'Big day: hike, view, sunset wine, late dinner.',
    preset: { occasion: 'date', vibe: ['adventurous', 'boujee'], duration_min: 360, budget_per_person: 100, effort: 'moderate', must_includes: ['view', 'food'], intent: 'impress' },
  },
  {
    id: 'slow_sunday',
    label: 'Slow Sunday',
    desc: 'Brunch, lakeside walk, long lazy afternoon.',
    preset: { occasion: 'date', vibe: ['chill', 'cozy'], duration_min: 240, budget_per_person: 50, effort: 'low', must_includes: ['food'], intent: 'reconnect' },
  },
  {
    id: 'no_phones',
    label: 'No phones',
    desc: 'Activity-first, conversation-led, screens-down.',
    preset: { occasion: 'date', vibe: ['intimate', 'spontaneous'], duration_min: 180, budget_per_person: 60, effort: 'moderate', must_includes: ['activity'], intent: 'reconnect' },
  },
];
