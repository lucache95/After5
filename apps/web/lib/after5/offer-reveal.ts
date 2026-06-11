// apps/web/lib/after5/offer-reveal.ts
// Reveal-at-pick (founder decision 2026-06-10): the candidate of an ACTIVE
// (unexpired) or accepted offer sees the HOST's clear profile. This mirrors the
// RLS predicate match_reveal_allowed_pair's offer branch EXACTLY
// (o.status = 'accepted' OR (o.status = 'active' AND o.expires_at > now())) so
// the app-layer photo gates (offer page, inbox, thread header) never project a
// clear url the storage policy would refuse to sign, and never withhold one the
// ceremony needs. Host-side stays lock-gated: this returns true only for the
// CANDIDATE looking at the HOST.
export function offerRevealsHostClear(
  viewerId: string,
  offer: { candidate_id: string; status: string; expires_at: string | null } | null | undefined,
): boolean {
  if (!offer || offer.candidate_id !== viewerId) return false;
  if (offer.status === 'accepted') return true;
  return (
    offer.status === 'active' &&
    !!offer.expires_at &&
    new Date(offer.expires_at).getTime() > Date.now()
  );
}
