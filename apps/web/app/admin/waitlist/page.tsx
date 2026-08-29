// /admin/waitlist — the pre-launch waitlist dashboard. Watch signups roll in,
// track progress toward the Kelowna liquidity trigger (~400–600), see the
// referral leaderboard + organic-vs-referred split. Service-role read.

import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/require-admin';
import { relativeTime } from '@/lib/relative-time';

export const dynamic = 'force-dynamic';

// Liquidity go/no-go band from the launch plan.
const TRIGGER_LOW = 400;
const TRIGGER_HIGH = 600;

interface Row {
  id: string;
  email: string | null;
  first_name: string | null;
  city: string | null;
  created_at: string;
  referral_code: string | null;
  referred_by: string | null;
}

export default async function AdminWaitlistPage() {
  await requireAdmin('/admin/waitlist');
  const admin = createAdminClient();

  // Cast: generated DB types don't include the wait01 referral columns yet.
  const { data } = await (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          order: (col: string, opts: { ascending: boolean }) => Promise<{ data: Row[] | null }>;
        };
      };
    };
  }).from('subscribers')
    .select('id, email, first_name, city, created_at, referral_code, referred_by')
    .eq('source', 'waitlist')
    .order('created_at', { ascending: false });

  const rows: Row[] = data ?? [];
  const total = rows.length;

  // Referral counts derived from the rows themselves (a row's referral_code is
  // "used" by every row whose referred_by points at it).
  const refCount = new Map<string, number>();
  for (const r of rows) {
    if (r.referred_by) refCount.set(r.referred_by, (refCount.get(r.referred_by) ?? 0) + 1);
  }
  const referredCount = rows.filter((r) => r.referred_by).length;
  const organicCount = total - referredCount;

  const leaderboard = rows
    .map((r) => ({ name: r.first_name || r.email?.split('@')[0] || '—', code: r.referral_code, n: r.referral_code ? refCount.get(r.referral_code) ?? 0 : 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);

  const pct = Math.min(100, Math.round((total / TRIGGER_HIGH) * 100));

  return (
    <main className="mx-auto max-w-content px-6 py-12 md:px-10 md:py-16">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">Pre-launch</p>
          <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-5xl">Waitlist</h1>
        </div>
        <a
          href="/admin/waitlist/export"
          className="rounded-pill border border-border px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-surface"
        >
          Export CSV
        </a>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total signups" value={total.toLocaleString()} />
        <Stat label="From referrals" value={referredCount.toLocaleString()} sub={total ? `${Math.round((referredCount / total) * 100)}%` : undefined} />
        <Stat label="Organic" value={organicCount.toLocaleString()} />
        <Stat label="Liquidity target" value={`${TRIGGER_LOW}–${TRIGGER_HIGH}`} />
      </div>

      {/* liquidity progress */}
      <div className="mt-6 rounded-2xl border border-border bg-surface/40 p-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-text">Progress to launch liquidity</span>
          <span className="text-secondary">{total} / {TRIGGER_HIGH}</span>
        </div>
        <div className="relative h-3 w-full overflow-hidden rounded-pill bg-border">
          <div className="h-full rounded-pill bg-text transition-all" style={{ width: `${pct}%` }} />
          {/* low-band marker */}
          <div className="absolute top-0 h-full w-px bg-secondary/60" style={{ left: `${(TRIGGER_LOW / TRIGGER_HIGH) * 100}%` }} />
        </div>
        <p className="mt-2 text-[12px] text-muted">
          {total >= TRIGGER_LOW ? 'In the go-band — enough density to consider flipping the app on.' : `${TRIGGER_LOW - total} more to reach the bottom of the go-band.`}
        </p>
      </div>

      {/* referral leaderboard */}
      {leaderboard.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 font-display text-lg font-semibold text-text">Top referrers</h2>
          <div className="flex flex-wrap gap-2">
            {leaderboard.map((x) => (
              <span key={x.code} className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface/50 px-3 py-1.5 text-sm">
                <span className="font-medium text-text">{x.name}</span>
                <span className="rounded-pill bg-text px-2 py-0.5 text-[11px] font-semibold text-background">{x.n}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* table */}
      <div className="mt-8 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface/40 text-[12px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium">Referrals</th>
              <th className="px-4 py-3 font-medium">Referred by</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">No waitlist signups yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 text-text">{r.email}</td>
                <td className="px-4 py-3 text-secondary">{r.first_name || '—'}</td>
                <td className="px-4 py-3 text-secondary" title={r.created_at}>{relativeTime(r.created_at)}</td>
                <td className="px-4 py-3 text-secondary">{r.referral_code ? (refCount.get(r.referral_code) ?? 0) : 0}</td>
                <td className="px-4 py-3 font-mono text-[12px] text-muted">{r.referred_by || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-[12px] text-muted">
        Behavioral analytics (funnels, demographics, retention) live in{' '}
        <Link href="https://us.posthog.com" className="underline hover:text-text">PostHog</Link>. This view is the owned-data slice — signups + referrals.
      </p>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/40 p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-text">
        {value}
        {sub && <span className="ml-1 align-middle text-sm font-medium text-secondary">{sub}</span>}
      </p>
    </div>
  );
}
