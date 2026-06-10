import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { selectTopTemplates } from './templates.ts';
import type { PlanInputs, Template } from './types.ts';

// ─── selectTopTemplates location gate ─────────────────────────────────────
// At-home templates (geographic_rule = 'home') must only serve location='home'
// requests — and out templates must not serve at-home requests. Mirrors
// filterPlaces' at_home venue scoping on the template side; without it a
// romantic-tagged at-home template won 'out' selection and filled its
// 'activity' slots with climbing gyms (2026-06-10 seed repro).

function tpl(overrides: Partial<Template>): Template {
  return {
    id: 't',
    name: 'a template',
    duration_min: 180,
    suitable_for: ['date'],
    vibe: [],
    slots: [{ types: ['restaurant'], duration_min: 60 }],
    geographic_rule: null,
    energy_curve: null,
    ...overrides,
  };
}

function inputs(location: PlanInputs['location']): PlanInputs {
  return {
    occasion: 'date',
    duration_min: 180,
    budget_per_person: 80,
    vibe: ['romantic'],
    must_includes: [],
    drive_tolerance_min: 30,
    max_radius_km: 30,
    location,
    effort: 'low',
  };
}

const HOME_ROMANTIC = tpl({
  id: 'home_cozy',
  vibe: ['romantic', 'cozy'],
  geographic_rule: 'home',
  slots: [{ types: ['activity'], duration_min: 90 }, { types: ['activity'], duration_min: 90 }],
});
const OUT_ROMANTIC = tpl({ id: 'out_dinner', vibe: ['romantic'] });
const OUT_PLAIN = tpl({ id: 'out_plain', vibe: ['chill'] });

Deno.test('selectTopTemplates: out request excludes at-home templates even when they out-score on vibe', () => {
  // HOME_ROMANTIC matches 2 vibe tags (4 pts) vs OUT_ROMANTIC's 1 (2 pts) —
  // the gate must still drop it for location='out'.
  const picked = selectTopTemplates([HOME_ROMANTIC, OUT_ROMANTIC, OUT_PLAIN], inputs('out'), 3);
  assertEquals(picked.some((t) => t.id === 'home_cozy'), false);
  assertEquals(picked[0].id, 'out_dinner');
});

Deno.test('selectTopTemplates: home request selects ONLY at-home templates', () => {
  const picked = selectTopTemplates([HOME_ROMANTIC, OUT_ROMANTIC, OUT_PLAIN], inputs('home'), 3);
  assertEquals(picked.length, 1);
  assertEquals(picked[0].id, 'home_cozy');
});
