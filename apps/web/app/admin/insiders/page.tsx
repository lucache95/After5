// /admin/insiders — approval queue for Insider applications + active insiders list.
// Server component fetches data; InsidersAdmin handles interactivity.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/require-admin';
import { InsidersAdmin } from './insiders-admin';

export const dynamic = 'force-dynamic';

export interface ApplicationRow {
  id: string;
  created_at: string;
  email: string;
  first_name: string;
  instagram: string | null;
  motivation: string;
  best_date_spot: string;
  status: string;
  reviewed_at: string | null;
  notes: string | null;
}

export interface ActiveInsiderRow {
  id: string;
  email: string | null;
  first_name: string | null;
  insider_role: string | null;
  insider_points: number;
  insider_approved_at: string | null;
}

export default async function AdminInsidersPage() {
  await requireAdmin('/admin/insiders');
  const admin = createAdminClient();

  // Fetch all applications, newest first
  const { data: applications } = await (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        order: (col: string, opts: { ascending: boolean }) => Promise<{
          data: ApplicationRow[] | null;
        }>;
      };
    };
  })
    .from('insider_applications')
    .select(
      'id, created_at, email, first_name, instagram, motivation, best_date_spot, status, reviewed_at, notes',
    )
    .order('created_at', { ascending: false });

  // Fetch active insiders (profiles with insider_role set)
  const { data: insiders } = await admin
    .from('profiles')
    .select('id, email, first_name, insider_role, insider_points, insider_approved_at')
    .not('insider_role', 'is', null)
    .order('insider_points', { ascending: false });

  return (
    <InsidersAdmin
      applications={(applications ?? []) as ApplicationRow[]}
      insiders={(insiders ?? []) as ActiveInsiderRow[]}
    />
  );
}
