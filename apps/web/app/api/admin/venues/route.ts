// PATCH /api/admin/venues — update a single venue row.
// Gated by requireAdmin. Uses service-role client to bypass RLS.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@after5/types';

type PlaceUpdate = Database['public']['Tables']['places']['Update'];

// Fields the founder is allowed to edit from the QA panel.
const ALLOWED_FIELDS = new Set([
  'local_insight',
  'vibe_tags',
  'pairing_tags',
  'effort',
  'energy',
  'perceived_value',
  'time_of_day',
  'is_active',
]);

export async function PATCH(req: Request) {
  try {
    await requireAdmin('/admin/venues');
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const id = body.id;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  // Build a safe update payload from only allowed fields.
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (key === 'id') continue;
    if (!ALLOWED_FIELDS.has(key)) {
      return NextResponse.json({ error: `field_not_allowed: ${key}` }, { status: 400 });
    }
    raw[key] = body[key];
  }

  if (Object.keys(raw).length === 0) {
    return NextResponse.json({ error: 'no_fields' }, { status: 400 });
  }

  raw.updated_at = new Date().toISOString();

  // Cast through the typed update shape so Supabase's strict generics accept it.
  const update = raw as PlaceUpdate;

  const admin = createAdminClient();
  const { error } = await admin.from('places').update(update).eq('id', id);

  if (error) {
    console.error('venue update error', error);
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
