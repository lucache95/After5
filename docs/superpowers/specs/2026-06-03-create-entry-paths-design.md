# Create Entry Paths — Design Spec (2026-06-03)

**Goal:** Give the "+" two doors that both land on the **same §2A customization canvas** (defined in the date-settings spec): (1) **build it for me** → AI generates a night from vibe/budget/time/city → canvas; (2) **start from scratch** → an **empty canvas** → add stops via the M3.5 custom-venue Places search + manual entry → post. One canvas, two ways to fill it. Minimal new build — almost everything already exists.

**Status:** Design proposal (owner review, 2026-06-03). Task #85. NOT yet built. Companion to the date-settings spec (the canvas it converges on is §2A there) and the unified-inbox spec (shares the bottom-nav "+" decision).

---

## North star
The §2A decision already locked the **canvas** as the host's editing paradigm — a mobile-native itinerary of stop-cards + a post bar, built mostly from M3's `ItineraryEditor`. The date-settings spec also already wired a **"+"** that opens the AI generate flow → canvas → post. This spec's only job is to add the **second door**: the same "+" can also drop you onto a **blank canvas** so a host who already knows the night ("dinner at Lucia, then that rooftop bar") doesn't have to fight an AI generation they'll just overwrite. Both doors converge on the identical canvas, so there is exactly **one** edit/post surface to build and maintain.

The principle: **the "+" asks one question — "want us to build it, or are you driving?" — then gets out of the way.** Door 1 is the wedge/funnel (AI is the magic); door 2 is the power-user escape hatch that keeps confident hosts from bouncing.

## What exists today (grounded)
- **AI generate flow** (`apps/web/app/create/CreateFlow.tsx` + `page.tsx`): the fast funnel — vibe (required, emoji-paired) + budget + time-of-day + free-text city → `POST /api/create-plan` → returns gated itineraries. Authed users get the full `ItineraryView`; this is the existing "build it for me" engine. `/create` is the anon free-try funnel.
- **The canvas (M3 editor)** (`apps/web/app/plans/[id]/edit/`): `ItineraryEditor` holds editable stops/title/cover, threads mutations through pure helpers (`lib/itinerary/edit`: `addBlankStop`, `patchStop`, `removeStop`, `validateStopsForSave`), saves via the owner-scoped `update_itinerary_stops` RPC with optimistic toast + rollback.
  - `EditableStopCard` — controlled name/start-time/minutes/cost/what-to-do inputs + remove + drag grip (Reorder).
  - `CustomVenueSearch` (M3.5) — `/api/places/search` proxy (server-side Google Places, key never client-side); each result `onAdd` appends an inline custom stop (`place_id` = `custom:<googleId>`) and best-effort logs it to `custom_venue_submissions` (admin promotion queue). Handles the 503 "no key" case.
  - `handleAdd` already adds a **blank** stop (manual entry); `handleAddCustom` adds a Places result. **Both manual-add and Places-add already work in the editor today.**
  - `CoverPicker` — pick cover from stop photos.
- **Posting** (`apps/web/app/nights/new/`): `PostNightForm` lets a verified, dating-enabled host pick one of their itineraries (own or public) + ambient sound → `post_night` RPC, which **deep-copies (forks)** the chosen itinerary into a private host-owned row and points a `date_instance` at the fork (`20260602140100_m3_post_night_fork.sql`). `my-nights` links to `/nights/new` ("post a night").
- **Itinerary storage**: `itineraries` table — `stops jsonb`, `title`, `cover_image_url`, `vibe_tags`, `pay_setting`, `why_note`, `total_cost_pp`, `is_public`, `user_id`, `city_id`. `update_itinerary_stops` is owner-scoped.

So the inventory is: the AI door exists, the canvas exists, manual-add exists, Places-add exists, the fork-on-post exists. **The only genuinely new pieces are: the two-door entry screen, and a way to create an empty itinerary to open the canvas on.**

---

## 1. The "+" entry screen — the two-door choice

