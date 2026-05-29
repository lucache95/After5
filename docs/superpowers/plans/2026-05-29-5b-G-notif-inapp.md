# Sub-project G — notification surfaces, in-app half (TDD plan)

Date: 2026-05-29
Spec: `docs/superpowers/specs/2026-05-29-5b-G-notif-inapp-design.md`
Roadmap: `docs/superpowers/plans/2026-05-27-5b-master-roadmap.md` Task 8 (in-app half only; email half DEFERRED — spec §9)

Bite-sized TDD tasks. Each task: write the test first (red), implement (green), commit. Every commit message ends with:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

No placeholders. Type-consistent against `packages/types/src/database.ts` (`notifications` Row verified non-stale). All code below is complete.

Order: foundation (per-type map → realtime sub) → API route → components (badge, toast, center) → preferences page → a11y → browser-verify.

---

### Task 0 — preflight verification (no code)

Confirm at execution time (facts may drift):

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\d notifications" -c "\d notification_preferences"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "SELECT unnest(enum_range(NULL::notification_type))::text ORDER BY 1;"
ls apps/web/app/api/notifications apps/web/app/account/notifications 2>&1   # expect: No such file (no collision)
```

Confirm 20 enum values match spec §2 and neither target path exists. No commit.

---

### Task 1 — per-type rendering map (`notif-map.ts`)

Pure `.ts`, no `'use client'` (bug class 5). Server + client both import it.

**Test first** — `apps/web/lib/after5/__tests__/notif-map.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { NOTIF_META, hrefForNotification, NOTIFICATION_TYPES } from '../notif-map';

describe('NOTIF_META', () => {
  it('covers all 20 notification types', () => {
    expect(NOTIFICATION_TYPES).toHaveLength(20);
    for (const t of NOTIFICATION_TYPES) {
      const meta = NOTIF_META[t];
      expect(meta).toBeTruthy();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.label).toBe(meta.label.toLowerCase());
      expect(meta.Icon).toBeTruthy();
      expect(meta.category).toBeTruthy();
    }
  });

  it('hrefForNotification never returns empty string, tolerates empty/odd payloads', () => {
    for (const t of NOTIFICATION_TYPES) {
      expect(hrefForNotification(t, {})).not.toBe('');
      expect(hrefForNotification(t, null as unknown as Record<string, unknown>)).not.toBe('');
      expect(hrefForNotification(t, { junk: 1 })).not.toBe('');
    }
  });

  it('builds deeplinks from verified payload keys', () => {
    expect(hrefForNotification('offer_received', { offer_id: 'o1' })).toBe('/offers/o1');
    expect(hrefForNotification('new_match', { lock_id: 'l1' })).toBe('/matches/l1');
    expect(hrefForNotification('reciprocal_detected', { pair_id: 'p1' })).toBe('/reciprocal/p1');
    expect(hrefForNotification('rating_request', { lock_id: 'l2' })).toBe('/matches/l2');
    // fallback when the key the route needs is absent
    expect(hrefForNotification('new_match', {})).toBe('/matches');
    expect(hrefForNotification('offer_received', {})).toBe('/feed');
    expect(hrefForNotification('account', {})).toBe('/account');
  });
});
```

**Implement** — `apps/web/lib/after5/notif-map.ts`:

```ts
// apps/web/lib/after5/notif-map.ts
// Pure (NO 'use client') per-type rendering map for the in-app notification
// surfaces (G, spec §4). Imported by both server components (badge seed) and
// client components (center, toast). Labels are lowercase stop-slop copy.
// hrefFor reads the jsonb payload defensively and NEVER returns '' (a bad href
// would break <Link>); it falls back to a safe in-app surface.
import {
  Heart, Clock, X, Undo2, ArrowUp, Sparkles, HeartHandshake, MessageCircle,
  CalendarCheck, Star, CalendarX, RefreshCw, ShieldCheck, ShieldAlert,
  User, Gavel, BadgeCheck, BadgeAlert, Scale, type LucideIcon,
} from 'lucide-react';
import type { Database } from '@after5/types';

