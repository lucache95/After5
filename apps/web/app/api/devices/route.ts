// apps/web/app/api/devices/route.ts
// Persist a Web Push subscription onto the caller's `devices` row. Auth runs
// under the viewer's RLS-bound SSR client; the write goes through the
// SECURITY DEFINER register_device RPC (auth.uid()-scoped), so a user can only
// ever register a device for themselves.
//
// For web push the native expo token is empty: the unique constraint
// `nulls not distinct (user_id, expo_push_token)` collapses a user's web-only
// row to a single slot, so re-subscribing (or a new browser) overwrites the
// stored web_push_sub. Web push is intentionally best-effort / single-browser.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { registerDevice } from '@after5/api-client';

interface DeviceBody {
  /** 'web' for browser push; native clients send their platform + token. */
  kind?: unknown;
  /** PushSubscription.toJSON() — { endpoint, keys: { p256dh, auth } }. */
  subscription?: unknown;
  /** Native push token (ignored for web). */
  token?: unknown;
}

function isWebPushSubscription(v: unknown): v is { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (!v || typeof v !== 'object') return false;
  const sub = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  return (
    typeof sub.endpoint === 'string' &&
    !!sub.keys &&
    typeof sub.keys.p256dh === 'string' &&
    typeof sub.keys.auth === 'string'
  );
}

export async function POST(request: NextRequest) {
  let body: DeviceBody;
  try {
    body = (await request.json()) as DeviceBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const kind = body.kind === 'web' || typeof body.kind !== 'string' ? 'web' : body.kind;

  if (kind === 'web') {
    if (!isWebPushSubscription(body.subscription)) {
      return NextResponse.json({ error: 'invalid_subscription' }, { status: 400 });
    }
    try {
      // Web row: empty expo token (collapses to one web slot per user), the
      // subscription lands in web_push_sub.
      const id = await registerDevice(
        supabase,
        '',
        'web',
        body.subscription as Record<string, unknown>,
      );
      return NextResponse.json({ id });
    } catch (err) {
      console.error('[api/devices] register web push failed', err);
      return NextResponse.json({ error: 'register_failed' }, { status: 500 });
    }
  }

  // Native registration: requires a token; no web_push_sub.
  if (typeof body.token !== 'string' || body.token.length === 0) {
    return NextResponse.json({ error: 'token_required' }, { status: 400 });
  }
  try {
    const id = await registerDevice(supabase, body.token, kind, null);
    return NextResponse.json({ id });
  } catch (err) {
    console.error('[api/devices] register native failed', err);
    return NextResponse.json({ error: 'register_failed' }, { status: 500 });
  }
}
