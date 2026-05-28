// Server entrypoint: redirect already-authed users straight to /home so
// /login doesn't render the magic-link form for a logged-in session
// (caught in the 2026-05-27 a11y audit — C5).
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/home');
  return <LoginForm />;
}
