import { test, expect } from '@playwright/test';

// M2 date-first landing — anon flow in a real browser.
//
// The server-side blur-gate (toTeaser) is proven deterministically by the unit tests
// (lib/create/__tests__/blur-gate.test.ts) and the route test (app/api/create-plan/route.test.ts):
// an anon caller never receives premium fields. generate-plan itself needs an LLM key
// (ANTHROPIC_API_KEY) that the e2e env doesn't carry, so we MOCK /api/create-plan +
// /api/email-plan at the network layer. This keeps the e2e about what only a browser can
// prove — the real CreateFlow renders the gated teaser, shows the unlock section, and the
// email-the-full-plan capture works — without depending on the LLM.
const TEASER = {
  authed: false,
  city: 'kelowna',
  fellBack: false,
  itineraries: [
    {
      template_id: 't1',
      template_name: 'creative night',
      title: 'pottery + ramen',
      hook: 'get your hands dirty, then warm up over noodles',
      why_it_works: '', // server-stripped for anon
      locked: true,
      total_cost_pp: 60,
      total_duration_min: 180,
      vibe: ['creative', 'foodie'],
      stops: [
        { place_id: 'p1', place_name: 'clay studio', place_type: 'activity', start_time: '18:00',
          duration_min: 90, estimated_cost_pp: 35, what_to_do: 'throw a bowl on the wheel', photo_url: null, locked: false },
        { place_id: 'p2', place_type: 'restaurant', photo_url: null, place_name: '', locked: true },
      ],
    },
  ],
};

test.describe('M2 /create (anon)', () => {
  test('generates a plan, gates premium behind the unlock section, captures email', async ({ page }) => {
    await page.route('**/api/create-plan', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TEASER) }),
    );
    await page.route('**/api/email-plan', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    );

    await page.goto('/create');

    // input screen: pick a required vibe, then generate
    await expect(page.getByRole('heading', { name: /what.?s the/i })).toBeVisible();
    await page.getByRole('button', { name: /creative/i }).click();
    await page.getByRole('button', { name: /make my date/i }).click();

    // results: the plan title + the first (unlocked) stop render in the real browser
    await expect(page.getByText(/pottery \+ ramen/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/clay studio/i)).toBeVisible();

    // anon blur-gate: the unlock section CTA is present
    await expect(page.getByText(/email me the full plan/i)).toBeVisible();
    await expect(page.getByText(/no account needed/i)).toBeVisible();

    // email capture → full-plan PDF (locked decision #3)
    await page.getByLabel('email').fill('m2-e2e@example.com');
    await page.getByRole('button', { name: /send it/i }).click();
    await expect(page.getByText(/it.?s in your inbox/i)).toBeVisible({ timeout: 10000 });
  });
});
