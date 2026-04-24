# After5 — Matching Mechanic Walkthrough

**Author:** Steven (walkthrough derived from `2026-04-23-date-engine-v2-architecture-design.md`)
**Date:** 2026-04-23
**Purpose:** Plain-language reference for how two strangers actually go from "signed up" to "on a date together" in After5. Useful for onboarding a new hire, briefing an advisor, or pressure-testing the product flow in conversation.

**TL;DR:** After5's match mechanic is **asymmetric**, not Tinder-style mutual-swipe. A creator publishes a specific date plan and gates it as "seeking." Other users swipe right on *the plan* (with only blurred-photo author hints). The creator then reviews their incoming swipes as a batch and picks *one*. The plan is the unit of attraction; the meeting activity is pre-negotiated before any profile is revealed.

---

## 1. The primitives

Three states on an itinerary drive the whole flow:

| Field | Values | What it controls |
|---|---|---|
| `visibility` | `public` / `unlisted` / `private` | Whether the date appears in the discovery feed (social content) |
| `match_status` | `none` / `seeking` / `matched` / `completed` | Whether the date is in the swipe queue as a matchable slot |
| `state` (on `matches`) | `confirmed` / `reminded` / `completed` / `cancelled` / `ghosted` | Lifecycle of a formed match |

These are **orthogonal**: a date can be public but not seeking (pure social content), or seeking but unlisted (quiet mode), or public + seeking (default behavior).

Two other primitives matter:

- **Author hints** — blurred photo + first name + age + payment preference + vibe tags. This is the only personal info visible to either party before a match is formed.
- **Clear photo reveal** — `profiles.clear_photo_url` is RLS-gated by a view that checks for an active `matches` row between viewer and target. Reveal is automatic on match formation, automatic on revoke via RLS when match state flips to `'cancelled'`.

---

## 2. End-to-end walkthrough

Concrete scenario: **Maya** (creator, 29, Kelowna) and **Jordan** (swiper, 31, Kelowna).

### Step 1 — Maya generates a date

Maya opens After5. She tells it: *"Thursday night, ~$80, I want something cozy."* The generator returns 3 plans; she picks one:

> **Wine & waterfront** · Thursday 7pm · ~$80
> Drinks at Mission Hill rooftop → tasting flight at Sandhill → dessert at Waterfront

A new `itineraries` row is inserted. Defaults:
- `visibility = 'public'` (goes into the discovery feed as content immediately)
- `match_status = 'none'`
- `moderation_status = 'pending'` (Claude Sonnet pre-publish safety classifier runs)
- `social_score` computed by LLM for content-pipeline ranking
- `context_embedding` computed for semantic feed ranking

If Maya stops here, the date is a saved plan. It may also be auto-used by the social content pipeline (Phase 6) to generate a TikTok/Reel.

### Step 2 — Maya toggles "find a match"

She hits the **find a match** toggle. This flips:
- `match_status` from `none` → `seeking`
- `match_seeking_since = now()`

The itinerary now enters the swipe-queue selection space. Overnight (or within ~5 min of toggling, depending on cache-refresh strategy), it will appear in eligible users' `feed_cache`.

**"Eligible" means**:
- Same `city_id` as the swiper's primary_city
- Swiper's age ∈ Maya's `age_preferences`
- Swiper's gender ∈ Maya's `gender_preferences`
- Maya's age ∈ swiper's `age_preferences`
- Maya's gender ∈ swiper's `gender_preferences`
- Not already swiped by this user
- Not muted/blocked
- Date is `moderation_status = 'approved'`

Filtering is **bilateral** — both parties' preferences must be satisfied. If Maya wants men 28–36 and Jordan wants women 26–32, they mutually qualify.

### Step 3 — Jordan sees the date in his feed

Jordan opens After5. His swipe queue is served from `feed_cache`, not recomputed live — cache is keyed `(user_id, itinerary_id)` with a score and TTL. The feed is ranked by some weighted combination of social_score, creator_score, venue quality_score, freshness, and embedding-similarity to Jordan's preference profile.

What Jordan actually sees:

```
┌─────────────────────────┐
│   [Cover photo:         │
│    Mission Hill sunset] │
│                         │
│ Wine & waterfront       │
│ Thursday · 7pm          │
│ $80 · 3 stops           │
│                         │
│ ──────────────          │
│ [Blurred photo] Maya    │
│ 29 · pays half          │
│ #cozy #wine #rooftop    │
└─────────────────────────┘
```

