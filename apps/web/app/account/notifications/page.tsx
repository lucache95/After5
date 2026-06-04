// apps/web/app/account/notifications/page.tsx
// Notification preferences (G, spec §5.3/§6). SSR-reads the viewer's prefs row
// under RLS (notif_prefs_owner_all); a missing row renders all-on defaults
// (dispatch_notification treats absent prefs as permissive).
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { DeepRouteHeader } from '@/components/DeepRouteHeader';
import { PreferencesForm } from './PreferencesForm';

export const dynamic = 'force-dynamic';

export default async function NotificationPreferencesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account/notifications');

  const { data } = await supabase
    .from('notification_preferences')
    .select('push_enabled,email_enabled,offers_enabled,matches_enabled,messages_enabled,reminders_enabled,account_enabled,quiet_hours_start,quiet_hours_end')
    .eq('user_id', user.id)
    .maybeSingle();

  return (
    <>
      <DeepRouteHeader title="notifications" backHref="/account" backLabel="back to your account" />
      {/* deep route: pb-20 (no bottom-nav clearance), per UI-SPEC §Spacing */}
      <main className="mx-auto w-full max-w-[420px] px-6 pb-20 pt-8">
        <h1 className="font-heading text-3xl lowercase text-shell-ink">notifications</h1>
        <p className="mt-1 font-body text-sm text-shell-ink/70">choose what reaches you, and when.</p>
        <PreferencesForm userId={user.id} initial={data ?? null} />
      </main>
    </>
  );
}