export type NotificationType = Database['public']['Enums']['notification_type'];
export type NotifCategory = 'offers' | 'matches' | 'messages' | 'reminders' | 'account' | 'system';

type Payload = Record<string, unknown> | null | undefined;

function str(payload: Payload, key: string): string | null {
  if (payload && typeof payload === 'object' && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

export interface NotifMeta {
  label: string;
  Icon: LucideIcon;
  category: NotifCategory;
  hrefFor: (payload: Payload) => string;
}

const offerHref = (p: Payload) => { const o = str(p, 'offer_id'); return o ? `/offers/${o}` : '/feed'; };
const lockHref = (p: Payload) => { const l = str(p, 'lock_id'); return l ? `/matches/${l}` : '/matches'; };
const feed = () => '/feed';
const account = () => '/account';

export const NOTIF_META: Record<NotificationType, NotifMeta> = {
  offer_received:        { label: 'a date wants you in',          Icon: Heart,          category: 'offers',   hrefFor: offerHref },
  offer_expiring:        { label: "an offer's about to lapse",    Icon: Clock,          category: 'offers',   hrefFor: offerHref },
  offer_passed:          { label: 'they passed this time',        Icon: X,              category: 'system',   hrefFor: feed },
  offer_expired:         { label: 'an offer ran out',             Icon: Clock,          category: 'system',   hrefFor: feed },
  offer_withdrawn:       { label: 'a host pulled an offer',       Icon: Undo2,          category: 'offers',   hrefFor: feed },
  standby_promoted:      { label: "you're up next",               Icon: ArrowUp,        category: 'offers',   hrefFor: offerHref },
  new_match:             { label: "it's a match",                 Icon: Sparkles,       category: 'matches',  hrefFor: lockHref },
  reciprocal_detected:   { label: 'you both said yes',            Icon: HeartHandshake, category: 'system',   hrefFor: (p) => { const id = str(p, 'pair_id'); return id ? `/reciprocal/${id}` : '/matches'; } },
  new_message:           { label: 'new message',                  Icon: MessageCircle,  category: 'messages', hrefFor: () => '/matches' },
  date_reconfirm:        { label: "confirm you're still on",      Icon: CalendarCheck,  category: 'reminders',hrefFor: lockHref },
  rating_request:        { label: 'how was the date?',            Icon: Star,           category: 'reminders',hrefFor: lockHref },
  lock_cancelled_frozen: { label: 'a date was cancelled',         Icon: CalendarX,      category: 'system',   hrefFor: lockHref },
  lock_cancelled_rolled: { label: 'a date rolled to standby',     Icon: RefreshCw,      category: 'system',   hrefFor: lockHref },
  safety_checkin:        { label: 'checking you got home ok',     Icon: ShieldCheck,    category: 'system',   hrefFor: lockHref },
  safety_alert:          { label: 'safety alert',                 Icon: ShieldAlert,    category: 'system',   hrefFor: account },
  account:               { label: 'account update',               Icon: User,           category: 'account',  hrefFor: account },
  moderation_action:     { label: 'a moderation update',          Icon: Gavel,          category: 'account',  hrefFor: account },
  verification_passed:   { label: "you're verified",              Icon: BadgeCheck,     category: 'account',  hrefFor: account },
  verification_failed:   { label: 'verification needs another look', Icon: BadgeAlert,  category: 'account',  hrefFor: account },
  appeal_resolved:       { label: 'your appeal was reviewed',     Icon: Scale,          category: 'account',  hrefFor: account },
};

export const NOTIFICATION_TYPES = Object.keys(NOTIF_META) as NotificationType[];

export function hrefForNotification(type: NotificationType, payload: Payload): string {
  return NOTIF_META[type].hrefFor(payload);
}
```

Commit: `feat(G): per-type notification rendering map (20 types, pure helper)`.

---

### Task 2 — realtime subscription (`subscribeNotifications`)

Extend `apps/web/lib/after5/realtime.ts`, mirroring `subscribeLockInserts`. User-scoped channel; RLS gates delivery.

**Test first** — `apps/web/lib/after5/__tests__/realtime.notif.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const subscribe = vi.fn(() => ({}));
const on = vi.fn(() => ({ subscribe }));
const channel = vi.fn(() => ({ on }));
const removeChannel = vi.fn();

vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({ channel, removeChannel }) }));