He sees:
- **Full plan**: title, cover photo, time, cost, venues, narrative
- **Author hints only**: blurred_photo_url, first_name, age, payment_preference, vibe_tags

He does **not** see: clear photo, full name, bio, Instagram handle, phone, email, exact location of Maya, or anything else.

### Step 4 — Jordan swipes

**Right swipe:**
- Inserts `swipes` row: swiper_id=Jordan, itinerary_id=Maya's-date, creator_id=Maya (denormalized for query efficiency), direction=`right`, status=`pending`, expires_at=now()+30d
- Writes `events` row (`swipe.right`)
- `notification.dispatch(maya, 'swipe', {...})` → push via APNs/FCM plus in-app badge

Maya sees: *"Someone swiped on your Mission Hill date."* No identity yet.

**Left swipe:**
- Writes `events` row only (`swipe.left`)
- No notification to anyone
- Itinerary is filtered from Jordan's future feeds (handled at `feed_cache` recompute)

Either way, Jordan sees the next card.

### Step 5 — Maya reviews her incoming queue

This is the **biggest departure from Tinder** and the key asymmetry.

Maya's `/matches/incoming` view for her Mission Hill date shows a **batch review queue**, not a swipe deck:

```
Your Mission Hill date · 3 people swiped · 27 days left

  [blurred] Jordan, 31 · pays full · #hikes #wine
  [blurred] Alex, 28 · pays half · #foodie #jazz
  [blurred] Sam, 33 · pays half · #outdoors #cozy
```

Every swiper is shown at the same hint level Maya shows them: blurred photo, first name, age, payment preference, vibe tags.

Maya picks **one**. She does not need to justify the pick. She can also:
- Decline all (all swipes → `status='declined'`)
- Leave it pending (swipes naturally expire at 30d, with a nudge 3d before)
- Pick later, once more people have swiped

### Step 6 — Match formation

Maya picks Jordan. The following happens atomically in a single transaction, protected by a Postgres advisory lock (`pg_advisory_xact_lock` keyed on `match:{itinerary_id}:{swiper_id}`) to prevent double-match races on double-click:

1. `matches` row inserted — `state='confirmed'`, `scheduled_for=Thursday 7pm`, `chat_channel_id='match_${uuid}'`
2. `swipes.status` → `'approved'` for Jordan
3. `swipes.status` → `'declined'` for Alex and Sam (implicit)
4. `itineraries.match_status` flips `seeking` → `matched` — the date leaves everyone else's feed
5. `events` writes: `match.created`, `swipe.approved`, `swipe.declined × 2`
6. Supabase Realtime chat channel `match_${match_id}` activated with RLS authorization gate on `matches` membership
7. Push notifications fire to Maya and Jordan

**Clear-photo reveal** is *not* a separate column write. It's enforced by the `profiles_v` view (§8.1 of the architecture doc) that computes `clear_photo_url` on read:

```
CASE
  WHEN auth.uid() = id THEN clear_photo_url  -- owner sees own
  WHEN EXISTS (
    SELECT 1 FROM matches m
    WHERE m.state IN ('confirmed','reminded','completed')
      AND ((m.creator_id = auth.uid() AND m.matched_user_id = profiles.id)
           OR (m.matched_user_id = auth.uid() AND m.creator_id = profiles.id))
  ) THEN clear_photo_url
  ELSE NULL
END
```

So the moment `matches` row exists in one of those three states, both clients can query `profiles_v` and see each other's clear photo. When state transitions to `'cancelled'` or `'ghosted'`, the view stops returning it on the next read (though clients may have cached bytes).

### Step 7 — Between match and the date

Chat is now open. Both parties can see:
- Each other's clear_photo_url
- Each other's full profile (first_name + bio + instagram_handle + vibe_tags)
- The date itself (which they both committed to)

They **cannot** see each other's phone, email, or exact home location — those live in `profiles_private` behind owner-only RLS.

The chat scope is intentionally narrow: *the specific date they've committed to.* There's no "hey, want to do something else?" path in v2 — the plan is already set. In practice the chat handles logistics: transportation, confirming time, exchanging a phone number if they want to.

### Step 8 — Day of the date

Inngest cron fires on match.scheduled_for - 5h (configurable):
- Push to both: *"Tonight at 7pm: Mission Hill. See you there."*
- Writes `event` row (`match.reminded`)
- `matches.state` → `'reminded'`

### Step 9 — After the date

24h after `scheduled_for`, Inngest fires a rating prompt to both independently. Each writes a `match_ratings` row:

