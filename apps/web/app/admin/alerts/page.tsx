// apps/web/app/admin/alerts/page.tsx
// Admin reader for admin_alerts — safety/ops events from the job runner.
// Service-role client bypasses RLS (no select policy on admin_alerts).
// Must remain a server component — service-role key never reaches the browser.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/require-admin';
import { relativeTime } from '@/lib/relative-time';
import { formatAlertKind } from '@/lib/admin-alerts';
import { LocalTime } from '@/components/LocalTime';

export const dynamic = 'force-dynamic';

interface AlertRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
}

export default async function AdminAlertsPage() {
  await requireAdmin('/admin/alerts');
  const admin = createAdminClient();

  // Cast: admin_alerts is not yet in the generated Database types.
  const { data, error } = await (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: AlertRow[] | null; error: { message: string } | null }>;
        };
      };
    };
  })
    .from('admin_alerts')
    .select('id, kind, payload, created_at, resolved_at')
    .order('created_at', { ascending: false })
    .limit(100);

  const rows: AlertRow[] = data ?? [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 md:px-10 md:py-16">
      <div className="mb-10 flex items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
            Admin · alerts
          </p>
          <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-5xl">
            Safety &amp; ops alerts
          </h1>
        </div>
        <p className="text-sm text-muted [font-variant-numeric:tabular-nums]">
          {rows.length} {rows.length === 1 ? 'alert' : 'alerts'}
          {error && (
            <span className="ml-2 text-rose-600">· query error: {error.message}</span>
          )}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center text-sm text-secondary">
          No alerts. Rows written by <code className="font-mono text-xs">raise_admin_alert</code> land here.
        </div>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => (
            <li
              key={r.id}
              className={`rounded-card border bg-background p-6 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.08)] ${
                r.resolved_at
                  ? 'border-border opacity-60'
                  : 'border-rose-200'
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex items-center rounded-pill px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ring-1 ${
                    r.resolved_at
                      ? 'bg-surface text-muted ring-border'
                      : 'bg-rose-100 text-rose-900 ring-rose-200'
                  }`}
                >
                  {formatAlertKind(r.kind)}
                </span>
                <span className="text-xs text-muted [font-variant-numeric:tabular-nums]">
                  {relativeTime(r.created_at)} · <LocalTime iso={r.created_at} />
                </span>
                {r.resolved_at && (
                  <span className="ml-auto text-xs text-muted">
                    resolved <LocalTime iso={r.resolved_at} />
                  </span>
                )}
              </div>

              <div className="mt-4">
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                  Payload
                </p>
                <pre className="overflow-auto rounded-card border border-border bg-surface p-4 font-mono text-xs leading-relaxed text-text">
                  {JSON.stringify(r.payload, null, 2)}
                </pre>
              </div>

              <p className="mt-3 font-mono text-[10px] text-muted break-all">
                id: {r.id}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
