import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/tell-us — accepts a user-submitted bug, place suggestion,
// feature request, or other note. Anonymous OK; signed-in users get
// their user_id attached automatically.

const ALLOWED_KINDS = new Set(['bug', 'place_suggestion', 'feature', 'other']);

export async function POST(req: Request) {
  let body: {
    kind?: string;
    subject?: string;
    body?: string;
    email?: string;
    page_url?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const kind = (body.kind ?? '').trim();
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 });
  }

  const text = (body.body ?? '').trim();
  if (text.length < 5 || text.length > 4000) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const subject = (body.subject ?? '').trim().slice(0, 200) || null;
  const email = (body.email ?? '').trim().toLowerCase().slice(0, 200) || null;
  const pageUrl = (body.page_url ?? '').trim().slice(0, 500) || null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Service-role for write — bypasses RLS so the form keeps working
  // regardless of policy drift. Cast: generated DB types don't yet
  // include user_feedback.
  const admin = createAdminClient();
  const { error } = await (admin as unknown as {
    from: (t: string) => {
      insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    };
  }).from('user_feedback').insert({
    kind,
    subject,
    body: text,
    email: email ?? user?.email ?? null,
    user_id: user?.id ?? null,
    page_url: pageUrl,
    user_agent: req.headers.get('user-agent') ?? null,
  });

  if (error) {
    console.error('[/api/tell-us] insert error', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
