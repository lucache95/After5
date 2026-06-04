# Phase 3: Marketplace Completeness (P1) - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning
**Source:** Autonomous defaults (user granted "run autonomously, I trust your defaults") — all decisions below are founder-overridable.

<domain>
## Phase Boundary

Complete the creator + host surfaces so a host can fully configure and publish a night, triage candidates, and every match/offer screen shows the actual plan, delivered reliably. Delivers audit items **E11** (creator controls), **E12** (host reject candidate + offer-outcome surfacing), **E13** (plan-on-match/offer), **E14** (offer delivery reliability).

**In scope:** the creator-control fields on the post/customize flow + Door-2 publish CTA; `reject_candidate` RPC + decline UI + offer-outcome/withdraw on the interested list; rendering the attached itinerary on `/matches/[lockId]` + `/offers/[offerId]`; reliable offer delivery (guaranteed in-app + server-runtime email).

**Out of scope (own phases):** real feed FILTERS + targeting query application (E10/Phase 4 — Phase 3 adds the per-date TARGETING fields to creation, but the feed-side filtering/sort is Phase 4); progressive reveal / experience-led offer screens (E15/Phase 5 — Phase 3 renders the plan but does not change the photo-led reveal tier); chat↔profile↔night cross-links (E18/Phase 6).
</domain>

<decisions>
## Implementation Decisions (autonomous defaults — override anytime)

### E11 — Creator controls
- **D-01:** Add the creator-control fields to the post/customize flow per `docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md`: who-pays (`pay_setting`), vibe-tags, the why (`why_note`), per-night radius (`search_radius_km`), exact scheduling, and per-date targeting (`target_genders`, `target_age_range`). Add a real cover-image UPLOADER (storage-backed). Add a publish CTA on the Door-2 canvas. Show a reach preview ("~N people match this in <city>") if the supporting query is cheap; otherwise defer the reach preview to Phase 4 (it depends on the targeting/filter data layer).
- **D-02:** Per-stop "regenerate one venue, leave the rest" is a STRETCH — include only if the generate-plan edge already exposes a single-stop regenerate seam; otherwise defer to P3 (E20-adjacent). Research decides feasibility.
- **D-03 (DOOR-2 PROD RE-CHECK — REQUIRED before E11 build):** `create_blank_itinerary` (migration 20260603120100) + the generate-plan edge + typed-city handling ARE applied/deployed to PROD. The 2026-06-03 live-verify "Door 2 dead-end" + "typed-city ignored" were LOCAL-only artifacts. Re-check against PROD (Supabase MCP: confirm `create_blank_itinerary` exists on `ufufmcpnysvwtutpbian`) and do NOT rebuild the blank-itinerary RPC. Build the canvas publish-CTA + creator controls on top. Reconcile §2A canvas work with the `open-city` `CreateFlow.tsx` scaffold (separate unmerged branch) — do not double-edit; treat open-city as a known parallel surface.

### E12 — Host reject + outcome surfacing
- **D-04:** `reject_candidate` RPC (DEFINER, creator-only, idempotent — copy match_make_offer pattern) sets a queue_entry to a declined/passed state. SILENT decline: the rejected candidate is NOT notified ("you were rejected" is harsh and off-brand). The candidate simply doesn't progress. Removes them from the host's active new-interest list.
- **D-05:** Surface offer OUTCOME (accepted/passed/expired) and a WITHDRAW control on the interested list (the host can see what happened to an offer + retract an outstanding one). 

