# 5b Sub-project E — UI Candidate Surface — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-05-29-5b-E-ui-candidate-design.md`
**Branch:** create `5b-E-ui-candidate` off `main` (do not work on `main`).
**Test runner:** `pnpm --filter web test <path>` (root: `npm run test` proxies turbo; per-file: `cd apps/web && npx vitest run <path>`).
**Commit trailer (every commit):**
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```
**Method:** strict TDD per task — write the failing test, run it (RED), implement real complete code, run it (GREEN), commit. No placeholder bodies. Type names are fixed in Task 1 and reused verbatim downstream.

**Shared type contract (fixed here, used in every task):**
```ts
// match.ts additions
export function acceptOffer(offer: string): Promise<string>;   // resolves the lock uuid
export function passOffer(offer: string): Promise<void>;
// withdraw(instance: string): Promise<null>  — ALREADY EXISTS, reuse

// AccountGate.tsx
export type GateReason = 'verify' | 'cooldown' | 'suspended' | 'dating_disabled' | 'blocked' | 'generic';
export function deriveGateReason(me: {
  dating_enabled: boolean | null;
  verification: string | null;
  standing: string | null;
  account_state: string | null;
}): GateReason | null;

// OfferDetail.tsx props
export interface OfferDetailProps {
  offerId: string;
  instanceId: string | null;       // null when date row unreadable (Risk E-R1)
  expiresAt: string;               // ISO, from offers.expires_at
  status: 'active' | 'accepted' | 'passed' | 'expired';
  host: { first_name: string; age: number | null; city: string | null; photo_url: string | null; bio: string | null };
  date: { startsAt: string } | null;   // null = details locked (Risk E-R1)
}
```

---

### Task 1: `acceptOffer` + `passOffer` wrappers in match.ts (foundation)

**Test first** — append to `apps/web/lib/after5/__tests__/match.test.ts`:
- import `acceptOffer, passOffer` from `../match`.
- `acceptOffer` mock `{ data: { ok: true, data: 'lock-uuid-1' }, error: null }` → assert invoked `'match-accept-offer'` with `body.offer === 'off-1'` and `typeof body.idem_key === 'string'` (length > 10); assert it **returns the string** `'lock-uuid-1'` (NOT an object — audit carry-forward #1).
- `passOffer` mock `{ data: { ok: true, data: null }, error: null }` → assert invoked `'match-pass-offer'` with `body === { offer: 'off-1' }` and **no `idem_key`** key present; assert resolves `undefined`.
- `acceptOffer` mock `{ data: { ok: false, code: 'offer_expired', errcode: 'P5007', message: '...' }, error: null }` → `rejects.toMatchObject({ code: 'offer_expired', errcode: 'P5007' })`.

Run `npx vitest run lib/after5/__tests__/match.test.ts` → RED (functions don't exist).

**Implement** in `apps/web/lib/after5/match.ts`, after the existing `withdraw` export, reusing the existing `call<T>` + `idemKey()` helpers:
```ts
// Sub-project E (candidate accept). match_accept_offer returns a bare uuid (the
// lock id); the edge envelope is { ok:true, data:'<uuid>' } so call<string> yields it.
export function acceptOffer(offer: string): Promise<string> {
  return call<string>('match-accept-offer', { offer, idem_key: idemKey() });
}

