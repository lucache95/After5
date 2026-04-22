// /admin/feedback — Lucas's inbox for /tell-us submissions.
// Service-role read (bypasses RLS), grouped by kind, newest first.

import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/require-admin';
import { relativeTime } from '@/lib/relative-time';
import { Bug, Coffee, Lightbulb, MessageCircle } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface FeedbackRow {
  id: string;
  kind: string;
  subject: string | null;
  body: string;
  email: string | null;
  user_id: string | null;
  page_url: string | null;
  status: string;
  created_at: string;
}

const KIND_META: Record<string, { label: string; icon: typeof Bug; tone: string }> = {
  bug:               { label: 'Bug',       icon: Bug,            tone: 'bg-rose-100 text-rose-900 ring-rose-200' },
  place_suggestion:  { label: 'Place',     icon: Coffee,         tone: 'bg-amber-100 text-amber-950 ring-amber-200' },
  feature:           { label: 'Feature',   icon: Lightbulb,      tone: 'bg-emerald-100 text-emerald-900 ring-emerald-200' },
  other:             { label: 'Other',     icon: MessageCircle,  tone: 'bg-violet-100 text-violet-900 ring-violet-200' },
};

export default async function AdminFeedbackPage() {
  await requireAdmin('/admin/feedback');
  const admin = createAdminClient();

  // Cast: generated DB types don't yet include user_feedback.
  const { data } = await (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: FeedbackRow[] | null }>;
        };
      };
    };
  }).from('user_feedback')
    .select('id, kind, subject, body, email, user_id, page_url, status, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  const rows: FeedbackRow[] = data ?? [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 md:px-10 md:py-16">
      <div className="mb-10 flex items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
            Curator inbox
          </p>
          <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-5xl">
            Tell-us submissions
          </h1>
        </div>
        <p className="text-sm text-muted [font-variant-numeric:tabular-nums]">
          {rows.length} {rows.length === 1 ? 'note' : 'notes'}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center text-sm text-secondary">
          Nothing yet. /tell-us submissions land here.
        </div>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => {
            const meta = KIND_META[r.kind] ?? KIND_META.other;
            const Icon = meta.icon;
            return (
              <li
                key={r.id}
                className="rounded-card border border-border bg-background p-6 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.08)]"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ring-1 ${meta.tone}`}>
                    <Icon className="h-3 w-3" strokeWidth={2.5} />
                    {meta.label}
                  </span>
                  <span className="text-xs text-muted [font-variant-numeric:tabular-nums]">
                    {relativeTime(r.created_at)} · {new Date(r.created_at).toLocaleString()}
                  </span>
                  {r.email && (
                    <a
                      href={`mailto:${r.email}?subject=${encodeURIComponent('Re: ' + (r.subject ?? meta.label + ' on After5'))}`}
                      className="ml-auto text-xs font-medium text-accent underline decoration-accent/40 underline-offset-[4px] hover:decoration-accent"
                    >
                      Reply to {r.email}
                    </a>
                  )}
                </div>

                {r.subject && (
                  <h2 className="mt-4 font-display text-lg font-semibold text-text">
                    {r.subject}
                  </h2>
                )}
                <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-text">
                  {r.body}
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted">
                  {r.user_id && <span>user: {r.user_id.slice(0, 8)}…</span>}
                  {r.page_url && (
                    <a
                      href={r.page_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-border hover:text-text hover:decoration-text"
                    >
                      {r.page_url.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  <span>status: {r.status}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-10 text-center text-xs text-muted">
        <Link href="/admin/places" className="underline decoration-border hover:text-text hover:decoration-text">
          Curate places
        </Link>
        {' · '}
        <Link href="/account" className="underline decoration-border hover:text-text hover:decoration-text">
          Back to dashboard
        </Link>
      </p>
    </main>
  );
}
