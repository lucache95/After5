// Dating-profile editor route (Barbiecore Tier-1 shell). Hydrates the signed-in
// user's current dating fields and renders the client <ProfileEditor>. This is
// the post-onboarding edit surface the feature-gap audit (Area C) flagged as
// missing — distinct from /account (planner profile) which only edits
// first_name/city/neighborhood on `profiles`.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { listMyPhotos, signClearUrls } from '@/lib/after5/photos';
import type { DynamicPromptAnswer, ExpandedProfile } from '@after5/validators';
import { ProfileEditor, type ProfileEditorInitial } from './ProfileEditor';
import type { ManagedPhoto } from './sections/PhotoManager';

export const dynamic = 'force-dynamic';

export default async function ProfileEditPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account/profile');

  const [{ data: profile }, { data: priv }, { data: promptDefs }] = await Promise.all([
    supabase
      .from('profiles')
      .select('first_name, neighborhood, vibe_tags, clear_photo_url, prompt_answers, pronouns, height_cm, occupation, socials')
      .eq('id', user.id)
      .maybeSingle(),
    supabase.from('profiles_private').select('bio, instagram_handle').eq('user_id', user.id).maybeSingle(),
    supabase.from('profile_prompts').select('id, label, placeholder').eq('is_active', true).order('sort_order', { ascending: true }),
  ]);

  // M6 gallery: rows + fresh signed clear URLs (owner read passes the RLS policy).
  let photos: ManagedPhoto[] = [];
  try {
    const rows = await listMyPhotos(supabase, user.id);
    const urls = await signClearUrls(supabase, rows.map((r) => r.clear_path));
    photos = rows.map((r, i) => ({
      id: r.id, clear_path: r.clear_path, url: urls[i] ?? null,
      is_primary: r.is_primary, sort_order: r.sort_order,
    }));
  } catch {
    photos = [];
  }

  // Legacy single-photo preview (pre-M6 grace, only used when no gallery rows).
  let photoUrl: string | null = null;
  if (photos.length === 0 && profile?.clear_photo_url) {
    const { data: signed } = await supabase.storage
      .from('profile-photos')
      .createSignedUrl(profile.clear_photo_url as string, 60 * 10);
    photoUrl = signed?.signedUrl ?? null;
  }

  const initial: ProfileEditorInitial = {
    first_name: profile?.first_name ?? '',
    neighborhood: profile?.neighborhood ?? '',
    bio: priv?.bio ?? '',
    instagram_handle: priv?.instagram_handle ?? '',
    vibe_tags: (profile?.vibe_tags as string[] | null) ?? [],
    photo_url: photoUrl,
    photos,
    prompt_answers: ((profile?.prompt_answers as DynamicPromptAnswer[] | null) ?? []),
    expanded: {
      pronouns: (profile?.pronouns as ExpandedProfile['pronouns']) ?? undefined,
      height_cm: (profile?.height_cm as number | null) ?? undefined,
      occupation: (profile?.occupation as string | null) ?? undefined,
      socials: (profile?.socials as ExpandedProfile['socials']) ?? undefined,
    },
    available_prompts: (promptDefs ?? []) as { id: string; label: string; placeholder?: string | null }[],
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