// Sub-project E (candidate pass). match_pass_offer returns void; no idem_key.
export async function passOffer(offer: string): Promise<void> {
  await call<null>('match-pass-offer', { offer });
}
```

Run → GREEN. Commit `feat(5b-E): add acceptOffer + passOffer wrappers to match.ts`.

---

### Task 2: `ExpiryCountdown` component

**Test first** — `apps/web/app/offers/[offerId]/__tests__/ExpiryCountdown.test.tsx`, using `vi.useFakeTimers()` / `vi.setSystemTime()`:
- future `expiresAt` (90s ahead) → renders a time string; advance 1s → text updates.
- `expiresAt` 1s ahead → advance 2s → renders `/expired|slipped away/i`; `onExpire` called exactly once even after further ticks.
- `expiresAt` 2h in the past (zombie, §4.2) → renders expired immediately on mount, `onExpire` called once.
- cleanup: `unmount()` then advance timers → no further `onExpire` calls (no leaked interval).

Run → RED.

**Implement** `apps/web/app/offers/[offerId]/ExpiryCountdown.tsx` (`'use client'`):
- `useState` for `now`, `setInterval(() => setNow(Date.now()), 1000)` in `useEffect` with cleanup.
- `remaining = Date.parse(expiresAt) - now`; `expired = remaining <= 0 || Date.parse(expiresAt) < now - 3_600_000`.
- `useRef` guard so `onExpire?.()` fires once at the first `expired` transition (also on mount if already expired).
- Format: `>1h` → `Hh Mm`; else `Mm:Ss` zero-padded. Text-only, Barbiecore (`font-body text-shell-ink`, expired state `text-shell-ink/60`). `role="timer"` + `aria-live="off"` while counting, switch to a static `aria-live="polite"` line on expiry.

Run → GREEN. Commit `feat(5b-E): ExpiryCountdown with client tick + zombie-offer expiry`.

---

### Task 3: `AccountGate` + `deriveGateReason`

**Test first** — `apps/web/app/offers/[offerId]/__tests__/AccountGate.test.tsx`:
- `deriveGateReason` cases: `{dating_enabled:false,...}` → `'dating_disabled'`; verified+enabled but `verification:'pending'` → `'verify'`; `standing:'cooldown'` → `'cooldown'`; `standing:'suspended'` → `'suspended'`; `standing:'locked_ban'` → `'suspended'`; `account_state:'paused'` → `'suspended'`; all-good (`dating_enabled:true, verification:'verified', standing:'good', account_state:'active'`) → `null`. Priority: dating_disabled beats verify beats standing.
- `<AccountGate reason="verify"/>` → headline `/verify first/i` + link href `/onboarding`; `reason="cooldown"` → `/short break/i` + `/settings/account`; `reason="suspended"` → `/on hold/i`; `reason="dating_disabled"` → `/switched off/i` + `/settings/dating`; `reason="blocked"` → link `/feed`; `reason="generic"` → link `/feed`.

Run → RED.

**Implement** `apps/web/app/offers/[offerId]/AccountGate.tsx` (`'use client'` — no server-only deps, reused both sides):
- Export `GateReason`, `deriveGateReason`, `AccountGate` per the fixed contract. `deriveGateReason` is a pure function (priority order exactly as the spec table).
- A `COPY: Record<GateReason, { headline; body; href; cta }>` table with the spec's copy (stop-slop, lowercase).
- Render a full-screen `<main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">` with `h1.font-heading.text-5xl.lowercase.text-shell-ink`, a `p.font-body.text-lg.text-shell-ink/70`, and a `next/link` styled as the shell accent pill (`rounded-full bg-shell-accent ... focus-visible:ring-4`). `mailto:` for suspended uses a plain `<a>`.

Run → GREEN. Commit `feat(5b-E): AccountGate fallback + deriveGateReason mapping`.

---

### Task 4: `OfferDetail` component

