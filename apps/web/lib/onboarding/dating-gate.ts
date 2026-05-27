// Friendly UI copy for a canEnableDating() reason code. Pure (no I/O).
export function datingGateMessage(reason?: string): string {
  switch (reason) {
    case 'birthdate_missing':
      return "We couldn't read your date of birth from your ID. Email hello@tryafter5.app and we'll sort it out.";
    case 'under_18':
      return 'After5 dating is 18+.';
    case 'not_verified':
      return 'Finish verifying to turn dating on.';
    case 'onboarding_incomplete':
      return 'Finish setting up your profile first.';
    default:
      return "We couldn't turn dating on. Email hello@tryafter5.app and we'll help.";
  }
}