### E13 — Plan on match/offer
- **D-06:** Render the FULL attached itinerary (all stops + venue names + per-stop timing/cost, reusing the existing StopCard/timeline components from the detail sheet) on BOTH `/matches/[lockId]` (LockDetail) and `/offers/[offerId]` (OfferDetail). This is the "every match has a real plan attached" payoff. Fix the live-verify finding that the offer screen's "the night" section shows only date/time (labelled-but-empty).
- **D-07:** Phase 3 renders the plan; it does NOT change the photo-led reveal ordering (that's E15/Phase 5). Keep the existing reveal tier; just add the plan.

### E14 — Offer delivery reliability
- **D-08:** GUARANTEE the in-app notification reaches the candidate (the reliability backbone — `/offers/[id]` is reachable via the inbox/notification deep-link regardless of email). Move the offer-received EMAIL off the edge runtime (blank RESEND key) to a SERVER runtime that has the RESEND key (a Next API route / server action invoked post-offer), best-effort. Add push if VAPID is configured. In-app is the guarantee; email/push are enhancements.

### Claude's Discretion
- Cover-upload storage bucket + signing approach (reuse the photo-upload pipeline pattern).
- Exact reach-preview query (or its deferral to Phase 4).
- Targeting field UI (chips vs selects) following DESIGN-SYSTEM.md.
- Where the server-runtime offer email is triggered (API route vs server action).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope source
- `docs/superpowers/reports/2026-06-03-MVP-AUDIT.md` §E (E11–E14), §B (High #11/#13/#15/#18, Med #37), §D (#2/#5/#10), §F (#4 collapse PublishToFeedButton).
- `docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md` (the creator-controls + targeting design — backs E11; §2A customization canvas).
- `.planning/REQUIREMENTS.md` (REQ-E11..E14), `.planning/intel/constraints.md` (api-contracts), `.planning/ROADMAP.md` Phase 3 (incl. the Door-2 verify-note).

### Existing surfaces to read
- `apps/web/app/nights/new/PostNightForm.tsx` (creator form to extend), `apps/web/app/create/PublishToFeedButton.tsx` (hardcoded date — collapse into the real form per F#4), `apps/web/app/create/CreateFlow.tsx` (open-city scaffold — parallel surface), `apps/web/app/plans/[id]/edit/` (Door-2 canvas).
- `apps/web/app/dates/[slug]/interested/InterestedList.tsx` (E12 reject + outcome/withdraw UI).
- `apps/web/app/matches/[lockId]/LockDetail.tsx` + `apps/web/app/offers/[offerId]/OfferDetail.tsx` (E13 plan render — currently no stops).
- `apps/web/lib/after5/match.ts` (offer email best-effort path — E14), `apps/web/lib/email/resend.ts` (RESEND wrapper), `apps/web/lib/push/send.ts`.
- The detail-sheet StopCard/timeline (`NightDetailSheet.tsx`) for the reusable plan-render components.
- `supabase/functions/match-make-offer` (offer creation), `supabase/migrations/20260527126300_p5_make_offer.sql` (DEFINER exemplar for reject_candidate).

### Design + conventions (MANDATORY)
- `docs/superpowers/DESIGN-SYSTEM.md`; `.planning/codebase/CONVENTIONS.md` (RLS, DEFINER patterns); secure-by-default; gated prod-apply (any new migrations local-only; prod gated).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PostNightForm` already has plan picker + datetime + ambient picker — extend with the remaining creator fields. `listAmbientSounds` + the new venue/ambient wiring from Phase 2 (`/my-nights`) are reuse precedents.
- `match_make_offer` (DEFINER + idempotency + advisory-lock + dispatch) = the reject_candidate exemplar.
- StopCard / per-stop timeline from `NightDetailSheet` = reuse for E13 plan render.
- The photo-upload + blur pipeline = pattern for the E11 cover uploader.
- `resend.ts` `sendEmail` works from a Node/server runtime (has the key there) — E14 moves the offer email to a server caller.

### Established Patterns
- DEFINER RPCs re-check auth.uid(); creator surfaces filter by creator_id; notifications via dispatch_notification; server-runtime email via resend.ts.

### Integration Points
- New migrations: reject_candidate (+ per-date targeting columns if not already present from Phase 2/gated). PostNightForm extension + Door-2 publish CTA. InterestedList reject/withdraw/outcome. LockDetail + OfferDetail plan render. Server-runtime offer-email trigger.
</code_context>

<specifics>
## Specific Ideas
- "Every match has a real plan attached" must hold at the payoff moment (E13) — the offer screen's empty "the night" section is the most jarring miss.
- Reject is silent + humane; the marketplace models accept AND decline, but declines aren't broadcast.
</specifics>

<deferred>
## Deferred Ideas
- Feed-side filter application + sort + reach data layer → E10/Phase 4 (Phase 3 only adds the per-date targeting FIELDS at creation).
- Experience-led / progressive-reveal offer screens → E15/Phase 5.
- Per-stop regenerate if the edge seam isn't ready → P3.
- Chat↔profile↔night cross-links → E18/Phase 6.

### Reviewed Todos (not folded)
None.
</deferred>

---

*Phase: 3-Marketplace Completeness (P1)*
*Context gathered: 2026-06-03 (autonomous defaults)*
