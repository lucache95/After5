import { OnboardingShell } from '../OnboardingShell';
export const dynamic = 'force-dynamic';
export default function BasicsPage() {
  return <OnboardingShell step={2}><p>basics</p></OnboardingShell>;
}