```
did_it_happen         bool         -- single most important field
date_rating           int 1-5      -- how was the plan?
person_rating         int 1-5      -- how was the person?
would_repeat_date     bool         -- would you do this plan again?
would_repeat_person   bool         -- would you see them again?
free_text             text         -- optional
```

On submit, `matches.state` → `'completed'`. Both ratings flow to `events`.

---

## 3. The data flywheel

The post-date ratings are the **single largest quality lever in the product** (Pillar 7). Overnight, an Inngest cron aggregator reads `events` and updates derived scores:

| Derived score | Updated from | Used by |
|---|---|---|
| `places.quality_score` | Average `date_rating` on matches whose itinerary contained this venue | Generator scoring; feed ranking |
| `places.completion_score` | % of matches containing this venue where `did_it_happen=true` | Generator scoring; filters out ghost-magnet venues |
| `profiles.creator_score` | Average `date_rating` + `would_repeat_date` across all matches on their authored itineraries | Feed ranking — good creators' dates rank higher |
| `itineraries.social_score` | LLM quality + swipe-right rate + match-formation rate | Social content pipeline selection |
| `feed_cache` | Recomputed from all the above per-user every ~5 min | What the swipe feed actually shows |

**This is the moat.** The bifurcation between `date_rating` and `person_rating` is what makes the signal unique — incumbents learn "did these two people message" but not "did *this plan* work for *this pairing*." After5 learns *"Mission Hill works for first dates but not second dates," "The Laughing Owl works for introverted pairs," "Creator X picks great plans but isn't a great date themselves,"* etc.

Incumbents structurally cannot collect this data without reshaping their product.

---

## 4. What's distinctive vs Tinder / Hinge / Bumble

| | Tinder / Hinge / Bumble | After5 |
|---|---|---|
| **Primary artifact** | User profile | Date plan |
| **Match mechanic** | Mutual right-swipe, symmetric | Asymmetric — swiper swipes, creator picks one |
| **Info before match** | Full profile (photos, prompts, bio) | Plan in full + author hints only (blurred photo, vibe tags) |
| **Info after match** | Already had it | Clear photo + bio unlock |
| **Chat scope** | Open-ended. "hey" → small talk → maybe plan → maybe meet | Scoped to a specific date already committed to |
| **Commitment device** | None — message thread can die | The plan itself. Both parties already said yes to the activity |
| **Signal captured** | Swipes, messages sent | Swipes + **did-it-happen** + **date_rating** + **person_rating** |
| **Creator power** | None (peer-to-peer) | Curator-level — reviews batch, picks one |
| **Attention unit** | Endless deck | Finite queue of specific dates |

The closest structural precedent is Bumble's women-message-first mechanic, generalized: *whoever authored the artifact controls the match.* This gives creators (who in practice will often but not always be women) structural power in the interaction, which is both a safety feature and a category differentiator.

---

## 5. Edge cases the design already handles

