# After5 — Experience-First Dating: Core Loop Design

**Date:** 2026-05-25
**Status:** Draft v1 — core consumer dating mechanic from the 2026-05-25 brainstorm (create → browse → match → lock → rate)
**Author:** Lucas Senechal (w/ Claude)
**Related specs:**
- `2026-04-23-date-engine-v2-architecture-design.md` — platform architecture, schema, multi-city scaffolding. This doc builds on it.
- `2026-04-23-date-plan-generator-deep-dive.md` — the generation pipeline that produces a date's "first draft."
- `2026-04-23-matching-mechanic-walkthrough.md` — earlier matching flow; extended/superseded where noted here.

---

## 1. Executive Summary

After5's content object is a date plan, and its long-term form is a dating app where people swipe on **nights, not faces**. This document specifies the **core consumer loop** of that dating product: how a user creates a date, how others discover and express interest in it experience-first (blind to the creator), how the creator selects, how a match resolves into a single locked night, and how trust is maintained through verification and reliability ratings.

North star / one-liner: **"Choose the night. Meet the person after."**

Scope note: this spec covers product mechanics and the states they imply. It does **not** re-specify the generation pipeline (see generator deep-dive) or the full platform schema (see date-engine-v2).

---

## 2. Thesis & Design Pillars

**The format is the problem.** A conventional dating app reduces a human to a photo and asks for a half-second judgment. That single choice — *the photo as the unit* — cascades into every failure mode: the most photogenic win over the most compatible; snap judgments replace real evaluation; free, frictionless matches are hoarded and never acted on; and a "match" dumps two strangers into an empty chat to manufacture chemistry. Ghosting, flaking, and burnout are the predictable output, not bugs.

After5 inverts the unit: **you swipe on the night.** The pillars that constrain every downstream decision:

1. **Experience-first.** The date is the profile. The creator's face is revealed only after mutual interest.
2. **Symmetric marketplace.** Everyone both creates dates and swipes. Every user is simultaneously supply and demand — the structural answer to marketplace liquidity.
3. **AI sets the floor; the human sets the ceiling.** Generation guarantees a competent baseline date; personalization is where attraction (the "courtship") actually happens.
4. **A match is a plan, not a chat.** Matches resolve to a single, scheduled, off-market night.
5. **Kind by design.** Non-selection reads as "the night filled up," never "you weren't attractive enough."
6. **Safe by structure.** Public, vetted venues + verified identities + behavior-based reliability — not surveillance.
7. **The planner is the wedge, not a side feature.** The single-player planner builds the audience, taste data, venue database, and local density the dating layer requires.

---

## 3. The Core Loop

```
Create → Publish → Browse (blind) → Shortlist → Reveal + Demand → Lock → The Night → Rate
```

1. **Create** — generate a strong draft from the vetted venue DB, then personalize.
2. **Publish** — the date enters the marketplace as the creator's "profile." Face not shown.
3. **Browse** — others scroll open dates (ambient sound plays), blind to the creator; swipe right = "I want this night."
4. **Shortlist** — the creator sees who raised their hand (profile + reliability), and right-swipes several.
5. **Reveal + Demand** — right-swiped users become *matched & pending*: creator's profile opens to them, chat opens, and a demand signal is shown.
6. **Lock** — a ranked pending queue resolves to one confirmed person; the night locks and leaves the market.
7. **The Night** — the pair meets at a real, public, vetted venue.
8. **Rate** — both parties rate reliability & conduct; scores follow them forward.

---

## 4. Date Object Model

Two related forms (hybrid model):

- **Evergreen date idea (template).** Browsable, always matchable, low creation effort. Builds a personal library. The default published form.
- **Scheduled instance ("lit up").** A specific dated night derived from an evergreen idea ("I'm doing this Friday — who's in?"). Carries urgency and is the natural hook for **live events** (e.g., a show that night).

Fields on a date:
- **Venues** — drawn only from the vetted venue DB (LLM never invents places; see generator deep-dive).
- **Vibe / theme**, the **"why" note**, an **opener**, a **place photo**, an **ambient sound**.
- **Pay setting** — `I pay` / `they pay` / `50-50`. Resolves the most common unspoken first-date ambiguity up front.
- **Capacity** — 1 seat (1-on-1) for v1.

**Live-events sourcing (for scheduled instances):** Ticketmaster Discovery API is the primary viable source. Eventbrite's public search is restricted. Kelowna-local events likely require Tourism Kelowna or light scraping (sourcing/licensing is an open question — §11).

**Relationship to the generator:** the generator produces the first draft (the floor); the user's edits are the personalization layer (the ceiling). This spec treats the generator as a black box.

---

## 5. Browsing & Interest (experience-first)

- A feed of open dates; each plays its **ambient sound** as it surfaces, so the night is *felt*, not just read.
- **The creator's identity is hidden** — no face, no name. The browser sees only the night: venues, vibe, the "why," place photo, pay setting, and (for scheduled instances) the date/time.
- **Swipe right** = "I want this night." **Swipe left** = pass.

