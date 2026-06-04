---
created: 2026-06-04
source: 05-REVIEW.md (WR-04)
severity: warning
area: privacy / reveal gate
resolves_phase:
---

# Clear host photo stays revealable after a lock is cancelled (WR-04)

Surfaced by the Phase 5 code review (`.planning/phases/05-progressive-reveal-p2/05-REVIEW.md`, WR-04). **Pre-existing** — the predicate predates Phase 5, but the reveal page now exercises it more visibly.

**Issue:** The reveal gate's unconditional `o.status = 'accepted'` branch (the `match_reveal_allowed` / `match_reveal_allowed_pair` predicate) keeps the counterpart's clear photo signable/revealable even after a lock transitions to `cancelled`. `matches/[lockId]/page.tsx` signs the clear photo without first checking `lock.status`.

**Why deferred (not auto-fixed in Phase 5):** changing a reveal RLS predicate is a security-sensitive decision that needs a product call on the intended behavior after cancellation (should a revealed face un-reveal? for how long? does cancellation even un-reveal in the product model?). Out of scope for the progressive-reveal MVP slice.

**Options to decide:**
1. Add a `lock.status <> 'cancelled'` guard before signing clear photos in `matches/[lockId]/page.tsx` (app-layer, cheap).
2. Tighten the reveal predicate itself (DB-layer, gated-prod-apply) so a cancelled lock revokes reveal.
3. Accept as-is (a once-revealed face stays revealed; document the decision).

Full detail + file:line in `05-REVIEW.md` WR-04.
