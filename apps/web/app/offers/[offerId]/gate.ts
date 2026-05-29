// apps/web/app/offers/[offerId]/gate.ts
// Server-safe (NO 'use client'): the pure account-gate resolver, imported by both
// the server page (page-level gate) and the client AccountGate (mid-session gate).
// Kept out of AccountGate.tsx because a 'use client' module's functions can't be
// invoked from a server component.

export type GateReason = 'verify' | 'cooldown' | 'suspended' | 'dating_disabled' | 'blocked' | 'generic';

export function deriveGateReason(me: {
  dating_enabled: boolean | null;
  verification: string | null;
  standing: string | null;
  account_state: string | null;
}): GateReason | null {
  if (me.dating_enabled === false) return 'dating_disabled';
  if (me.verification !== 'verified') return 'verify';
  if (me.standing === 'cooldown') return 'cooldown';
  if (me.standing === 'suspended' || me.standing === 'locked_ban') return 'suspended';
  if (me.account_state && me.account_state !== 'active') return 'suspended';
  return null;
}
