# Context Intel

> Synthesized 2026-06-03 by gsd-doc-synthesizer.
> DOC-typed running notes keyed by topic, with source attribution. The
> LIVE-NAV-VERIFY DOC carries per-doc precedence 0 (highest) — its live
> verdicts override the static MVP-AUDIT on the specific points it walked.
> Where the orchestrator issued an authoritative correction (prod-vs-local),
> the corrected value is recorded here and surfaced in INGEST-CONFLICTS.md.

---

## Topic: Product thesis — feature-first, not experience-first
- source: .planning/inbox/2026-06-03-chatgpt-mvp-reconciliation-audit.md; docs/superpowers/reports/2026-06-03-MVP-AUDIT.md
- The app was built feature-first instead of experience-first: screens/routes/buttons/flows exist but were never forced to answer "what is the user trying to accomplish right now?" and "what should happen next?". Result: dead-end pages, disconnected screens, placeholder functionality, missing lifecycle states, missing navigation paths, missing marketplace mechanics, missing creator tools, missing trust flows. It is a collection of strong screens, not a complete dating marketplace. The biggest problem is NOT visual polish — it is that the product, navigation, and marketplace models are not fully reconciled.
- Vision (verbatim): "Swipe on the date, not the face." Browse nights → match around experiences → profiles progressively reveal → every match already has a real plan attached. The AI planner is the moat.

## Topic: Live-nav verification method + reachability caveats
- source: docs/superpowers/reports/2026-06-03-LIVE-NAV-VERIFY.md
- Method: live Playwright walk of three roles (anonymous, logged-in swiper, logged-in host) against the LOCAL Supabase stack + `pnpm dev`. Read-only; no source committed.
- KEY CAVEAT: ran against the LOCAL stack. Prod r2host/r2cand accounts could not be used (harness hard-wired to local), so demand/supply state was re-seeded, not replayed from prod. Local env has a BLANK RESEND key (surfaces as an offer-delivery caveat, not a nav break).
- Verdict tally — Combined: 19 CONFIRMED, 2 WORSE, 1 NOT_REPRO, 7 UNREACHED, + 6 new issues.
- Section C (14 dead-ends): 7 CONFIRMED, 1 WORSE (C12), 1 NOT_REPRO (C10), 5 UNREACHED (C2,C3,C5,C6,C9).
- Section D (17 journeys): 12 CONFIRMED + 2 indirect (D3,D17), 1 WORSE (D2), 2 UNREACHED (D13,D16).

## Topic: UNREACHED items are assertions, not verified facts
- source: docs/superpowers/reports/2026-06-03-LIVE-NAV-VERIFY.md corrections; PROJECT.md Key Decisions
- UNREACHED items (C2, C3, C5, C6, C9, D13, D16) are guard/error/lifecycle/safety states a happy-path walk cannot trigger. They remain assertions from the static read, NOT live-verified. Confirm them in code before queuing fixes. The fixes still map to the same E-items (mostly E1 nav-chrome, E5 lifecycle, E19 safety, E4 preferences).

## Topic: Six new issues found live (not in the static audit)
- source: docs/superpowers/reports/2026-06-03-LIVE-NAV-VERIFY.md
1. Offer screen "the night" is labelled-but-empty (actively misleading) — shows only date/time, no stops/venues. → folded into E13.
2. Possible lost-swipe race in the detail-sheet "i'm in" path — `recordSwipe` may fire against the wrong/advancing card; a `queue_entry` sometimes did not land for the displayed night. Worth a closer look; NOT yet an E-item. (flag for investigation)
3. `/account` is a real, well-built host hub but nav-orphaned — resolves ISSUE #15 cheaply via a profile-tab repoint + profile-view. → makes E3 cheap (D12).
4. Four marketplace RPCs absent from the running (local) DB: `create_blank_itinerary`, `reject_candidate`, `update_night`, `cancel_night`. AUTHORITATIVE CORRECTION: `create_blank_itinerary` IS applied on PROD; only `reject_candidate`/`update_night`/`cancel_night` are genuinely absent on prod (E12/E7/E6).
5. Brand-serif regressions (legacy Fraunces) on `/create` PolaroidLoader, `/login` wordmark + heading, `/about` + `/tell-us` headings. Corroborates the 2026-06-02 brand-alignment audit. NOTE: PROJECT.md lists the brand sweep as shipped — these residual serif spots are a follow-up, not a re-queue of the whole sweep.
6. Anon `/create` ignores the typed city (typed "New York, NY" → generated "kelowna"). AUTHORITATIVE CORRECTION: this is a LOCAL-ONLY artifact; typed-city handling is live on prod — re-check against prod, do not rebuild.

