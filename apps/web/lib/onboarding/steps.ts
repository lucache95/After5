// Pure onboarding step-order + routing helpers. Mirrors the backend
// advance_onboarding_step sequence (validators OnboardingStepSchema). NO I/O.
import type { OnboardingStep } from '@after5/validators';

export const ONBOARDING_STEPS: OnboardingStep[] = [
  'age_gate', 'basics', 'photos', 'preferences', 'phone_verify', 'selfie_verify', 'done',
];

export const STEP_ROUTE: Record<OnboardingStep, string> = {
  age_gate: '/onboarding/welcome',
  basics: '/onboarding/basics',
  photos: '/onboarding/photo',
  preferences: '/onboarding/preferences',
  phone_verify: '/onboarding/phone',
  selfie_verify: '/onboarding/verify',
  done: '/home',
};

export function routeForStep(step: OnboardingStep): string {
  return STEP_ROUTE[step];
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  const i = ONBOARDING_STEPS.indexOf(step);
  if (i < 0 || i >= ONBOARDING_STEPS.length - 1) return null;
  return ONBOARDING_STEPS[i + 1];
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step) + 1;
}

export const WIZARD_STEP_COUNT = ONBOARDING_STEPS.length - 1; // 6
