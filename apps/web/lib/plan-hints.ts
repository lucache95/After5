// Inline warnings shown beside the plan-flow steps. Heuristic — no API call —
// catches the most common ways a user can over-constrain themselves before
// they wait 10s for the loader and hit "no template matches."

export type Hint = {
  tone: 'warn' | 'info';
  text: string;
  // Long-form explainer revealed by the "What does this mean?" expander on
  // every hint. Keep to 2-3 sentences. Should answer WHY this is happening
  // and WHAT happens if they ignore it — not just restate the short text.
  explainer?: string;
};

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

  if (step === 2) {
    if (i.duration_min >= 600) {
      hints.push({
        tone: 'info',
        text: 'A full day plan needs a wider radius — bump it on the next step if a plan fails.',
        explainer:
          'A 10-hour day usually wants 4-5 stops, and the best 5-stop plans pull from a wider area than just downtown — wineries in West Kelowna, a bluff hike, sunset on the lake. If the radius stays tight, we may run out of variety and skip some of the more memorable spots that make a full day worth it.',
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
        explainer: `Most Kelowna spots have multiple vibe tags but only a handful lean hard into "${i.vibe[0]}" alone. Picking it solo means we're choosing from a smaller pool, so all three plans may feel similar. Adding chill or romantic widens what we can pull from while still keeping the lead vibe you wanted.`,
      });
    }
  }

  if (step === 4) {
    if (i.location === 'home') {
      hints.push({
        tone: 'info',
        text: 'At-home plans skip the radius — Kelowna distance doesn\'t matter when you\'re on the couch.',
        explainer:
          'At-home plans pull from a separate catalog of cooking-together, fort-building, movie-marathon style ideas — none of which involve driving anywhere. The radius slider doesn\'t affect what we generate when you\'re staying in.',
      });
    }
    if (i.budget_per_person <= 25 && i.vibe.includes('boujee')) {
      hints.push({
        tone: 'warn',
        text: 'Boujee usually needs $50+ to plan well. Plans may stretch the budget.',
        explainer:
          'Boujee plans lean on tasting menus, cocktail bars, and fine-dining-style spots that typically cost $40+ per person. We\'ll still try to honor the vibe, but the only way to land at $25 is to pick spots that don\'t really feel boujee — so plans may either go over budget or feel less special than the tag promised.',
      });
    }
    if (i.location === 'out' && i.max_radius_km <= 10) {
      hints.push({
        tone: 'info',
        text: 'Under 10 km is tight — covers downtown + nearby. Bump up if a plan fails.',
        explainer:
          'A 10 km circle from Kelowna centroid covers downtown, the cultural district, Pandosy, and parts of Glenmore. It misses Lower Mission, West Kelowna, Lake Country, the wineries, and the bigger hikes. If the plan can\'t find a third stop, that\'s usually why.',
      });
    }
  }

  if (step === 5) {
    const m = i.must_includes;
    // hidden_gem doesn't constrain templates (it's a tone hint, not a slot
    // requirement), so it doesn't count toward the "too many" warning.
    const constraining = m.filter((x) => x !== 'hidden_gem');
    if (constraining.length >= 5) {
      hints.push({
        tone: 'warn',
        text: 'Lots of must-haves narrow the plan hard. Try keeping it to 2-3.',
        explainer:
          'Each must-have removes templates that can\'t cover it. Stack 5+ together and we may have only one or two templates that satisfy all of them — meaning all three plans look almost identical. 2-3 keeps the plan focused without collapsing the variety.',
      });
    }
    if (m.includes('indoors') && m.includes('outdoors')) {
      hints.push({
        tone: 'warn',
        text: 'Indoors and outdoors usually fight each other. The plan will pick one.',
        explainer:
          'Templates pick a primary mood — a brewery-and-cinema night is indoors; a hike-and-lake-walk is outdoors. Asking for both forces us to pick whichever the lead template prefers and quietly drop the other. If you actually want a mix, "outdoors" plus "food" or "drinks" tends to work better.',
      });
    }
    if (i.location === 'home' && (m.includes('walk') || m.includes('view') || m.includes('lake'))) {
      hints.push({
        tone: 'info',
        text: 'You\'re planning at-home — outdoor must-haves like walk/view/lake will be ignored.',
        explainer:
          'At-home plans pull from the cooking-together / movie-night / fort-building catalog only. Any must-have that requires leaving the couch (walk, view, lake, hike) won\'t apply because there\'s nowhere outdoors to satisfy it without breaking the at-home premise.',
      });
    }
    if (m.length === 1 && m.includes('hidden_gem')) {
      hints.push({
        tone: 'info',
        text: 'Hidden gem on its own is loose. Pair with food or drinks for a focused plan.',
        explainer:
          'Hidden gem just tells us "show me offbeat options". Without a backbone like food or drinks, we have nothing to anchor the plan around. Pair it with a concrete must-have and we\'ll prefer the lesser-known options for that backbone — a hidden-gem cafe instead of an obvious one, a hidden-gem cocktail bar instead of the busy one downtown.',
      });
    }
    if (m.includes('drinks') && i.duration_min < 120) {
      hints.push({
        tone: 'info',
        text: 'A drinks-led plan usually needs 2+ hours.',
        explainer:
          'Most cocktail bars, breweries, and wineries take 60-90 minutes once you factor in seating, ordering, and actually finishing the drinks. Sub-2-hour plans force us to stack a single drink stop with something quick — fine, but the drinks moment ends up rushed.',
      });
    }
  }

  return hints;
}
