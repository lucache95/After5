# R0.3 — Admin Alerts Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a server-component `/admin/alerts` page that reads `admin_alerts` rows via the existing service-role client (bypassing RLS), gated by `requireAdmin`.

**Architecture:** The service-role client already exists at `apps/web/lib/supabase/admin.ts` (`createAdminClient`). The page follows the exact pattern of `/admin/feedback/page.tsx` — server component, `force-dynamic`, `requireAdmin` call first, then `createAdminClient()` query, then JSX render. A pure `formatAlert` helper function provides a testable unit boundary. Add "Alerts" to the admin nav layout.

**Tech Stack:** Next.js 15 App Router (server components), TypeScript, Vitest (jsdom), existing `createAdminClient` / `requireAdmin` / `relativeTime` helpers.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `apps/web/app/admin/alerts/page.tsx` | Server page: auth guard → service-role query → render alert list |
| **Create** | `apps/web/lib/admin-alerts.ts` | Pure `formatAlert` helper (testable unit; no Supabase import) |
| **Create** | `apps/web/lib/__tests__/admin-alerts.test.ts` | Unit tests for `formatAlert` |
| **Modify** | `apps/web/app/admin/layout.tsx` | Add "Alerts" nav item |

---

### Task 1: Add the `formatAlert` helper and its unit tests

**Files:**
- Create: `apps/web/lib/admin-alerts.ts`
- Create: `apps/web/lib/__tests__/admin-alerts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/__tests__/admin-alerts.test.ts
import { describe, it, expect } from 'vitest';
import { formatAlertKind } from '../admin-alerts';

describe('formatAlertKind', () => {
  it('formats known kinds as title-case label', () => {
    expect(formatAlertKind('safety_job_failed')).toBe('Safety job failed');
    expect(formatAlertKind('job_missing_rpc')).toBe('Job missing rpc');
  });

  it('returns unknown kinds as-is when not in map', () => {
    expect(formatAlertKind('totally_new_kind')).toBe('Totally new kind');
  });

  it('handles empty string gracefully', () => {
    expect(formatAlertKind('')).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/lucas/Projects/After5
pnpm --filter @after5/web test -- --reporter=verbose lib/__tests__/admin-alerts 2>&1 | tail -20
```

Expected: FAIL with "Cannot find module '../admin-alerts'"

- [ ] **Step 3: Write the minimal implementation**

```ts
// apps/web/lib/admin-alerts.ts

// Converts an admin_alerts.kind value into a human-readable label.
// Rule: replace underscores with spaces, sentence-case the result.
// Exported as a pure function so it's unit-testable without Supabase.
export function formatAlertKind(kind: string): string {
  if (!kind) return '';
  const spaced = kind.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/lucas/Projects/After5
pnpm --filter @after5/web test -- --reporter=verbose lib/__tests__/admin-alerts 2>&1 | tail -20
```

Expected: PASS (3 tests green)

- [ ] **Step 5: Commit**

```bash
git -C /Users/lucas/Projects/After5 add apps/web/lib/admin-alerts.ts apps/web/lib/__tests__/admin-alerts.test.ts
git -C /Users/lucas/Projects/After5 commit -m "$(cat <<'EOF'
test(admin): add formatAlertKind helper with unit tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Build the `/admin/alerts` page

**Files:**
- Create: `apps/web/app/admin/alerts/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
// apps/web/app/admin/alerts/page.tsx
// Admin reader for admin_alerts — safety/ops events from the job runner.
// Service-role client bypasses RLS (no select policy on admin_alerts).
// Must remain a server component — service-role key never reaches the browser.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/require-admin';
import { relativeTime } from '@/lib/relative-time';
import { formatAlertKind } from '@/lib/admin-alerts';

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
                  {relativeTime(r.created_at)} · {new Date(r.created_at).toLocaleString()}
                </span>
                {r.resolved_at && (
                  <span className="ml-auto text-xs text-muted">
                    resolved {new Date(r.resolved_at).toLocaleString()}
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
```

- [ ] **Step 2: Run typecheck to confirm no errors**

```bash
cd /Users/lucas/Projects/After5
pnpm --filter @after5/web typecheck 2>&1 | tail -20
```

Expected: exit 0, no errors in `app/admin/alerts/page.tsx`

- [ ] **Step 3: Commit**

```bash
git -C /Users/lucas/Projects/After5 add apps/web/app/admin/alerts/page.tsx
git -C /Users/lucas/Projects/After5 commit -m "$(cat <<'EOF'
feat(admin): /admin/alerts reader for admin_alerts (service-role behind requireAdmin)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add "Alerts" to the admin nav layout

**Files:**
- Modify: `apps/web/app/admin/layout.tsx`

- [ ] **Step 1: Add the nav item**

In `apps/web/app/admin/layout.tsx`, add `<NavItem href="/admin/alerts" label="Alerts" />` to the `<ul>` — put it after "Eval" (last item currently):

```tsx
            <NavItem href="/admin/eval" label="Eval" />
            <NavItem href="/admin/alerts" label="Alerts" />
```

- [ ] **Step 2: Run typecheck and lint**

```bash
cd /Users/lucas/Projects/After5
pnpm --filter @after5/web typecheck 2>&1 | tail -10
pnpm --filter @after5/web lint 2>&1 | tail -10
```

Expected: both exit 0

- [ ] **Step 3: Commit**

```bash
git -C /Users/lucas/Projects/After5 add apps/web/app/admin/layout.tsx
git -C /Users/lucas/Projects/After5 commit -m "$(cat <<'EOF'
feat(admin): add Alerts nav item to admin layout

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Full CI gate — typecheck + lint + build + test

- [ ] **Step 1: Run all checks**

```bash
cd /Users/lucas/Projects/After5
pnpm --filter @after5/web typecheck 2>&1 | tail -5
pnpm --filter @after5/web lint 2>&1 | tail -5
pnpm --filter @after5/web build 2>&1 | tail -15
pnpm --filter @after5/web test 2>&1 | tail -20
```

Expected: all exit 0

- [ ] **Step 2: If any check fails, fix and amend/commit**

Address errors, then:

```bash
git -C /Users/lucas/Projects/After5 add -p
git -C /Users/lucas/Projects/After5 commit -m "$(cat <<'EOF'
fix(admin): resolve typecheck/lint/build errors in alerts page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```
