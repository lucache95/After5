'use client';
// In-app notification center (G, spec §3/§5). A vaul bottom sheet triggered by
// the bell affordance (wrapping NotificationBadge). The list is paginated by
// created_at cursor via GET /api/notifications. Each row shows the per-type icon,
// lowercase label, relative time, and an unread dot; clicking marks the single
// row read (POST { ids:[id] }) + emits a 'notif:read' window event (the badge
// listens) and deeplinks via the per-type map. "mark all read" posts { all:true }.
// Icons only — no <Image> (bug class 6 N/A).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Drawer } from 'vaul';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { NOTIF_META, hrefForNotification, type NotificationType } from '@/lib/after5/notif-map';
import { NotificationBadge } from './NotificationBadge';

interface NotifItem {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

interface ListResponse {
  items: NotifItem[];
  nextCursor: string | null;
  unreadCount: number;
}

async function markRead(ids: string[]) {
  await fetch('/api/notifications', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  window.dispatchEvent(new CustomEvent('notif:read', { detail: { updated: ids.length } }));
}

async function markAllRead() {
  await fetch('/api/notifications', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ all: true }),
  });
  window.dispatchEvent(new CustomEvent('notif:read', { detail: { all: true } }));
}

export function NotificationCenter({ userId, initialCount }: { userId: string; initialCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (nextCursor?: string | null) => {
    setLoading(true);
    try {
      const url = nextCursor ? `/api/notifications?cursor=${encodeURIComponent(nextCursor)}` : '/api/notifications';
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as ListResponse;
      setItems((prev) => (nextCursor ? [...prev, ...data.items] : data.items));
      setCursor(data.nextCursor);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !loaded) void load();
  }, [open, loaded, load]);

  function onRowClick(item: NotifItem) {
    if (!item.read_at) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)));
      void markRead([item.id]);
    }
    router.push(hrefForNotification(item.type, item.payload));
    setOpen(false);
  }

  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>
        <button
          type="button"
          aria-label="notifications"
          onClick={() => setOpen(true)}
          className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-shell-ink/80 transition hover:text-shell-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50"
        >
          <Bell className="h-6 w-6" aria-hidden />
          <NotificationBadge userId={userId} initialCount={initialCount} />
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-shell-ink/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[80dvh] max-w-[420px] flex-col rounded-t-3xl bg-shell-base px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
          <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-shell-ink/20" />
          <div className="flex items-center justify-between">
            <Drawer.Title className="font-heading text-3xl lowercase text-shell-ink">notifications</Drawer.Title>
            <button
              type="button"
              onClick={() => {
                setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
                void markAllRead();
              }}
              className="flex min-h-[44px] items-center font-body text-sm lowercase text-shell-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50"
            >
              mark all read
            </button>
          </div>
          <Drawer.Description className="sr-only">your recent matches, offers, and reminders.</Drawer.Description>

          <ul className="mt-3 flex-1 overflow-y-auto">
            {loaded && items.length === 0 && (
              <li className="py-12 text-center font-body text-sm text-shell-ink/60">
                nothing yet. your matches and offers land here.
              </li>
            )}
            {items.map((item) => {
              const meta = NOTIF_META[item.type];
              const Icon = meta.Icon;
              const unread = !item.read_at;
              return (
                <li key={item.id}>
                  <Link
                    href={hrefForNotification(item.type, item.payload)}
                    onClick={(e) => { e.preventDefault(); onRowClick(item); }}
                    className={cn(
                      'flex min-h-[44px] items-center gap-3 rounded-2xl px-2 py-3 transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50',
                      unread ? 'bg-shell-pink/30' : 'hover:bg-shell-ink/5',
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0 text-shell-ink/70" aria-hidden />
                    <span className="flex-1 font-body text-sm lowercase text-shell-ink">{meta.label}</span>
                    <span className="shrink-0 font-body text-xs text-shell-ink/50">{relativeTime(item.created_at)}</span>
                    {unread && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-shell-accent" />}
                  </Link>
                </li>
              );
            })}
          </ul>

          {cursor && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(cursor)}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-full font-body text-sm lowercase text-shell-ink/70 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-ink/30 disabled:opacity-50"
            >
              load more
            </button>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