| Case | Handling |
|---|---|
| Multiple swipers, one date | Only one match per itinerary allowed. On match formation, other pending swipes flip to `declined` atomically; itinerary's match_status flips to `matched` and leaves the feed. |
| Creator never picks anyone | 30-day expiry on pending swipes + 3-day-ahead nudge to creator. Keeps queues fresh. |
| Creator ghosts the actual date | `matches.state` can be set to `'ghosted'`. Swiper's rating marks did_it_happen=false. Creator's `creator_score` degrades. Future dates by them sink in feed ranking. Self-correcting. |
| Match is cancelled pre-date | `state='cancelled'`. Clear-photo reveal revokes on next view (RLS). Chat locked to read-only (retention policy applies). Both parties can match again with others. |
| Both parties ghost | No `match_ratings` submitted → default assumption is no-show. `places.completion_score` unchanged. Might introduce a "did anyone check in" signal later. |
| Simultaneous creator-approves-two-people-clicks | `pg_advisory_xact_lock` on `match:{itinerary_id}:{swiper_id}` serializes the insert. Only one wins; the other returns a constraint violation the UI handles gracefully. |
| Swiper changes their mind before match | No undo primitive in v2. Could add `swipes.status='withdrawn'` cheaply; currently a swiper just has to hope the creator declines them. |
| Creator changes preferences after publishing | Preference check happens on feed-cache recompute; already-queued swipes are unaffected (fair — the swiper saw and swiped in good faith). |
| Swiper swipes on multiple of same creator's dates | Allowed by schema (different itinerary_ids). Interpreted as strong signal. Creator's review queue shows all of them; she can pick at most one per date. |
| Same user is both creator (some dates) and swiper (on others') | No conflict. Each itinerary has one creator; user can have many itineraries as creator and many swipes as swiper. |

---

## 6. What's underspecified (open product questions)

These are not architectural bugs — they're product decisions deferred until user behavior emerges. Worth naming so nobody assumes they're settled.

### 6.1 Concurrent-seeking cap per creator

Schema doesn't limit how many `seeking` itineraries one user can have open at once. In theory Maya can spray 20 dates into the queue and wake up to 60 incoming swipes. Realistic cap is probably 2–3. Needed before Phase 7 launch to prevent feed pollution and review-queue overwhelm.

### 6.2 Reciprocity / "I want to go on one of your dates instead"

Current design: fully asymmetric. Swiper can only accept the exact plan the creator offered. A swiper who likes Maya but not Mission Hill has to wait for Maya's next seeking date or publish their own and hope Maya swipes.

Alternative worth considering for Y2: after match, either party can propose a reschedule to a different seeking date. Not in v2.

### 6.3 Match expiry without date-completion

If `matches.scheduled_for` passes and nobody files a `match_ratings` row, what state is the match in? Currently no auto-transition. Could add a `matches.state='abandoned'` if neither party rates within 7 days. Worth deciding before signal aggregation matters.

### 6.4 Creator compensation

If creators' dates drive matches and (eventually) bookings + partner revenue, do they get anything? Discount code kickback? Free Plus tier? Affiliate cut? Open Question in the architecture doc (§10), flagged as "needs answer by Phase 7" — I'd argue Phase 5.

### 6.5 Preference persistence across dates

Jordan's `age_preferences` + `gender_preferences` are on `profiles` — one setting per user. But a swiper's preferences for a casual wine-bar date might differ from a hiking date. Not v2 scope, but Y2 might want preferences per date type.

### 6.6 The "she declined me" moment

When Alex and Sam swipe right on Maya's date and Maya picks Jordan, Alex and Sam see their swipe "expired" with no explanation. The design avoids the emotional cost of explicit rejection by not telling the swiper they were passed over vs the date simply filled. This is a deliberate product choice worth being explicit about (and possibly A/B testing).

### 6.7 Safety / check-in flow around the date

Day-of reminder fires 5h before. Nothing fires *during* the date to check safety. A dating app in 2026 might want a "tap to confirm you're okay" flow 30 minutes after `scheduled_for`. Flagged in the architecture review (out-of-scope in v2 deferrals §9 — "match insurance / safety button — defer" — reconsider if female advisors push on it).

---

## 7. Canonical event sequence (for testing & analytics)

Full happy-path event log for the Maya + Jordan scenario:

```
itinerary.generated      actor=maya    subject=itinerary_M
itinerary.published      actor=maya    subject=itinerary_M   (visibility→public)
moderation.approved      actor=system  subject=itinerary_M
match.sought             actor=maya    subject=itinerary_M   (match_status→seeking)
feed.populated           actor=system  subject=itinerary_M   (appears in N users' feed_cache)
swipe.right              actor=jordan  subject=itinerary_M
swipe.right              actor=alex    subject=itinerary_M
swipe.right              actor=sam     subject=itinerary_M
match.created            actor=maya    subject=match_J       (picks jordan)
swipe.approved           actor=system  subject=swipe_jordan
swipe.declined           actor=system  subject=swipe_alex
swipe.declined           actor=system  subject=swipe_sam
itinerary.matched        actor=system  subject=itinerary_M   (leaves feed)
chat.opened              actor=system  subject=match_J
notification.sent        actor=system  subject=match_J  × 2
chat.message             actor=jordan  subject=match_J
chat.message             actor=maya    subject=match_J
match.reminded           actor=system  subject=match_J       (scheduled_for − 5h)
match.completed          actor=system  subject=match_J       (on first rating)
date.rated               actor=jordan  subject=match_J       (did_it_happen, ratings)
date.rated               actor=maya    subject=match_J       (did_it_happen, ratings)
```

This exact sequence should be the nightly E2E smoke test (§8.6 of the architecture doc mentions a Playwright E2E that walks generate → publish → find-match → swipe → match → chat → rate — this is the canonical spec for it).

---

## 8. One-sentence summary for an advisor or hire

> *After5 is a dating app where creators publish specific date plans and gate them as "seeking." Other users swipe on the plans with only blurred-photo author hints. The creator reviews their incoming swipes as a curator and picks one — the plan and the person are accepted together, profiles reveal post-match, chat is scoped to the committed date, and both parties rate the date and the person afterward. The ratings power a data flywheel that incumbents structurally can't collect.*
