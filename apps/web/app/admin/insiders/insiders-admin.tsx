'use client';

import { useState } from 'react';
import { CheckCircle2, X, Loader2, ExternalLink } from 'lucide-react';
import type { ApplicationRow, ActiveInsiderRow } from './page';

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type Tab = 'applications' | 'active';

const ROLES = ['scout', 'tester', 'curator', 'ambassador'] as const;

function roleBadge(role: string | null) {
  const colors: Record<string, string> = {
    scout: 'bg-blue-100 text-blue-900 ring-blue-200',
    tester: 'bg-amber-100 text-amber-950 ring-amber-200',
    curator: 'bg-emerald-100 text-emerald-900 ring-emerald-200',
    ambassador: 'bg-violet-100 text-violet-900 ring-violet-200',
  };
  const tone = colors[role ?? ''] ?? 'bg-gray-100 text-gray-900 ring-gray-200';
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ring-1 ${tone}`}
    >
      {role ?? 'none'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  applications: ApplicationRow[];
  insiders: ActiveInsiderRow[];
}

export function InsidersAdmin({ applications: initial, insiders }: Props) {
  const [tab, setTab] = useState<Tab>('applications');
  const [apps, setApps] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});

  const pending = apps.filter((a) => a.status === 'pending');
  const reviewed = apps.filter((a) => a.status !== 'pending');

  async function handleAction(
    applicationId: string,
    action: 'approve' | 'reject',
  ) {
    const role = selectedRoles[applicationId] || 'scout';
    setBusy(applicationId);
    try {
      const res = await fetch('/api/admin/insiders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_id: applicationId, action, role }),
      });
      if (res.ok) {
        setApps((prev) =>
          prev.map((a) =>
            a.id === applicationId
              ? { ...a, status: action === 'approve' ? 'approved' : 'rejected' }
              : a,
          ),
        );
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 md:px-10 md:py-16">
      {/* Header */}
      <div className="mb-10 flex items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
            Insider program
          </p>
          <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-5xl">
            Insiders
          </h1>
        </div>
        <p className="text-sm text-muted [font-variant-numeric:tabular-nums]">
          {pending.length} pending
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-8 flex gap-1 rounded-pill bg-surface p-1">
        {(['applications', 'active'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-pill px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-background text-text shadow-sm'
                : 'text-secondary hover:text-text'
            }`}
          >
            {t === 'applications'
              ? `Applications (${pending.length})`
              : `Active Insiders (${insiders.length})`}
          </button>
        ))}
      </div>

      {/* Applications tab */}
      {tab === 'applications' && (
        <div className="space-y-4">
          {pending.length === 0 && reviewed.length === 0 && (
            <div className="rounded-card border border-border bg-surface p-10 text-center text-sm text-secondary">
              No applications yet. Share the /join page to start recruiting.
            </div>
          )}

          {/* Pending applications */}
          {pending.map((app) => (
            <div
              key={app.id}
              className="rounded-card border border-border bg-background p-6 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.08)]"
            >
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-display text-lg font-semibold text-text">
                  {app.first_name}
                </h3>
                <a
                  href={`mailto:${app.email}`}
                  className="text-sm text-accent underline decoration-accent/40 underline-offset-[4px] hover:decoration-accent"
                >
                  {app.email}
                </a>
                {app.instagram && (
                  <a
                    href={`https://instagram.com/${app.instagram.replace('@', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-secondary hover:text-text"
                  >
                    {app.instagram}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <span className="text-xs text-muted [font-variant-numeric:tabular-nums]">
                  Applied {new Date(app.created_at).toLocaleDateString()}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                    Why they want to help
                  </p>
                  <p className="text-sm leading-relaxed text-text">
                    {app.motivation}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                    Best hidden date spot
                  </p>
                  <p className="text-sm leading-relaxed text-text">
                    {app.best_date_spot}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <select
                  value={selectedRoles[app.id] || 'scout'}
                  onChange={(e) =>
                    setSelectedRoles((prev) => ({
                      ...prev,
                      [app.id]: e.target.value,
                    }))
                  }
                  className="rounded-card border border-border bg-background px-3 py-1.5 text-sm text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => handleAction(app.id, 'approve')}
                  disabled={busy === app.id}
                  className="inline-flex items-center gap-1.5 rounded-pill bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busy === app.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Approve
                </button>

                <button
                  onClick={() => handleAction(app.id, 'reject')}
                  disabled={busy === app.id}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-background px-4 py-1.5 text-sm font-medium text-secondary transition-colors hover:bg-surface hover:text-text disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" />
                  Reject
                </button>
              </div>
            </div>
          ))}

          {/* Previously reviewed */}
          {reviewed.length > 0 && (
            <>
              <h3 className="mt-8 text-sm font-medium text-muted">
                Previously reviewed ({reviewed.length})
              </h3>
              {reviewed.map((app) => (
                <div
                  key={app.id}
                  className="rounded-card border border-border bg-surface/50 p-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-text">
                      {app.first_name}
                    </span>
                    <span className="text-sm text-muted">{app.email}</span>
                    <span
                      className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                        app.status === 'approved'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {app.status}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Active Insiders tab */}
      {tab === 'active' && (
        <div>
          {insiders.length === 0 ? (
            <div className="rounded-card border border-border bg-surface p-10 text-center text-sm text-secondary">
              No active insiders yet. Approve some applications to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                    <th className="pb-3 pr-4">Name</th>
                    <th className="pb-3 pr-4">Email</th>
                    <th className="pb-3 pr-4">Role</th>
                    <th className="pb-3 pr-4 text-right">Points</th>
                    <th className="pb-3 text-right">Approved</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {insiders.map((ins) => (
                    <tr key={ins.id}>
                      <td className="py-3 pr-4 font-medium text-text">
                        {ins.first_name ?? 'Unknown'}
                      </td>
                      <td className="py-3 pr-4 text-secondary">
                        {ins.email ?? '-'}
                      </td>
                      <td className="py-3 pr-4">{roleBadge(ins.insider_role)}</td>
                      <td className="py-3 pr-4 text-right [font-variant-numeric:tabular-nums]">
                        {ins.insider_points}
                      </td>
                      <td className="py-3 text-right text-muted [font-variant-numeric:tabular-nums]">
                        {ins.insider_approved_at
                          ? new Date(ins.insider_approved_at).toLocaleDateString()
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