import { subscribeNotifications } from '../realtime';

beforeEach(() => { channel.mockClear(); on.mockClear(); subscribe.mockClear(); removeChannel.mockClear(); });

describe('subscribeNotifications', () => {
  it('opens a per-user channel for notifications inserts', () => {
    subscribeNotifications('user-1', vi.fn());
    expect(channel).toHaveBeenCalledWith('notif:user-1');
    const [evt, cfg] = on.mock.calls[0];
    expect(evt).toBe('postgres_changes');
    expect(cfg).toMatchObject({ event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.user-1' });
  });

  it('forwards the new row and returns a cleanup', () => {
    const onInsert = vi.fn();
    const cleanup = subscribeNotifications('user-1', onInsert);
    const handler = on.mock.calls[0][2] as (p: { new: unknown }) => void;
    handler({ new: { id: 'n1', type: 'new_match', user_id: 'user-1' } });
    expect(onInsert).toHaveBeenCalledWith({ id: 'n1', type: 'new_match', user_id: 'user-1' });
    cleanup();
    expect(removeChannel).toHaveBeenCalled();
  });
});
```

**Implement** — append to `apps/web/lib/after5/realtime.ts`:

```ts
export type NotificationRow = Database['public']['Tables']['notifications']['Row'];

// Sub-project G (in-app notifications). User-scoped channel `notif:<userId>`.
// We add an explicit user_id filter (belt on top of RLS notifications_recipient_read)
// so the socket only delivers this viewer's rows. Caller (badge/toast) re-renders.
export function subscribeNotifications(
  userId: string,
  onInsert: (row: NotificationRow) => void,
): () => void {
  const client = browserAfter5Client();
  const ch = client
    .channel(`notif:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload: { new: NotificationRow }) => onInsert(payload.new),
    )
    .subscribe();
  return () => { client.removeChannel(ch); };
}
```

Commit: `feat(G): subscribeNotifications realtime helper (user-scoped)`.

---

### Task 3 — API route (`/api/notifications`)

GET paginated list + unread count; POST mark-read (ids[] or all). Writes ONLY `read_at` (spec §5.2 / RED-G1). Auth via SSR `createClient()`, mirroring `app/api/saved-plans/route.ts`.

**Test first** — `apps/web/app/api/notifications/__tests__/route.test.ts` (mock the supabase server client; assert 401 unauth, select shape, and that POST update payload is exactly `{ read_at: <iso> }`). Build a chainable query-builder mock; assert `.update` is called with a single `read_at` key and `.is('read_at', null)` is applied.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let user: { id: string } | null = { id: 'u1' };
const captured: { update?: Record<string, unknown> } = {};

function qb() {
  const b: any = {};
  for (const m of ['select','eq','order','lt','is','in','limit']) b[m] = vi.fn(() => b);
  b.update = vi.fn((vals: Record<string, unknown>) => { captured.update = vals; return b; });
  b.then = (res: (v: { data: unknown[]; error: null; count: number }) => void) => res({ data: [], error: null, count: 0 });
  return b;
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) }, from: () => qb() }),
}));

import { GET, POST } from '../route';

beforeEach(() => { user = { id: 'u1' }; captured.update = undefined; });

describe('/api/notifications', () => {
  it('GET 401 when unauthenticated', async () => {
    user = null;
    const res = await GET(new Request('http://x/api/notifications'));
    expect(res.status).toBe(401);
  });

  it('GET returns items + unreadCount shape', async () => {
    const res = await GET(new Request('http://x/api/notifications?limit=20'));
    const json = await res.json();
    expect(json).toHaveProperty('items');
    expect(json).toHaveProperty('unreadCount');
  });

  it('POST mark-read updates ONLY read_at (RED-G1)', async () => {
    const res = await POST(new Request('http://x/api/notifications', {
      method: 'POST', body: JSON.stringify({ ids: ['n1'] }),
    }));
    expect(res.status).toBe(200);
    expect(Object.keys(captured.update ?? {})).toEqual(['read_at']);
  });
});
```

**Implement** — `apps/web/app/api/notifications/route.ts`:

```ts
// apps/web/app/api/notifications/route.ts
// In-app notification list + mark-read (G, spec §5). All reads/writes run under
// the viewer's RLS-bound SSR client. Mark-read writes ONLY read_at (RED-G1):
// the UPDATE policy permits more columns, we never touch them.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const rawLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;

  let q = supabase
    .from('notifications')
    .select('id,type,payload,read_at,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.lt('created_at', cursor);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.created_at ?? null : null;

  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null);

  return NextResponse.json({ items, nextCursor, unreadCount: count ?? 0 });
}

