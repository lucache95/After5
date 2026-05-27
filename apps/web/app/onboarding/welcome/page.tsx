import { OnboardingShell } from '../OnboardingShell';
import { WelcomeAgeGate } from '../steps/WelcomeAgeGate';

export const dynamic = 'force-dynamic';

export default function WelcomePage() {
  return <OnboardingShell step={1}><WelcomeAgeGate /></OnboardingShell>;
}
