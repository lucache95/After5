import { describe, it, expect } from 'vitest';
import { buildPlanEmail } from '../plan-pdf';

describe('buildPlanEmail', () => {
  it('greets by first name, lowercase, references the plan title', () => {
    const { subject, html, text } = buildPlanEmail({ firstName: 'Sam', itineraryTitle: 'pottery + ramen' });
    expect(subject.toLowerCase()).toContain('pottery + ramen');
    expect(html.toLowerCase()).toContain('hey sam');
    expect(text.toLowerCase()).toContain('pottery + ramen');
  });
  it('handles a missing name', () => {
    const { html } = buildPlanEmail({ firstName: null, itineraryTitle: 'a night out' });
    expect(html.toLowerCase()).toContain('hey');
  });
});