## Topic: Top 3 critical gaps (the headline)
- source: docs/superpowers/reports/2026-06-03-MVP-AUDIT.md Section B CRITICAL; PROJECT.md Context
1. Progressive reveal does not exist — binary gate; the blur pipeline is orphaned; the feed carries ZERO host presence. → E15 (single highest-leverage vision item).
2. The loop never closes — locks never reach `completed`; ratings compute nothing. → E5 + E17.
3. The match screen shows the person but not the plan, and hosts get no notification on right-swipe. → E13 + E8.

## Topic: What already exists and works (Section A — do not rebuild)
- source: docs/superpowers/reports/2026-06-03-MVP-AUDIT.md Section A; PROJECT.md Validated
- Strong, recently redesigned: feed/browse (framer-motion SwipeDeck, photo-led NightCard with the dark-title bug FIXED, vibe sticker chips, ambient Web Audio crossfade deck, swipe persistence via `record_swipe`, `browse_feed_for_viewer`).
- Blind-safe night detail (`get_night_detail`): hero + chip facts + per-stop photo timeline; blind contract enforced end-to-end.
- Binary post-match reveal works (RLS `match_reveal_allowed`/`_pair`; `/matches/[lockId]` → RevealModal → ProfileCard; offer-screen pre-lock reveal).
- Host marketplace happy path real and well-built: interested → shortlist (draggable, realtime) → make-offer → accept/pass/withdraw → lock; reciprocal double-host resolution; auto-roll standby promotion. The most complete dating surface.
- Two creation doors: Door 1 (`/create/generate` → AI funnel → PublishToFeedButton), Door 2 (`create_blank_itinerary` → ItineraryEditor); `post_night` forks the itinerary to a host-owned copy; `/nights/new` PostNightForm. (Door 2 is live on prod per correction.)
- Venues first-class as CONTENT: `/places/[slug]`, `/places` catalog, Google enrichment, custom-venue queue + admin QA. (But severed from the dating loop — E21.)
- Chat engine solid: unified `/inbox`, `Conversation` (optimistic send, realtime, mark-read, report), combined unread badge. (But wiring to profile/night absent — E18.)
- Profile editor at `/account/profile`, notification prefs at `/account/notifications`, account hub at `/account`, onboarding preferences capture. (But nav-orphaned/mislabeled — E2/E3/E4.)

## Topic: Resolved contradictions from the audit's own synthesis
- source: docs/superpowers/reports/2026-06-03-MVP-AUDIT.md Synthesis notes
- "Dark title / tags missing / poor audio" → genuinely FIXED in current feed code; do not re-queue.
- "Venue titles not clickable / no business pages" → half-wrong; full business pages + clickable titles exist on the PLANNER side; the real problem is structural severance from the dating loop (E21, F11).
- "Host identity missing entirely" → the binary gate is built and works; the progressive ladder + feed-tier limited reveal do not exist (E15).
- Lifecycle is a 3-state machine (`seeking`↔`matched`→`cancelled`), NOT the 8-state spec. The intentional gap is the back half (completed → reviewed → reliability), in P0 E5 + P2 E17. PROJECT.md confirms the 3-state machine is intentional; only the back half is in scope.

