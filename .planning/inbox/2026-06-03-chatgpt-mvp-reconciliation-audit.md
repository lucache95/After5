# After5 — MVP Reality Reconciliation Audit (external input, ChatGPT, 2026-06-03)

> Captured verbatim for GSD ingestion. This is the scope/requirements input for the next milestone. **Do NOT code from this directly — it is an AUDIT brief whose output (Sections A–F) becomes the GSD roadmap.**

## Framing (the thesis)
The app was built **feature-first instead of experience-first**. Claude implemented screens/routes/buttons/flows but was never forced to continually answer "what is the user trying to accomplish right now?" and "what should happen next?" Result: dead-end pages, disconnected screens, placeholder functionality, missing lifecycle states, missing navigation paths, missing marketplace mechanics, missing creator tools, missing trust-building flows. The app feels like **a collection of screens**, not **a complete dating marketplace**. Biggest problem is NOT visual polish — it's that the product model, navigation model, and marketplace model are not fully reconciled.

## ISSUE #15 — Profile page is fundamentally wrong
The Profile page currently shows **onboarding/landing content** (how it works, examples of dates, marketing copy) instead of **user profile content**. Expected on Profile:
- **Identity:** photo, name, age, city, verification
- **Dating profile:** bio, prompts, interests, relationship goals
- **Stats:** nights hosted, matches, response rate, reviews
- **Settings:** distance, age range, notifications, privacy
- **Content:** active nights, draft nights, past nights

---

## THE AUDIT BRIEF

**You are NOT implementing code yet.** Perform a complete product, UX, navigation, marketplace, lifecycle, and MVP audit of the current implementation. Before proposing solutions: audit actual implementation; compare against intended vision; identify missing flows, dead ends, fake functionality, broken marketplace mechanics, missing lifecycle states; produce a prioritized execution queue. **DO NOT trust documentation** — audit actual routes, screens, components, navigation paths, actions, state transitions, implemented functionality.

**Product vision:** "Swipe on the date, not the face." Users browse nights → match around experiences → profiles progressively reveal → every match already has a real plan attached. The AI planner is the moat.

### Audit categories
1. **Feed experience** — card/image/title readability, tags, metadata, distance, city, filters, audio, discoverability. Known: dark title unreadable, tags missing, audio poor, city/radius missing, filters placeholder, time selector misleading.
2. **Date detail experience** — feed→detail continuity, hero image consistency, route/business/map/host rendering. Known: detail image differs from feed, route section meaningless, no map, businesses not clickable, host missing.
3. **Host identity system** — progressive reveal: pre-match (blurred image, limited profile) → match (partial reveal) → threshold (full reveal). Known: host identity missing entirely.
4. **Business object system** — businesses as first-class entities: business pages, links, venue metadata/photos, maps, website links. Known: venue titles not clickable.
5. **Discovery filters** — distance, budget, date range, city, who pays, vibe, duration. Known: filter system placeholder.
6. **Navigation graph** — identify all dead ends; user should never be trapped. Audit every page/modal/route/detail. Known: multiple dead-end screens.
7. **Date creator experience** — "Build It For Me" (missing: radius, who pays, more preferences, scheduling) AND "Start From Scratch" (missing: photos, cover image, settings, tags, sound, host options, publishing controls).
8. **Night lifecycle** — Draft / Published / Matched / Booked / Completed / Archived / Cancelled / Deleted. What exists vs not? Can host edit / unpublish / archive / delete? What happens after matches exist?
9. **Host marketplace** — "Who's Interested" flow (appears unfinished). Need complete: interested users → shortlist → accept → reject → match creation.
10. **Messaging system** — conversation UX, profile access, night access. Known: cannot navigate to profile. Expected nav: Chat→Profile, Chat→Night, Profile→Night, Night→Profile.
11. **Profile system** — see ISSUE #15. Determine what should live on profile (profile, photos, prompts, interests, settings, active nights, drafts, archived nights, stats).
12. **Marketplace state machine** — complete state diagram for User / Night / Interest / Match / Conversation / Reveal / Date / Review. Determine missing transitions.

### Required output
- **Section A — Current reality:** what actually exists.
- **Section B — Missing MVP functionality:** grouped Critical / High / Medium / Low.
- **Section C — Dead-end routes:** complete list.
- **Section D — Broken user journeys:** e.g. Browse→Match, Host→Publish, Match→Chat, Chat→Profile, Profile→Date.
- **Section E — Execution queue:** implementation order. P0 = MVP blockers, P1 = core marketplace, P2 = trust & reveal, P3 = enhancements.
- **Section F — What to delete:** screens/UI/flows/content to remove rather than fix (esp. onboarding content in profile, placeholder sections, duplicate concepts).

**Do not code yet.** First reconcile the entire product against the vision. Goal = complete MVP readiness audit + implementation queue, not incremental bug fixing.
