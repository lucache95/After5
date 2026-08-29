// POST /api/admin/ideas/[id] — admin curates a feature request onto the public
// board: publish/unpublish, set the clean public_title, and move status
// (open → planned → shipped). Admin-gated; service-role write.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/require-admin';

export const dynamic = 'force-dynamic';

const STATUSES = new Set(['new', 'triaged', 'planned', 'shipped', 'done', 'wontfix']);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin('/admin/ideas');
  const { id } = await params;

  let body: { is_public?: boolean; public_title?: string | null; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.is_public === 'boolean') {
    patch.is_public = body.is_public;
    // stamp published_at the first time it goes public.
    if (body.is_public) patch.published_at = new Date().toISOString();
  }
  if (body.public_title !== undefined) patch.public_title = body.public_title?.trim() || null;
  if (body.status !== undefined && STATUSES.has(body.status)) patch.status = body.status;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
  }

  const admin = createAdminClient() as unknown as { from: (t: string) => any };
  const { error } = await admin.from('user_feedback').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: 'update_failed', details: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
