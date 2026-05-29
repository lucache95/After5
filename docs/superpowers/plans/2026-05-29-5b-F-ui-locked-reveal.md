# Sub-project F — UI locked + reveal + ratings (implementation plan)

Date: 2026-05-29
Spec: `docs/superpowers/specs/2026-05-29-5b-F-ui-locked-reveal-design.md`
Execute with: `superpowers:subagent-driven-development` (or `executing-plans`). TDD per task: test → red → implement → green. Commit each task. All commits end with the trailer:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

Conventions reused from D/E: `cn` from `@/lib/cn`, `createClient` from `@/lib/supabase/server`, `browserAfter5Client` from `@/lib/after5/client`, `Polaroid` from `@/components/Polaroid`, `sonner` toast, `framer-motion` `useReducedMotion`, `vaul` `Drawer`. Barbiecore tokens: `bg-shell-base`, `bg-shell-pink`, `text-shell-ink`, `bg-shell-accent`, `font-heading` (Caprasimo), `font-body` (Fredoka). Lowercase, stop-slop copy. `export const dynamic = 'force-dynamic'` on every server page.

---

### Task 0: Verify schema, regen types, sanity-check

No code. Confirm against live DB and fix the stale type:

```bash
export PGPASSWORD=postgres
PSQL="psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -X"
$PSQL -c "SELECT enum_range(NULL::lock_status);"          # expect {active,completed,cancelled}
$PSQL -c "\d locks" | grep rating_closed_at               # confirm column present
$PSQL -c "SELECT column_name FROM information_schema.columns WHERE table_name='profiles' AND column_name='bio';"  # expect ZERO rows
```

Regenerate types so `locks.rating_closed_at` is present (the committed `database.ts` is stale):

```bash
cd /Users/lucas/Projects/After5
supabase gen types typescript --local > packages/types/src/database.ts
git diff --stat packages/types/src/database.ts   # should add rating_closed_at to locks Row/Insert/Update
```

If `supabase gen types` is unavailable, add `rating_closed_at: string | null` to the `locks` Row manually and note it. Commit: `chore(5b-F): regen types for locks.rating_closed_at`.

**Verify:** `pnpm -C apps/web tsc --noEmit` (or repo's typecheck) passes after regen.

---

### Task 1: Foundation — `submitRating` + `subscribeLockInserts`

**Test first** `apps/web/lib/after5/__tests__/match.rating.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn();
const getUser = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({
    auth: { getUser },
    from: () => ({ insert }),
  }),
}));

import { submitRating, MatchError } from '@/lib/after5/match';

beforeEach(() => {
  insert.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'me' } }, error: null });
});

const input = {
  lockId: 'lock-1', rateeId: 'them',
  showed_up: true, on_time: false, cancelled_with_notice: null, unsafe_or_disrespectful: false,
};

describe('submitRating', () => {
  it('inserts the rating with rater_id from the session and returns ok', async () => {
    insert.mockResolvedValue({ error: null });
    await expect(submitRating(input)).resolves.toBe('ok');
    expect(insert).toHaveBeenCalledWith({
      lock_id: 'lock-1', rater_id: 'me', ratee_id: 'them',
      showed_up: true, on_time: false, cancelled_with_notice: null, unsafe_or_disrespectful: false,
    });
  });

  it('maps a 23505 unique violation to already_rated', async () => {
    insert.mockResolvedValue({ error: { code: '23505', message: 'dup' } });
    await expect(submitRating(input)).resolves.toBe('already_rated');
  });

  it('throws MatchError on any other error', async () => {
    insert.mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    await expect(submitRating(input)).rejects.toBeInstanceOf(MatchError);
  });

  it('throws when there is no authed user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(submitRating(input)).rejects.toBeInstanceOf(MatchError);
  });
});
```

**Implement** — append to `apps/web/lib/after5/match.ts`:

```ts
// Sub-project F (post-date rating). match_ratings has NO RPC — it's a direct
// table insert under RLS (policy match_ratings_rater_insert: rater_id=auth.uid()
// AND the lock pairs rater↔ratee). So this wrapper inserts via the browser client
// rather than functions.invoke. The unique (lock_id, rater_id) constraint means a
// resubmit returns 'already_rated' (terminal success), not an error.
export interface RatingInput {
  lockId: string;
  rateeId: string;
  showed_up: boolean | null;
  on_time: boolean | null;
  cancelled_with_notice: boolean | null;
  unsafe_or_disrespectful: boolean | null;
}

export async function submitRating(input: RatingInput): Promise<'ok' | 'already_rated'> {
  const client = browserAfter5Client();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new MatchError('auth_mismatch');
  const { error } = await client.from('match_ratings').insert({
    lock_id: input.lockId,
    rater_id: user.id,
    ratee_id: input.rateeId,
    showed_up: input.showed_up,
    on_time: input.on_time,
    cancelled_with_notice: input.cancelled_with_notice,
    unsafe_or_disrespectful: input.unsafe_or_disrespectful,
  });
  if (error) {
    if (error.code === '23505') return 'already_rated';
    throw new MatchError('server_error', error.code, error.message);
  }
  return 'ok';
}
```

**Implement** — append to `apps/web/lib/after5/realtime.ts`:

```ts
export type LockRow = Database['public']['Tables']['locks']['Row'];

// Sub-project F (MatchConfirmation). User-scoped channel: a viewer gets locks
// inserted where they participate. RLS (locks_party_read) already gates which
// rows the socket delivers, so no server-side filter string is needed; the
// caller still re-checks the new row references this viewer.
export function subscribeLockInserts(
  userId: string,
  onInsert: (row: LockRow) => void,
): () => void {
  const client = browserAfter5Client();
  const ch = client
    .channel(`locks:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'locks' },
      (payload: { new: LockRow }) => onInsert(payload.new),
    )
    .subscribe();
  return () => {
    client.removeChannel(ch);
  };
}
```

Add a small realtime test mirroring the existing `realtime.test.ts` (channel name `locks:<id>`, INSERT handler invokes callback, unsubscribe removes channel).

**Verify:** new tests green; existing match/realtime tests still green; typecheck passes.
Commit: `feat(5b-F): add submitRating wrapper + subscribeLockInserts`.

---

### Task 2: Pure helpers — `lock-view.ts` (server-safe, NO 'use client')

**Test first** `apps/web/app/matches/__tests__/lock-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickCounterpart, bucketLocks, ratingOpensAt, isRatingOpen, lockStatusLabel } from '../lock-view';

