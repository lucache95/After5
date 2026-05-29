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
    .update({ read_at: new Date().toISOString() }, { count: 'exact' })  // RED-G1: only read_at
    .eq('user_id', user.id)
    .is('read_at', null);
  if (!all) q = q.in('id', ids);

  const { error, count } = await q.select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ updated: count ?? 0 });
}
