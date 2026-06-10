# Date Customization Canvas — Design Spec

**Date:** 2026-06-08
**Status:** SHIPPED VIA CONVERGENCE — see addendum

> **ADDENDUM (2026-06-09, user-approved):** during implementation we found the existing
> `/plans/[id]/edit` editor (`ItineraryEditor`, #85 "§2A canvas") already delivers this spec's
> canvas — and more (cover upload, stop reorder, custom venue search). Rather than ship a second,
> weaker canvas, we converged: authed generation now lands directly on `/plans/[id]/edit`, which
> gained the spec's net-new pieces — AI title "another take"/tone (new `regenerate_title` improve
> action) and the improve loop (swap/NL-tweak) for generated nights. generate-1 and `remove_stop`
> shipped as specified. The standalone `DateCanvas`/sheet components described below were built,
> reviewed, then deleted in favor of the converged surface. Product principles (one date, the
> night is the hero, no "regenerate" copy) still apply and are honored by the editor.
**Track:** A (customization flow). Track B (venue corpus) is parallel + non-blocking — see
`/.planning/todos/pending/kelowna-corpus-activation.md`.

---

## Context & goal

After5's generator already produces good Kelowna dates, but the post-generation experience is thin and
scattered across three surfaces: generate 3 candidates (`CreateFlow` results), a flat
swap/NL-tweak panel (`ImproveControls`), and a separate publish form (`/nights/new` `PostNightForm`).
Users get "close" but have no easy, unified way to make a date *theirs*, and the 3-candidate step
invites slot-machine behavior.

**Goal:** the AI drafts **one** date; the user shapes it into a night they're proud to post — and it's
live in the marketplace in ~60 seconds. The screen's hero is **the night**, not a configuration
process.

**North star:** *The AI drafts a date. The user feels like they created it.*

## Non-goals

- Perfect autonomous generation (explicitly deferred — Track B fuels quality over time).
- A multi-step wizard / progress bar / "step N of M" (rejected: makes the process the hero, depresses
  publish rate).
- Re-roll-the-whole-date as a primary action (rejected: trains slot-machine/consumer behavior instead
  of ownership).

## Product principles

1. **AI drafts, human directs, After5 polishes.** One strong draft, easy per-piece control.
2. **The night is the hero.** The screen shows the actual date (feed-card / detail form); edit controls
   are secondary chips beneath it.
3. **Customize this date — don't re-roll.** No prominent "generate another." Variety comes from
   per-piece edits (and Track B venues), not slot-machining.
4. **Optional, not forced.** Every piece is AI-filled and publishable as-is. Editing is invited, never
   required. 90% publishing beats 90% perfectly customizing.
5. **Maximize the ownership moment.** The instant a user swaps a stop, retitles, or shifts the timing,
   it stops being "the AI's date" and becomes "my night." Design *and copy* amplify that:
   - Call it **"your night,"** never "AI-generated date."
   - Label edits as **specific creative acts**, never mechanical ones. "make it more romantic," "swap
     this stop," "change the ending," "fresh cover" — not "regenerate." Specific actions feel like
     authorship; "regenerate" feels like pulling a slot machine. **The word "regenerate" must not
     appear in UI copy.**
   - Target feeling: *"I described the night I wanted, After5 made something surprisingly good, I made
     a couple tweaks, I published it."* Not *"I filled out a form."* The first creates hosts; the
     second creates abandonment.

---

## The flow

```
Set filters  →  Generate 1 date  →  Canvas (shape it)  →  Publish  →  Feed
```

The filters step is the existing generator input (vibe · budget · time · city · who-pays). On generate,
the user lands directly on the canvas for their single date — no candidate-picking step.

## Architecture — the canvas

One screen. Top = the night rendered as it will appear (cover, title/hook, ordered stops, time/price).
Beneath it, a row of **edit chips**; tapping a chip opens a **focused bottom-sheet editor** for just
that piece, which returns to the night on close. A persistent **Publish** action. No step sequencing.

```
 ← your night                         [ publish → ]
 ┌─────────────────────────────────────┐
 │            [ cover image ]          │
 │   Golden Hour & Good Conversation   │
 │     Mission Hill → Sunset Lookout   │
 │     → Gelato                        │
 │     Wed 7pm · $$                    │
 └─────────────────────────────────────┘
   make it yours
   [✏️ title] [🖼 image] [📍 stops] [💰 logistics] [👥 who it's for]
   first-run hint: "tap any chip to make it yours"
   · start over (small, quiet, confirmed) ·
```

**Component boundaries** (each independently testable):
- `DateCanvas` — owns the rendered night + chip row + publish CTA; holds the working itinerary state.
- One editor sheet per section (`TitleEditor`, `CoverEditor`, `StopsEditor`, `LogisticsEditor`,
  `AudienceEditor`) — each takes the current value(s) + an `onApply` callback, knows nothing about the
  others.
- Edits flow up to `DateCanvas`, which persists and re-renders the night.

## Generate: one date, not three

The generator currently returns 3 itineraries (`/api/create-plan` → `generate-plan`). Change the
request/response to a **single** itinerary. (Implementation note: `generate-plan` builds N candidates;
return the top 1. Confirm whether to generate-1 or generate-N-and-take-best during planning — prefer
generate-1 for cost/latency unless best-of-N meaningfully lifts quality.)

## The five editable sections

Each: **today / new work / controls / persistence.**

### 1. Title & hook
- **Today:** Claude writes title + hook at generation; no edit control. NL-tweak can shift tone of the
  whole night.
- **New:** a focused title/hook regenerate.
- **Controls (UI copy):** `another take` (fresh title/hook over the same stops) ·
  `more romantic / playful / casual` (tone shift) · `write my own` (manual). No "regenerate" wording.
