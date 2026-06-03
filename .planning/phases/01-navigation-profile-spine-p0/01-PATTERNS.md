# Phase 1: Navigation & Profile Spine (P0) - Pattern Map

**Mapped:** 2026-06-03
**Files analyzed:** 13 (3 new, 10 modified/extracted)
**Analogs found:** 13 / 13 (every file has a strong in-repo analog — this is pure brownfield reuse)

> BROWNFIELD. No new files invent structure; each maps to a live, production analog three feet away. The risk this phase carries is re-inventing existing primitives — every excerpt below is something to COPY, not redesign. Edit ONLY the main checkout under `/Users/lucas/Projects/After5/apps/...`; never `.claude/worktrees/`.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/web/components/DeepRouteHeader.tsx` | component (nav chrome) | presentational | `apps/web/app/account/page.tsx:76-80` (masthead `<header>`) + `account/profile/page.tsx:75-81` (ArrowLeft `Link`) | exact (composite) |
| `apps/web/app/account/preferences/page.tsx` | route (RSC) | request-response (SSR read) | `apps/web/app/onboarding/preferences/page.tsx` | exact |
| `apps/web/app/account/preferences/<SelfView/PrefsForm>` self-view sheet | component (client wrapper) | event-driven (open/close) | `apps/web/app/matches/[lockId]/RevealModal.tsx` | exact |
| `apps/web/components/PreferencesForm.tsx` (extracted) | component (client form) | CRUD (write) | `apps/web/app/onboarding/steps/PreferencesStep.tsx` | exact (extract-in-place) |
| `apps/web/app/account/page.tsx` | route (RSC) | request-response (SSR read) | self (enhance in place) | self |
| `apps/web/components/BottomTabShell.tsx` | component (nav) | presentational | self (2-line edit) | self |
| `apps/web/components/UserMenu.tsx` | component (nav) | presentational | self (1-line edit) | self |
| `apps/web/app/matches/[lockId]/page.tsx` | route (RSC) | request-response | self (add header + guard header) | self |
| `apps/web/app/matches/[lockId]/rate/page.tsx` | route (RSC) | request-response | matches/[lockId]/page.tsx | role-match |
| `apps/web/app/offers/[offerId]/page.tsx` | route (RSC) | request-response | matches/[lockId]/page.tsx | role-match |
| `apps/web/app/messages/[threadId]/page.tsx` | route (RSC) | request-response | matches/[lockId]/page.tsx | role-match |
| `apps/web/app/dates/[slug]/interested/page.tsx` | route (RSC) | request-response | matches/[lockId]/page.tsx | role-match |
| `apps/web/app/account/notifications/page.tsx` | route (RSC) | request-response | self (add header) | self |

Note: `apps/web/app/inbox/[threadId]/page.tsx` is a one-line re-export of `messages/[threadId]/page.tsx` — it inherits the header automatically. Add the header to the SHARED messages page, do NOT fork.

---

## Pattern Assignments

### `apps/web/components/DeepRouteHeader.tsx` (NEW — component, presentational)

**Analogs:** `account/page.tsx:76-80` (the masthead header shell to mirror) + `account/profile/page.tsx:8,75-81` (the existing ArrowLeft back-`Link`) + `BottomTabShell.tsx:84,99` (44px tap target + a11y conventions).

**Sticky-header shell to mirror** (from `account/page.tsx:76-80`):
```tsx
<header className="sticky top-0 z-30 border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-md">
  <nav aria-label="masthead" className="mx-auto flex w-full max-w-[420px] items-center justify-between px-5 py-3.5">
    <Link href="/" className="font-heading text-2xl lowercase text-shell-accent">after5</Link>
  </nav>
</header>
```

**Existing back-arrow link** (from `account/profile/page.tsx:8,75-81`) — the scattered pattern this primitive REPLACES:
```tsx
import { ArrowLeft } from 'lucide-react';
// ...
<Link
  href="/account"
  className="inline-flex items-center gap-1.5 font-body text-[13px] lowercase text-shell-ink/60 transition hover:text-shell-ink"