**Test first** — `apps/web/app/offers/[offerId]/__tests__/OfferDetail.test.tsx`. Mocks (mirror D's test mock shapes):
```ts
vi.mock('@/lib/after5/match', () => ({
  acceptOffer: vi.fn(), passOffer: vi.fn(), withdraw: vi.fn(),
  MatchError: class extends Error { code:string; constructor(c:string){super(c);this.code=c;} },
  messageForCode: (c:string) => c,
}));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
```
Cases:
- renders host Tier-3 lowercased (`first_name`, `, age`, `city`) + bio.
- accept: `acceptOffer` resolves `'lock-7'` → click accept → `await` → `push` called with `/matches/lock-7`.
- pass: `passOffer` resolves → click pass → `push('/feed')`.
- withdraw (instanceId set): click withdraw → `withdraw('inst-1')` called → `push('/feed')`.
- withdraw fallback (instanceId null): click withdraw → `passOffer` called (not `withdraw`) → `push('/feed')`.
- error: `acceptOffer` rejects `new MatchError('offer_expired')` → `toast.error` called with `'offer_expired'` (mapped) AND `push('/feed')`.
- error generic: `acceptOffer` rejects `new MatchError('account_gated')` → renders inline `AccountGate` (assert `/can't take this offer/i` or the generic headline) — does NOT navigate.
- expired prop (`expiresAt` in the past): accept + pass buttons `toBeDisabled()`; withdraw still enabled.
- `date == null`: renders the "details unlock when you accept" placeholder line.

Run → RED.

**Implement** `apps/web/app/offers/[offerId]/OfferDetail.tsx` (`'use client'`):
- imports: `useState`, `useRouter`, `toast`, `Polaroid`, `cn`, `acceptOffer/passOffer/withdraw/MatchError/messageForCode`, `ExpiryCountdown`, `AccountGate` (+ `GateReason`).
- local state: `busy` (disables all actions), `expired` (set by `ExpiryCountdown onExpire`), `gate: GateReason | null` (inline gate after a mid-session `account_gated`).
- if `gate` → return `<AccountGate reason={gate} />` (early).
- layout: `<main>` Barbiecore shell, header line "you've got an offer", host block (`Polaroid tone="dating" size="sm"` + name/age/city + bio), the date block (`date ? format(startsAt) : 'details unlock when you accept'`), `<ExpiryCountdown expiresAt={expiresAt} onExpire={() => setExpired(true)} />`.
- actions (column of pill buttons, min-h-[48px], focus-visible rings — copy MakeOfferModal's button classes):
  - **accept** (primary `bg-shell-accent`): `disabled={busy || expired}`; handler calls `acceptOffer(offerId)` then `router.push(\`/matches/${lockId}\`)`.
  - **pass** (secondary, `text-shell-ink/70`): `disabled={busy || expired}`; `passOffer(offerId)` then `/feed`.
  - **withdraw** (tertiary, small, `text-shell-ink/50`): label "not interested"; `instanceId ? withdraw(instanceId) : passOffer(offerId)` then `/feed`.
- shared `run(fn, after)` helper sets `busy`, try/catch:
  ```ts
  catch (e) {
    if (e instanceof MatchError) {
      if (e.code === 'offer_expired') { toast.error(messageForCode(e.code)); router.push('/feed'); return; }
      if (e.code === 'account_gated') { setGate('generic'); return; }
      toast.error(messageForCode(e.code));
    } else { toast.error("that didn't go through. try again?"); }
  } finally { setBusy(false); }
  ```
- expired body line: `expired && <p>this one slipped away. <Link href="/feed">back to the feed</Link></p>`.

Run → GREEN. Commit `feat(5b-E): OfferDetail with accept/pass/withdraw wiring + expiry handling`.

---

### Task 5: server `page.tsx` (auth + flag + recipient + gate + embeds)

**Note:** server components aren't unit-tested in this repo (D's `page.tsx` had no test; verified covered by H's E2E). This task is verified by typecheck + lint + the embed-hint correctness review, NOT a Vitest file. State that explicitly in the commit body.

**Implement** `apps/web/app/offers/[offerId]/page.tsx`:
- `export const dynamic = 'force-dynamic'`.
- `params: Promise<{ offerId: string }>`; `await params`.
- `createClient()` from `@/lib/supabase/server`; `getUser()`; no user → `redirect(\`/login?next=/offers/${offerId}\`)`.
- flag read (`feature_config`/`match_v2_enabled`); `!== true` → `<ComingSoonBanner />`.
- offer read with the **hinted embeds** (bug class 3 — pin FK constraint names):
  ```ts
  const { data: offer } = await supabase
    .from('offers')
    .select(`id, status, expires_at, candidate_id, creator_id,
      host:profiles!offers_creator_id_fkey ( first_name, age, city, clear_photo_url, bio ),
      instance:date_instances!offers_date_instance_id_fkey ( starts_at )`)
    .eq('id', offerId)
    .maybeSingle();
  ```
- `!offer || offer.candidate_id !== user.id` → `<NotYourOffer/>` (inline 403 `<main>`, Barbiecore, copy "not your offer" / "this one was sent to someone else.").
- own gate fields: `profiles.select('dating_enabled, verification, standing, account_state').eq('id', user.id).maybeSingle()` → `deriveGateReason(me)`; non-null → `<AccountGate reason={...} />`.
- map embed to props (host may be a single object or null; `instance` is **expected null under RLS until the E-R1 migration lands** — handle gracefully):
  ```ts
  const host = offer.host ?? {};
  const instance = offer.instance ?? null;
  return <OfferDetail
    offerId={offer.id}
    instanceId={offer.date_instance_id ?? null}   // NOTE: select date_instance_id too
    expiresAt={offer.expires_at}
    status={offer.status}
    host={{ first_name: host.first_name ?? 'someone', age: host.age ?? null, city: host.city ?? null, photo_url: host.clear_photo_url ?? null, bio: host.bio ?? null }}
    date={instance ? { startsAt: instance.starts_at } : null}
  />;
  ```
  (Add `date_instance_id` to the select list so `instanceId` is available for withdraw even when the embedded `instance` row is RLS-hidden — the FK column lives on `offers`, which the candidate CAN read.)

Run `cd apps/web && npx tsc --noEmit` + `npx next lint` (or repo lint script) → GREEN. Commit `feat(5b-E): offer-recipient server page with hinted embeds + flag/gate/403 branches`.

---

### Task 6: a11y test

**Test** `apps/web/app/offers/[offerId]/__tests__/a11y.test.tsx` (mirror D's a11y test): mock match/navigation/sonner; `import { axe } from 'jest-axe'`.
- OfferDetail happy (`date` set, not expired) → `toHaveNoViolations()`.
- OfferDetail expired branch → no violations.
- AccountGate each reason → no violations.

Run → fix any violations in the components inline (label buttons, heading order, link discernible text), re-run → GREEN. Commit `test(5b-E): a11y audit for OfferDetail + AccountGate`.

---

### Task 7: full-suite run + self-verify

- `cd apps/web && npx vitest run app/offers lib/after5/__tests__/match.test.ts` → all GREEN.
- `npx tsc --noEmit` clean; lint clean.
- Manually confirm: no `app/offers/[x]` sibling exists (route-collision, bug class 1) — `ls apps/web/app/offers`.
- Append a short "browser verification follows in H" note to the commit body (jsdom passed; two-context Playwright is H, not E — matches §4.3).
- Commit any lint/format fixups `chore(5b-E): suite green + lint`.

**Do not merge.** Stop after Task 7; the user reviews before merge (roadmap Task 6 Steps 4–5).

---

## Prerequisite flagged (NOT authored by this plan)

**Risk E-R1 migration** — `date_instances` recipient-read policy. Without it, `OfferDetail`'s `date` prop is null and the screen shows the "details unlock when you accept" degrade (covered by tests). The plan ships E green either way. Recommend the user land this migration (predicate in the spec) before E's H-E2E run so the offered date renders. Author it in A's band, not in E.

---

## Self-review (plan vs spec)

- **Coverage:** every spec deliverable maps to a task — match.ts wrappers (T1), ExpiryCountdown incl. zombie threshold (T2), AccountGate + deriveGateReason all reasons (T3), OfferDetail accept/pass/withdraw + error→toast + expired + date-null degrade + inline gate (T4), server page flag/recipient-403/gate/hinted-embeds (T5), a11y (T6), verify (T7). Spec's withdraw-on-OfferDetail (E-D1), 403, ComingSoonBanner reuse, navigation targets all present.
- **Placeholders:** none — every handler body, query, FK hint, and copy source is concrete.
- **Type consistency:** `acceptOffer→Promise<string>`, `passOffer→Promise<void>`, `withdraw(instance)` reused, `GateReason`/`deriveGateReason`/`OfferDetailProps` fixed in the header and used verbatim in T3/T4/T5. The `instanceId` source (offers FK column, readable; not the RLS-hidden embed) is reconciled between T5 and T4's withdraw-fallback.
- **Bug classes:** (1) route-collision checked T5/T7; (2) RLS — candidate reads own offer + own profile + host via reveal RLS (all confirmed readable in spec); the one gap (date_instances) is flagged E-R1 with a degrade path so no task is blocked; (3) embed FK hints baked into T5's query.
- **Backend truth:** accept returns bare uuid string (T1), pass void no-idem (T1), error string-code branching (T4) — all match the coherency audit. No divergence from the roadmap; E-D1 (withdraw placement) and E-R1 (date RLS) are the two autonomous calls, both justified in the spec.
