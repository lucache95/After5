import { OnboardingShell } from '../OnboardingShell';
import { IdentityVerifyStep } from '../steps/IdentityVerifyStep';

export const dynamic = 'force-dynamic';

export default function VerifyPage() {
  return <OnboardingShell step={6}><IdentityVerifyStep /></OnboardingShell>;
}