## Topic: ISSUE #15 expected profile contents (PRD acceptance shape)
- source: .planning/inbox/2026-06-03-chatgpt-mvp-reconciliation-audit.md
- The profile page currently shows onboarding/landing content instead of user profile content. Expected: Identity (photo/name/age/city/verification); Dating profile (bio/prompts/interests/goals); Stats (nights hosted/matches/response rate/reviews); Settings (distance/age range/notifications/privacy); Content (active/draft/past nights). → drives E3 acceptance.

## Topic: 12 audit categories (PRD scope checklist)
- source: .planning/inbox/2026-06-03-chatgpt-mvp-reconciliation-audit.md
- The brief defined 12 audit categories: feed experience, date detail, host identity system, business object system, discovery filters, navigation graph, date creator experience, night lifecycle, host marketplace, messaging system, profile system, marketplace state machine. The MVP-AUDIT Sections A–F are the output of this brief and become the GSD roadmap. The brief is an AUDIT brief — do NOT code from it directly.

## Topic: Date-settings SPEC north star + experience upgrades
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §North-star/§4
- North star: matches on the night, not a photo or a database query. Governing principle: filters remove dealbreakers, then get out of the way. Over-filtering empties feeds and kills two-sided marketplaces — every decision is biased toward keeping the feed liquid and serendipitous.
- Four experience upgrades, all in scope: (1) soft-boost + "looking for someone like you"; (2) reach preview for hosts (liquidity protection); (3) inclusive defaults + friendly empty state (anti-cold-start); (4) light filters + attainability + "post again".
- Status: design approved in brainstorm (owner, 2026-06-03); NOT yet built. Next step was implementation plan via writing-plans — now folded into E10 + E11.

## Topic: Date-settings phasing + fleet overlap (sequencing hazard)
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §7
- Phasing arc (each its own spec→plan→build): (1) DB foundation (columns, feed_filters, signature changes, reach_preview, indexes, RLS, backfill — gated prod migration, security advisor after DDL); (2) Host settings UI; (3) date-customization canvas §2A + "+" entry + per-stop regenerate; (4) searcher filter sheet + feed query; (5) card labels + interested-list curation.
- MVP-first ordering within the arc: the §2A canvas + per-stop regenerate is the highest bang-for-buck (mostly reuse + the one magic add) and a strong standalone MVP; §2 targeting / §3 filters layer on without rework.
- ⚠ HAZARD: SPEC §7 step 2 OVERLAPS the open-city scaffold the fleet is currently building into `CreateFlow.tsx`. Reconcile AFTER the fleet lands; do NOT double-edit `CreateFlow.tsx` concurrently. (E11 dependency note.)

## Topic: Out-of-scope guardrails (do not queue)
- source: PROJECT.md Out of Scope; orchestrator correction #3/#4; date-settings SPEC §9
- Native mobile apps — parked (web-first). The architecture is prepared (D6/CON-api-first), the app itself is parked.
- Legacy AI-planner-as-standalone-product framing — the planner is the moat/wedge inside the dating marketplace, not a separate product.
- Re-fixing already-shipped feed issues (dark title, missing tags, poor audio) — genuinely FIXED.
- Business-ownership / merchant claim model beyond a stub — deferred to P3+.
- Full 8-state night lifecycle as originally specced — the 3-state machine is intentional; only the back half is in scope.
- Already shipped & live this cycle (do not queue): brand sweep, image pipeline, unified inbox + nav, create chooser, the 4 mobile-UX redesigns, audio + ownership fixes, SEO assets, open-city.
- Gated/parked (not active blockers): inbox notification-type dispatch wiring is in-scope (E8/E16), but the enums are already applied; #77 venue photos, #78 per-vibe ambient, #86 cover-consistency stay gated.
- SPEC §9 YAGNI for v1: precise geolocation (city-centroid v1), native app build, paid/boosted placement, advanced ML ranking (soft-sort is deterministic SQL v1).
