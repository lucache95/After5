'use client';

// Per-idea admin controls on /admin/ideas: edit the public title, publish/
// unpublish to the board, and move status. Posts to /api/admin/ideas/[id] and
// refreshes the server data on success.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STATUSES = ['new', 'triaged', 'planned', 'shipped', 'done', 'wontfix'] as const;

export function AdminIdeaControls({
  id, isPublic, publicTitle, status,
}: {
  id: string;
  isPublic: boolean;
  publicTitle: string | null;
  status: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(publicTitle ?? '');
  const [busy, setBusy] = useState(false);

  async function send(patch: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/ideas/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="public title (shown on the board)"
        className="min-w-[220px] flex-1 rounded-pill border border-border bg-background px-3 py-1.5 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-text/20"
      />
      <select
        value={status}
        disabled={busy}
        onChange={(e) => send({ status: e.target.value })}
        className="rounded-pill border border-border bg-background px-3 py-1.5 text-sm text-text focus:outline-none"
      >
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <button
        type="button"
        disabled={busy}
        onClick={() => send({ is_public: !isPublic, public_title: title || null })}
        className={
          isPublic
            ? 'rounded-pill border border-border px-4 py-1.5 text-sm font-medium text-text hover:bg-surface disabled:opacity-50'
            : 'rounded-pill bg-text px-4 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50'
        }
      >
        {isPublic ? 'Unpublish' : 'Publish to board'}
      </button>
      {title !== (publicTitle ?? '') && (
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ public_title: title || null })}
          className="rounded-pill border border-border px-3 py-1.5 text-sm font-medium text-text hover:bg-surface disabled:opacity-50"
        >
          Save title
        </button>
      )}
    </div>
  );
}