const profile = (id: string) => ({ id, first_name: 'x', age: 30, city: 'c', neighborhood: null, clear_photo_url: null, vibe_tags: [] });

describe('pickCounterpart', () => {
  it('returns matched when viewer is creator', () => {
    const lock = { creator_id: 'me', matched_user_id: 'them', creator: profile('me'), matched: profile('them') } as any;
    expect(pickCounterpart(lock, 'me')?.id).toBe('them');
  });
  it('returns creator when viewer is matched', () => {
    const lock = { creator_id: 'them', matched_user_id: 'me', creator: profile('them'), matched: profile('me') } as any;
    expect(pickCounterpart(lock, 'me')?.id).toBe('them');
  });
});

describe('bucketLocks', () => {
  it('splits active from past', () => {
    const rows = [
      { id: '1', status: 'active' }, { id: '2', status: 'completed' }, { id: '3', status: 'cancelled' },
    ] as any[];
    const { active, past } = bucketLocks(rows);
    expect(active.map(r => r.id)).toEqual(['1']);
    expect(past.map(r => r.id)).toEqual(['2', '3']);
  });
});

describe('rating window (starts_at + duration + 2h)', () => {
  const instance = { starts_at: '2026-05-01T18:00:00Z', time_range: '["2026-05-01 18:00:00+00","2026-05-01 20:30:00+00")' } as any;
  it('opens 2h after time_range upper', () => {
    expect(ratingOpensAt(instance)?.toISOString()).toBe('2026-05-01T22:30:00.000Z');
  });
  it('closed before open time', () => {
    expect(isRatingOpen(instance, new Date('2026-05-01T22:29:00Z'))).toBe(false);
  });
  it('open at exactly the boundary', () => {
    expect(isRatingOpen(instance, new Date('2026-05-01T22:30:00Z'))).toBe(true);
  });
  it('falls back to starts_at + 150 + 120 when time_range is null', () => {
    expect(ratingOpensAt({ starts_at: '2026-05-01T18:00:00Z', time_range: null } as any)?.toISOString())
      .toBe('2026-05-01T22:30:00.000Z');
  });
});

describe('lockStatusLabel', () => {
  it('maps statuses to lowercase copy', () => {
    expect(lockStatusLabel('active')).toBe('locked in');
    expect(lockStatusLabel('completed')).toBe('done');
    expect(lockStatusLabel('cancelled')).toBe('cancelled');
  });
});
```

**Implement** `apps/web/app/matches/lock-view.ts`:

```ts
// Server-safe pure helpers for sub-project F. NO 'use client' — these are imported
// by the server pages (matches/page.tsx, [lockId]/page.tsx, rate/page.tsx) and by
// client components; a 'use client' module's functions can't be called from a
// server component (bug class 5, the E deriveGateReason lesson).
import type { Database } from '@after5/types';

type LockStatus = Database['public']['Enums']['lock_status'];

export interface PartyProfile {
  id: string;
  first_name: string | null;
  age: number | null;
  city: string | null;
  neighborhood: string | null;
  clear_photo_url: string | null;
  vibe_tags: string[];
}

