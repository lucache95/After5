// apps/web/app/onboarding/steps/PreferencesStep.tsx
// Step 4 (preferences): orientation + age range + distance + dealbreakers. The
// form body, validation (PreferencesInputSchema), and save (savePreferences →
// advanceOnboarding → /onboarding/phone) now live in the shared, mode-aware
// <PreferencesForm> (E4 / D-09). This step is a thin onboarding-mode wrapper so
// onboarding behavior is byte-for-byte preserved.
import { PreferencesForm, type PreferencesInitial } from '@/components/PreferencesForm';

export type { PreferencesInitial };

export function PreferencesStep({ userId, initial }: { userId: string; initial: PreferencesInitial }) {
  return <PreferencesForm mode="onboarding" userId={userId} initial={initial} />;
}
