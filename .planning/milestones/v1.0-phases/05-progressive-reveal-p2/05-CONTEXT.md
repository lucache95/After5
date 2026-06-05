# Phase 05: Progressive Reveal (P2) - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver REQ-E15 + REQ-E16: make "swipe on the date, not the face" real via a **three-rung host reveal ladder** plus an `identity_revealed` ceremony. The ladder is **blur-driven** — the host's first name + age are known from the feed onward, and it is the FACE that progressively un-blurs:

1. **Pre-match** (feed card + detail): heavy-blur host avatar + first name + age.
2. **Offer stage** (interested → offer): name+age persist; the blur **softens one step** (face starts resolving).
3. **Threshold = post-lock** (the match): clear photo + an **animated unblur ceremony** + the gated `identity_revealed` notification.

**In scope:** consume `blurred_photo_url` + add `signBlurredUrls()`; project a limited host hint (blurred avatar + first name + age) into `FeedNight` and render it on the feed card + detail; soften the blur at the offer stage on the interested/offer surfaces and make them experience-led (not photo-led); fire the FULL reveal at lock; dispatch `identity_revealed` at the threshold; build/enhance the reveal-ceremony moment (animated unblur dissolve + subtle Barbiecore flourish). Reuse the existing blur pipeline + reveal policies + RPCs.

**Out of scope (own phases):** ratings/reliability aggregation + chat↔profile↔night cross-links + safety flows (E17–E19 / Phase 6); map/route/ranking (Phase 7). Building the blur generator itself (`generate-blur` already exists). The rapport-gated reveal threshold (considered + rejected for MVP — see D-02).

**Mode: mvp** — vertical slices (UI→API→DB per rung).
</domain>

<decisions>
## Implementation Decisions

These four are the product-taste calls locked in discussion. The blur pipeline + reveal policies/RPCs already exist (see Code Context) — this phase WIRES the ladder, it does not rebuild plumbing.

### Pre-match host tier (feed card + detail, before any match)
- **D-01:** **Heavy-blur host avatar + first name + age.** The feed card and detail show a soft/heavily-blurred host photo PLUS the host's first name and age. This consciously relaxes the Phase-4 pure-blind-feed contract: the searcher now senses a real person (name, age, blurred face) but still can't judge the face — the experience still leads. `FeedNight` gains a limited host hint; `signBlurredUrls()` signs the blurred photo. (Note: this means name+age are known from the feed onward, so the offer-stage delta below is purely the blur reduction.)

### Reveal threshold — when the FULL reveal fires (most consequential)
- **D-02:** **Post-lock, at the match.** The full reveal + ceremony fire the moment both sides lock the date (accept). This is the MVP choice: the existing `RevealModal.tsx` already lives at lock, and the `match_reveal_allowed` RPCs already gate post-lock reveal. **Rapport-gated reveal (reveal only after chat rapport) was considered and explicitly deferred** — it is net-new hard-gating logic and risks people meeting having only partially seen each other; revisit as a P3 enhancement if desired. (Recorded in Deferred Ideas.)

### Partial reveal at the offer stage (the middle rung)
- **D-03:** **Lighter blur at the offer.** Because name+age already show pre-match (D-01), the offer stage's job is to **soften the blur one step** — the face begins to resolve as a reward for getting matched, without giving away the clear photo. The interested/offer surfaces (`InterestedList`, the offer/`MakeOfferModal` flow) stay experience-led (the night leads, the softening face is secondary).

### The ceremony (REQ-E16 reveal moment)
- **D-04:** **Animated unblur + subtle Barbiecore flourish.** Crossing the threshold renders a deliberate ceremony: the face resolves from blur into focus (animated dissolve) with a gentle on-brand beat (soft glow/sticker + a `sonner` toast), reusing + enhancing the existing `RevealModal.tsx`. Earned and tasteful — not confetti-loud, not a silent swap.

### Claude's Discretion (implementation — planner/researcher decide)
- The exact blur strengths per rung (heavy → light → clear) and whether the "lighter blur" at offer is a second pre-generated blurred asset or a CSS blur on the same asset — planner's call (note `generate-blur` produces `blurred_photo_url`; a second tier may need a second blur level or a client-side blur).
- The precise `FeedNight` shape extension for the host hint (blurred avatar URL + first name + age) while preserving the rest of the blind contract (no exact location/identity beyond the hint) — researcher/planner per the spec.
- Ceremony animation mechanics (framer-motion dissolve, timing, reduced-motion fallback) per DESIGN-SYSTEM.md.
- Whether `identity_revealed` dispatch is already wired at lock (the type exists) or needs a dispatch site — researcher confirms against the lock/accept RPC path.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — REQ-E15 (lines ~155–162: three reveal tiers, `signBlurredUrls()`, limited host hint into `FeedNight`, experience-led InterestedList/OfferDetail) + REQ-E16 (lines ~164–168: dispatch `identity_revealed` + reveal ceremony).
- `.planning/ROADMAP.md` §"Phase 5: Progressive Reveal (P2)" — goal + 3 success criteria + `Mode: mvp` + deps.