export interface LockRowWithParties {
  id: string;
  status: LockStatus;
  locked_at: string;
  rating_closed_at: string | null;
  cancel_reason: string | null;
  creator_id: string;
  matched_user_id: string;
  date_instance_id: string;
  creator: PartyProfile | null;
  matched: PartyProfile | null;
  instance: { id: string; starts_at: string; time_range: string | null } | null;
}

const RATING_GRACE_MIN = 120;
const DEFAULT_DURATION_MIN = 150;

export function pickCounterpart(
  lock: Pick<LockRowWithParties, 'creator_id' | 'matched_user_id' | 'creator' | 'matched'>,
  viewerId: string,
): PartyProfile | null {
  return lock.creator_id === viewerId ? lock.matched : lock.creator;
}

export function bucketLocks<T extends { status: LockStatus }>(rows: T[]): { active: T[]; past: T[] } {
  const active: T[] = [];
  const past: T[] = [];
  for (const r of rows) {
    if (r.status === 'active') active.push(r);
    else past.push(r);
  }
  return { active, past };
}

// Parse the upper bound of a Postgres tstzrange literal: ["lower","upper") or [lower,upper).
function upperOfRange(range: string): Date | null {
  const m = range.match(/[,]\s*"?([^",)\]]+)"?\s*[\)\]]\s*$/);
  if (!m) return null;
  const d = new Date(m[1].replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function ratingOpensAt(instance: { starts_at: string; time_range: string | null } | null): Date | null {
  if (!instance) return null;
  let end: Date | null = instance.time_range ? upperOfRange(instance.time_range) : null;
  if (!end) {
    const start = new Date(instance.starts_at);
    if (Number.isNaN(start.getTime())) return null;
    end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60_000);
  }
  return new Date(end.getTime() + RATING_GRACE_MIN * 60_000);
}

export function isRatingOpen(
  instance: { starts_at: string; time_range: string | null } | null,
  now: Date = new Date(),
): boolean {
  const opens = ratingOpensAt(instance);
  return opens != null && now.getTime() >= opens.getTime();
}

export function lockStatusLabel(status: LockStatus): string {
  switch (status) {
    case 'active': return 'locked in';
    case 'completed': return 'done';
    case 'cancelled': return 'cancelled';
    default: return String(status);
  }
}
```

**Verify:** helper tests green (boundary at exactly +2h is the key one).
Commit: `feat(5b-F): pure lock-view helpers (counterpart, buckets, rating window)`.

---

### Task 3: `MatchesList.tsx` + `matches/page.tsx`

**Test first** `apps/web/app/matches/__tests__/MatchesList.test.tsx`: renders active + past buckets with counterpart name + status label; empty state shows "no locked dates yet." + `/feed` link; each card links to `/matches/<id>`.

**Implement** `apps/web/app/matches/MatchesList.tsx` (`'use client'`):

```tsx
'use client';
import Link from 'next/link';
import { Polaroid } from '@/components/Polaroid';
import { cn } from '@/lib/cn';
import { lockStatusLabel, type LockRowWithParties, type PartyProfile } from './lock-view';

export interface MatchCard {
  id: string;
  status: LockRowWithParties['status'];
  counterpart: PartyProfile | null;
  startsAt: string | null;
}

