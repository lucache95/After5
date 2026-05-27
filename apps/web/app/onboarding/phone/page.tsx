import { OnboardingShell } from '../OnboardingShell';
export const dynamic = 'force-dynamic';
export default function PhonePage() {
  return <OnboardingShell step={5}><p>phone</p></OnboardingShell>;
}