interface MarkBody { ids?: unknown; all?: unknown }

export async function POST(request: NextRequest) {
  let body: MarkBody;
  try { body = (await request.json()) as MarkBody; }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const all = body.all === true;
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
  if (!all && ids.length === 0) return NextResponse.json({ error: 'ids_or_all_required' }, { status: 400 });

  let q = supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })  // RED-G1: only read_at
    .eq('user_id', user.id)
    .is('read_at', null);
  if (!all) q = q.in('id', ids);

  const { error, count } = await q.select('id', { count: 'exact' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ updated: count ?? 0 });
}
```

Commit: `feat(G): /api/notifications GET (paginated + unread) and POST mark-read`.

---

### Task 4 — NotificationBadge

Unread pill on the bell. SSR-seeded `initialCount`; realtime increments; window `notif:read` event decrements.

**Test first** — `apps/web/components/__tests__/NotificationBadge.test.tsx`: renders nothing when count 0; renders count when >0; increments on a simulated realtime insert (mock `subscribeNotifications` to capture the callback and invoke it); decrements/clears on `window.dispatchEvent(new CustomEvent('notif:read', { detail: { updated: n } }))`.

**Implement** — `apps/web/components/NotificationBadge.tsx`:

```tsx
'use client';
// Unread-count pill for the bell affordance (G, spec §3/§5.2). Seeded from an
// SSR count, bumped live by realtime inserts, and cleared/decremented when a
// 'notif:read' window event fires (emitted by the center after mark-read).
import { useEffect, useState } from 'react';
import { subscribeNotifications } from '@/lib/after5/realtime';

export function NotificationBadge({ userId, initialCount }: { userId: string; initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const unsub = subscribeNotifications(userId, () => setCount((c) => c + 1));
    function onRead(e: Event) {
      const detail = (e as CustomEvent<{ updated?: number; all?: boolean }>).detail;
      if (detail?.all) { setCount(0); return; }
      setCount((c) => Math.max(0, c - (detail?.updated ?? 1)));
    }
    window.addEventListener('notif:read', onRead);
    return () => { unsub(); window.removeEventListener('notif:read', onRead); };
  }, [userId]);

  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} unread notifications`}
      className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-shell-accent px-1 text-[10px] font-semibold leading-[18px] text-shell-base"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
```

Commit: `feat(G): NotificationBadge with realtime increment + notif:read decrement`.

---

### Task 5 — NotificationToast

Mounts the realtime sub once; fires a sonner toast on each new row. No visible DOM. (Decision G-5: any row reaching the client is meant to be seen — gating already happened in `dispatch_notification`.)

**Test first** — `apps/web/components/__tests__/NotificationToast.test.tsx`: mock `subscribeNotifications` and `sonner`; invoke the captured insert callback with a `new_match` row; assert `toast(...)` called with the mapped label.

**Implement** — `apps/web/components/NotificationToast.tsx`:

```tsx
'use client';
// Headless: subscribes to the viewer's notifications and fires a sonner toast on
// each new row (G, spec §3/§5). The toast action deeplinks via the per-type map.
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { subscribeNotifications, type NotificationRow } from '@/lib/after5/realtime';
import { NOTIF_META, hrefForNotification } from '@/lib/after5/notif-map';

export function NotificationToast({ userId }: { userId: string }) {
  const router = useRouter();
  useEffect(() => {
    return subscribeNotifications(userId, (row: NotificationRow) => {
      const meta = NOTIF_META[row.type];
      const href = hrefForNotification(row.type, row.payload as Record<string, unknown>);
      toast(meta.label, { action: { label: 'view', onClick: () => router.push(href) } });
    });
  }, [userId, router]);
  return null;
}
```

