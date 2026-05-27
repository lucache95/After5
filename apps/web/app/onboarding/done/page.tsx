import { OnboardingShell } from '../OnboardingShell';
export const dynamic = 'force-dynamic';
export default function DonePage() {
  return <OnboardingShell step={7}><p>done</p></OnboardingShell>;
}
