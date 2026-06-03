'use client';
// Combined unread pill for the inbox bottom-tab (#84, spec §2/D3: one number =
// unread activity + unread threads). Self-seeding: fetches the combined count on
// mount (so the badge works on every page that mounts the nav, without threading
// a server count through BottomTabShell), then keeps it live — realtime
// notification inserts bump it, and a `notif:read` window event (emitted by the
// activity list after mark-read) clears/decrements it, reusing the bell's old
// contract. Renders nothing at zero.
import { useEffect, useState } from 'react';
import { subscribeNotifications, type NotificationRow } from '@/lib/after5/realtime';

export function InboxTabBadge({ userId }: { userId: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    void fetch('/api/inbox/unread')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { total?: number } | null) => { if (alive && typeof d?.total === 'number') setCount(d.total); })
      .catch(() => {});

    const unsub = subscribeNotifications(userId, (row: NotificationRow) => {
      if (row.type === 'new_message') return; // messages bump via their own path, not double-counted
      setCount((c) => c + 1);
    });
    function onRead(e: Event) {
      const detail = (e as CustomEvent<{ updated?: number; all?: boolean }>).detail;
      if (detail?.all) { setCount(0); return; }
      setCount((c) => Math.max(0, c - (detail?.updated ?? 1)));
    }
    window.addEventListener('notif:read', onRead);
    return () => { alive = false; unsub(); window.removeEventListener('notif:read', onRead); };
  }, [userId]);

  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} unread in inbox`}
      className="absolute right-2 top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-shell-accent px-1 text-[10px] font-semibold leading-[18px] text-white ring-2 ring-shell-base"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
