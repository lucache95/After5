'use client';
// Unified inbox — activity zone (#84, spec §1/§3). The NotificationCenter rows,
// lifted out of the vaul sheet into an in-page section. Single rows render the
// per-type icon + lowercase label + relative time + unread dot; grouped rows
// (e.g. `interest_received` collapsed by night) show a count chip and mark ALL
// members read on tap. Newest first; live-arriving notifications prepend.
//
// Read model reuses the existing path verbatim: POST /api/notifications marks only
// `read_at`, and a `notif:read` window event keeps the tab badge in sync (the
// badge listens for it, exactly as the old bell did). The top N show inline; the
// rest sit behind "see all activity".
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { metaFor } from '@/lib/after5/notif-map';
import { subscribeNotifications, type NotificationRow } from '@/lib/after5/realtime';
import { groupActivity, type ActivityItem, type RawNotification } from '@/lib/after5/inbox-activity';

const INLINE_LIMIT = 5;

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

function ActivityRow({
  item,
  onActivate,
  index,
  reduce,
}: {
  item: ActivityItem;
  onActivate: (item: ActivityItem) => void;
  index: number;
  reduce: boolean;
}) {
  const meta = metaFor(item.type);
  const Icon = meta.Icon;
  const unread = isUnread(item);
  const count = item.kind === 'group' ? item.count : 1;
  const label = item.kind === 'group' && count > 1 ? `${count} ${meta.label}` : meta.label;

  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { delay: Math.min(index, 6) * 0.04, type: 'spring', stiffness: 380, damping: 30 }}
    >
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
          <span
            aria-hidden
            className="shrink-0 rounded-full bg-shell-accent px-2 py-0.5 font-body text-[11px] font-semibold leading-none text-white"
          >
            {count}
          </span>
        )}
        <span className="shrink-0 font-body text-xs text-shell-ink/50">{relativeTime(item.created_at)}</span>
        {unread && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-shell-accent" />}
      </button>
    </motion.li>
  );
}

export function ActivityList({
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
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  // Live prepend: a new notification arrives → re-group the head so a fresh
  // `interest_received` folds into its existing group instead of stacking.
  useEffect(() => {
    return subscribeNotifications(userId, (row: NotificationRow) => {
      if (row.type === 'new_message') return; // activity excludes messages (spec §2)
      const raw: RawNotification = {
        id: row.id,
        type: row.type,
        payload: (row.payload as Record<string, unknown> | null) ?? null,
        read_at: row.read_at,
        created_at: row.created_at,
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
      // Re-group the merged stream so a group split across a page boundary unifies.
      setItems((prev) => groupActivity([...prev, ...data.items].flatMap(flattenItem)));
      setCursor(data.nextCursor);
      setExpanded(true);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

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

  if (items.length === 0) return null; // page renders the unified empty state

  const visible = expanded ? items : items.slice(0, INLINE_LIMIT);
  const hasMoreInline = !expanded && items.length > INLINE_LIMIT;
  const anyUnread = items.some(isUnread);

  return (
    <section aria-labelledby="inbox-activity-heading" className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 id="inbox-activity-heading" className="font-heading text-2xl lowercase text-shell-ink">
          ✨ activity
        </h2>
        {anyUnread && (
          <button
            type="button"
            onClick={onMarkAll}
            className="flex min-h-[44px] items-center font-body text-xs lowercase text-shell-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50"
          >
            mark all read
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {visible.map((item, i) => (
          <ActivityRow key={item.id} item={item} index={i} onActivate={onActivate} reduce={reduce} />
        ))}
      </ul>
      {(hasMoreInline || cursor) && (
        <button
          type="button"
          disabled={loading}
          onClick={() => (hasMoreInline && !cursor ? setExpanded(true) : void loadMore())}
          className="flex min-h-[44px] w-full items-center justify-center font-body text-sm lowercase text-shell-ink/65 transition hover:text-shell-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-ink/30 disabled:opacity-50"
        >
          {loading ? 'loading…' : 'see all activity →'}
        </button>
      )}
    </section>
  );
}

// Flatten a grouped item back to its raw rows so re-grouping after a merge stays
// idempotent. Single rows map 1:1; a group expands to one synthetic raw row per
// member id, all carrying the group's shared payload/type (sufficient for the
// grouping key). read_at is reconstructed from anyUnread conservatively: the
// first member carries the unread flag, the rest read — counts as "any unread"
// either way without inventing per-member read state we discarded.
function flattenItem(item: ActivityItem): RawNotification[] {
  if (item.kind === 'single') {
    return [{ id: item.id, type: item.type, payload: item.payload, read_at: item.read_at, created_at: item.created_at }];
  }
  return item.ids.map((id, i) => ({
    id,
    type: item.type,
    payload: item.payload,
    read_at: item.anyUnread && i === 0 ? null : item.created_at,
    created_at: item.created_at,
  }));
}

function markItemRead(item: ActivityItem): ActivityItem {
  if (item.kind === 'group') return { ...item, anyUnread: false };
  return { ...item, read_at: item.read_at ?? new Date().toISOString() };
}