>
  <ArrowLeft className="h-4 w-4" aria-hidden />
  back
</Link>
```

**Tap-target + focus-ring convention to copy** (from `BottomTabShell.tsx:83-84`): `min-h-[44px]` / `h-11 w-11`, `focus-visible:outline-none focus-visible:ring-shell-accent/40`, decorative glyphs `aria-hidden`, the control carries `aria-label="back"`.

**Recommended API** (server component — pure `Link`, no `'use client'`; RESEARCH Pattern 1, lines 188-233):
```tsx
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface DeepRouteHeaderProps {
  backHref: string;          // STATIC parent (D-08) — NEVER router.back()/history.back()
  backLabel: string;         // a11y label, e.g. 'back to matches'
  title?: string;
  right?: React.ReactNode;   // optional action slot (e.g. a rate CTA)
  className?: string;
}
```
**Critical (D-08, Pitfall 1):** static `backHref` only. Deep routes are cold-entry points (every one has `redirect('/login?next=...')`), so `history.back()` exits the app. The component must NOT import `useRouter`/`usePathname`.

**Why server component:** pure `<Link>`, so it drops straight into the SSR deep-route pages below with no client boundary (mirrors how `account/page.tsx` renders its masthead server-side).

---

### `apps/web/app/account/preferences/page.tsx` (NEW — route, RSC, SSR read)

**Analog:** `apps/web/app/onboarding/preferences/page.tsx` (exact — same columns, same parser, same form).

**Copy the auth gate + read + parser wholesale** (onboarding/preferences/page.tsx:6-35):
```tsx
export const dynamic = 'force-dynamic';

// EXTRACT this parser to a shared util and reuse (Pitfall 3) — do not re-derive.
// age_pref is stored canonical as '[lo,hi)' (upper exclusive). Parse to inclusive min/max.
function parseAgePref(raw: unknown): { min: number; max: number } {
  if (typeof raw !== 'string') return { min: 25, max: 40 };
  const m = raw.match(/^\[(\d+),(\d+)\)$/) ?? raw.match(/^\[(\d+),(\d+)\]$/);
  if (!m) return { min: 25, max: 40 };
  const lo = Number(m[1]); const hiRaw = Number(m[2]);
  const inclusiveHi = raw.endsWith(')') ? hiRaw - 1 : hiRaw;
  return { min: lo, max: inclusiveHi };
}

