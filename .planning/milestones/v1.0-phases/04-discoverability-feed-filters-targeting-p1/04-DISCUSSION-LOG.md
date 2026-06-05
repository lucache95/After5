# Phase 04 Discussion Log — Discoverability — Feed Filters & Targeting (P1)

**Date:** 2026-06-04
**Mode:** discuss (default), no flags
**Note:** Architecture pre-locked by `docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md`; discussion limited to the open product-taste decisions.

## Areas selected for discussion
User selected all four offered gray areas: Reach preview behavior, Empty-feed recovery, "someone like you" hint, Filter defaults & weight.

## Decisions

### D-01 — Reach preview behavior
- **Options:** Passive + encouraging (Rec) / Active loosen-nudge / Just the number.
- **Chose:** Passive + encouraging. Quiet live count under targeting; low count framed positively; never blocks/discourages posting.

### D-02 — Empty-feed recovery
- **Options:** Active + 'post your own' (Rec) / Friendly message only / Auto-relax silently.
- **Chose:** Active + 'post your own'. Name most-restrictive hard filter + one-tap loosen, plus a post-your-own attainability nudge.

### D-03 — "looking for someone like you" fit hint
- **Options:** Subtle pill, strong matches only (Rec) / Prominent highlight / Invisible (rank only).
- **Chose:** Subtle pill on strong matches only + soft-sort.

### D-04 — Filter defaults & weight
- **Options:** Open defaults + light chips (Rec) / Full sheet up front.
- **Chose:** Open inclusive defaults (nothing filtered) + light 3-chip quick-filter; tap opens full vaul sheet; chips per design system.

## Claude's discretion (implementation, captured in CONTEXT)
- `target_genders = {everyone}` vs `{}` normalization in fit/boost + reach math (ROADMAP carry-forward note #1).
- feed_filters jsonb key set, index/cursor strategy, soft match-score formula — per spec §5/§6.
- FilterSheet layout/chip set/copy — per DESIGN-SYSTEM.md.

## Deferred / flagged
- Post-night "why"-edit mutates source plan (ROADMAP carry-forward note #2) — E11/data-flow concern, flagged not scoped.

## Scope creep
- None raised.
