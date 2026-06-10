# Onboarding Experience Audit — 2026-06-09 (browser-driven)

Companion to `2026-06-09-onboarding-funnel-audit.md` (the data/code audit). This one
is the **lived walk**: a fresh email through the cold landing → signup → all six
wizard steps → first feed, in a real Chromium at 420×900 against the forced-local
stack, judged against "sophisticated behind the scenes, dead simple in front."

- **Collector spec:** `apps/web/e2e/route-onboarding-experience.spec.ts`
  (`CAPTURE_ONBOARDING_AUDIT=1 CI=1 SERVICE_ROLE_KEY=… npx playwright test e2e/route-onboarding-experience.spec.ts --retries=0`)
- **Evidence:** 40 screenshots + `walk-log.json` (taps, landed URLs, probe extras,
  console/network errors) in `/tmp/onboarding-audit/`. 4 walks, all passed, 2.1m.
- **Walls and hops:** the phone step ran **for real** via a temporary uncommitted
  `[auth.sms.test_otp]` mapping (250 555 0199 → 123456; config reverted after the
  run). Persona has no local keys: the pitch screen + failure state were captured
  (shots 25/26), then service-role wrote the verdict the webhook would write.
  Persona itself is still SANDBOX on prod — already flagged, still the launch blocker.

---

## The walk (fresh email, virgin funnel)

### Getting in: cold `/` → signed in

| | |
|---|---|
| shots | 01-landing, 02-login, 03-login-sent, 04-post-auth-landing |
| taps to "in the app" | **4** (let's go → email field → email me a link → *leave for your inbox* → tap the magic link) |
| keystrokes | ~20 (the email address) |

The landing is genuinely good: one pink CTA, "match on the night, not the guy.",
polaroids that sell the premise, a quiet planner door. Two nits: the early-access
banner is an amber/rose gradient that sits outside the Barbiecore system and adds a
second door ("claim your spot →" → `/login`) above the primary one; and the hero
copy is gendered ("the guy") while preferences default woman-seeking-man — coherent
as a positioning choice, worth confirming it *is* one.

`/login` is single-purpose with **"continue with google" first** (the only 2-tap
path in). The email path costs an inbox round-trip — the first real quit point: a
distracted person who switches to Gmail does not come back tonight. The sent-state
("check your inbox… use a different email") is forgiving. After the link: straight
to `/onboarding/welcome`, no dead ends.

### Step 1 — welcome / age gate (shot 05, 06)

1 checkbox, 2 taps, zero typing. CTA disabled until ticked (empty-submit safe).
Honest progress "1 / 6". No back chip (correct — nothing before it). Double-tapping
the CTA is harmless (disables while submitting). The why is the product pitch itself.
**Stumble:** "not now" still links to `/` — the logged-out marketing page — which is
the funnel-audit F4 hostile exit, unchanged.

### Step 2 — basics (shots 07, 08, 09)

3 fields, 1 required (name): 2 taps + a name. Next disabled until name exists.
**Refresh mid-step keeps you exactly here (08); the ← back chip exists and state
survives a round-trip (name retained, walk-log 11).** Stumble: bio and vibe tags
carry no "(optional)" label — a non-reader sees three required-looking fields and
the ask triples. The placeholder bios are charming and do real work.

### Step 3 — photo (shots 10, 13, 14)

The why-copy is the best in the funnel: *"it's blurred in the feed. your clear photo
only shows up once you've both matched on a night out."* — a 12-year-old gets it.
Browser back and the back chip both land safely on basics (11, 12).

**Wall (dev-only, but found live):** the cropper rendered a blank square and "looks
good" never enabled (13, 14: `naturalWidth: 0`, console `net::ERR_FILE_NOT_FOUND` on
the `blob:` URL). Cause read from code: `PhotoCropper` creates the object URL in
`useMemo` and revokes it in the effect cleanup — React StrictMode's dev double-mount
runs the cleanup once while keeping the memoized URL, so the image source is revoked
before it loads. Production builds don't double-mount, so real users are fine — but
the photo step is **untestable in any dev/e2e environment**, and the failure mode is
silent: no error message, a forever-disabled button. Hopped via service-role.

### Step 4 — preferences (shots 15, 16, 17)

**Zero required decisions — 1 tap.** Gender/show-me pre-selected, ages 25/40,
distance 40 km. defaults>decisions done right. Today's fixes verified here:

- age input typed `19` → `19` (not `019`), deleted cleanly to empty, a careless
  `019` became `19` (walk-log 16 extras) ✅
- hard-nos helper line present: "anyone who matches one of these is an instant no
  for you." ✅
- empty-age submit blocked with friendly copy: "age range needs both numbers
  (18 to 99)." (17) ✅

**Stumble:** the hard-nos section asks 7 chips' worth of dealbreakers that the
matching SQL does not enforce (admitted in the code comment; `browse_feed_for_viewer`
never reads them). It's a deferrable ask whose answer currently does nothing.

### Step 5 — phone (shots 18–24) — ran for real