Tapping the bottom-nav **"+"** (the date-settings spec's MVP wires this; final placement is the shared open decision D1) opens a **full-screen two-door chooser**, not a form:

```
┌─────────────────────────────┐
│  ←                          │
│                             │
│   make a night              │   ← lowercase Caprasimo
│                             │
│  ┌─────────────────────────┐ │
│  │  ✨ build it for me      │ │   ← door 1 (primary, pink)
│  │  pick a vibe, we'll      │ │
│  │  plan the whole thing    │ │
│  └─────────────────────────┘ │
│                             │
│  ┌─────────────────────────┐ │
│  │  ✍️ start from scratch   │ │   ← door 2 (secondary, outline)
│  │  you already know the    │ │
│  │  move. just build it.    │ │
│  └─────────────────────────┘ │
└─────────────────────────────┘
```

- **Door 1 → "build it for me":** opens the **existing** `CreateFlow` input (vibe/budget/time/city → `/api/create-plan`). On generate, instead of the read-only `ItineraryView`, route the authed result onto the **canvas** (`ItineraryEditor` on the generated itinerary's id). This is the §2A flow the date-settings spec already describes — this spec just confirms door 1 *is* that flow.
- **Door 2 → "start from scratch":** create an **empty itinerary** (one blank stop) and open the **canvas** directly on it. No AI call.
- **Both land on the identical canvas** (`ItineraryEditor`), so post, edit, save, cover, targeting (the §2 "who's this for" card), and the per-stop regenerate/swap all behave the same regardless of door.

**Tier-1 Barbiecore:** `bg-shell-base`, phone-width, lowercase, pink primary CTA + outline secondary, soft `shadow-fun`, tap ≥44px. The chooser is a route (`/create` re-homed, or `/nights/new` repurposed) or a vaul sheet — see D2.

---

## 2. The blank-canvas / manual-add flow (door 2)

Door 2 needs an itinerary to edit. The canvas (`ItineraryEditor`) is keyed on `itineraryId` and saves via `update_itinerary_stops` (owner-scoped), so door 2:

1. **Creates an empty itinerary** owned by the host with one `addBlankStop` stop, `is_public=false`, `title=null`, the host's `primary_city_id`. Two ways (see D3):
   - **(a) new minimal RPC `create_blank_itinerary()`** → `security definer`, inserts an empty owned row, returns its id. Cleanest, API-first (native reuses it), and matches the secure-by-default posture (no anon, owner-scoped). **Recommended.**
   - **(b)** a thin authenticated insert under `itineraries` RLS. Avoid if `itineraries` insert RLS isn't already locked to `user_id = auth.uid()` — confirm before choosing.
2. **Opens the canvas** on the new id. The canvas already supports everything door 2 needs, today:
   - **`handleAdd`** → "add a stop" → blank `EditableStopCard` (manual name/time/cost/what-to-do).
   - **`CustomVenueSearch`** → "add a place we don't have yet" → Places proxy → `handleAddCustom` appends a real venue as an inline custom stop.
   - reorder (drag), remove, title, cover, save.
3. **Blank-state copy** matters here (the canvas opens with one empty stop): a dry, design-system-voice prompt instead of an empty grid — e.g. heading "what's the move?" / sub "add your first spot — search a place or type it in." (final copy = D4, route it through the stop-slop skill).

**Reuse vs new for door 2:** `ItineraryEditor`, `EditableStopCard`, `CustomVenueSearch`, `CoverPicker`, `addBlankStop`, `update_itinerary_stops`, `post_night` — **all reused**. New: the `create_blank_itinerary` RPC (~15 lines) + the blank-state copy + wiring the door. That's it.

---

## 3. How both doors fold into §2A (the canvas)

The §2A canvas is the convergence point. Both doors hand it an `itineraryId` and it behaves identically:

| canvas capability (§2A) | door 1 (AI) | door 2 (scratch) |
| --- | --- | --- |
| stop-cards (name/time/cost/what-to-do) | pre-filled by AI | start empty, host fills |
| add stop (manual) | ✅ same | ✅ same |
| add real venue (Places, M3.5) | ✅ same | ✅ same |
| reorder / remove | ✅ same | ✅ same |
| per-stop regenerate/swap (the §2A new magic) | ✅ | ✅ (works on any stop, AI-seeded or not) |
| cover, title, "the why" | ✅ same | ✅ same |
| "who's this for" targeting card (§2 of date-settings) | ✅ same | ✅ same |
| post (fork-on-post via `post_night`) | ✅ same | ✅ same |

The canvas does not branch on which door created the itinerary — it only sees an owned `itineraryId` with some (or zero) stops. This is why "two doors, one canvas" stays cheap: **door 2 is door 1's canvas opened on an empty itinerary instead of a generated one.**

One nuance: **door 2 must reach the post step.** Today posting lives in `PostNightForm` (`/nights/new`, pick-an-existing-itinerary). The §2A canvas is meant to gain an inline **post bar** (the date-settings spec, §2A "post bar"). Door 2 (and door 1) both post from that canvas post bar via `post_night` on the current itinerary — so `/nights/new`'s "pick a plan" list becomes redundant for the create flow (it can stay as a "repost an old night" surface; see the date-settings "post again"). Confirm the post-bar is in §2A scope (it is) so door 2 isn't stranded without a post action.

---

## 4. API-first / mobile-fast
- The only new backend is `create_blank_itinerary()` — Postgres RPC, `security definer`, owner-scoped, `revoke execute from anon`. Native reuses it verbatim.
- No new client state machine: door 1 reuses `CreateFlow`'s existing fetch; door 2 is one RPC call then a route to the canvas.
- Lean: blank itinerary is one tiny row; the canvas already saves diffs via `update_itinerary_stops`.
- Places search already proxies server-side (key safe) and is mobile-fast (one POST per search).
- Run the **security advisor after the RPC DDL**; never `USING(true)`.

---

## 5. Phased build
1. **Two-door chooser screen** + wire the bottom-nav "+" to it (coordinate with the date-settings §2A "+" — they wire the *same* button; this spec adds the chooser in front of door 1's existing generate flow). Door 1 = route the existing authed generate result onto the canvas.
2. **Blank-canvas door** — `create_blank_itinerary` RPC (gated migration, advisor after), wire door 2 → RPC → canvas, blank-state copy.
3. **Canvas post bar convergence** — ensure both doors post from the §2A canvas post bar (shared with the date-settings canvas work; sequence after §2A lands so there's no double-edit).

Phases 1–2 are small and mostly wiring. The heavy lifting (canvas, Places, post) is already built. **Coordinate ordering with the date-settings §2A phase** (that spec's phase 3 builds the canvas + "+" + per-stop regenerate) — this spec's door 2 layers on once the canvas + post bar exist; do not build the "+" twice.

---

## 6. Testing
- **DB**: pgTAP that `create_blank_itinerary` creates exactly one owned, private, empty itinerary for the caller; anon EXECUTE revoked; the row is editable via `update_itinerary_stops` (owner) and not by others (RLS).
- **Web (vitest)**: chooser renders two doors; door 2 calls the RPC then routes to the canvas; blank canvas shows the blank-state copy + one empty stop; `CustomVenueSearch` + manual `addBlankStop` both append on the blank canvas.
- **E2E (Playwright/Chromium)**: "+" → "start from scratch" → blank canvas → add a manual stop + add a Places venue → set cover/title → post via the canvas post bar → the night appears in `my-nights` and the feed. "+" → "build it for me" → generate → land on the same canvas → tweak a stop → post.

---

## 7. Open decisions (owner)
- **D1 — where the "+" lives (shared with the unified-inbox spec).** Center-raised tab in a 5-slot nav (discover · dates · **+** · inbox · profile) vs a floating FAB. **Recommendation: center-raised tab** (TikTok pattern; both specs assume the "+" exists). Settle once across both specs.
- **D2 — chooser as a route or a vaul sheet.** A full-screen route (`/create`) is shareable/back-button-clean; a vaul sheet over the current screen is lighter and more "tap +". **Recommendation: full-screen route** for the chooser, since each door then pushes its own screen (generate input / canvas) cleanly.
- **D3 — empty-itinerary creation: new `create_blank_itinerary` RPC (a) vs authenticated insert (b).** **Recommendation: (a) the RPC** — API-first (native reuse), owner-scoped, anon-revoked, one place to enforce the "blank = one stop, private, your city" invariant. Choose (b) only if confirmed `itineraries` insert RLS is already `user_id = auth.uid()`-locked and you want zero new functions.
- **D4 — blank-state copy** for door 2's empty canvas ("what's the move?" / "add your first spot…"). Route through the stop-slop skill; lowercase, dry, no "Get Started."
- **D5 — does `/create` (anon free-try) become door 1 only, or also offer door 2 to anon?** Door 2 requires an owned itinerary + verified/dating-enabled to post, so **anon should see door 1 only** (the funnel), with door 2 gated behind sign-in/verification. **Recommendation: anon → door 1 only; authed verified → both doors.** Confirm the gate copy ("sign in to build from scratch").
- **D6 — fate of `/nights/new` `PostNightForm`.** Once the canvas has an inline post bar, the "pick an existing plan to post" form is redundant for *creating*. Keep it as the **"post again / repost an old night"** surface (aligns with date-settings "post again"), or retire it. **Recommendation: keep as repost-only**, relink from the canvas.

## 8. Out of scope (YAGNI v1)
- Saving a blank-canvas draft as a reusable template (post forks the itinerary already; templating is later).
- AI assist *inside* door 2 beyond the §2A per-stop regenerate (door 2 is deliberately the manual path).
- Importing a night from a shared link / external source.
- The per-stop regenerate/swap itself (owned by the date-settings §2A spec; this spec just confirms it works identically on both doors).
