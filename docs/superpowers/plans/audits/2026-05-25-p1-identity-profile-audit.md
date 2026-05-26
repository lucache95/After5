# CRITICAL MISSING SYSTEMS

**1. There is NO Persona Inquiry creation / start-verification path. The whole verify flow has no front door.**
The plan ships a `persona-webhook` that *receives* a verdict, but nothing *starts* an Inquiry. `api-client/src/profile.ts` is documented to export `startVerification` (File Structure, line 61) but Task 9 never implements it — it only implements `savePreferences`, `upsertProfile`, `getMyBadge`, `revealCreator`. There is no Edge Function, RPC, or client call that (a) creates/embeds a Persona Inquiry, (b) sets `reference-id = profiles.id`, or (c) inserts the initial `verifications(kind='age', state='pending')` row. The plan defers "the Persona embed (template id, environment keys)" to "a later UI task" (line 1579, Assumption 5) but that UI task does not exist in any phase plan. **Result: a verified-only product where no user can ever become verified, because nothing ever opens an Inquiry.** The webhook will never fire because no Inquiry is ever created.

**2. Phone OTP verification has no implementation and no `verifications` write-back.**
The Architecture says "Phone OTP rides Supabase Auth's native phone provider" and the rollup (Task 5) requires `kind='phone', state='verified'` for a profile to become `verified`. But NO task writes that row. Assumption 2 (line 1590) admits "a small web/edge step writes it on successful `auth.verifyOtp` — that thin write lives in the onboarding UI task." That task is not in this plan or any sibling. Worse: a client-side write of `verifications(kind='phone', state='verified')` directly contradicts P0's RLS — P0 line 211 explicitly says "writes are service-role only (verification vendor webhook); no insert/update policy." So the client *cannot* write the phone row, and no server function exists to do it. **The phone half of the AND-gate can never be satisfied → no one is ever `verified` → dating_enabled can never be set → the entire app is dead at launch.**

**3. Appeal flow is a named enum value with no machinery behind it.**
The header (line 20) and Self-Review (line 1570) tout `appeal` as the spec-required state. The enum gets the value (Task 2) and the rollup propagates it (Task 5: `elsif ... = 'appeal' then result := 'appeal'`). But there is **no way to enter appeal** (no `inquiry.*` event maps to it — Task 6 only emits `verified|failed|pending`), **no appeal submission RPC/endpoint, no appeal review surface, no notification, and no resolution path back to verified/failed.** The moderation/verification-review console is P8, but nothing in P1 or P8 references writing `verifications.state='appeal'` or reading it. Appeal is decorative — a dead state that the data model supports but no flow can reach or exit.

