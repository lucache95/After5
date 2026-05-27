import { OnboardingShell } from '../OnboardingShell';
export const dynamic = 'force-dynamic';
export default function VerifyPage() {
  return <OnboardingShell step={6}><p>verify</p></OnboardingShell>;
}