4 taps + 16 keystrokes (number + code) + waiting on a text. The why is tight:
"every number gets checked, so nobody's a ghost."

- partial number ("123") → friendly guard before Twilio: "Enter a full number with
  area code, e.g. 403 921 6616." (19)
- full number → code entry with the phone shown locked, **"use a different number"
  link, "resend in 30s" throttle** (20) ✅ today's fix
- wrong code → error; "use a different number" returns to an editable field with
  the number kept (22) ✅
- resend throttle counts down to a live "resend code"; after the resend the
  "having trouble? email hello@tryafter5.app" hatch appears (23, 24) ✅
- right code → real advance to verify

Nits: the error copy is Sentence-case in a lowercase product, and the example looks
like a real personal number (use 555). The wrong-code "checking…" state held >10s
locally before the error rendered (21).

### Step 6 — verify, the Persona cliff (shots 25, 26)

"one last thing" chip + "prove it's really you" + *"quick id + selfie check, runs
through persona. it's how we keep after5 real and confirm you're 18+."* That's a
decent DMV-form-with-a-smile, but it's sold thin for the single highest-friction ask
in the product: no time estimate, no "what happens to my id" privacy line, no payoff
preview (the feed is one screen away and the pitch never says so). Meanwhile the
teaser-feed toast elsewhere promises "takes 2 minutes" — the number lives on the
wrong screen. When the start call fails, the user sees **"Edge Function returned a
non-2xx status code"** (26) — raw infrastructure jargon in the alert.

### Step 7 — done + the payoff (shots 27, 28, 29, 30)

Today's redesign verified end-to-end:

- gate-ok branch: "verified · new" badge, "you're in.", pink **turn dating on**,
  outlined **see tonight's nights →**, quiet "home" — exactly one pink per state (27) ✅
- double-tap on "turn dating on" is harmless ✅
- after enabling: "see tonight's nights →" becomes the pink primary (28) ✅
- gate-blocked branch (walk 4, shot 38): no "turn dating on", honest card ("finish
  verifying to turn dating on."), one pink CTA ✅
- it routes to `/feed` ✅ — **and the feed said "that's everyone for now. touch
  grass and come back later." (29, cardCount: 0) with 4 compatible seeded nights
  + 13 teaser-visible nights live.** See P0-1.

---

## Adversarial probes (walks 2–4)

| probe | result |
|---|---|
| teaser feed pre-verification (32) | works read-only; real cards, "13 left" |
| heart pre-verification (33) | toast "verify to match on this night — takes 2 minutes" + **verify me** → routes to the user's true step (34) ✅ |
| pass (X) pre-verification (35) | advances locally, persists nothing (code-confirmed) ✅ |
| **is the teaser discoverable mid-funnel?** (31) | **No. Zero links to `/feed` from inside the wizard** — the teaser only exists if you type the URL |
| URL-skip every step at `age_gate` (36) | all steps render without redirect; done page stays honest-ish but see P2-1: it claims "profile complete" + "we couldn't read your date of birth from your id" when no ID was ever scanned |
| `/onboarding` index for a stalled user (37) | routes to the true step ✅ |
| refresh mid-step / browser back / back chips | all safe, state survives ✅ |
| `/home` while verification pending (39) | calm clock card, "look around" ✅ |
| `/home` gate-blocked (40) | the new gate-notice card reads intentional: branded pink wash, one action ✅ today's fix |

Console/network across all walks: clean except the two expected local walls
(Persona 502) and one PKCE-link 403 from the deliberate back/forward replay.

---

## Rubric

| dimension | score | evidence |
|---|---|---|
| time-to-value | **1.5/5** | 19 taps + ~45 keys + email round-trip + SMS + government-ID scan to the feed — which then renders **zero nights** (P0-1). The teaser would rescue this and is undiscoverable (P1-1) |
| one thing per screen | **5/5** | every step is single-purpose with exactly one primary CTA; double-taps safe |
| defaults > decisions | **4/5** | preferences = 1 tap; deferrable asks: unlabeled-optional bio/tags, 7 dead dealbreaker chips |
| why-framing a 12-year-old gets | **3.5/5** | photo and phone excellent; verify thin (no time, no privacy, no payoff) |
| forgiveness | **4.5/5** | back chips + refresh-safe + URL-skip-safe + use-a-different-number + resend; ding: silent dead-end cropper failure mode |
| honest progress | **4/5** | 1/6→6/6 truthful; dings: done still says "building your profile 6/6", "takes 2 minutes" lives on the wrong surface, skip-to-done invents an ID failure |
| the verification cliff | **2.5/5** | "one last thing" framing is right; the sell is one sentence where it needs three; raw error copy on failure; Persona still sandbox (launch blocker, known) |
| lowercase voice | **4.5/5** | consistent everywhere except validation strings ("Enter a full number…") |

---

## Findings, ranked

### P0

1. **Completing onboarding produces a structurally empty feed.** Nothing in the
   wizard (or anywhere in the dating flow) sets `profiles.primary_city_id` — the
   only writer is the planner's generate funnel (`/api/profile/city`, called from
   `CreateFlow`). `browse_feed_for_viewer` computes the viewer point as
   `coalesce(p_point, city centroid)` and gates every row on `st_dwithin(…, me.pt, …)`;
   a NULL point nulls the predicate and filters **everything**. Observed live:
   verified + dating-on user, 4 compatible seeded nights, `cardCount: 0`, "touch
   grass and come back later" (shot 29) — while a pre-verified lurker sees 13 nights
   in the teaser (shot 32). The most-committed user sees the least. Every wizard-only
   prod signup (i.e., every pure-dating user) hits this.
   **Fix (S):** set the launch city at profile creation (trigger default) or in the
   preferences save; alternatively make the RPC fall back to the default city
   centroid the way the teaser does. The real any-city answer is the v2.0 milestone;
   the S-fix unblocks launch.

