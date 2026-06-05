# Phase 05 Discussion Log — Progressive Reveal (P2)

**Date:** 2026-06-04
**Mode:** discuss (default), no flags
**Note:** Most reveal infrastructure already exists (generate-blur, blurred_photo_url, match_reveal_allowed RPCs, p5 reveal policies, identity_revealed notif type, RevealModal). Discussion focused on the product-taste ladder, not plumbing.

## Areas selected for discussion
User selected all four: Pre-match host tier, Reveal threshold, Partial reveal at offer, The ceremony.

## Decisions

### D-01 — Pre-match host tier
- **Options:** Blurred avatar only (Rec) / Fully blind until offer / Blurred avatar + first name + age.
- **Chose:** Blurred avatar + first name + age. Feed card + detail show a heavy-blur host photo plus first name + age. Consciously relaxes the Phase-4 blind feed.

### D-02 — Reveal threshold (full reveal)
- **Options:** Post-lock at the match (Rec for MVP) / Rapport-gated after real chat / Mutual tap-to-reveal.
- **Chose:** Post-lock, at the match. Reuses the existing RevealModal + match_reveal_allowed gate. Rapport-gated explicitly DEFERRED (net-new gating, meet-without-seeing risk).

### D-03 — Partial reveal at offer
- **Options:** First name + age, lighter blur (Rec) / Lighter blur only / No change until full.
- **Chose:** First name + age, lighter blur. Reconciled with D-01: since name+age already show pre-match, the offer-stage delta is the BLUR REDUCTION (the face begins to resolve). Ladder is blur-driven: heavy → light → clear.

### D-04 — The ceremony
- **Options:** Animated unblur + subtle flourish (Rec) / Quiet tasteful unveil / Full celebration.
- **Chose:** Animated unblur + subtle Barbiecore flourish. Face resolves from blur into focus + gentle glow/sticker + sonner toast; enhance RevealModal. Earned, not loud.

## Reconciliation captured
Because name+age show from pre-match (D-01), the three rungs differ primarily by BLUR LEVEL (heavy → light → clear), with name+age constant. Recorded in CONTEXT domain + D-03.

## Claude's discretion (implementation, in CONTEXT)
- Blur strengths per rung + whether offer-tier blur is a second asset or CSS blur.
- FeedNight host-hint shape (preserve rest of blind contract).
- Ceremony animation mechanics (framer-motion + reduced-motion) per DESIGN-SYSTEM.
- Whether identity_revealed already dispatches at lock or needs a dispatch site.

## Deferred / flagged
- Rapport-gated reveal threshold (P3 enhancement).
- Mutual tap-to-reveal (backlog).

## Scope creep
- None raised. (Ratings/safety/chat-wiring correctly left to Phase 6; map/ranking to Phase 7.)
