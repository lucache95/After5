// Friendly UI copy for a canEnableDating() reason code. Pure (no I/O).
export function datingGateMessage(reason?: string): string {
  switch (reason) {
    case 'birthdate_missing':
      return "we couldn't read your date of birth from your id. email hello@tryafter5.app and we'll sort it out.";
    case 'under_18':
      return 'after5 dating is 18+.';
    case 'not_verified':
      return 'finish verifying to turn dating on.';
    case 'onboarding_incomplete':
      return 'finish setting up your profile first.';
    default:
      return "we couldn't turn dating on. email hello@tryafter5.app and we'll help.";
  }
}
