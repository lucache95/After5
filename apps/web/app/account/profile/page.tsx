// Dating-profile editor route (Barbiecore Tier-1 shell). Hydrates the signed-in
// user's current dating fields and renders the client <ProfileEditor>. This is
// the post-onboarding edit surface the feature-gap audit (Area C) flagged as
// missing — distinct from /account (planner profile) which only edits
// first_name/city/neighborhood on `profiles`.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { ProfileEditor, type ProfileEditorInitial } from './ProfileEditor';

export const dynamic = 'force-dynamic';

export default async function ProfileEditPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account/profile');

  const [{ data: profile }, { data: priv }] = await Promise.all([
    supabase.from('profiles').select('first_name, neighborhood, vibe_tags, clear_photo_url').eq('id', user.id).maybeSingle(),
    supabase.from('profiles_private').select('bio, instagram_handle').eq('user_id', user.id).maybeSingle(),
  ]);

  // The clear photo lives in a private bucket; a short-lived signed URL lets the
  // editor preview it without exposing the object publicly.
  let photoUrl: string | null = null;
  if (profile?.clear_photo_url) {
    const { data: signed } = await supabase.storage
      .from('profile-photos')
      .createSignedUrl(`${user.id}/clear.jpg`, 60 * 10);
    photoUrl = signed?.signedUrl ?? null;
  }

  const initial: ProfileEditorInitial = {
    first_name: profile?.first_name ?? '',
    neighborhood: profile?.neighborhood ?? '',
    bio: priv?.bio ?? '',
    instagram_handle: priv?.instagram_handle ?? '',
    vibe_tags: (profile?.vibe_tags as string[] | null) ?? [],
    photo_url: photoUrl,
  };

  return (
    <main className="min-h-screen bg-shell-base">
      <div className="mx-auto w-full max-w-[420px] px-5 pb-20 pt-8">
        <Link
          href="/account"
          className="inline-flex items-center gap-1.5 font-body text-[13px] lowercase text-shell-ink/60 transition hover:text-shell-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          back
        </Link>

        <header className="mt-5">
          <h1 className="font-heading text-3xl lowercase text-shell-ink">your profile</h1>
          <p className="mt-2 font-body text-[15px] leading-relaxed text-shell-ink/70">
            tweak it whenever. this is what people see when you come up.
          </p>
        </header>

        <div className="mt-7">
          <ProfileEditor userId={user.id} initial={initial} />
        </div>
      </div>
    </main>
  );
}
