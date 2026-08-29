// /admin/ideas — curate feature requests onto the public board (/ideas).
// Lists user_feedback kind='feature'; admin publishes, titles, and moves status.

import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/require-admin';
import { relativeTime } from '@/lib/relative-time';
import { AdminIdeaControls } from '@/components/admin/AdminIdeaControls';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  subject: string | null;
  body: string;
  email: string | null;
  created_at: string;
  status: string;
  is_public: boolean;
  public_title: string | null;
  vote_count: number;
}

export default async function AdminIdeasPage() {
  await requireAdmin('/admin/ideas');
  const admin = createAdminClient() as unknown as { from: (t: string) => any };

  const { data } = await admin
    .from('user_feedback')
    .select('id, subject, body, email, created_at, status, is_public, public_title, vote_count')
    .eq('kind', 'feature')
    .order('is_public', { ascending: false })
    .order('vote_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);

  const rows: Row[] = data ?? [];
  const live = rows.filter((r) => r.is_public).length;

  return (
    <main className="mx-auto max-w-content px-6 py-12 md:px-10 md:py-16">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">Roadmap</p>
          <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-5xl">Ideas</h1>
        </div>
        <Link href="/ideas" className="rounded-pill border border-border px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-surface">
          View public board ({live})
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface/40 p-10 text-center text-muted">
          No feature requests yet. They arrive via <Link href="/tell-us" className="underline">/tell-us</Link>.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-border bg-surface/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {r.subject && <p className="font-medium text-text">{r.subject}</p>}
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-secondary">{r.body}</p>
                  <p className="mt-1 text-[12px] text-muted">
                    {relativeTime(r.created_at)}{r.email ? ` · ${r.email}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {r.is_public && <span className="rounded-pill bg-text px-2 py-0.5 text-[11px] font-semibold text-background">LIVE</span>}
                  <span className="text-[12px] text-muted">{r.vote_count} {r.vote_count === 1 ? 'vote' : 'votes'}</span>
                </div>
              </div>
              <AdminIdeaControls id={r.id} isPublic={r.is_public} publicTitle={r.public_title} status={r.status} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
