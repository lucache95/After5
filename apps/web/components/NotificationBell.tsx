// apps/web/components/NotificationBell.tsx
// Server wrapper for the header notification affordance (G, spec §3 / decision
// G-1: a header affordance, NOT a 5th bottom tab — BottomTabShell stays untouched).
// Resolves the viewer + seeds the unread count under RLS, then mounts the client
// NotificationCenter (which contains the bell + badge) and the headless toast.
// Renders nothing for logged-out callers.
import { createClient } from '@/lib/supabase/server';
import { NotificationCenter } from './NotificationCenter';
import { NotificationToast } from './NotificationToast';

export async function NotificationBell() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null);

  return (
    <>
      <NotificationCenter userId={user.id} initialCount={count ?? 0} />
      <NotificationToast userId={user.id} />
    </>
  );
}
