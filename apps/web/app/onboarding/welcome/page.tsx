import { OnboardingShell } from '../OnboardingShell';
export const dynamic = 'force-dynamic';
export default function WelcomePage() {
  return <OnboardingShell step={1}><p>welcome</p></OnboardingShell>;
}