### Existing reveal/blur infrastructure (REUSE — do not rebuild)
- `supabase/functions/generate-blur/` — the blur generator edge fn (produces `blurred_photo_url`).
- `supabase/migrations/20260527126600_p5_profiles_revealed_policy.sql` — the revealed-profile RLS policy.
- `supabase/migrations/20260527127400_p5_host_pre_offer_disclosure.sql` — pre-offer host disclosure scope.
- `supabase/migrations/20260527127700_p5_reveal_hardening.sql` + `20260527126650_p5_revoke_internals_from_anon.sql` — reveal hardening/anon revokes.
- `supabase/migrations/20260603120000_gated_inbox_notification_types.sql` — the `identity_revealed` notification type (already exists).
- `match_reveal_allowed(...)` / `match_reveal_allowed_pair(...)` RPCs (in `20260527126600_p5_profiles_revealed_policy.sql` and related p5 migrations) — gate who may see a revealed photo.
- `apps/web/app/matches/[lockId]/RevealModal.tsx` + `LockDetail.tsx` + `MatchConfirmation.tsx` — the post-lock reveal surfaces (enhance RevealModal for the ceremony).
- `apps/web/components/ProfileCard.tsx` — the reusable profile/photo card.
- `apps/web/app/dates/[slug]/interested/InterestedList.tsx` + the offer/`MakeOfferModal` flow — the offer-stage surfaces to soften + make experience-led.
- `apps/web/app/feed/{NightCard,SwipeDeck,page}.tsx` + `FeedNight` (in `packages/api-client/src/feed.ts`) — where the pre-match blurred host hint lands.
- `apps/web/app/onboarding/steps/PhotoStep.tsx` — existing `blurred_photo_url` usage reference (for the `signBlurredUrls()` pattern to add).

### Prior-phase decisions that constrain this phase
- Phase 4 `04-CONTEXT.md` — the blind feed contract (no host identity); D-01 here consciously relaxes it to a blurred-avatar+name+age hint.
- Phase 7 chat (shipped) — the soft rapport-nudge; relevant only as the deferred rapport-gated-reveal option (D-02), NOT used as the MVP threshold.
- `docs/superpowers/DESIGN-SYSTEM.md` — Barbiecore tokens + framer-motion for the ceremony animation.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `generate-blur` edge fn + `blurred_photo_url` column — the blur already exists; this phase consumes it (add `signBlurredUrls()` to sign the blurred path like the clear-photo signing).
- `match_reveal_allowed` / `match_reveal_allowed_pair` RPCs + the p5 reveal RLS policies — the post-lock reveal gate already exists (D-02 threshold = post-lock aligns with this).
- `identity_revealed` notification type — already defined; likely just needs a dispatch site at the lock/accept path (confirm).
- `RevealModal.tsx`, `LockDetail.tsx`, `MatchConfirmation.tsx` — post-lock reveal surfaces to enhance into the D-04 ceremony.
- `ProfileCard.tsx` — render the host across tiers (blurred → lighter → clear).

### Established Patterns
- **Blind-contract feed** (Phase 4): `FeedNight` carries no host identity. D-01 extends it with a LIMITED hint (blurred avatar + first name + age) — preserve the rest of the contract (no precise location/venue/identity).
- **Signed storage URLs:** clear photos use signed URLs gated by reveal; mirror for `signBlurredUrls()` (blurred photos can be more permissively signed since they're pre-match-safe — researcher confirms the right scope).
- **Secure-by-default + gated prod-apply:** any new RLS/RPC pins search_path + revokes anon + grants authenticated; run the advisor after DDL; local-green before gated prod-apply (consistent with Phases 1–4).
- **Visual-verify** every reveal-tier surface @420px against the design contract (the ceremony especially).

### Integration Points
- `FeedNight` ← host blurred avatar + first name + age → rendered on `NightCard`/detail.
- Offer surfaces (`InterestedList` / offer flow) ← the lighter-blur tier.
- Lock/accept RPC path → dispatch `identity_revealed` + the `RevealModal` ceremony reads the now-clear photo via `match_reveal_allowed`.
</code_context>

<specifics>
## Specific Ideas

- Governing premise (CLAUDE.md core value): "swipe on the date, not the face" — every tier decision biases toward the experience leading and the face being earned. The blur-driven ladder (name+age known, face un-blurs heavy→light→clear) is the chosen expression.
- Tone for all reveal copy: lowercase, dry, Barbiecore, stop-slop (no em-dashes). The ceremony should feel earned and warm, never gimmicky.
- The ceremony is the emotional payoff of the whole product — make it land (D-04), but tasteful over loud.
</specifics>

<deferred>
## Deferred Ideas

- **Rapport-gated reveal threshold** — revealing the full face only after real chat rapport (reusing the Phase-7 soft-nudge as a hard gate) was discussed and is the truest expression of "identity reveals as the connection deepens," but deferred from this MVP phase (D-02) because it is net-new hard-gating logic and risks people meeting having only partially seen each other. Revisit as a P3 enhancement once the post-lock reveal ships and is observed.
- **Mutual tap-to-reveal** — both parties tapping a "reveal" button in chat; considered, not chosen (coordination + stuck-state complexity). Backlog.

</deferred>

---

*Phase: 05-progressive-reveal-p2*
*Context gathered: 2026-06-04*
