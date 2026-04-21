import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Server-only admin guard. Throws via redirect() if the current user
// isn't authenticated or isn't on the ADMIN_EMAILS allowlist.
//
// ADMIN_EMAILS is a comma-separated env var, e.g.
//   ADMIN_EMAILS=lucas@breathefum.com,lucas@lucassenechal.com
// Empty allowlist = nobody is admin (fail closed).

export async function requireAdmin(currentPath: string): Promise<{ email: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  }

  const allow = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (!allow.includes(user.email.toLowerCase())) {
    redirect('/');
  }

  return { email: user.email };
}
