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

// Resolve the reason canEnableDating() reports into the one the user should READ.
// canEnableDating checks birthdate first, but the birthdate only ever comes FROM
// the id scan — so a user who never attempted/completed verification (state is
// 'unverified' or 'pending') gets 'birthdate_missing', and the copy above would
// invent an id-read failure for an id that was never scanned (P2, 2026-06-09
// audit: skip-to-done). Only 'verified'/'failed'/'appeal' users have actually
// been through a scan; everyone else just isn't verified yet. Pure (no I/O).
export function displayGateReason(
  reason: string | undefined,
  verification: string,
): string | undefined {
  const scanned = verification === 'verified' || verification === 'failed' || verification === 'appeal';
  if (reason === 'birthdate_missing' && !scanned) return 'not_verified';
  return reason;
}
