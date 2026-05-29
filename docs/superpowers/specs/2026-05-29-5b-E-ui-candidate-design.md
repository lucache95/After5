# 5b Sub-project E — UI Candidate Surface — Design Spec

**Date:** 2026-05-29
**Roadmap task:** Task 6 (`docs/superpowers/plans/2026-05-27-5b-master-roadmap.md`)
**Overview contract:** `docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md` §1-E, §2.6, §4.1, §4.2, §5.1 seam 4
**Backend reality source:** `docs/superpowers/reports/2026-05-29-5b-coherency-audit.md` (read; carry-forward facts honored below)
**Convention source:** sub-project D (`apps/web/app/dates/[slug]/interested/*`, `apps/web/lib/after5/match.ts`) — committed + browser-proven on `main` (e0e0861).

---

## Goal

Ship every screen the **candidate** (offer recipient) sees: the offer-received detail with a live expiry countdown, accept/pass/withdraw actions wired to the real edge functions, and an account-gate fallback when the candidate can't act. All behind `feature_config.match_v2_enabled`. No app code yet — this is the contract the plan executes.

---

## Architecture (file responsibilities)

New route segment `apps/web/app/offers/[offerId]/`:

| File | Kind | Responsibility |
|---|---|---|
| `page.tsx` | server | `createClient()` → `getUser()` → auth redirect → read flag → fetch the candidate's own offer row + the candidate's own gate fields + the host's Tier-3 profile (RLS) → branch to one of: `ComingSoonBanner` (flag off), 403 (not the recipient), `AccountGate` (candidate can't act), or `OfferDetail` (happy path). Passes plain serializable props. |
| `OfferDetail.tsx` | client | Renders host Tier-3 preview (Polaroid + first_name/age/city), the date details (best-effort, see Risk E-R1), `ExpiryCountdown`, and the accept / pass / withdraw actions. Owns the RPC calls + error→toast mapping + navigation. |
| `ExpiryCountdown.tsx` | client | Pure presentational ticking timer. Source of truth = `expiresAt` (ISO string from `offers.expires_at`). Ticks every 1s; renders an "expired" visual state once `expiresAt <= now` OR the zombie threshold (Risk handling below). Calls an optional `onExpire` once at the crossover. |
| `AccountGate.tsx` | client | Renders the P5002 fallback. Maps a `reason` discriminant to Barbiecore copy + a remediation link. Used both by the server page (pre-flight gate) and by `OfferDetail` (gate raised at accept time). |
| `__tests__/OfferDetail.test.tsx` | test | RTL: host preview render, accept→navigate, pass→navigate, withdraw→navigate, error→toast, expired→actions disabled. |
| `__tests__/ExpiryCountdown.test.tsx` | test | RTL + fake timers: ticks, expired state, onExpire fires once, zombie threshold. |
| `__tests__/AccountGate.test.tsx` | test | RTL: each reason renders correct copy + link. |
| `__tests__/a11y.test.tsx` | test | jest-axe: OfferDetail + AccountGate have no violations. |

Wrapper additions in `apps/web/lib/after5/match.ts` (foundation, Task 1): `acceptOffer(offer) → Promise<string>` and `passOffer(offer) → Promise<void>`. `withdraw(instance) → Promise<null>` already exists and is reused as-is.

**Route-collision check (audit bug class 1):** `apps/web/app/offers/` does NOT exist today (verified). `offers/[offerId]` is a fresh top-level segment with no sibling dynamic param, so no Next.js param-name collision. The D collision (`[instanceId]` vs legacy `[slug]`) does not recur here.

---

## Data model facts (verified against migrations + prod via the coherency audit)

- `offers(id, date_instance_id, candidate_id, creator_id, status['active'|'accepted'|'passed'|'expired'], expires_at, resolved_at, created_at)`. RLS: `offers_party_read` → `candidate_id = auth.uid() OR creator_id = auth.uid()`. **The candidate CAN read their own offer row under their SSR client.** (`20260525120600_p0_offers.sql`)
- FK constraint names (Postgres defaults, used for PostgREST embed hints — audit bug class 3):
  - `offers_creator_id_fkey` → `profiles(id)` (the host)
  - `offers_candidate_id_fkey` → `profiles(id)` (the candidate / viewer)
  - `offers_date_instance_id_fkey` → `date_instances(id)`
