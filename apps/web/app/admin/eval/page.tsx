// /admin/eval — Generation quality evaluation dashboard.
// Server component that renders the client-side interactive dashboard.

import { requireAdmin } from '@/lib/auth/require-admin';
import { EvalDashboard } from './eval-dashboard';

export const dynamic = 'force-dynamic';

export default async function AdminEvalPage() {
  await requireAdmin('/admin/eval');
  return <EvalDashboard />;
}
