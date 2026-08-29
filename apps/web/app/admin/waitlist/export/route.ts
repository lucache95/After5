// /admin/waitlist/export — CSV of the waitlist (admin-gated). Service-role read.
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/require-admin';

export const dynamic = 'force-dynamic';

interface Row {
  email: string | null;
  first_name: string | null;
  city: string | null;
  created_at: string;
  referral_code: string | null;
  referred_by: string | null;
}

// Minimal CSV escaping: wrap in quotes, double embedded quotes.
const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export async function GET() {
  await requireAdmin('/admin/waitlist');
  const admin = createAdminClient();

  const { data } = await (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          order: (col: string, opts: { ascending: boolean }) => Promise<{ data: Row[] | null }>;
        };
      };
    };
  }).from('subscribers')
    .select('email, first_name, city, created_at, referral_code, referred_by')
    .eq('source', 'waitlist')
    .order('created_at', { ascending: false });

  const rows: Row[] = data ?? [];
  const header = ['email', 'first_name', 'city', 'joined_at', 'referral_code', 'referred_by'];
  const lines = [
    header.join(','),
    ...rows.map((r) => [r.email, r.first_name, r.city, r.created_at, r.referral_code, r.referred_by].map(cell).join(',')),
  ];

  return new NextResponse(lines.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="after5-waitlist.csv"',
    },
  });
}
