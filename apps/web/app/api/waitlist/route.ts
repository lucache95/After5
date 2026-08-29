import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureWelcomeSent } from '@/lib/email/welcome';
import { sendWaitlistSignupAlert } from '@/lib/email/waitlist-notify';
import { normalizeSubscribeInput } from '@/lib/create/subscribe';

// Sept-8 launch waitlist with a referral loop (see
// .planning/2026-06-20-kelowna-launch-plan.md). POST joins the list (idempotent
// on (email, source='waitlist')), mints a stable referral code, records who
// referred them, fires the welcome email, and returns the caller's standing.
// GET ?code= returns standing for the share page. source='waitlist' is the
// segment marker; referrals pull a signup up the queue (see waitlist_status RPC).

export const dynamic = 'force-dynamic';

const SOURCE = 'waitlist';
// Unambiguous base32 (no 0/O/1/I/L) — codes are shared in links + read aloud.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function mintCode(len = 7): string {
  const b = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

// The generated Database types don't yet include the wait01 columns
// (referral_code/referred_by) or the waitlist_status RPC, so we use a loose
// client for those — same approach as lib/create/subscribe.ts. Standard-column
// safety isn't lost elsewhere; this route only touches subscribers + the RPC.
type LooseDb = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};
const loose = () => createAdminClient() as unknown as LooseDb;

async function statusFor(admin: LooseDb, code: string) {
  const { data, error } = await admin.rpc('waitlist_status', { p_code: code });
  if (error || !data || (Array.isArray(data) && data.length === 0)) {
    return { queue_position: null, referral_count: 0, total: null };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    queue_position: row.queue_position ?? null,
    referral_count: row.referral_count ?? 0,
    total: row.total ?? null,
  };
}

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code')?.trim();
  if (!code) return NextResponse.json({ error: 'missing_code' }, { status: 400 });
  const admin = loose();
  return NextResponse.json({ code, ...(await statusFor(admin, code)) });
}

export async function POST(req: Request) {
  let body: { email?: string; first_name?: string | null; city?: string | null; referred_by?: string | null; source?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const n = normalizeSubscribeInput({
    email: body.email,
    city: body.city,
    first_name: body.first_name,
    source: SOURCE,
  });
  if (!n.valid) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });

  const referredBy = (body.referred_by ?? '').trim() || null;
  const admin = loose();

  // Already on the waitlist? Reuse the existing code (idempotent) — never
  // re-mint, or a refresh would orphan prior referrals.
  const { data: existing } = await admin
    .from('subscribers')
    .select('id, referral_code')
    .eq('email', n.email)
    .eq('source', SOURCE)
    .limit(1)
    .maybeSingle();

  let code = existing?.referral_code ?? null;
  let isNewSignup = false;

  if (existing) {
    if (!code) {
      code = mintCode();
      await admin.from('subscribers').update({ referral_code: code }).eq('id', existing.id);
    }
  } else {
    // New signup. Retry once on the (rare) referral_code collision.
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      code = mintCode();
      const { error } = await admin.from('subscribers').insert({
        email: n.email,
        source: SOURCE,
        first_name: n.first_name ?? null,
        city: n.city ?? null,
        referral_code: code,
        // Don't credit a self-referral or a code that doesn't exist yet.
        referred_by: referredBy && referredBy !== code ? referredBy : null,
        user_agent: req.headers.get('user-agent') ?? null,
      });
      if (!error) { inserted = true; isNewSignup = true; break; }
      // 23505 = unique violation; on referral_code retry, on email treat as race → reuse.
      if (error.code === '23505' && /referral_code/.test(error.message)) continue;
      if (error.code === '23505') {
        const { data: race } = await admin
          .from('subscribers').select('referral_code').eq('email', n.email).eq('source', SOURCE).limit(1).maybeSingle();
        code = race?.referral_code ?? code;
        inserted = true;
        break;
      }
      console.error('[waitlist] insert error', error);
      return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }
  }

  // Welcome email — idempotent (checks welcome_sent_at), non-blocking.
  void ensureWelcomeSent({ email: n.email, firstName: n.first_name, admin }).then((res) => {
    if (res.error) console.error('[waitlist] welcome', res.error);
  });

  // Founder alert — only on a genuinely new signup (not an idempotent re-join
  // or an email-race reuse), non-blocking. See lib/email/waitlist-notify.ts.
  if (isNewSignup) {
    void sendWaitlistSignupAlert({ email: n.email, city: n.city }).catch((err) =>
      console.error('[waitlist] founder alert', err));
  }

  return NextResponse.json({ code, ...(code ? await statusFor(admin, code) : {}) });
}
