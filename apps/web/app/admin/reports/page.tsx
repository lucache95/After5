// apps/web/app/admin/reports/page.tsx
// Admin reader for message_reports — chat messages flagged via the report_message RPC.
// Service-role client bypasses RLS (message_reports is deny-by-default, ZERO policies).
// Must remain a server component — service-role key never reaches the browser.
// Read-only this round: visibility only, no resolve/delete action.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/require-admin';
import { relativeTime } from '@/lib/relative-time';
import { LocalTime } from '@/components/LocalTime';

export const dynamic = 'force-dynamic';

// Shape of the embedded PostgREST resources. message_reports / messages aren't in
// the generated Database types yet, so we describe + cast the join result.
interface ReportRow {
  id: string;
  reason: string | null;
  created_at: string;
  reporter: { first_name: string | null } | null;
  message: {
    id: string;
    body: string;
    created_at: string;
    sender: { first_name: string | null } | null;
    thread: {
      id: string;
      state: string | null;
      offer: { id: string } | null;
    } | null;
  } | null;
}

export default async function AdminReportsPage() {
  await requireAdmin('/admin/reports');
  const admin = createAdminClient();

  // Newest-first. Each report joins to the reported message (body, sender, time),
  // the reporter, and the thread/offer context behind the message.
  const { data, error } = await (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: ReportRow[] | null; error: { message: string } | null }>;
        };
      };
    };
  })
    .from('message_reports')
    .select(
      `id, reason, created_at,
       reporter:profiles!message_reports_reporter_id_fkey(first_name),
       message:messages!message_reports_message_id_fkey(
         id, body, created_at,
         sender:profiles!messages_sender_id_fkey(first_name),
         thread:chat_threads!messages_thread_id_fkey(
           id, state,
           offer:offers!chat_threads_offer_id_fkey(id)
         )
       )`,
    )
    .order('created_at', { ascending: false })
    .limit(100);

  const rows: ReportRow[] = data ?? [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 md:px-10 md:py-16">
      <div className="mb-10 flex items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
            Admin · reports
          </p>
          <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-5xl">
            Reported messages
          </h1>
        </div>
        <p className="text-sm text-muted [font-variant-numeric:tabular-nums]">
          {rows.length} {rows.length === 1 ? 'report' : 'reports'}
          {error && (
            <span className="ml-2 text-rose-600">· query error: {error.message}</span>
          )}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center text-sm text-secondary">
          No reports. Rows written by the{' '}
          <code className="font-mono text-xs">report_message</code> RPC land here.
        </div>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => {
            const senderName = r.message?.sender?.first_name ?? 'unknown';
            const reporterName = r.reporter?.first_name ?? 'unknown';
            const offerId = r.message?.thread?.offer?.id ?? null;
            const threadState = r.message?.thread?.state ?? null;
            return (
              <li
                key={r.id}
                className="rounded-card border border-rose-200 bg-background p-6 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.08)]"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center rounded-pill bg-rose-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-900 ring-1 ring-rose-200">
                    Reported
                  </span>
                  <span className="text-xs text-muted [font-variant-numeric:tabular-nums]">
                    {relativeTime(r.created_at)} · <LocalTime iso={r.created_at} />
                  </span>
                  {threadState && (
                    <span className="ml-auto text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                      thread {threadState}
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                    Message from {senderName}
                  </p>
                  {r.message ? (
                    <blockquote className="rounded-card border border-border bg-surface p-4 text-sm leading-relaxed text-text">
                      {r.message.body}
                    </blockquote>
                  ) : (
                    <p className="rounded-card border border-border bg-surface p-4 text-sm italic text-muted">
                      message no longer exists
                    </p>
                  )}
                  {r.message && (
                    <p className="mt-1.5 text-xs text-muted [font-variant-numeric:tabular-nums]">
                      sent {relativeTime(r.message.created_at)} ·{' '}
                      <LocalTime iso={r.message.created_at} />
                    </p>
                  )}
                </div>

                <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                  <div className="flex gap-2">
                    <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                      Reported by
                    </dt>
                    <dd className="text-text">{reporterName}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                      Reason
                    </dt>
                    <dd className="text-text">{r.reason ?? '(none given)'}</dd>
                  </div>
                </dl>

                <p className="mt-3 font-mono text-[10px] text-muted break-all">
                  report: {r.id}
                  {offerId && ` · offer: ${offerId}`}
                  {r.message && ` · message: ${r.message.id}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