export default async function PreferencesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account/preferences');   // CHANGE next= target (V2 auth gate, MUST keep)

  const { data: p } = await supabase
    .from('profiles')
    .select('gender, gender_preferences, age_pref, distance_pref_km, dealbreakers, dating_enabled')  // + dating_enabled for the toggle
    .eq('id', user.id).maybeSingle();
  // ...build PreferencesInitial identically...
}
```

**Page shell** — use the deep-route shell, NOT `OnboardingShell`. Mirror `account/notifications/page.tsx:24-30` + the deep-route spacing (`pb-20`, no bottom nav, per UI-SPEC §Surface 4):
```tsx
return (
  <main className="min-h-dvh bg-shell-base">
    <DeepRouteHeader title="preferences" backHref="/account" backLabel="back to your account" />
    <div className="mx-auto w-full max-w-[420px] px-5 pb-20 pt-8">
      <h1 className="font-heading text-3xl lowercase text-shell-ink">settings</h1>
      <p className="mt-1 font-body text-sm text-shell-ink/70">who we line up for you. tweak it whenever.</p>
      <PreferencesForm mode="account" userId={user.id} initial={initial} datingEnabled={p?.dating_enabled ?? false} />
    </div>
  </main>
);
```
**Security (V2/V4):** keep the `getUser()` → `redirect('/login?next=...')` gate; derive `userId` server-side, never accept it from the client. `savePreferences` writes `.eq('id', userId)` under RLS `auth.uid()`.

---

### `apps/web/components/PreferencesForm.tsx` (NEW — extracted from PreferencesStep; client form, CRUD write)

**Analog:** `apps/web/app/onboarding/steps/PreferencesStep.tsx` (extract the form body verbatim; make the post-save action injectable).

**Extract these verbatim** (PreferencesStep.tsx): the `StickerChip` component (lines 26-53), all field state (57-62), `toggle()` (66-68), `numberClass` (91-94), and the entire JSX field block (96-147 — gender radios, "show me" checkboxes, age inputs, distance slider, dealbreaker chips, error card). The `StickerChip` should be lifted to shared (UI-SPEC reuse map) and reused by both onboarding and account.

**The ONLY thing that differs is the post-save branch** (PreferencesStep.tsx:70-89 — the coupling to break, Pitfall 2):
```tsx
// CURRENT (onboarding-only) — save is shared, the tail is what forks:
async function handleContinue() {
  const candidate = { gender, gender_preferences: wants, age_min: ageMin, age_max: ageMax, distance_pref_km: distance, dealbreakers };
  const parsed = PreferencesInputSchema.safeParse(candidate);     // KEEP — reuse PreferencesInputSchema (V5)
  if (!parsed.success) { setErrorMsg(...); setPhase('error'); return; }
  setPhase('saving'); setErrorMsg('');
  try {
    const client = browserAfter5Client();
    await savePreferences(client, userId, parsed.data);           // IDENTICAL for both modes
    await advanceOnboarding(client, 'phone_verify');              // ← onboarding ONLY
    router.push('/onboarding/phone');                             // ← onboarding ONLY
  } catch (e) { setErrorMsg(...); setPhase('error'); }
}
```

**Mode-aware target** (RESEARCH Pattern 2, lines 241-256):
```tsx
export function PreferencesForm({ mode, userId, initial, datingEnabled }: {
  mode: 'onboarding' | 'account'; userId: string; initial: PreferencesInitial; datingEnabled?: boolean;
}) {
  // ...same fields/validation...
  async function handleSave() {
    // ...parse identically...
    await savePreferences(client, userId, parsed.data);
    if (mode === 'onboarding') {
      await advanceOnboarding(client, 'phone_verify');
      router.push('/onboarding/phone');
    } else {
      toast.success('preferences saved');   // sonner; account mode stays put
      router.refresh();
    }
  }
}
```
**Critical:** account mode must NEVER call `advanceOnboarding` or push `/onboarding/*` (Pitfall 2 / REQ-E4 test). Onboarding's `PreferencesStep` must keep its exact behavior — the safest refactor is to make `PreferencesStep` render `<PreferencesForm mode="onboarding" .../>`.

**Dating on/off toggle (E4 / D-09)** — relocate `EnableDatingButton`'s gated write into this form (`home/EnableDatingButton.tsx:20-28`):
```tsx
const { error } = await client.from('profiles').update({ dating_enabled: true }).eq('id', user.id);
if (error) { setMsg(error.message); setPhase('error'); return; }
router.refresh();
```
**Net-new (A3 / Open Q1):** account context needs the ON→OFF path (the button is ON-only today). Render a labelled `dating is on` / `turn dating on` control; OFF/pause is a neutral ink-outline button with a one-line confirm (UI-SPEC copy: `pause dating? you'll stop showing up in feeds till you flip it back on.`). Surface the OFF cascade question to the founder before shipping the off-switch. The DB age-gate trigger stays the hard gate — do not bypass.

---

### Self-view sheet wrapper (NEW — client component, event-driven)

**Analog:** `apps/web/app/matches/[lockId]/RevealModal.tsx` (EXACT — already a thin `vaul` Drawer wrapping `ProfileCard`; D-03 reuse target).

**Copy the whole wrapper** (RevealModal.tsx:1-43) — re-title for the self-view, feed it the OWNER's own signed photos + fields:
```tsx
'use client';
import { Drawer } from 'vaul';
import { ProfileCard, type ProfileCardPrompt } from '@/components/ProfileCard';

export function SelfViewSheet({ open, onOpenChange, name, age, place, pronouns, photos, vibe_tags, prompts }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  name: string; age: number | null; place: string | null; pronouns: string | null;
  photos: string[]; vibe_tags: string[]; prompts: ProfileCardPrompt[];
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content
          aria-label="as others see it"
          className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-shell-base p-4 pb-10 outline-none"
        >
          <Drawer.Title className="sr-only">as others see it</Drawer.Title>
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-shell-ink/15" aria-hidden />
          <ProfileCard name={name} age={age} place={place} pronouns={pronouns}
            photos={photos} vibe_tags={vibe_tags} prompts={prompts} />
          {/* instagram_handle intentionally OMITTED — self-preview, not a contact card (A1) */}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