- Host Tier-3 reveal: `profiles_select_revealed` RLS uses `match_reveal_allowed_pair(viewer, target)`. Branch (b) of that DEFINER function returns true when the **viewer is the candidate of an active/accepted offer on an instance the target created** — exactly E's case. So the candidate CAN read the host's revealed profile fields (`first_name, age, city, clear_photo_url, bio`) under RLS. (`20260527126500/126600`)
- `can_enter_lock_flow(user)` = `account_state='active' AND standing NOT IN ('cooldown','locked_ban','suspended')`. (`20260525123500`)
- P5002 `detail` values, by RPC:
  - `match_make_offer` (host side, NOT E): `dating_disabled` / `blocked` / `candidate_not_eligible`.
  - `match_accept_offer` (E's path): `detail='actor_not_eligible'` — a single value covering all `can_enter_lock_flow=false` cases. It does NOT sub-classify cooldown vs suspended vs verify. (`20260527126400` line 75)
- `feature_config` has `match_v2_enabled` + `offer_window_hours`, both readable client/SSR via `feature_config_public_read` (`127300`).

### Carry-forward backend facts honored (from audit "Carry-forward for E/F/G/H")

1. **RPC returns are bare scalars.** `match_accept_offer` → `uuid` string; the edge envelope is `{ ok: true, data: '<lock-uuid>' }`. `data` is the string — do NOT read `.lock_id`. `match_pass_offer` → void (`{ ok: true, data: null }`). `match_withdraw` → void.
2. **Error envelope:** `{ ok:false, code:'<string-name>', message, detail?:'<string>', errcode:'P50xx' }`. Branch on the **string `code`** (the existing `MatchError`/`messageForCode` discriminator). `detail` is always a string.
3. **Edge body keys** (verified in the function sources): accept `{ offer, idem_key }`; pass `{ offer }`; withdraw `{ instance }`.

---

## Flows

### Server page resolution order (`page.tsx`)

```
const { offerId } = await params
supabase = await createClient()
user = (await supabase.auth.getUser()).data.user
if !user → redirect(`/login?next=/offers/${offerId}`)

// 1. flag (RLS-public)
flagRow = feature_config where key='match_v2_enabled'
if flagRow?.value !== true → <ComingSoonBanner />

// 2. the offer + embedded host + embedded date (hinted FKs — bug class 3)
offer = offers
  .select(`
    id, status, expires_at, candidate_id, creator_id,
    host:profiles!offers_creator_id_fkey ( first_name, age, city, clear_photo_url, bio ),
    instance:date_instances!offers_date_instance_id_fkey ( starts_at, time_range )
  `)
  .eq('id', offerId).maybeSingle()

// 3. recipient check — non-recipient (incl. the host) gets 403
//    RLS already hides non-party rows, so offer===null OR candidate_id!==user.id both → 403.
if !offer || offer.candidate_id !== user.id → <NotYourOffer/> (403 state)

// 4. candidate's own gate fields (owner reads own profile row — no RLS issue)
me = profiles.select('dating_enabled, verification, standing, account_state')
       .eq('id', user.id).maybeSingle()
gate = deriveGateReason(me)            // pure helper, see AccountGate
if gate !== null → <AccountGate reason={gate} />

// 5. happy path
<OfferDetail
   offerId, instanceId={offer.instance ? ... : null},
   expiresAt={offer.expires_at}, status={offer.status},
   host={ first_name, age, city, photo_url, bio },
   date={ startsAt, ... }            // may be null — Risk E-R1
/>
```

`export const dynamic = 'force-dynamic'` (mirrors D's page — SSR per request, no static cache of auth-scoped data).

### Accept

`OfferDetail` accept button → `acceptOffer(offerId)` (new wrapper) → resolves to the **lock uuid string** → `router.push(\`/matches/${lockId}\`)`. F's `/matches/[lockId]` route may not exist yet — navigate anyway (acceptance criterion; F builds the target).

- On `MatchError`: map `e.code` through `messageForCode`, `toast.error(...)`. Special-cases:
  - `account_gated` (P5002, `detail='actor_not_eligible'`): the candidate's standing changed since page load. Re-render the gate inline by surfacing `AccountGate` with a derived/`generic` reason (we can't sub-classify from `detail` — see Risk E-R2), rather than only a toast.
  - `offer_expired` (P5007): toast "that offer already expired." + `router.push('/feed')` (matches §4.1).
  - `time_conflict` (P5004): toast "that time overlaps another locked date." (candidate already locked elsewhere) + refresh.

### Pass

Pass button → `passOffer(offerId)` (new wrapper, returns void) → on success `toast('passed.')` (neutral, not success) → `router.push('/feed')` (acceptance criterion). Errors → `messageForCode` toast.

### Withdraw (candidate self-withdraw — decision E-D1)

Per F-1, `match_withdraw(p_actor, p_instance)` is candidate-side and lives in E. **Design decision E-D1: the withdraw action sits on `OfferDetail`** as a low-emphasis tertiary action ("not interested"), alongside accept/pass. Rationale:
- `match_withdraw` operates on the **instance** (`p_instance`), removing the candidate from that night's queue entirely (a stronger signal than "pass," which just declines the single offer). On the offer-detail screen the candidate already has the instance id in context.
- A separate candidate "my offers" list is **out of scope for E** (no such list route is in the roadmap; the candidate reaches `/offers/[offerId]` via the `offer_received` notification G builds). Adding one would be scope creep. The single-offer detail screen is the only candidate offer surface in 5b.
- Withdraw wrapper already exists (`withdraw(instance)`), so it adds no foundation work.

Withdraw → `withdraw(instanceId)` → on success `toast('all good — you\'re out of the running.')` → `router.push('/feed')`. If `instanceId` is null (date row unreadable, Risk E-R1), the withdraw action falls back to passing the offer (`passOffer`) so the candidate is never trapped — documented degradation, not a silent failure.

### Expiry (ExpiryCountdown)

- Props: `expiresAt: string` (ISO), `onExpire?: () => void`.
- Computes `remaining = Date.parse(expiresAt) - Date.now()` on a `setInterval(1000)`; cleans up on unmount; respects nothing motion-wise (text only, no animation — so no `useReducedMotion` needed here).
- Renders `mm:ss` (or `Hh Mm` when > 1h) while positive; renders an "expired" state once `remaining <= 0`.
- **Zombie-offer threshold (§4.2):** if `Date.parse(expiresAt) < Date.now() - 3_600_000` (one hour past), treat as expired even though `status` may still read `'active'` (the `offer_expiry` job may have permanently failed). The "expired" visual is identical.
- `onExpire` fires exactly once at the crossover (guard with a ref) so `OfferDetail` can disable accept/pass without a re-fetch. The DB still enforces expiry (accept on an expired offer raises P5007); the client guard is UX only.
- When expired: `OfferDetail` disables accept + pass, keeps withdraw available (leaving a dead queue entry is still valid), and shows a quiet "this one slipped away" line with a `/feed` link.

### Feature-flag-off

Flag off → server page returns `<ComingSoonBanner />` (reused from `apps/web/components/ComingSoonBanner.tsx`). The edge functions also raise P5000 `feature_disabled` if somehow called with the flag off; `messageForCode('feature_disabled')` covers the toast, but the page-level banner is the primary surface.

### Offer-recipient 403

A non-recipient (any user who is not `offer.candidate_id`, including the host) gets a minimal 403 state (`<NotYourOffer/>`, same Barbiecore pattern as D's "not your date"). RLS double-protects: `offers_party_read` lets the host read the row too, so the explicit `candidate_id !== user.id` check is what turns the host away (the host's surface is D, not E). A stranger's read returns null → also 403. No PII renders in the 403 state.

---

## AccountGate reason → copy mapping

`AccountGate` takes `reason: GateReason` where
`type GateReason = 'verify' | 'cooldown' | 'suspended' | 'dating_disabled' | 'blocked' | 'generic'`.

`deriveGateReason(me)` (pure, server-side, exported for unit test) maps the candidate's own profile fields to a reason, in priority order:

| Condition (candidate's own row) | reason | Headline (Caprasimo, lowercase) | Body (Fredoka) | Link |
|---|---|---|---|---|
| `dating_enabled === false` | `dating_disabled` | "dating's switched off" | "turn dating back on to take this offer." | `/settings/dating` |
| `verification !== 'verified'` | `verify` | "verify first" | "we need to confirm it's really you before you can lock a date." | `/onboarding` |
| `standing === 'cooldown'` | `cooldown` | "you're on a short break" | "you can take offers again once your cooldown lifts." | `/settings/account` |
| `standing IN ('suspended','locked_ban')` | `suspended` | "account on hold" | "reach out to support to sort this out." | `mailto:support` link |
| `account_state !== 'active'` | `suspended` | (same as suspended) | (same) | (same) |
| else | `null` (no gate → render OfferDetail) | — | — | — |

- `blocked` is NOT derivable from the candidate's own row (it's a relationship the host's make-offer detects). It is included in the union only so `AccountGate` can render the P5002 `detail='blocked'` case if it ever surfaced; in E's accept path the backend returns `detail='actor_not_eligible'` only, so `blocked` is effectively unreachable from E. Copy: "this date isn't available to you." link `/feed`. Documented for completeness; tested for render but flagged unreachable.
- `generic` is the fallback used when accept raises `account_gated` mid-session and we can't re-derive (we don't re-fetch the profile inside the catch). Copy: "you can't take this offer right now." link `/feed`.

All copy follows the stop-slop rule (no filler/adverbs/passive/em-dashes; lowercase Barbiecore voice). Each gate state is a full-screen `<main>` with one headline, one body line, one link styled as the shell accent button.

---

## Error → toast mapping (single source = `messageForCode`)

`OfferDetail` mirrors `MakeOfferModal`'s pattern exactly:

```ts
catch (e) {
  toast.error(e instanceof MatchError ? messageForCode(e.code) : "that didn't go through. try again?");
}
```

with the per-action navigation/gate special-cases listed under each flow. `messageForCode` already maps every relevant code: `feature_disabled`, `account_gated`, `offer_expired`, `time_conflict`, `auth_mismatch`, `server_error`, `bad_request`. No new message keys are needed for E (the existing `MESSAGES` table covers them).

---

## Risks (spec-flagged)

### Risk E-R1 (RED) — the candidate cannot read the host's `date_instances` row under RLS

`date_instances` has exactly two SELECT policies, both `creator_id = auth.uid()` (`date_instances_creator_all`, `date_instances_owner_select`). The candidate is not the creator, so **the embedded `instance:date_instances!offers_date_instance_id_fkey(...)` will return null under the candidate's SSR client.** The `browse_feed_for_viewer` DEFINER RPC can't help either: it filters `creator_id <> p_viewer` AND excludes already-swiped instances (the candidate swiped right to get here), so the offered instance is filtered out.

**Impact:** E can render the host's profile and the countdown, but NOT the date's `starts_at` / venue / title from `date_instances` under RLS. The offer-received screen would be missing "the date."

**Resolution (a backend dependency, NOT E UI code):** add a `date_instances` SELECT policy (or a tiny DEFINER read function) that lets a user read an instance they have an active/accepted offer on — symmetric to `profiles_select_revealed`. Predicate: `EXISTS (select 1 from offers o where o.date_instance_id = date_instances.id and o.candidate_id = auth.uid() and o.status in ('active','accepted'))`. This migration is a **prerequisite the plan calls out** but does not itself author (E is a UI sub-project; the migration is flagged for the user/A to land, mirroring how D needed `127300`). Until it lands, `OfferDetail` degrades: `date` prop is `null`, the screen shows "the date" as a placeholder line ("details unlock when you accept") and withdraw falls back to pass (E-D1). Tests cover both the `date != null` and `date == null` branches so E ships green either way.

### Risk E-R2 (YELLOW) — `account_gated` at accept time can't be sub-classified

`match_accept_offer` raises P5002 with `detail='actor_not_eligible'` only. When this fires mid-session, E cannot tell cooldown from suspended from the envelope. Handled by rendering `AccountGate reason='generic'` (or re-running `deriveGateReason` is impossible client-side without the profile). Accepted: the pre-flight server gate already catches the common cases at page load; the mid-session race is rare and the generic gate is honest.

### Risk E-R3 (YELLOW) — seam 4 (in-lock candidate receives a new offer)

Per §5.1 seam 4, a candidate already in a lock can't enter another lock flow (`can_enter_lock_flow=false`). For E this manifests as the accept-time P5002 (E-R2 handling) — there's no separate UI. The candidate can still view the offer and pass/withdraw. No extra handling; noted so the implementer doesn't build a special case.

---

## Testing strategy

Per overview §4.3 (D/E/F row): Vitest + RTL per-component, plus jest-axe. Browser verification (Playwright two-context) is H's job and follows E's merge — explicitly NOT in E.

- `ExpiryCountdown.test.tsx`: fake timers (`vi.useFakeTimers`); assert tick text changes, expired state at crossover, `onExpire` fires once, zombie threshold (`expiresAt` 2h in the past → expired immediately).
- `OfferDetail.test.tsx`: mock `@/lib/after5/match` (`acceptOffer`/`passOffer`/`withdraw`/`MatchError`/`messageForCode`) and `next/navigation` `useRouter` and `sonner` `toast` (same mock shape as D's tests). Assert: host preview renders Tier-3 fields lowercased; accept resolves a lock id → `router.push('/matches/<id>')`; pass → `router.push('/feed')`; withdraw → `withdraw(instanceId)` then `/feed`; a thrown `MatchError('offer_expired')` → toast + `/feed`; expired prop disables accept/pass; `date==null` branch renders the placeholder + withdraw falls back to pass.
- `AccountGate.test.tsx`: render each `reason`, assert headline + link href. Plus `deriveGateReason` unit cases (verify/cooldown/suspended/dating_disabled/active→null).
- `a11y.test.tsx`: axe OfferDetail (happy + expired) and AccountGate (each reason); expect `toHaveNoViolations()`.
- `match.test.ts` additions: `acceptOffer` invokes `match-accept-offer` with `{ offer, idem_key:<string> }` and returns the bare uuid string from `data.data`; `passOffer` invokes `match-pass-offer` with `{ offer }` (no idem_key) and resolves void; both throw `MatchError` on `ok:false`.

---

## Out of scope (explicit)

- No Realtime subscription (overview §1-E: countdown is client-side, accept/pass fires sync; expiry notifications are G's surface).
- No candidate "my offers" list route (E-D1 rationale).
- No reciprocal-chooser entry from E (that's the host's make-offer path, D/B).
- The `date_instances` recipient-read migration (Risk E-R1) — flagged as a prerequisite, authored elsewhere.
- F's `/matches/[lockId]` target route.

---

## Self-review

- **Placeholders:** none. All file paths, FK names, column names, RPC names, body keys, and `detail` values are verified against migration sources / the coherency audit, not guessed.
- **Consistency:** RPC return shapes match audit carry-forward (#1 bare scalars); error branching uses the string `code` (matches existing `MatchError`/`messageForCode`, audit #2); navigation targets match acceptance criteria (`/matches/[lockId]`, `/feed`); design tokens (`bg-shell-base`, `text-shell-ink`, `text-shell-accent`, `font-heading`, `font-body`, `Polaroid tone="dating"`, `cn`, vaul, sonner) match D.
- **Scope:** withdraw placement (E-D1) and the absence of a my-offers list are decided and justified; reciprocal/Realtime/F-route excluded.
- **Ambiguity resolved:** the date-detail RLS gap (E-R1) is the one genuine open issue; it's flagged RED with a concrete predicate and a degrade path so E ships regardless. The accept-time gate sub-classification (E-R2) is resolved to `generic`. No remaining TBDs.
