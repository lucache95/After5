// Authenticated landing. Shows email + editable profile fields, sign-out
// button. Redirects to /login (with ?next=/account) if no session.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ProfileForm } from './ProfileForm';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/account');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, city, neighborhood')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-[2px]">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-5 md:px-10">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight text-text">
            After5
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-sm text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
            >
              Sign out
            </button>
          </form>
        </nav>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-16 md:px-10 md:py-24">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
          Your account
        </p>
        <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
          Hey{profile?.first_name ? `, ${profile.first_name}` : ''}.
        </h1>
        <p className="mt-5 text-base text-secondary">
          Signed in as <span className="text-text">{user.email}</span>.
        </p>

        <div className="mt-12">
          <ProfileForm
            initial={{
              first_name: profile?.first_name ?? '',
              city: profile?.city ?? '',
              neighborhood: profile?.neighborhood ?? '',
            }}
          />
        </div>

        <div className="mt-16 border-t border-border pt-10">
          <h2 className="font-display text-xl font-semibold text-text">Plan something</h2>
          <p className="mt-3 text-sm text-secondary">
            We&apos;ll prefill the email gate with your profile so you skip straight to the plans.
          </p>
          <Link
            href="/plan"
            className="mt-6 inline-flex items-center gap-2 rounded-pill bg-primary px-7 py-3.5 text-base font-medium text-background transition-opacity hover:opacity-85"
          >
            Build a plan →
          </Link>
        </div>
      </div>
    </main>
  );
}