```

**ProfileCard contract** (`components/ProfileCard.tsx:14-26` — what to feed it): `name, age, place, pronouns?, occupation?, height_cm?, photos[] (signed clear, primary first), vibe_tags[], prompts[{label,answer}]`. Do NOT pass `instagram_handle` (no PII in the self-preview).

---

### `apps/web/app/account/page.tsx` (MODIFY — route, RSC, enhance in place per D-01)

**Analog:** self. The hub already does the right things — this is ADDITIVE (Pitfall 4: do not over-strip; keep saved-plans wedge, sign-out, edit-profile link).

**Keep the existing skeleton** (account/page.tsx:42-49,75-80,216-218): `force-dynamic`, `getUser()` → `redirect('/login?next=/account')`, the masthead `<header>`, `<NotificationToast userId>` + `<BottomTabShell userId>` at the bottom.

**Widen the profiles read** — the current select is only `first_name` (line 51-55). Add identity + dating-summary columns (RESEARCH line 263-264; mirror `account/profile/page.tsx:23-30` which already reads them):
```tsx
supabase.from('profiles')
  .select('first_name, age, city, neighborhood, verification, clear_photo_url, vibe_tags, prompt_answers, pronouns, height_cm, occupation')
  .eq('id', user.id).maybeSingle(),