- **Persistence:** writes title/hook to the itinerary row immediately.

### 2. Cover image
- **Today:** `generate-cover` (FLUX) produces a cover; no in-flow control.
- **New:** surface regenerate + pick-from-venue-photos.
- **Controls (UI copy):** `fresh cover` (new FLUX image) · `use a venue photo` (any stop's photo as the
  cover). **Deferred:** upload-your-own (v1.1). No "regenerate" wording.
- **Persistence:** writes `cover_image_url` to the itinerary row.

### 3. Stops
- **Today:** per-stop `swap_stop` (deterministic re-pick) + the whole-night NL tweak exist in
  `ImproveControls`. Swaps re-validate proximity/budget/hours server-side; incoherent results surface as
  a toast, never a silent swap.
- **New:** search a *specific* venue by name (near the city) and insert it; add / remove a stop.
- **Controls (per stop, UI copy):** `swap this stop` (exists) · `find a specific spot` (search, new) ·
  `drop this stop`. Plus `add a stop`. Copy idea: frame swapping the *final* stop as
  **"change the ending."** **Deferred:** manual reorder (v1.1).
- **Persistence:** via the existing improve dispatch (`update_itinerary_stops`), which re-validates
  coherence. Search/add must run the same proximity/budget/hours validation as swap.

### 4. Logistics
- **Today:** `PostNightForm` already collects date/time, who-pays, budget, radius.
- **New:** present those fields in a canvas sheet (reuse the existing field logic + validation).
- **Controls:** date/time · who pays · budget · radius.
- **Persistence:** held as the publish payload → applied to the `date_instance` on publish (these are
  night-instance attributes, not itinerary-template attributes).

### 5. Who it's for + host note
- **Today:** `PostNightForm` collects audience targeting (age/gender reach) + a "why" note.
- **New:** present in a canvas sheet (reuse existing field logic).
- **Controls:** age/gender reach · "why I picked this" note.
- **Persistence:** publish payload → `date_instance` on publish.

## Publish

A persistent **Publish** action on the canvas creates the live night from (a) the customized itinerary
(title/cover/stops, already persisted) + (b) the logistics/audience publish payload → a `date_instance`
on the feed. Mirrors today's `PostNightForm` submit, just initiated from the canvas.

## Restart (no re-roll)

A small, quiet **start over** affordance returns to the **filters** step (not a one-tap re-roll on the
canvas) and confirms first ("you'll lose your tweaks"). Deliberately low-prominence to discourage
slot-machining.

## Data flow & persistence model

- **Itinerary-level edits (title, cover, stops)** persist to the itinerary row immediately (stops via
  the coherence-validating improve dispatch). The itinerary is the reusable *template*.
- **Logistics + audience** are collected on the canvas and applied at **publish**, creating the
  `date_instance` (the published night with when/who). This matches the existing template-vs-instance
  split.

## Error handling

- **Incoherent stop change** (swap/search/add breaks proximity/budget/hours): server returns
  `{ ok:false, issues }`; surface the first issue as a toast; never apply a silent/broken change
  (existing behavior — preserve it for the new search/add paths too).
- **Cover/title regenerate failure:** toast, leave the prior value intact.
- **Generation failure / cold result:** existing error copy ("that one slipped away. try again?").
- **Publish validation failure:** inline on the relevant chip's sheet (reuse `PostNightForm` validation).

## MVP scope

**In:** generate-1; the canvas with 5 edit chips + bottom-sheet editors; title regenerate/tone/manual;
cover regenerate + pick-venue-photo; stop swap (exists) + search-specific-venue + add/remove; reuse
`PostNightForm` logistics + audience; publish from canvas; quiet confirmed restart; first-run hint.

**Cut:** separate vibe/tags step (vibe is set in filters up front).

**Deferred (v1.1):** upload-your-own cover image; manual stop reordering; a richer guided nudge if data
shows first-timers stall.

## Testing

- **Unit (RTL):** each editor sheet in isolation (controls render, `onApply` fires with the right
  payload, failure → toast + no change). `DateCanvas` renders the night + chips and reflects an applied
  edit.
- **Integration (RTL, mocked generation):** generate-1 → canvas shows the night → edit title → edit a
  stop (coherent + incoherent paths) → publish creates a night. No live LLM/Foursquare.
- **Coherence:** assert search/add a venue runs the same proximity/budget/hours validation as swap and
  rejects incoherent results.
- **Visual-verify @420px** (per repo convention): the canvas, one open editor sheet, the first-run hint.

## Dependencies

- **Track B (venue corpus) — non-blocking fuel.** The canvas works on today's corpus; more venues simply
  make `swap` / `search` / `add` feel fresher. Captured separately
  (`kelowna-corpus-activation.md`): activate the 120 drafts, add sunset/viewpoint inventory, fill the
  ChatGPT-flagged type gaps. Can run in parallel (another chat or here) without gating this work.

## Open implementation decisions (resolve in planning)

1. **Publish on canvas vs. route to `/nights/new`.** Preferred: fold logistics/audience into canvas
   sheets (reusing `PostNightForm` field logic) and publish from the canvas — one unified surface. If
   that integration proves heavy, acceptable MVP fallback: canvas owns title/image/stops, and a
   "publish" CTA routes to the existing `/nights/new` for logistics/audience + publish. Decide based on
   how cleanly `PostNightForm`'s fields extract into sheets.
2. **generate-1 vs best-of-N.** Prefer generate-1 for cost/latency; revisit only if best-of-N
   measurably lifts draft quality.
3. **`search a specific venue`** source: the curated/warmed `places` corpus first; whether to also hit
   live Foursquare/Google search for not-yet-ingested venues is a planning call (ties to Track B + the
   Google-seed decision).
