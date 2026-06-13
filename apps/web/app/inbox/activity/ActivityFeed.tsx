'use client';
// Standalone activity feed (founder 2026-06-12, TikTok inbox pattern): the full
// notification history on its own page, auto-loading on scroll. The inbox's
// inline ActivityList shows a glanceable summary row that links here; this is
// where you scroll through 1000s. Same read model: groupActivity over the
// notifications table, POST /api/notifications marks read_at only, a `notif:read`
// window event keeps the tab badge in sync. New notifications prepend live.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { metaFor } from '@/lib/after5/notif-map';
import { subscribeNotifications, type NotificationRow } from '@/lib/after5/realtime';
import { groupActivity, type ActivityItem, type RawNotification } from '@/lib/after5/inbox-activity';
import { HeartLoader } from '@/components/HeartLoader';

interface ActivityResponse {
  items: ActivityItem[];
  nextCursor: string | null;
  unreadCount: number;
}

async function markRead(ids: string[]) {
  if (ids.length === 0) return;
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

function idsOf(item: ActivityItem): string[] {
  return item.kind === 'group' ? item.ids : [item.id];
}
function isUnread(item: ActivityItem): boolean {
  return item.kind === 'group' ? item.anyUnread : item.read_at == null;
}
function hrefOf(item: ActivityItem): string {
  return metaFor(item.type).hrefFor(item.payload);
}
function markItemRead(item: ActivityItem): ActivityItem {
  if (item.kind === 'group') return { ...item, anyUnread: false };
  return { ...item, read_at: item.read_at ?? new Date().toISOString() };
}
// Flatten a grouped item back to raw rows so re-grouping after a page merge stays
// idempotent (a group split across a page boundary unifies). Mirrors ActivityList.
function flattenItem(item: ActivityItem): RawNotification[] {
  if (item.kind === 'single') {
    return [{ id: item.id, type: item.type, payload: item.payload, read_at: item.read_at, created_at: item.created_at }];
  }
  return item.ids.map((id, i) => ({
    id, type: item.type, payload: item.payload,
    read_at: item.anyUnread && i === 0 ? null : item.created_at,
    created_at: item.created_at,
  }));
}

function Row({ item, onActivate }: { item: ActivityItem; onActivate: (i: ActivityItem) => void }) {
  const meta = metaFor(item.type);
  const Icon = meta.Icon;
  const unread = isUnread(item);
  const count = item.kind === 'group' ? item.count : 1;
  const label = item.kind === 'group' && count > 1 ? `${count} ${meta.label}` : meta.label;
  return (
    <li>
      <button
        type="button"
        onClick={() => onActivate(item)}
        aria-label={`${label}${unread ? ', unread' : ''}`}
        className={cn(
          'flex w-full min-h-[44px] items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50',
          unread ? 'bg-shell-pink/40' : 'bg-white hover:bg-shell-ink/5',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            unread ? 'bg-shell-accent/15 text-shell-accent' : 'bg-shell-ink/5 text-shell-ink/60',
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className={cn('min-w-0 flex-1 truncate font-body text-sm lowercase text-shell-ink', unread && 'font-semibold')}>
          {label}
        </span>
        {item.kind === 'group' && count > 1 && (
          <span aria-hidden className="shrink-0 rounded-full bg-shell-accent px-2 py-0.5 font-body text-[11px] font-semibold leading-none text-white">
            {count}
          </span>
        )}
        <span className="shrink-0 font-body text-xs text-shell-ink/50">{relativeTime(item.created_at)}</span>
        {unread && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-shell-accent" />}
      </button>
    </li>
  );
}

export function ActivityFeed({
  userId,
  initialItems,
  initialCursor,
}: {
  userId: string;
  initialItems: ActivityItem[];
  initialCursor: string | null;
}) {
  const router = useRouter();
  const reduce = useReducedMotion() ?? false;
  const [items, setItems] = useState<ActivityItem[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Live prepend (same as the inbox section).
  useEffect(() => {
    return subscribeNotifications(userId, (row: NotificationRow) => {
      if (row.type === 'new_message') return;
      const raw: RawNotification = {
        id: row.id, type: row.type,
        payload: (row.payload as Record<string, unknown> | null) ?? null,
        read_at: row.read_at, created_at: row.created_at,
      };
      setItems((prev) => groupActivity([raw, ...prev.flatMap(flattenItem)]));
    });
  }, [userId]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/inbox/activity?cursor=${encodeURIComponent(cursor)}`);
      if (!res.ok) return;
      const data = (await res.json()) as ActivityResponse;
      setItems((prev) => groupActivity([...prev, ...data.items].flatMap(flattenItem)));
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

  // Infinite scroll: auto-load the next page when the sentinel nears the viewport.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !cursor) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) void loadMore(); },
      { rootMargin: '600px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  function onActivate(item: ActivityItem) {
    if (isUnread(item)) {
      const ids = idsOf(item);
      setItems((prev) => prev.map((it) => (it.id === item.id ? markItemRead(it) : it)));
      void markRead(ids);
    }
    router.push(hrefOf(item));
  }

  function onMarkAll() {
    setItems((prev) => prev.map(markItemRead));
    void markAllRead();
  }

  const anyUnread = items.some(isUnread);

  if (items.length === 0) {
    return (
      <div className="px-2 py-20 text-center">
        <p className="font-heading text-2xl lowercase text-shell-ink">nothing yet</p>
        <p className="mt-2 font-body text-sm text-shell-ink/60">offers, matches, and nudges land here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {anyUnread && (
        <div className="flex justify-end px-1">
          <button
            type="button"
            onClick={onMarkAll}
            className="flex min-h-[44px] items-center font-body text-xs lowercase text-shell-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50"
          >
            mark all read
          </button>
        </div>
      )}
      <motion.ul
        className="space-y-2"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduce ? 0 : 0.2 }}
      >
        {items.map((item) => (
          <Row key={item.id} item={item} onActivate={onActivate} />
        ))}
      </motion.ul>
      {cursor && (
        <div ref={sentinelRef} className="flex min-h-[56px] items-center justify-center">
          {loading && <HeartLoader size={28} accessibilityLabel="loading more activity" />}
        </div>
      )}
    </div>
  );
}