**4. No verification-failure user experience or notification.**
When Persona declines (`inquiry.declined → failed`), the rollup demotes `profiles.verification='failed'`. Then nothing happens. There is no notification (P2's frozen `type` enum has zero verification events — confirmed: `offer_received, offer_expired, standby_promoted, pending_expired, date_auto_closed, day_of_reconfirm, safety_check_in, lock_confirmed, new_interest, cancellation`). There is no "retry verification" path, no failure-reason surfacing to the user, no support route. A failed user is silently stuck with no UI feedback and no way forward — and the appeal state that should rescue them is unreachable (see #3).

**5. No clear-photo signed-URL minting — the reveal returns a URL the candidate cannot open.**
`offer_reveal_for` returns `clear_photo_url` as a raw text column (line 1337). But the `profile-photos` bucket is **private** and the migration deliberately ships **no storage policy** for `clear.jpg` (line 1303: "No blanket policy exposes clear.jpg; the offer RPC mints a signed URL"). The plan punts signed-URL minting to "P5's offer RPC" (line 1591, Assumption 3). But P5's reveal mechanism is a *completely different function* (`match_reveal_allowed` predicate, see DEAD UI #1) and P5's plan never mentions minting a signed URL for `clear.jpg` either. **Net: the offer-holder receives `clear_photo_url` pointing at a private object they have no policy to read and no signed URL for → the reveal photo is a broken image in production.** The single most important privacy/UX moment (the face reveal at offer) does not actually work.

---

# DEAD UI / FAKE INTERACTIONS

**1. `offer_reveal` is an orphaned, wrong-grain duplicate of P5's reveal — and it self-destructs at lock.**
P1 builds `offer_reveal(target uuid)` keyed on `(offers.creator_id = target, offers.candidate_id = auth.uid(), offers.status = 'active')`. P5 builds the *authoritative* reveal as `match_reveal_allowed(viewer, instance)` keyed on the **date_instance** holding the active offer. These are two competing reveal systems with different grains:
   - P1 keys on **creator profile id**; P5 keys on **date_instance id**. A creator with two simultaneous offers on two different nights would have P1's predicate reveal them to *both* candidates the moment either offer is active — leaking identity to a candidate whose specific night did not get the offer. P5's per-instance grain is correct; P1's per-creator grain is a privacy leak.
   - **P1 keys reveal on `status = 'active'` ONLY.** P5 Task 5 (line 719) flips the offer to `status = 'accepted'` at lock. So the instant the candidate confirms/locks — the exact moment full identity should be permanently theirs — **P1's `offer_reveal` returns 0 rows and the reveal vanishes.** Whichever of `offer_reveal` vs `match_reveal_allowed` the client wires up, one is dead. The api-client `revealCreator` (Task 9) calls `offer_reveal`, the broken one.

**2. `public_profile_card` view selects columns it does not expose — and is built on a privacy assumption P3 may break.**
The badge test asserts `clear_photo_url` is absent (good), but the view exposes `blurred_photo_url` to any authenticated user. There is no task that *produces* `blurred_photo_url` — Assumption 3 (line 1591) says "Blur derivative generation (Sharp) happens at upload time in the web/edge layer (a later UI/media task)." No such task exists in P1; it is hand-waved to "P3-adjacent." So `public_profile_card.blurred_photo_url` is **NULL for every user at launch** — the entire blind-browse feed shows no photo. The "experience-first, face-blurred" core mechanic has no image.

**3. The onboarding state machine (`onboarding_step`) is written by nothing.**
`profiles.onboarding_step` defaults to `'age_gate'` and has 7 valid values. `canEnableDating` requires `onboarding_step = 'done'`. But **no task ever advances it.** No RPC, no client helper, no trigger transitions `age_gate → basics → ... → done`. `upsertProfile`/`savePreferences` don't touch it. So `onboarding_step` is permanently `'age_gate'` → `canEnableDating` always returns `{ok:false, reason:'onboarding_incomplete'}` → **dating can never be enabled even for a fully verified adult.** A complete dead-end gate.

**4. `prompt_answers` is written as raw `ProfileInput.prompts` with no shape validation at the DB.**
`upsertProfile` writes `prompt_answers: input.prompts` (an array of `{prompt_id, answer}`) into a `jsonb` column with `default '[]'`. Nothing validates server-side that `prompt_id ∈ profile_prompts` or that count ≤ 3. The Zod schema enforces it only if the client uses it; a direct PostgREST `update` bypasses it. The `profile_prompts` table exists but no FK or CHECK ties `prompt_answers` to it — the relationship is purely conventional. Stale/invalid prompt ids will silently render as blank prompts in the reveal.

**5. Dealbreakers are a self-declared tag with no symmetric meaning — a pre-filter input that cannot filter.**
`dealbreakers text[]` (e.g. `'smoking'`) is captured on the viewer, but **there is no corresponding profile attribute to match against.** A viewer who lists `'smoking'` as a dealbreaker needs candidates to declare whether *they* smoke — but no `profiles` column stores "I smoke / I have kids / I have pets." So `compatibilityPrefilterInputs` faithfully extracts `dealbreakers`, hands them to P4, and P4 has nothing to compare them to. The dealbreaker UI is collectable but structurally inert; the pre-filter will silently ignore it.

---

# MISSING EDGE CASES

**1. `inquiry.created`, `inquiry.failed`, `inquiry.expired`, and retries.** Task 6 maps only `approved/declined/marked-for-review`; everything else falls into `default: 'pending'`. A Persona `inquiry.expired` (user abandoned the flow) becomes `pending` forever — there's no timeout that flips an abandoned Inquiry to `failed` or back to `unverified`. Users who close the Persona tab are stuck `pending` indefinitely.

**2. Webhook idempotency / replay.** Persona retries webhooks. The function upserts on `(user_id, kind)` so a replay is mostly idempotent, but there's **no event-id dedup and no ordering guard**: an out-of-order delivery (a late `marked-for-review` arriving after `approved`) will demote a verified user to pending. `updated_at` is set to `now()` on every upsert, so the rollup's "most recent row wins" cannot distinguish a stale replay from a genuine new verdict. Verified users can flap.

**3. Age changes after `profiles.age` is cached.** The age-gate trigger sets `new.age` only on the transition into `dating_enabled=true`. After that, `profiles.age` is frozen. A user who turns 26 keeps showing 25 in `public_profile_card` and `offer_reveal` indefinitely. No daily birthday job recomputes age. Also: a user can edit `profiles_private.birthdate` *after* passing the gate (owner-only RLS lets them) — the trigger doesn't re-fire on birthdate edits, so a verified adult can change their stored birthdate to anything and the public age never updates. The "birthdate wins because it cannot be self-set to a lie" claim (line 553) is false post-verification.

**4. Persona DOB vs `profiles_private.birthdate` is never reconciled.** The webhook maps `approved → age:verified` but **never reads or writes the actual DOB Persona parsed.** The age gate trusts `profiles_private.birthdate`, which the user typed themselves. So Persona's real government-ID DOB is discarded and the gate runs on self-reported data — exactly the "selfie ≠ age verification" gap the phase claims to close (line 1571). A 17-year-old who self-reports `2000-01-01` but verifies a real ID showing 2009 gets `age:verified` AND passes the birthdate gate, because the two are never cross-checked. **The age-verification close is not actually closed.**

**5. `extract(year from age(bd)) < 18` vs the JS `isAdult` use different math.** The DB trigger uses `floor(extract(year from age(bd)))`. The JS `ageFromBirthdate` uses a month/day comparison. These can disagree on a leap-day or exact-18th-birthday boundary (the test even checks `2008-05-26 @ 2026-05-25 = not adult`). The "defence in depth" claim assumes they agree; they're not proven equivalent, so a user can pass one layer and fail another, yielding a confusing half-enabled state.

**6. No handling for a user who has `verification='verified'` but no birthdate.** The rollup sets `verified` from `phone+age` verifications. But the age-gate trigger requires `profiles_private.birthdate IS NOT NULL` to enable dating. If verification completes before birthdate is captured, `canEnableDating` and the trigger diverge. Order-of-operations across onboarding steps is undefined.

**7. Photo deletion / replacement lifecycle is undefined.** Storage RLS lets the owner write, but there's no cleanup when a user replaces a photo (orphaned objects), no virus/NSFW scan on upload (UGC moderation is P8 but the upload point is here), and no handling of a user with zero photos in `public_profile_card`.

**8. Concurrent `savePreferences` + age-gate.** `savePreferences` writes `age_pref = '[25,40]'`. The `not valid`→`validate` constraint pattern (Task 4) validates existing rows, but the `[lo,hi]` inclusive-inclusive int4range from the client becomes `[25,41)` canonically; the CHECK `coalesce(upper(age_pref),99) <= 100` and `lower <= upper` need verifying against `[25,40]`'s canonical upper of 41 — off-by-one risk that the SQL test (which writes `int4range(25,40)` = `[25,41)`) does not catch because it asserts `lower=25`, never the upper bound.

---

# STATE & DATA FLOW PROBLEMS

**1. Migration timestamp collisions across P1/P2/P5 will scramble apply order.** P1, P2, and P5 **all** number their migrations `20260525130000` → `20260525130700`. When all three phases land, `supabase/migrations/` will contain e.g. `20260525130000_p1_test_harness_marker.sql`, `20260525130000_p2_jobs.sql`, `20260525130000_p5_p2_shim.sql` — identical timestamps. Supabase applies lexicographically by full filename, so ordering becomes `p1 < p2 < p5` *within* a timestamp by luck of the suffix, but the P1 `appeal` enum `ALTER TYPE ... ADD VALUE` (which must commit before any file uses `'appeal'`) shares timestamp `...130100` with `p2_jobs_rpcs` and `p5_idempotency`. The dependency "P0 applied first, then P1, then P2/P5" is **not encoded in the filenames** — it relies entirely on the `pN` suffix sorting after the timestamp, which is fragile and undocumented. This is a latent "works on my machine, breaks on fresh reset" bug.

**2. State ownership of "reveal" is split and contradictory (see DEAD UI #1).** Two functions, two grains, two status predicates, in two phases, both claiming to be the reveal. Neither plan acknowledges the other. Whoever executes P5 will not know P1 already shipped `offer_reveal`, and vice versa.

**3. `profiles.verification` is written by both the rollup trigger AND implicitly assumed elsewhere.** The rollup is the only writer in P1. But P5's fixtures (line 214-216) do `insert into profiles (... verification) ... on conflict do update set verification='verified'` — directly setting `verification`, bypassing the rollup. In tests that's fine, but it signals the column is not consistently owned: anything can write it, and the rollup will overwrite it on the next `verifications` change, silently reverting manual sets. Unclear single source of truth.

**4. `onboarding_completed_at` is added but never set** (Task 2 adds the column; nothing writes it). Dead column.

**5. `vibe_tags` ownership ambiguity.** P0 already created `profiles.vibe_tags text[]`. P1's `ProfileInputSchema` caps it at 8 tags of ≤24 chars, but there's no DB CHECK enforcing that, and `upsertProfile` writes it raw. Free-text vibe tags with no controlled vocabulary will fragment ("foodie" vs "Foodie" vs "food") and any future faceting/filtering on them is doomed.

**6. The rollup's "most recent row wins" relies on `updated_at desc`, but the webhook sets `updated_at = now()` on every upsert** — including replays and unrelated-kind upserts. Since age and selfie are upserted together in one webhook call with the same `now()`, and phone is written by a different (missing) path, there's no global ordering guaranteeing the rollup sees a coherent snapshot.

---

# BACKEND/API GAPS

1. **No `startVerification` / create-Inquiry endpoint** (Critical #1). The api-client interface promises it (line 61); no task delivers it.
2. **No phone-OTP verification-row writer** (Critical #2). Client can't write it (RLS), no server function exists.
3. **No appeal-submission or appeal-resolution RPC** (Critical #3).
4. **No clear-photo signed-URL endpoint** (Critical #5). `offer_reveal` returns an unreadable private URL.
5. **No `getMyProfile` / read-back endpoint** — File Structure (line 61) lists `getMyProfile`; Task 9 omits it. The web onboarding can write a profile but cannot read it back to render the form's current state.
6. **No `onboarding_step` advance RPC** (DEAD UI #3).
7. **No blur-derivative generation** for `blurred_photo_url` (DEAD UI #2).
8. **No DOB extraction from Persona** into the DB (MISSING EDGE #4) — the function discards the one piece of data that makes it "real" age verification.
9. **`savePreferences` does not write `gender` to the type-safe path consistently** — it writes `gender` to `profiles` but the age-gate/eligibility never validates orientation completeness before enabling dating; a user with `gender_preferences='{}'` (P0 default) passes `canEnableDating` and lands in P4's pre-filter with an empty preference set → either an empty feed or an unfiltered one (undefined).
10. **Webhook signature secret bootstrapping undefined** — `PERSONA_WEBHOOK_SECRET` env var is read but there's no task to set it in `config.toml`/secrets, and the local Deno test uses `whsec_test` inline; the production secret provisioning is unspecified.
11. **No rate limiting / abuse guard on the webhook** — a leaked/guessed reference-id pattern plus a forged-but-valid signature (if the secret leaks) lets an attacker mark arbitrary users verified. No per-Inquiry ownership check that the `reference-id` actually initiated an Inquiry (because nothing tracks Inquiry creation — Critical #1).

---

# UX CONTRADICTIONS

1. **"Defence in depth" age gate that a verified user can trivially defeat** by editing their own `birthdate` after passing the gate (MISSING EDGE #3) — the trigger never re-fires, and self-reported DOB is what the gate trusts (never Persona's, MISSING EDGE #4). The narrative says birthdate "cannot be self-set to a lie"; the implementation lets it.
2. **"The badge is true, not dead" (line 22) vs. the badge is false at launch** — `badge_verified` requires `verification='verified'`, which (per Critical #1/#2) no user can achieve, so the launch state is "no one is verified, no badge for anyone," not "everyone is Verified·New."
3. **"Reveal at offer" privacy moment is the headline feature, and it ships broken** — wrong-grain predicate (privacy leak), self-destructs at lock, and returns an unopenable photo URL (Critical #5, DEAD UI #1).
4. **Blind-browse face-blur is the core thesis, and no blurred image is ever produced** (DEAD UI #2). Spec §5 "each plays its ambient sound; the creator's identity is hidden (no face, no name)" — but `public_profile_card` exposes `first_name` directly. That is the creator's **first name in the blind feed**, contradicting "no name" (spec §5/§7.2 say pending/standby see "no photo, name, or contact"). `public_profile_card` is supposed to be the pre-offer card but leaks `first_name`.
5. **Onboarding requires `done` but is never advanceable** (DEAD UI #3) — the user completes every visible step and the system still says "onboarding incomplete."

---

# WHAT ENGINEERS WILL REGRET LATER

1. **Two reveal systems.** Discovering in P5 that P1 already shipped `offer_reveal` (wrong grain, status-fragile) means either ripping it out or maintaining two divergent privacy predicates forever. Pick ONE grain (date_instance, per P5/spec §7.2) and ONE status set (`active` OR `accepted`/`locked`) NOW.
2. **Self-reported birthdate as the age source.** When a minor incident happens, "we trusted what they typed and never checked Persona's ID DOB" is a legal/PR catastrophe. Wire Persona's parsed DOB into `profiles_private.birthdate` (service-role, in the webhook) and make it the immutable source.
3. **`prompt_answers` as untyped jsonb with no FK to `profile_prompts`.** Renaming/retiring a prompt later orphans every answer with no referential safety. A `profile_prompt_answers` child table (FK to `profile_prompts`, unique `(profile_id, prompt_id)`) would be the right normalization.
4. **`dealbreakers` with no matchable counterpart** (DEAD UI #5). Shipping the input now and the matching attribute "later" guarantees the pre-filter quietly ignores dealbreakers — and "blind but filtered" trust collapses the first time a user discovers their hard filter did nothing.
5. **Migration timestamp collisions** (STATE #1). The day a fresh `supabase db reset` reorders P2 before P1 and the `appeal` enum value isn't committed yet, a downstream migration fails cryptically. Re-base each phase's timestamps into non-overlapping windows (P1 `1301xx`, P2 `1302xx`, P5 `1303xx`, …).
6. **Cached `profiles.age` that never updates** (MISSING EDGE #3) — birthdays silently stop. A nightly recompute job or a `GENERATED` expression (can't, needs birthdate cross-table) — at minimum a re-fire on birthdate update.
7. **No event-id dedup on the webhook** (MISSING EDGE #2) — Persona *will* retry and reorder; verified users flapping to pending will generate support tickets.

---

# REQUIRED ADDITIONAL SCREENS / COMPONENTS

These are implied by P1's data model but built by no task in P1 or any sibling plan:

1. **Start-verification flow + Persona embed component** (web) — opens an Inquiry with `reference-id`, inserts the seed `verifications(age, pending)` row, handles the in-flight/return states. (Critical #1)
2. **Phone-OTP capture + verify screen** that calls a server function to write `verifications(phone, verified)`. (Critical #2)
3. **Verification-status screen** — pending / verified / **failed (with reason + retry)** / **appeal (submit + status)**. None exist. (Critical #3/#4)
4. **Appeal submission + appeal-review surface** (the latter in P8, but P8 doesn't reference the `appeal` state). (Critical #3)
5. **Onboarding stepper** that actually advances `onboarding_step` to `done` via an RPC. (DEAD UI #3)
6. **Photo upload + blur-derivative generation** producing `blurred_photo_url`/`clear_photo_url`. (DEAD UI #2)
7. **Profile read-back (`getMyProfile`) + edit form** to hydrate the onboarding UI. (BACKEND #5)
8. **Clear-photo signed-URL endpoint + reveal screen** wiring (Critical #5).
9. **A "dealbreaker-matchable attributes" capture** (do you smoke / have kids / pets) so dealbreakers can filter. (DEAD UI #5)
10. **Verification notification types** added to P2's frozen enum (`verification_passed`, `verification_failed`, `appeal_resolved`). (Critical #4)

---

# PRODUCTION READINESS SCORE

**2.5 / 10.**

The TDD scaffolding, schema hygiene, RLS posture, and shared-package discipline are genuinely strong, and the vitest harness (Task 0) is clean and reusable. But P1's stated *purpose* — "make the user a real, accountable, revealable person" — does not function end-to-end as written. The verification flow has no start trigger and no phone-row writer, so **no user can ever become verified**, which collapses the badge, the age-gate's downstream `verified` requirement, and `canEnableDating`. The headline reveal-at-offer privacy moment ships in two contradictory implementations (one of which leaks and self-destructs at lock and returns an unopenable photo). Onboarding can never reach `done`. The blind feed has no blurred image and leaks `first_name`. Persona's real DOB — the entire justification for choosing Persona — is discarded, so the "selfie ≠ age verification" gap stays open. The score reflects excellent plumbing under a product that cannot complete its core loop on launch day.

---

# PRIORITY FIX ORDER

1. **Add the verification *start* path + phone-row writer (service-role).** A `start-verification` Edge Function/RPC that creates the Persona Inquiry, seeds `verifications(age,pending)`, and a server-side writer for `verifications(phone,verified)` on `auth.verifyOtp`. Without this nothing is ever verified. (Critical #1, #2)
2. **Unify the reveal mechanism with P5 onto ONE grain and ONE status set.** Delete P1's `offer_reveal`/`offer_reveal_for` or rebase them on date_instance + (`active` OR `accepted`/`locked`); have `revealCreator` call the single canonical predicate. Mint the clear-photo signed URL in that one place. (DEAD UI #1, Critical #5)
3. **Make Persona's parsed DOB the age source: write it (service-role) into `profiles_private.birthdate` in the webhook, and re-fire the age gate on birthdate change.** Closes the actual age-verification gap and the "edit-DOB-after-gate" hole. (MISSING EDGE #3, #4)
4. **Implement onboarding-step advancement (RPC) so `done` is reachable**, and add `getMyProfile`. (DEAD UI #3, BACKEND #5)
5. **Produce `blurred_photo_url` (and remove `first_name` from the pre-offer `public_profile_card`).** The blind feed needs an image and must honor "no name." (DEAD UI #2, UX #4)
6. **Build the appeal + failure UX path** (entry, review, resolution) and add verification notification types to P2's enum. (Critical #3, #4)
7. **Add a matchable counterpart for `dealbreakers`** (smoke/kids/pets attributes) or defer dealbreakers from the pre-filter contract. (DEAD UI #5)
8. **Rebase P1/P2/P5 migration timestamps into non-overlapping windows + add webhook event-id dedup/ordering guard.** (STATE #1, MISSING EDGE #2)