### P1

2. **The teaser feed is invisible from inside the funnel.** `feedLinksVisible: 0`
   at the welcome step (shot 31). The strategic point of the teaser (funnel-audit
   F1: "see real nights is the onboarding *motivation*") is defeated — only
   URL-typers find it. **Fix (S):** one quiet "peek at tonight's nights →" link on
   the welcome and verify steps (the two highest-stall screens), and/or land
   post-signup users on `/feed` in teaser mode with the wizard as the overlay ask.
3. **The verify step undersells the biggest ask, and oversells it elsewhere.** No
   time estimate, no privacy line, no payoff preview on the screen itself (25);
   "takes 2 minutes" only appears in the feed toast (33). On failure, users read
   "Edge Function returned a non-2xx status code" (26). **Fix (S, copy only):**
   "takes about 2 minutes · your id is checked by persona and never shown to other
   members · then tonight's nights unlock" + a human failure message.

### P2

4. **Skip-to-done invents an ID failure.** A user at `age_gate` who opens
   `/onboarding/done` sees a "profile complete" badge and "we couldn't read your
   date of birth from your id" (shot 36) — no ID was ever scanned. Cause:
   `canEnableDating` checks `birthdate` before `onboarding_step`. **Fix (S):**
   reorder the checks (onboarding_incomplete first) or step-guard the done page.
5. **The photo cropper is dead in every dev/e2e environment and fails silently.**
   StrictMode's double-mount revokes the `useMemo` object URL before the image
   loads (`ERR_FILE_NOT_FOUND`, `naturalWidth: 0`, "looks good" disabled forever,
   no error shown — shots 13/14). Prod is unaffected, but local QA of the photo
   step is impossible and any real decode failure hits the same silent dead end.
   **Fix (S):** create/revoke the object URL in a `useEffect` + state keyed to the
   file; surface an error + "choose different" nudge on img `onerror`.
6. **Bio + vibe tags read as required.** No "(optional)" anywhere (shot 07).
   **Fix (S):** label them.
7. **Hard-nos chips are a dead ask.** Stored, never enforced by the feed SQL.
   Either wire them into `browse_feed_for_viewer` (M) or defer the ask out of
   onboarding until they do something (S).

### P3

8. Phone validation copy: Sentence-case + a real-looking example number
   ("403 921 6616") — lowercase it and use a 555 number (S).
9. Done step still shows "building your profile · 6 / 6" — the label should
   resolve ("profile built", or hide the bar) (S).
10. Early-access banner: amber palette off the design system + a duplicate door
    above the hero CTA (S).
11. Wrong-code verify held a ">10s checking…" state locally before erroring
    (shot 21); worth a timeout + immediate error (S).
12. "not now" on welcome → logged-out `/` (funnel-audit F4, unchanged) —
    re-point to `/my-nights` for planner-claimers (S).

### Today's fixes — regression check: **all six verified, zero regressions**

age input ✅ · hard-nos helper ✅ · back chips on 2–6 only ✅ · phone resend +
use-a-different-number ✅ · done branches honestly on the gate (both branches) ✅ ·
home gate-notice card intentional ✅ · done primary "see tonight's nights →" → /feed ✅

---

## Verdict

Per screen, this is now a genuinely well-made wizard — single asks, real defaults,
honest progress, forgiving in every direction I attacked it, with the best why-copy
("it's blurred in the feed…") living exactly where the scariest asks are. The
distracted person quits in three places, in order: at `/login`, the moment the app
sends them to their inbox and Gmail eats them (google-first mitigates, the email
path doesn't); at the verify step, where a government-ID scan is asked for with a
one-sentence pitch and no time/privacy framing before they've seen a single night
they could want; and — the cruelest one — **after winning**, when the person who did
everything right, scanned their ID, and tapped the shiny new "see tonight's nights →"
is told to *touch grass* by a feed that is empty not because supply is missing
(thirteen nights were live) but because nobody ever wrote a city onto their profile.
Right now the funnel punishes completion and rewards quitting at step one, since the
teaser shows lurkers more than verified members can see. Fix the city default
(one S-sized change), put one teaser link inside the wizard, and spend three
sentences of copy on the Persona screen — then "dead simple in front" is actually
true from the first tap to the first night.