function whenLabel(iso: string | null): string {
  if (!iso) return 'date tbd';
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Card({ card }: { card: MatchCard }) {
  const name = card.counterpart?.first_name ?? 'someone';
  const past = card.status !== 'active';
  return (
    <Link
      href={`/matches/${card.id}`}
      className={cn(
        'flex items-center gap-4 rounded-3xl border-2 border-shell-ink/10 bg-white p-3 transition',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 hover:border-shell-ink/25',
        past && 'opacity-70',
      )}
    >
      <Polaroid src={card.counterpart?.clear_photo_url ?? ''} alt={name} size="sm" tone="dating" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-heading text-xl lowercase text-shell-ink">{name}</p>
        <p className="truncate font-body text-sm text-shell-ink/65">{whenLabel(card.startsAt)}</p>
      </div>
      <span className="shrink-0 rounded-full bg-shell-pink px-3 py-1 font-body text-xs font-semibold lowercase text-shell-ink">
        {lockStatusLabel(card.status)}
      </span>
    </Link>
  );
}

export function MatchesList({ active, past }: { active: MatchCard[]; past: MatchCard[] }) {
  if (active.length === 0 && past.length === 0) {
    return (
      <div className="mx-auto max-w-[420px] py-16 text-center">
        <h1 className="font-heading text-4xl lowercase text-shell-ink">no locked dates yet</h1>
        <p className="mt-3 font-body text-shell-ink/70">when you match, it shows up here.</p>
        <Link href="/feed" className="mt-6 inline-block rounded-full bg-shell-accent px-6 py-3 font-body font-semibold lowercase text-white">
          browse dates
        </Link>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[480px] space-y-8 px-4 py-6">
      <h1 className="font-heading text-4xl lowercase text-shell-ink">your matches</h1>
      {active.length > 0 && (
        <section aria-label="active matches" className="space-y-3">
          <h2 className="font-body text-sm font-semibold uppercase tracking-wide text-shell-ink/50">locked in</h2>
          {active.map((c) => <Card key={c.id} card={c} />)}
        </section>
      )}
      {past.length > 0 && (
        <section aria-label="past matches" className="space-y-3">
          <h2 className="font-body text-sm font-semibold uppercase tracking-wide text-shell-ink/50">past</h2>
          {past.map((c) => <Card key={c.id} card={c} />)}
        </section>
      )}
    </div>
  );
}
```

**Implement** `apps/web/app/matches/page.tsx` (server):

```tsx
// Server entry for /matches (spec §4.1). Lists the viewer's locks under their own
// RLS client (locks_party_read restricts to creator_id|matched_user_id=auth.uid()).
// Each lock embeds BOTH party profiles FK-hinted (locks has 3 FKs to profiles —
// bug class 4) so the counterpart's name/photo render in one query; the date
// instance is embedded via its FK for the time label (readable post-lock via the
// 127500 lock-stage policy).
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { MatchesList, type MatchCard } from './MatchesList';
import { bucketLocks, pickCounterpart, type LockRowWithParties } from './lock-view';

export const dynamic = 'force-dynamic';

export default async function MatchesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/matches');

  const { data: flagRow } = await supabase
    .from('feature_config').select('value').eq('key', 'match_v2_enabled').maybeSingle();
  if (flagRow?.value !== true) return <ComingSoonBanner />;

  const { data: rows } = await supabase
    .from('locks')
    .select(`
      id, status, locked_at, rating_closed_at, cancel_reason, creator_id, matched_user_id, date_instance_id,
      creator:profiles!locks_creator_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
      matched:profiles!locks_matched_user_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
      instance:date_instances!locks_date_instance_id_fkey ( id, starts_at, time_range )
    `)
    .order('locked_at', { ascending: false });

  const locks = (rows ?? []) as unknown as LockRowWithParties[];
  const toCard = (l: LockRowWithParties): MatchCard => ({
    id: l.id,
    status: l.status,
    counterpart: pickCounterpart(l, user.id),
    startsAt: l.instance?.starts_at ?? null,
  });
  const { active, past } = bucketLocks(locks);
  return <MatchesList active={active.map(toCard)} past={past.map(toCard)} />;
}
```

**Verify:** list test green; typecheck.
Commit: `feat(5b-F): /matches list + MatchesList`.

---

### Task 4: `RevealModal.tsx` + `Phase7Placeholder.tsx`

**Test first** `apps/web/app/matches/[lockId]/__tests__/RevealModal.test.tsx`: renders `first_name, age, city`, renders each `vibe_tags` chip, has NO bio text; dialog has `aria-modal`/label; Escape/close callback fires. `Phase7Placeholder.test.tsx`: exact headline + body copy, `role="region"` `aria-label="messages"`.

**Implement** `apps/web/app/matches/[lockId]/Phase7Placeholder.tsx`:

```tsx
// Exact audit-A10 copy. Caprasimo headline (font-heading) + Fredoka body
// (font-body). Honest about the 5b boundary — chat lands in phase 7.
'use client';
export function Phase7Placeholder() {
  return (
    <section role="region" aria-label="messages" className="rounded-3xl border-2 border-dashed border-shell-ink/20 bg-shell-base/60 p-6 text-center">
      <h2 className="font-heading text-2xl lowercase text-shell-ink">messages coming with phase 7</h2>
      <p className="mt-2 font-body text-shell-ink/70">
        matched users will get chat here. for now, swap numbers off-platform if you want to coordinate.
      </p>
    </section>
  );
}
```

**Implement** `apps/web/app/matches/[lockId]/RevealModal.tsx` (`'use client'`, vaul `Drawer` for built-in focus trap + escape):

```tsx
'use client';
import { Drawer } from 'vaul';
import { Polaroid } from '@/components/Polaroid';
import type { PartyProfile } from '../lock-view';

export function RevealModal({
  open, onOpenChange, person,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  person: PartyProfile;
}) {
  const name = person.first_name ?? 'your match';
  const place = person.neighborhood ?? person.city ?? null;
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content
          aria-label={`profile of ${name}`}
          className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-shell-base p-6 pb-10 outline-none"
        >
          <Drawer.Title className="sr-only">{name}'s profile</Drawer.Title>
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-shell-ink/15" aria-hidden />
          <div className="mx-auto flex max-w-[420px] flex-col items-center text-center">
            <Polaroid src={person.clear_photo_url ?? ''} alt={name} size="lg" tone="dating" />
            <h2 className="mt-4 font-heading text-3xl lowercase text-shell-ink">
              {name}{person.age != null ? `, ${person.age}` : ''}
            </h2>
            {place && <p className="mt-1 font-body text-shell-ink/70">{place.toLowerCase()}</p>}
            {person.vibe_tags.length > 0 && (
              <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label="vibe tags">
                {person.vibe_tags.map((tag) => (
                  <li key={tag} className="rounded-full bg-shell-pink px-3 py-1 font-body text-sm lowercase text-shell-ink">
                    {tag}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
```

**Verify:** both component tests green; jest-axe clean.
Commit: `feat(5b-F): RevealModal (Tier-3) + Phase7Placeholder`.

---

### Task 5: `MatchConfirmation.tsx` (reduced-motion safe)

**Test first** `__tests__/MatchConfirmation.test.tsx`: with `useReducedMotion` mocked `true`, renders NO particle elements and a `role="status"` announcement "you matched with {name}"; with `false`, renders particles marked `aria-hidden`. Mock framer-motion's `useReducedMotion`.

**Implement** `apps/web/app/matches/[lockId]/MatchConfirmation.tsx`:

```tsx
// Lock-fired celebration (spec §4.4). Shown once when this viewer's lock just
// fired (justLocked from ?just=1, or a Realtime locks INSERT). Decorative
// particles are framer-motion only (no canvas-confetti dep) and fully gated
// behind useReducedMotion; the match announcement is a role=status live region
// so screen readers hear it regardless of motion preference.
'use client';
import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/cn';

const PARTICLES = Array.from({ length: 14 }, (_, i) => i);

export function MatchConfirmation({ name, show }: { name: string; show: boolean }) {
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(show);

  useEffect(() => { setVisible(show); }, [show]);
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), 3200);
    return () => clearTimeout(t);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      <div className="pointer-events-auto mx-4 max-w-[360px] rounded-3xl bg-shell-base px-8 py-10 text-center shadow-[0_24px_56px_-14px_rgba(80,40,20,0.4)]">
        <p role="status" className="font-heading text-4xl lowercase leading-tight text-shell-ink">
          you matched with {name}
        </p>
        <p className="mt-3 font-body text-shell-ink/70">it's locked in. see the details below.</p>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="mt-6 rounded-full bg-shell-accent px-6 py-2.5 font-body font-semibold lowercase text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        >
          let's go
        </button>
      </div>
      {!reduce && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {PARTICLES.map((i) => (
            <motion.span
              key={i}
              className={cn('absolute top-1/2 left-1/2 block h-2 w-2 rounded-full', i % 2 ? 'bg-shell-accent' : 'bg-shell-pink')}
              initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              animate={{
                opacity: 0,
                x: Math.cos((i / PARTICLES.length) * Math.PI * 2) * 180,
                y: Math.sin((i / PARTICLES.length) * Math.PI * 2) * 180,
                scale: 0.4,
              }}
              transition={{ duration: 1.1, ease: 'easeOut' }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

**Verify:** motion test green (reduced-motion path renders no `motion.span`); axe clean.
Commit: `feat(5b-F): MatchConfirmation overlay (reduced-motion safe)`.

---

### Task 6: `LockDetail.tsx` + `[lockId]/page.tsx`

**Test first** `__tests__/LockDetail.test.tsx`: renders counterpart preview + "see their profile" trigger that opens RevealModal; renders Phase7Placeholder; for `active` lock shows "cancel this date" (opens drawer with CancelWithReasonPicker → onConfirm calls `cancelLock`); rate CTA hidden when `ratingOpen=false`, shown + links to `/rate` when true; cancelled lock shows no rate CTA. Mock `@/lib/after5/match` `cancelLock`.

**Implement** `apps/web/app/matches/[lockId]/LockDetail.tsx` (`'use client'`):

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Drawer } from 'vaul';
import { toast } from 'sonner';
import { Polaroid } from '@/components/Polaroid';
import { cn } from '@/lib/cn';
import { cancelLock, MatchError, messageForCode } from '@/lib/after5/match';
import { CancelWithReasonPicker } from '@/app/dates/[slug]/interested/CancelWithReasonPicker';
import type { PartyProfile } from '../lock-view';
import { RevealModal } from './RevealModal';
import { Phase7Placeholder } from './Phase7Placeholder';
import { MatchConfirmation } from './MatchConfirmation';

export interface LockDetailProps {
  lockId: string;
  status: 'active' | 'completed' | 'cancelled';
  counterpart: PartyProfile;
  startsAt: string | null;
  ratingOpen: boolean;
  justLocked: boolean;
}

function whenLabel(iso: string | null): string {
  if (!iso) return 'date tbd';
  return new Date(iso).toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function LockDetail({ lockId, status, counterpart, startsAt, ratingOpen, justLocked }: LockDetailProps) {
  const router = useRouter();
  const [revealOpen, setRevealOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = counterpart.first_name ?? 'your match';

  async function onCancel(reason: 'mutual' | 'no_show' | 'creator_pre_lock' | 'safety') {
    setBusy(true);
    try {
      await cancelLock(lockId, reason);
      toast('that date's called off.');
      setCancelOpen(false);
      router.refresh();
    } catch (e) {
      const code = e instanceof MatchError ? e.code : 'unknown';
      toast.error(messageForCode(code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[480px] space-y-6 px-4 py-6">
      <MatchConfirmation name={name} show={justLocked} />

      <header className="flex items-center gap-4">
        <Polaroid src={counterpart.clear_photo_url ?? ''} alt={name} size="md" tone="dating" />
        <div className="min-w-0">
          <h1 className="truncate font-heading text-3xl lowercase text-shell-ink">{name}</h1>
          <p className="font-body text-shell-ink/70">{whenLabel(startsAt)}</p>
        </div>
      </header>

      <button
        type="button"
        onClick={() => setRevealOpen(true)}
        className="w-full rounded-full bg-shell-pink px-6 py-3 font-body font-semibold lowercase text-shell-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
      >
        see their profile
      </button>
      <RevealModal open={revealOpen} onOpenChange={setRevealOpen} person={counterpart} />

      <Phase7Placeholder />

      {ratingOpen && status !== 'cancelled' && (
        <Link
          href={`/matches/${lockId}/rate`}
          className="block w-full rounded-full bg-shell-accent px-6 py-3 text-center font-body font-semibold lowercase text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        >
          rate this date
        </Link>
      )}

      {status === 'active' && (
        <>
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            className="w-full rounded-full border-2 border-shell-ink/20 px-6 py-3 font-body font-semibold lowercase text-shell-ink/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
          >
            cancel this date
          </button>
          <Drawer.Root open={cancelOpen} onOpenChange={setCancelOpen}>
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
              <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-shell-base p-6 pb-10 outline-none">
                <Drawer.Title className="sr-only">cancel this date</Drawer.Title>
                <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-shell-ink/15" aria-hidden />
                <CancelWithReasonPicker onConfirm={onCancel} busy={busy} />
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer.Root>
        </>
      )}

      {status === 'cancelled' && (
        <p className={cn('rounded-3xl bg-shell-ink/5 p-4 text-center font-body text-shell-ink/60')}>this date was cancelled.</p>
      )}
    </main>
  );
}
```

**Implement** `apps/web/app/matches/[lockId]/page.tsx` (server):

```tsx
// Server entry for /matches/[lockId] (spec §4.2). Loads the lock with FK-hinted
// embeds (locks has 3 profiles FKs — bug class 4), gates to participants (RLS
// locks_party_read already hides non-party rows; the id check is defense-in-depth),
// derives the counterpart + rating-window state, and renders LockDetail.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { LockDetail } from './LockDetail';
import { pickCounterpart, isRatingOpen, type LockRowWithParties } from '../lock-view';

export const dynamic = 'force-dynamic';

export default async function LockPage({
  params, searchParams,
}: {
  params: Promise<{ lockId: string }>;
  searchParams: Promise<{ just?: string }>;
}) {
  const { lockId } = await params;
  const { just } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/matches/${lockId}`);

  const { data: flagRow } = await supabase
    .from('feature_config').select('value').eq('key', 'match_v2_enabled').maybeSingle();
  if (flagRow?.value !== true) return <ComingSoonBanner />;

  const { data: row } = await supabase
    .from('locks')
    .select(`
      id, status, locked_at, rating_closed_at, cancel_reason, creator_id, matched_user_id, date_instance_id,
      creator:profiles!locks_creator_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
      matched:profiles!locks_matched_user_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
      instance:date_instances!locks_date_instance_id_fkey ( id, starts_at, time_range )
    `)
    .eq('id', lockId)
    .maybeSingle();

  const lock = row as unknown as LockRowWithParties | null;
  if (!lock || (lock.creator_id !== user.id && lock.matched_user_id !== user.id)) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">
        <div className="mx-auto max-w-[420px]">
          <h1 className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">not your match</h1>
          <p className="mt-4 font-body text-lg text-shell-ink/70">this one belongs to someone else.</p>
        </div>
      </main>
    );
  }

  const counterpart = pickCounterpart(lock, user.id);
  if (!counterpart) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">
        <p className="font-body text-shell-ink/70">couldn't load this match. try again in a moment.</p>
      </main>
    );
  }

  return (
    <LockDetail
      lockId={lock.id}
      status={lock.status as 'active' | 'completed' | 'cancelled'}
      counterpart={counterpart}
      startsAt={lock.instance?.starts_at ?? null}
      ratingOpen={isRatingOpen(lock.instance)}
      justLocked={just === '1'}
    />
  );
}
```

**Verify:** LockDetail test green; typecheck. Manual: `CancelWithReasonPicker` import path resolves (`@/app/dates/[slug]/interested/CancelWithReasonPicker`).
Commit: `feat(5b-F): /matches/[lockId] detail + LockDetail (reveal, cancel, rate CTA)`.

---

### Task 7: `RatingForm.tsx` + `rate/page.tsx`

**Test first** `__tests__/RatingForm.test.tsx`: four yes/no toggles default null; submit calls `submitRating` with selected booleans; `'ok'` → success toast + navigate; `'already_rated'` → terminal "already rated" copy; thrown MatchError → error toast. Mock `submitRating`.

**Implement** `apps/web/app/matches/[lockId]/rate/RatingForm.tsx` (`'use client'`):

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { submitRating, MatchError, messageForCode } from '@/lib/after5/match';

type Tri = boolean | null;

const QUESTIONS: { key: 'showed_up' | 'on_time' | 'cancelled_with_notice' | 'unsafe_or_disrespectful'; label: string }[] = [
  { key: 'showed_up', label: 'did they show up?' },
  { key: 'on_time', label: 'were they on time?' },
  { key: 'cancelled_with_notice', label: 'if they cancelled, did they give notice?' },
  { key: 'unsafe_or_disrespectful', label: 'did they make you feel unsafe or disrespected?' },
];

export function RatingForm({ lockId, rateeId }: { lockId: string; rateeId: string }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, Tri>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function set(key: string, value: boolean) {
    setAnswers((a) => ({ ...a, [key]: a[key] === value ? null : value }));
  }

  async function onSubmit() {
    setBusy(true);
    try {
      const result = await submitRating({
        lockId, rateeId,
        showed_up: answers.showed_up ?? null,
        on_time: answers.on_time ?? null,
        cancelled_with_notice: answers.cancelled_with_notice ?? null,
        unsafe_or_disrespectful: answers.unsafe_or_disrespectful ?? null,
      });
      if (result === 'already_rated') { setDone(true); return; }
      toast('thanks — that helps keep things safe.');
      router.push(`/matches/${lockId}`);
    } catch (e) {
      toast.error(messageForCode(e instanceof MatchError ? e.code : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-[420px] py-16 text-center">
        <h1 className="font-heading text-3xl lowercase text-shell-ink">you already rated this date</h1>
        <p className="mt-3 font-body text-shell-ink/70">thanks for the feedback.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[420px] px-4 py-6">
      <h1 className="font-heading text-3xl lowercase text-shell-ink">how'd it go?</h1>
      <p className="mt-2 font-body text-shell-ink/70">honest answers keep everyone safe. skip anything you'd rather not say.</p>
      <div className="mt-6 space-y-5">
        {QUESTIONS.map((q) => (
          <fieldset key={q.key} aria-label={q.label}>
            <legend className="font-body font-semibold lowercase text-shell-ink">{q.label}</legend>
            <div className="mt-2 flex gap-2">
              {[true, false].map((val) => {
                const selected = answers[q.key] === val;
                return (
                  <button
                    key={String(val)}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => set(q.key, val)}
                    className={cn(
                      'min-h-[44px] flex-1 rounded-full border-2 font-body font-semibold lowercase transition',
                      'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                      selected ? 'border-shell-accent bg-shell-pink text-shell-ink' : 'border-shell-ink/15 bg-white text-shell-ink/70',
                    )}
                  >
                    {val ? 'yes' : 'no'}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onSubmit}
        className="mt-7 min-h-[48px] w-full rounded-full bg-shell-accent font-body font-semibold lowercase text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
      >
        submit
      </button>
    </div>
  );
}
```

**Implement** `apps/web/app/matches/[lockId]/rate/page.tsx` (server):

```tsx
// Server entry for /matches/[lockId]/rate (spec §4.5). Gates to participants,
// HARD-gates the route on the rating window (derived: time_range.upper + 2h —
// no rating_visible_at column exists), and short-circuits to an "already rated"
// state when a match_ratings row already exists for this rater (RLS
// match_ratings_rater_read_own allows the self-read).
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { RatingForm } from './RatingForm';
import { pickCounterpart, isRatingOpen, ratingOpensAt, type LockRowWithParties } from '../../lock-view';

export const dynamic = 'force-dynamic';

export default async function RatePage({ params }: { params: Promise<{ lockId: string }> }) {
  const { lockId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/matches/${lockId}/rate`);

  const { data: flagRow } = await supabase
    .from('feature_config').select('value').eq('key', 'match_v2_enabled').maybeSingle();
  if (flagRow?.value !== true) return <ComingSoonBanner />;

  const { data: row } = await supabase
    .from('locks')
    .select(`
      id, status, creator_id, matched_user_id, date_instance_id,
      creator:profiles!locks_creator_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
      matched:profiles!locks_matched_user_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
      instance:date_instances!locks_date_instance_id_fkey ( id, starts_at, time_range )
    `)
    .eq('id', lockId)
    .maybeSingle();

  const lock = row as unknown as LockRowWithParties | null;
  if (!lock || (lock.creator_id !== user.id && lock.matched_user_id !== user.id)) {
    redirect('/matches');
  }
  const counterpart = pickCounterpart(lock!, user.id);
  if (!counterpart) redirect(`/matches/${lockId}`);

  if (!isRatingOpen(lock!.instance)) {
    const opens = ratingOpensAt(lock!.instance);
    return (
      <main className="mx-auto max-w-[420px] px-4 py-16 text-center">
        <h1 className="font-heading text-3xl lowercase text-shell-ink">not yet</h1>
        <p className="mt-3 font-body text-shell-ink/70">
          you can rate this once the date's done{opens ? `, after ${opens.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })}` : ''}.
        </p>
      </main>
    );
  }

  const { data: existing } = await supabase
    .from('match_ratings')
    .select('id')
    .eq('lock_id', lockId)
    .eq('rater_id', user.id)
    .maybeSingle();

  if (existing) {
    return (
      <main className="mx-auto max-w-[420px] px-4 py-16 text-center">
        <h1 className="font-heading text-3xl lowercase text-shell-ink">you already rated this date</h1>
        <p className="mt-3 font-body text-shell-ink/70">thanks for the feedback.</p>
      </main>
    );
  }

  return <RatingForm lockId={lockId} rateeId={counterpart!.id} />;
}
```

**Verify:** RatingForm test green; typecheck.
Commit: `feat(5b-F): /matches/[lockId]/rate + RatingForm (window-gated, idempotent)`.

---

### Task 8: a11y test + run the suite

**Add** `apps/web/app/matches/[lockId]/__tests__/a11y.test.tsx`: jest-axe over `MatchesList`, `LockDetail`, `RevealModal` (open), `Phase7Placeholder`, `MatchConfirmation` (both reduced-motion states), `RatingForm` — zero violations.

**Verify:**
```bash
cd /Users/lucas/Projects/After5
pnpm -C apps/web test -- matches lock-view match.rating realtime   # all F tests
pnpm -C apps/web test -- a11y
pnpm -C apps/web tsc --noEmit
```
Commit: `test(5b-F): a11y coverage for matches surfaces`.

---

### Task 9: Browser verification (NOT optional — jsdom misses the real bugs)

Per `reference_local-qa-browser-login` (Playwright PKCE recipe, two authed contexts). jsdom does NOT exercise: FK-hint embeds, selected columns, participant RLS, the server/client boundary, or Realtime. Manually verify against the local stack:

1. Candidate accepts an offer → both contexts open `/matches/[lockId]`. Confirm the lock card + detail render the counterpart's REAL Tier-3 data (proves `locks_*_fkey` hints resolve + `profiles_select_revealed` passes under the viewer's client). No `email`/`bio` leak in the DOM.
2. MatchConfirmation fires on `?just=1` and via Realtime; under OS reduced-motion the static card shows with no particles, `role=status` announces.
3. A third, non-participant authed context opening the same `/matches/[lockId]` gets "not your match" (proves RLS denial → `!lock`).
4. The locked `date_instances` time renders (proves 127500 lock-stage read).
5. Fast-forward the clock (or seed a lock whose `time_range.upper + 2h < now`): the rate CTA + `/rate` form appear; submit persists a `match_ratings` row; resubmit shows "already rated"; direct-nav to `/rate` before the window shows "not yet".
6. axe in-browser on the open RevealModal: focus trapped, Escape closes, focus returns to trigger.

Record results in the run-log. **Do not claim F done on jsdom green alone.**

---

## Self-review vs spec

- Foundation: `submitRating` is a direct RLS insert (spec F-3), `rater_id` from session, `23505`→`already_rated`. ✓
- Embeds: all three `locks→profiles` FKs hinted + `date_instances` hinted in all three server queries (spec §1.3, bug class 4). ✓
- Columns: only `first_name, age, city, neighborhood, clear_photo_url, vibe_tags` from profiles; no bio (spec §1.4, bug class 2). `rating_closed_at` selected only after Task 0 regen. ✓
- Server/client boundary: `lock-view.ts` has no `'use client'`; imported by all server pages (spec bug class 5). ✓
- Routes: only `[lockId]` under `matches` (spec §1.8, bug class 1). ✓
- RLS: list/detail/rate reads + insert all map to passing policies under the viewer client (spec §6); no service role; no new migration. ✓
- Rating window derived `time_range.upper + 2h`, hard-gated at route, idempotent (spec F-4). ✓
- Reduced-motion: MatchConfirmation particles gated behind `useReducedMotion`, `role=status` announcement always present (spec §4.4). ✓
- F-2 cancel: D's `CancelWithReasonPicker` mounted in a vaul drawer, `onConfirm→cancelLock`, reason union matches exactly. ✓
- Phase-7 copy exact (spec §3). ✓
