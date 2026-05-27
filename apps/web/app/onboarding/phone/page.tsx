import { OnboardingShell } from '../OnboardingShell';
import { PhoneVerifyStep } from '../steps/PhoneVerifyStep';

export const dynamic = 'force-dynamic';

export default function PhonePage() {
  return <OnboardingShell step={5}><PhoneVerifyStep /></OnboardingShell>;
}