Commit: `feat(G): NotificationToast fires sonner on realtime inserts`.

---

### Task 6 — NotificationCenter (vaul sheet, paginated)

Bell trigger + vaul `Drawer` list. Per-row icon/label/relative-time/unread-dot/deeplink. Click row → mark-one-read (POST `{ ids:[id] }`) + emit `notif:read` + navigate. "mark all read" → POST `{ all:true }` + emit `notif:read {all:true}`. Pages by `nextCursor`.

**Test first** — `apps/web/components/__tests__/NotificationCenter.test.tsx`: mock `fetch` to return `{ items, nextCursor, unreadCount }`; open the sheet; assert rows render with mapped labels; assert empty state when `items: []`; click a row → asserts POST body `{ ids:['n1'] }` and a `notif:read` event dispatched.

**Implement** — `apps/web/components/NotificationCenter.tsx` (vaul pattern mirrors `MakeOfferModal.tsx`; uses `cn`, `relativeTime`, Barbiecore tokens). Trigger button wraps the bell `<Bell/>` + `NotificationBadge`. List maps `NOTIF_META[type].Icon`, `label`, `relativeTime(created_at)`, an unread dot when `read_at == null`, and `<Link href={hrefForNotification(...)}>`. "load more" appears when `nextCursor`. Helpers:

```tsx
async function markRead(ids: string[]) {
  await fetch('/api/notifications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });
  window.dispatchEvent(new CustomEvent('notif:read', { detail: { updated: ids.length } }));
}
async function markAllRead() {
  await fetch('/api/notifications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ all: true }) });
  window.dispatchEvent(new CustomEvent('notif:read', { detail: { all: true } }));
}
```

Empty state copy (stop-slop, lowercase): "nothing yet. your matches and offers land here." `Drawer.Title` = "notifications". Each row min-height 44px (touch target); unread dot `bg-shell-accent`; icons `text-shell-ink/70`. No `<Image>` — icons only (bug class 6 N/A).

Commit: `feat(G): NotificationCenter vaul sheet — paginated list + mark-read`.

---

### Task 7 — mount badge/toast/center in the authed shell

Add a bell affordance (top-right of the authed layout/header) wrapping `NotificationCenter` (which contains the badge), and mount `NotificationToast` once. Resolve `userId` + seed `unreadCount` server-side in the layout via `createClient()` (spec §3 / decision G-1: header affordance, NOT a 5th bottom tab — leaves the verified `BottomTabShell` untouched).

**Test:** light render test of the shell wrapper passing `userId`/`initialCount`; or fold into Task 4/6 tests. No bottom-tab edits.

Commit: `feat(G): mount notification bell + toast in authed shell`.

---

### Task 8 — preferences page + form

Server page reads prefs (`maybeSingle()` → null handled, spec §1.3/§5.3). Form: 5 category switches + 2 channel switches + quiet-hours start/end time inputs (both-or-neither, decision G-2). Save → upsert via browser client.

**Test first** — `apps/web/app/account/notifications/__tests__/PreferencesForm.test.tsx`: renders all-on defaults when `initial` is null; toggling a switch + save calls upsert with the full column set; clearing one quiet-hours field while the other is set surfaces the both-or-neither validation (no save with a single field).

**Implement** — `apps/web/app/account/notifications/page.tsx`:

```tsx
// apps/web/app/account/notifications/page.tsx
// Notification preferences (G, spec §5.3/§6). SSR-reads the viewer's prefs row
// under RLS (notif_prefs_owner_all); a missing row renders all-on defaults
// (dispatch_notification treats absent prefs as permissive).
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PreferencesForm } from './PreferencesForm';

export const dynamic = 'force-dynamic';

export default async function NotificationPreferencesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data } = await supabase
    .from('notification_preferences')
    .select('push_enabled,email_enabled,offers_enabled,matches_enabled,messages_enabled,reminders_enabled,account_enabled,quiet_hours_start,quiet_hours_end')
    .eq('user_id', user.id)
    .maybeSingle();

  return (
    <main className="mx-auto w-full max-w-[420px] px-6 pb-28 pt-8">
      <h1 className="font-heading text-3xl lowercase text-shell-ink">notifications</h1>
      <p className="mt-1 font-body text-sm text-shell-ink/70">choose what reaches you, and when.</p>
      <PreferencesForm userId={user.id} initial={data ?? null} />
    </main>
  );
}
```

