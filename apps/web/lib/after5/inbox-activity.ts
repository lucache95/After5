// apps/web/lib/after5/inbox-activity.ts
// Pure (NO 'use client') read-time grouping for the unified inbox activity zone
// (#84, spec §4). Imported by the /api/inbox/activity route (server) and the
// ActivityList client component, so it stays framework-neutral.
//
// The inbox shows ONE activity row per high-signal event, but collapses repeated
// low-signal events into a single counted row. Today the only grouped type is
// `interest_received` (multiple searchers swiping interested on the same night),
// keyed by payload.date_instance_id. Everything else stays a single row.
//
// `new_message` is EXCLUDED entirely — message activity lives in the thread zone,
// never duplicated as an activity row (spec §2, the double-count other apps hit).
//
// Grouping runs over the already-keyset-paginated page (zero migration, spec §4
// recommendation: TS grouping first, promote to an RPC for native later). The
// grouping CONTRACT (the GroupedActivity shape) is stable either way.

export interface RawNotification {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

// A single ungrouped activity row.
export interface ActivitySingle {
  kind: 'single';
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

// A collapsed group of same-type rows sharing a group key.
export interface ActivityGroup {
  kind: 'group';
  // Stable id for React keys + mark-read: the type + group key.
  id: string;
  type: string;
  /** All member notification ids — tapping the group marks them all read. */
  ids: string[];
  count: number;
  /** The shared grouping key (e.g. date_instance_id). */
  groupKey: string;
  /** Newest member's created_at — used for ordering + relative time. */
  created_at: string;
  /** Unread if ANY member is unread. */
  anyUnread: boolean;
  /** First non-empty payload among members (for the deep-link). */
  payload: Record<string, unknown> | null;
}

export type ActivityItem = ActivitySingle | ActivityGroup;

// Type → the payload key it groups by. Only listed types collapse; all others
// pass through as singles. Extend here when a new low-signal type needs grouping.
const GROUP_KEY_BY_TYPE: Record<string, string> = {
  interest_received: 'date_instance_id',
};

// Types that never appear in the activity zone (they live elsewhere in the UI).
const EXCLUDED_TYPES = new Set<string>(['new_message']);

function payloadStr(payload: Record<string, unknown> | null, key: string): string | null {
  if (payload && typeof payload === 'object' && key in payload) {
    const v = payload[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

// Group a created_at-desc page of notifications. Excluded types drop out;
// groupable types collapse by their key (rows missing the key stay single, so a
// malformed payload never silently vanishes); everything else passes through.
// Output order follows the input's newest-first order, anchored at each item's
// newest member.
export function groupActivity(rows: RawNotification[]): ActivityItem[] {
  const out: ActivityItem[] = [];
  const groupIndex = new Map<string, number>(); // groupId -> index in `out`

  for (const row of rows) {
    if (EXCLUDED_TYPES.has(row.type)) continue;

    const groupKeyField = GROUP_KEY_BY_TYPE[row.type];
    const groupKey = groupKeyField ? payloadStr(row.payload, groupKeyField) : null;

    if (!groupKey) {
      out.push({
        kind: 'single',
        id: row.id,
        type: row.type,
        payload: row.payload,
        read_at: row.read_at,
        created_at: row.created_at,
      });
      continue;
    }

    const groupId = `${row.type}:${groupKey}`;
    const existing = groupIndex.get(groupId);
    if (existing === undefined) {
      out.push({
        kind: 'group',
        id: groupId,
        type: row.type,
        ids: [row.id],
        count: 1,
        groupKey,
        created_at: row.created_at, // rows arrive newest-first, so the first wins
        anyUnread: row.read_at == null,
        payload: row.payload,
      });
      groupIndex.set(groupId, out.length - 1);
    } else {
      const g = out[existing] as ActivityGroup;
      g.ids.push(row.id);
      g.count += 1;
      g.anyUnread = g.anyUnread || row.read_at == null;
      if (g.payload == null && row.payload != null) g.payload = row.payload;
    }
  }

  return out;
}
