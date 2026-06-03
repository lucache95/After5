// apps/web/app/api/inbox/activity/route.ts
// Unified inbox activity feed (#84, spec §4). A grouped read view over the
// `notifications` table — same RLS-bound, keyset-paginated select the bell's
// /api/notifications route uses, with two inbox-specific transforms applied in TS:
//   1. exclude `new_message` (it lives in the thread zone, not activity);
//   2. group `interest_received` by payload.date_instance_id into one counted row.
// Returns lean items (ids + minimal payload + read state) so a phone pulls KB not
// MB; the client deep-links on tap and the target page fetches detail. unreadCount
// is the activity unread total (mirrors the bell's count). Mark-read reuses the
// existing read-only-`read_at` path at POST /api/notifications (no new write here).
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { groupActivity, type RawNotification } from '@/lib/after5/inbox-activity';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 60;

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
    .neq('type', 'new_message') // excluded from activity (spec §2) — keep keyset stable
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.lt('created_at', cursor);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as RawNotification[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  // Cursor is the raw created_at of the last RAW row on the page (keyset stays on
  // the underlying table, not the grouped output, so pagination can't skip rows).
  const nextCursor = hasMore ? page[page.length - 1]?.created_at ?? null : null;

  const items = groupActivity(page);

  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .neq('type', 'new_message')
    .is('read_at', null);

  return NextResponse.json({ items, nextCursor, unreadCount: count ?? 0 });
}