`apps/web/app/account/notifications/PreferencesForm.tsx` (`'use client'`): typed state seeded from `initial ?? DEFAULTS` (all booleans true, quiet hours `''`). Toggle rows for the 7 booleans (grouped: channels `push_enabled`/`email_enabled`; categories `offers/matches/messages/reminders/account_enabled`) with lowercase labels and helper sub-copy. Two `<input type="time">` for quiet hours + a clear button. Validate both-or-neither; on save:

```tsx
const { error } = await supabase.from('notification_preferences').upsert({
  user_id: userId,
  push_enabled, email_enabled, offers_enabled, matches_enabled,
  messages_enabled, reminders_enabled, account_enabled,
  quiet_hours_start: quietStart || null,
  quiet_hours_end: quietEnd || null,
}, { onConflict: 'user_id' });
error ? toast.error("couldn't save. try again?") : toast.success('saved.');
```

(`supabase` = `browserAfter5Client()`.) Note `email_enabled` is shown even though the email half is deferred — the column exists and `dispatch_notification` reads it; the toggle is harmless and ready for the deferred half (spec §9).

Commit: `feat(G): notification preferences page + form (categories, channels, quiet hours)`.

---

### Task 9 — a11y pass

`apps/web/components/__tests__/notif-a11y.test.tsx` (mirror `matches/[lockId]/__tests__/a11y.test.tsx`): vaul sheet has accessible `Drawer.Title`/`Description`; bell trigger has `aria-label="notifications"`; badge announces `${n} unread notifications`; preference switches use `role="switch"`/`aria-checked` (or native checkbox + label association) and 44px targets; quiet-hours inputs have associated `<label>`s. Fix inline.

Commit: `test(G): a11y for notification center, badge, and preferences`.

---

### Task 10 — browser-verify (REQUIRED — jsdom misses D/E/F bug classes)

Per spec §10, with the local QA authed session:

```sql
select dispatch_notification('5f387641-...'::uuid, 'new_match', '{"lock_id":"<real-lock>"}'::jsonb);
```

Verify live: badge increments (realtime), toast fires, center opens (vaul, focus/overlay clean), row deeplinks to `/matches/[lockId]`, mark-read clears dot + decrements badge, `/account/notifications` loads (no route collision), toggles + quiet hours save and re-read, console clean (no Next/image empty-src, no PGRST errors). Record results in the run-log. No app-code commit unless a bug is found (then fix + commit).

---

## Self-review (plan vs spec)

- Foundation→API→components→prefs→a11y→verify order matches the requested sequence. ✔
- Per-type map is plain `.ts`, imported by server (Task 7 layout seed via API) + client (Tasks 5/6) — bug class 5. ✔
- Only verified columns selected/written; `maybeSingle()` null-handling for absent prefs row; per-CATEGORY not per-type — bug class 2. ✔
- Mark-read writes ONLY `read_at`, asserted in Task 3 test (RED-G1) — bug class 3. ✔
- No PostgREST embeds anywhere in G — bug class 4 N/A. ✔
- No `<Image>` (icons only) — bug class 6 N/A; console-clean check retained. ✔
- Route-collision check in Task 0 — bug class 1. ✔
- Realtime mirrors `subscribeLockInserts` (channel `notif:<userId>`, filter, cleanup); vaul mirrors `MakeOfferModal`; SSR `createClient()` mirrors `saved-plans`. ✔
- Email half untouched; `email_enabled` toggle + the `notifications` table seam left ready (spec §9). ✔
- Every commit carries the `Co-Authored-By: Claude Opus 4.8` trailer. ✔