---

## 6. Creator Shortlist & Selection

- The creator sees everyone who swiped right on their night: each shows **profile + reliability score + verified badge**.
- Intentional asymmetry: the *browser* judged the night blind; the *creator* now vets the responders. This mirrors real life — you float a plan, people show interest, you choose.
- The creator can right-swipe **several** responders, forming a **ranked pending queue**.

---

## 7. Match, Reveal & Demand

- Each right-swiped person becomes **matched & pending**: the creator's profile opens to them (they can "creep" it) and a **chat opens**.
- A **demand signal** is shown to pending users: *"you + N others are pending for this night."*
- Rationale: honest social proof. It re-anchors the decision on the experience and prevents a pending user from bailing the instant they see the creator's face — the night is visibly wanted.

---

## 8. Locking the Night — the ranked queue

The back half of the loop is **one ordered queue** doing three jobs at once.

- The pending queue is **ordered by the creator**.
- The **#1** receives an **exclusive, time-boxed offer**: *"they want to lock this night with you — confirm by [T]."* Confirm → the night **LOCKS and comes off the market**. Pass or expire → it **auto-rolls to #2**.
- Non-selected pending users remain **standby, in order**. If the holder passes, or the locked match cancels before the night, the seat **auto-rolls to the next standby**.
- Framing is kind: a non-selected user sees *"this night filled — you're next in line if it opens,"* plus the creator's **other open dates** and **similar nights**, never a cold rejection.

This single mechanism: (1) selects the winner, (2) softens rejection, (3) handles flake/relist without re-matching from scratch.

---

## 9. The Night & Trust/Safety

- **Venue-anchored.** First meetings happen at real, public, vetted venues — never a private residence. The product is structurally safer than a blind coffee with a stranger.
- **Identity verification (day one).** Phone + a selfie matched to the profile establishes a real, accountable person and blocks throwaway accounts created after a bad review. New users display **"Verified · New."**
- **Reliability rating (not desirability).** After a locked night's scheduled time passes, **both** parties rate one axis only: did they show up, on time, respectful, safe. Never attractiveness or "how good a date." This preserves the anti-superficiality thesis and keeps the system fair.
- **Guardrails:** ratings solicited only after a locked night has passed (you cannot rate someone you never met); require a minimum number of ratings before a score "counts"; weight recent ratings; bidirectional (the host is rated as much as the guest, closing the power asymmetry from §6/§8).
- The reliability score rides along into future shortlists (§6).

---

## 10. Strategy & Go-to-Market Risks

- **Planner-as-wedge sequencing.** Ship the single-player planner first (instant day-one value, no liquidity dependency). Turn on the dating layer per-city only once that market has density. The planner solves the dating app's cold-start.
- **Build multi-city-capable, launch single-city.** Key all data by city in the model, but go to market one city at a time and concentrate density. Splitting scarce early users across cities creates N dead rooms.
- **Existential risk: local dating liquidity / cold-start.** This is the hardest problem in consumer tech and pits After5 against well-funded incumbents. Open question: whether Kelowna metro (~150–220k) is dense enough for the *dating* layer to ignite. Kelowna can prove the *mechanic*; the network may need a denser launch market.
- **Heavier operations than the planner:** trust & safety, moderation, and real-world-meeting liability are ongoing burdens the planner never carried.

---

## 11. Open Questions

1. **Capacity** — always 1-on-1, or support group/double-dates later? (v1 assumes 1-on-1.)
2. **Lock-offer window** — how long does the #1 hold an exclusive offer before it rolls (e.g., 24–48h)? Decide via testing.
3. **Liquidity threshold** — what concrete metric (active daters per city, dates published/week, swipe volume) gates enabling the dating layer in a city?
4. **Live-events sourcing** — confirm Ticketmaster Discovery integration; identify a Kelowna-local source and its licensing.
5. **Premium model** — custom ambient sound, "who liked your night," boosts. Out of scope here; spec separately.

---

## 12. Out of Scope (this spec)

- Generation pipeline internals — see generator deep-dive.
- Full platform schema and multi-city infrastructure — see date-engine-v2.
- Monetization design, growth/marketing strategy, and the native mobile build.

---

## 13. Glossary

- **Night / date** — the content object users swipe on: venues + vibe + "why" + photo + ambient sound + pay setting.
- **Evergreen idea** — an undated, always-browsable date template.
- **Scheduled instance** — a specific dated night derived from an evergreen idea; carries urgency and live-events.
- **Pending queue** — the creator-ordered list of right-swiped users awaiting a lock offer.
- **Lock** — mutual confirmation that takes the night off the market and turns it into a real plan.
- **Standby** — non-selected pending users, held in order to auto-fill if the seat opens.
- **Reliability score** — a behavior-only rating (showed up, conduct), distinct from desirability.
- **Experience-first** — the principle that users evaluate the night before (and instead of) the person's face.
