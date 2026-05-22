// POST /api/insiders/apply — public Insider application submission.
// Validates with Zod, checks for duplicate emails, inserts into insider_applications.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const schema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  email: z.string().email('Valid email required').max(320),
  instagram: z.string().max(100).optional().default(''),
  motivation: z
    .string()
    .min(50, 'Tell us a bit more (at least 50 characters)')
    .max(500, 'Keep it under 500 characters'),
  best_date_spot: z
    .string()
    .min(20, 'Tell us more about the spot (at least 20 characters)')
    .max(300, 'Keep it under 300 characters'),
});

// ---------------------------------------------------------------------------
// Simple in-memory rate limiter: 3 applications per IP per day
// ---------------------------------------------------------------------------

const ipCounts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + 86_400_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 3;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // Rate limit
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // Parse + validate
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: 'validation', issues: result.error.issues },
      { status: 400 },
    );
  }

  const { first_name, email, instagram, motivation, best_date_spot } = result.data;
  const normalizedEmail = email.toLowerCase().trim();

  const admin = createAdminClient();

  // Duplicate check — don't allow re-application if pending or approved
  const { data: existing } = await (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          in: (col: string, vals: string[]) => {
            limit: (n: number) => Promise<{ data: { id: string }[] | null }>;
          };
        };
      };
    };
  })
    .from('insider_applications')
    .select('id')
    .eq('email', normalizedEmail)
    .in('status', ['pending', 'approved'])
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'duplicate' }, { status: 409 });
  }

  // Insert
  const { error } = await (admin as unknown as {
    from: (t: string) => {
      insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    };
  })
    .from('insider_applications')
    .insert({
      email: normalizedEmail,
      first_name,
      instagram: instagram || null,
      motivation,
      best_date_spot,
    });

  if (error) {
    console.error('[insiders/apply] insert failed', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