supabase.from('profiles_private').select('bio, instagram_handle').eq('user_id', user.id).maybeSingle(),
```

**Copy the owner-photo load block verbatim** (account/profile/page.tsx:10,32-52) for the self-view photos (gallery + legacy single-photo fallback):
```tsx
import { listMyPhotos, signClearUrls } from '@/lib/after5/photos';
const rows = await listMyPhotos(supabase, user.id);
const urls = await signClearUrls(supabase, rows.map((r) => r.clear_path));
// ...legacy clear_photo_url fallback when no gallery rows...
```

**Copy the prompt-label join** (matches/[lockId]/page.tsx:88-99) to turn `prompt_answers` into `{label, answer}[]` for ProfileCard.

**Reuse the existing link-row visual** (account/page.tsx:92-108 — icon well + title + `ArrowRight`) for the NEW secondary links: `edit profile` (`/account/profile`), `preferences` (`/account/preferences`), `notifications` (`/account/notifications`). Keep the `your nights` row (D-04 surfaces posted nights here, not on the dates tab). Add the identity block (reuse `Polaroid tone="dating"`) + a `preview my profile` (Eye icon) row that opens `SelfViewSheet`. No computed stats (deferred to E17/Phase 6).

---

### `apps/web/components/BottomTabShell.tsx` (MODIFY — 2-line edit, E2/D-04/D-05)

**Analog:** self. Edit only the `TABS` href map (lines 22, 24); `isActive()` (27-29) already derives from `usePathname` — no other change.
```tsx
// line 22: { key: 'dates',   ..., href: '/matches', ... }   // D-04: was '/my-nights'
// line 24: { key: 'profile', ..., href: '/account', ... }   // D-05: was '/home'
```
`isActive` uses `pathname.startsWith('${href}/')`, so `/matches/[lockId]` lights dates and `/account/*` lights profile automatically. Active label stays ink (pink-on-cream fails AA, per the file's own comment lines 9-11).

---

### `apps/web/components/UserMenu.tsx` (MODIFY — 1-line edit, E2/D-05)

**Analog:** self. Edit only `MENU_ITEMS[0]` (line 29):
```tsx
{ href: '/account', label: 'your profile' },   // D-05: was '/home'
```
Keep `/my-nights` ("your nights"), `/matches`, `/messages` as-is.

---

### Deep-route pages — `matches/[lockId]`, `.../rate`, `offers/[offerId]`, `messages/[threadId]`, `dates/[slug]/interested`, `account/notifications` (MODIFY — RSC, E1/D-07-nav)

**Analog:** `matches/[lockId]/page.tsx` (the canonical guard + render shape every deep route shares).

**These routes already share an exact skeleton** (verified across all 6): `export const dynamic = 'force-dynamic'` → `createClient()` → `getUser()` → `redirect('/login?next=...')` → (most) `isMatchEnabledForViewer` flag → FK-hinted RLS read → guard branch → render client child. E1 wraps the rendered output AND every link-less guard branch with `<DeepRouteHeader>`.

**Mount on the happy path** (RESEARCH lines 374-382):
```tsx
return (
  <>
    <DeepRouteHeader backHref="/matches" backLabel="back to matches" title={counterpart.first_name ?? undefined} />
    <LockDetail ... />
  </>
);
```

**Add the SAME header to each link-less guard `<main>`** — the current trapped terminals to fix (matches/[lockId]/page.tsx:42-51, dates/[slug]/interested guard, messages "not your conversation", the rate "not yet"/"already rated" states):
```tsx
if (!lock || (lock.creator_id !== user.id && lock.matched_user_id !== user.id)) {
  return (
    <>
      <DeepRouteHeader backHref="/matches" backLabel="back to matches" />
      <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">
        <div className="mx-auto max-w-[420px]">
          <h1 className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">that's not your match</h1>
          <p className="mt-4 font-body text-lg text-shell-ink/70">this one isn't yours to see.</p>
        </div>
      </main>
    </>
  );
}
```

**Static back targets per route (D-08 / Open Q3):**
| Route | `backHref` | `backLabel` |
|-------|-----------|-------------|
| `/matches/[lockId]` | `/matches` | `back to matches` |
| `/matches/[lockId]/rate` | `/matches/[lockId]` | `back to your match` |
| `/offers/[offerId]` | `/inbox` | `back to inbox` |
| `/messages/[threadId]` (+ `/inbox/[threadId]` re-export) | `/inbox` | `back to inbox` |
| `/dates/[slug]/interested` | `/my-nights` | `back to your nights` |
| `/account/notifications` | `/account` | `back to your account` |

**Special cases:**
- `matches/[lockId]/rate/page.tsx` currently `redirect('/matches')` on guard (line, ~`if (!lock ...) redirect('/matches')`) — that's already escapable, but its "not yet"/"already rated" body states (`<main>` with only h1+p) need the header so the user can leave. Back to `/matches/[lockId]`.
- `messages/[threadId]/page.tsx` is the SHARED module; `inbox/[threadId]/page.tsx` re-exports it (`export { default, dynamic } from '../../messages/[threadId]/page'`). Add the header ONCE to the messages page — do NOT fork. Conversation route gets the back-header ONLY; outbound cross-links are Phase 6/E18 (deferred).
- `account/notifications/page.tsx` already has a clean `<main>` + h1 (lines 24-30); just prepend `<DeepRouteHeader>` and ensure it's linked from the hub (E3).
- Do NOT mount `BottomTabShell` on these routes (D-07-nav anti-pattern).

---

## Shared Patterns

### Auth gate (V2/V4 — apply to every new/modified RSC route)
**Source:** `account/page.tsx:42-48`, `matches/[lockId]/page.tsx:23-25`
```tsx
export const dynamic = 'force-dynamic';
const supabase = await createClient();          // @/lib/supabase/server — RLS-bound
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect('/login?next=<this-route>');
```
Derive `userId` server-side; never trust a client-supplied id. RLS `auth.uid()` is the backstop.

### Barbiecore token vocabulary (apply to all new UI)
**Source:** DESIGN-SYSTEM.md + every analog above
- Canvas `bg-shell-base`; surfaces `bg-white` / `bg-shell-pink`; text `text-shell-ink` (+ `/60 /40 /10` tints); accent `shell-accent` (reserved list per UI-SPEC §Color).
- `font-heading` (Caprasimo) display/heads, `font-body` (Fredoka) body; exactly two weights (400 + `font-semibold`). All chrome lowercase.
- Container `mx-auto w-full max-w-[420px] px-5`; primary surfaces `rounded-3xl`; `shadow-fun`. Tab-root pages `pb-28`; deep routes `pb-20` (no nav clearance).
- `cn()` from `@/lib/cn` for conditional classes — never concatenate.
- Self-view (`ProfileCard`) stays Tier-3 neutral (`profile.base`/`profile.ink`) — do not re-skin it Barbiecore.

### A11y conventions (apply to every interactive control)
**Source:** `BottomTabShell.tsx:81-99`, `account/page.tsx:97`, `RevealModal.tsx:25-29`
- Tap targets ≥44px (`min-h-[44px]` / `h-11 w-11`); `focus-visible:outline-none focus-visible:ring-shell-accent/40`.
- Icon-only controls carry `aria-label`; decorative glyphs `aria-hidden`. Active nav uses `aria-current="page"`. One `<h1>` per surface; vaul `Drawer.Title` (sr-only allowed) for sheet a11y.

### Preferences persistence (E4 — the single write path)
**Source:** `packages/api-client/src/profile.ts:45-61` (`savePreferences`) — re-exported via `@/lib/after5/client` and `@after5/api-client`
- Idempotent `profiles.update().eq('id', userId)` under RLS; owns the `age_pref` int4range literal. Validate with `PreferencesInputSchema` (V5) before calling. Do NOT hand-roll a `profiles.update` for prefs.

### Sonner / vaul / motion (polish)
**Source:** `RevealModal.tsx` (vaul), CLAUDE.md stack — `framer-motion`, `vaul@1.1.2`, `sonner@2.0.7` installed. Account-mode save toasts via `sonner`; every transition carries `motion-reduce:`.

---

## No Analog Found

None. Every file in scope maps to a live, verified in-repo analog. The only genuinely net-new behavior is the **dating ON→OFF toggle** in `PreferencesForm` (the existing `EnableDatingButton` is ON-only) — its write pattern is borrowed from `EnableDatingButton`, but the OFF-cascade side effects (withdraw active offers? hide from feeds?) are an unanswered product question (A3 / Open Q1) the planner must surface to the founder before shipping the off-switch.

---

## Metadata

**Analog search scope:** `apps/web/components/`, `apps/web/app/account/**`, `apps/web/app/onboarding/**`, `apps/web/app/matches/**`, `apps/web/app/offers/**`, `apps/web/app/messages|inbox/**`, `apps/web/app/dates/[slug]/interested/**`, `apps/web/app/home/**`, `packages/api-client/src/profile.ts`
**Files read in full:** BottomTabShell, UserMenu, account/page, ProfileCard, account/profile/page, onboarding/preferences/page, EnableDatingButton, PreferencesStep, profile.ts (1-110), matches/[lockId]/page, RevealModal; head-scanned offers/messages/inbox/interested/notifications/rate pages.
**Pattern extraction date:** 2026-06-03
**Landmine:** 28 locked agent worktrees under `.claude/worktrees/` touch profile/messages/my-nights surfaces. Planner should add a Wave-0 rebase/reconcile check before editing `account/page.tsx`, `BottomTabShell.tsx`, or the messages route. Edit ONLY the main checkout.
