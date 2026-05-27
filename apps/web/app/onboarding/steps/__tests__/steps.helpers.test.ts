import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_STEPS,
  STEP_ROUTE,
  routeForStep,
  nextStep,
  stepIndex,
} from '@/lib/onboarding/steps';

describe('onboarding step helpers', () => {
  it('lists the seven backend steps in forward order', () => {
    expect(ONBOARDING_STEPS).toEqual([
      'age_gate', 'basics', 'photos', 'preferences', 'phone_verify', 'selfie_verify', 'done',
    ]);
  });

  it('maps each step to its wizard route', () => {
    expect(STEP_ROUTE.age_gate).toBe('/onboarding/welcome');
    expect(STEP_ROUTE.basics).toBe('/onboarding/basics');
    expect(STEP_ROUTE.photos).toBe('/onboarding/photo');
    expect(STEP_ROUTE.preferences).toBe('/onboarding/preferences');
    expect(STEP_ROUTE.phone_verify).toBe('/onboarding/phone');
    expect(STEP_ROUTE.selfie_verify).toBe('/onboarding/verify');
    expect(STEP_ROUTE.done).toBe('/home');
  });

  it('routeForStep routes done to the first-session home', () => {
    expect(routeForStep('done')).toBe('/home');
    expect(routeForStep('age_gate')).toBe('/onboarding/welcome');
  });

  it('nextStep returns the following step, and null past done', () => {
    expect(nextStep('age_gate')).toBe('basics');
    expect(nextStep('selfie_verify')).toBe('done');
    expect(nextStep('done')).toBeNull();
  });

  it('stepIndex gives a 1-based position for the progress bar (done excluded)', () => {
    expect(stepIndex('age_gate')).toBe(1);
    expect(stepIndex('selfie_verify')).toBe(6);
  });
});
