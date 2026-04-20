// Inline warnings shown beside the plan-flow steps. Heuristic — no API call —
// catches the most common ways a user can over-constrain themselves before
// they wait 10s for the loader and hit "no template matches."

export type Hint = { tone: 'warn' | 'info'; text: string };

export interface InputsLike {
  occasion: 'date' | 'solo' | 'friends';
  duration_min: number;
  budget_per_person: number;
  vibe: string[];
  must_includes: string[];
  effort: 'low' | 'moderate' | 'high';
  max_radius_km: number;
  location: 'out' | 'home';
}

// Returns hints relevant to a specific step (1-5). Empty array = no warnings.
export function hintsForStep(step: number, i: InputsLike): Hint[] {
  const hints: Hint[] = [];

  if (step === 1) {
    if (i.occasion === 'solo') {
      hints.push({
        tone: 'info',
        text: 'Solo plans have fewer templates than dates. A 2-3 hour duration works best.',
      });
    }
  }

  if (step === 2) {
    if (i.duration_min <= 120) {
      hints.push({
        tone: 'info',
        text: '2 hours is short — expect 2 stops instead of 3.',
      });
    }
    if (i.duration_min >= 600) {
      hints.push({
        tone: 'info',
        text: 'A full day plan needs a wider radius — bump it on the next step if a plan fails.',
      });
    }
  }

  if (step === 3) {
    const narrowVibes = ['adventurous', 'intimate', 'cultural'];
    const onlyNarrow = i.vibe.length === 1 && narrowVibes.includes(i.vibe[0]);
    if (onlyNarrow) {
      hints.push({
        tone: 'warn',
        text: `"${i.vibe[0]}" is a narrower pool. Pair it with chill or romantic for more variety.`,
      });
    }
  }

  if (step === 4) {
    if (i.location === 'home') {
      hints.push({
        tone: 'info',
        text: 'At-home plans skip the radius — Kelowna distance doesn\'t matter when you\'re on the couch.',
      });
    }
    if (i.budget_per_person <= 25 && i.vibe.includes('boujee')) {
      hints.push({
        tone: 'warn',
        text: 'Boujee usually needs $50+ to plan well. Plans may stretch the budget.',
      });
    }
    if (i.location === 'out' && i.max_radius_km <= 10) {
      hints.push({
        tone: 'info',
        text: 'Under 10 km is tight — covers downtown + nearby. Bump up if a plan fails.',
      });
    }
  }

  if (step === 5) {
    const m = i.must_includes;
    if (m.length >= 5) {
      hints.push({
        tone: 'warn',
        text: 'Lots of must-haves narrow the plan hard. Try keeping it to 2-3.',
      });
    }
    if (m.includes('indoors') && m.includes('outdoors')) {
      hints.push({
        tone: 'warn',
        text: 'Indoors and outdoors usually fight each other. The plan will pick one.',
      });
    }
    if (i.location === 'home' && (m.includes('walk') || m.includes('view') || m.includes('lake'))) {
      hints.push({
        tone: 'info',
        text: 'You\'re planning at-home — outdoor must-haves like walk/view/lake will be ignored.',
      });
    }
    if (m.length === 1 && m.includes('hidden_gem')) {
      hints.push({
        tone: 'info',
        text: 'Hidden gem on its own is loose. Pair with food or drinks for a focused plan.',
      });
    }
    if (m.includes('drinks') && i.duration_min < 120) {
      hints.push({
        tone: 'info',
        text: 'A drinks-led plan usually needs 2+ hours.',
      });
    }
  }

  return hints;
}
