'use client';
// Post-onboarding dating-profile editor (Barbiecore, Tier-1 shell tokens).
// Hydrates current values from the server page and lets a signed-in user update
// their dating profile after onboarding:
//   - bio + instagram_handle → profiles_private (insert-first, update-on-23505,
//     mirroring BasicsStep — column-level grants block a PostgREST upsert).
//   - first_name, neighborhood, vibe_tags → profiles (RLS: own row only).
//   - photo replace → re-upload profile-photos/<uid>/clear.jpg + generate-blur.
// All writes go through the user's RLS'd browser client; a user can only ever
// touch their own row (.eq('id'/'user_id', userId)). sonner toast on save.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ImageUp, X } from 'lucide-react';
import Image from 'next/image';
import { ProfileInputSchema } from '@after5/validators';
import { cn } from '@/lib/cn';
import { browserAfter5Client, upsertProfile } from '@/lib/after5/client';
import { PhotoCropper } from '@/app/onboarding/steps/PhotoCropper';

const MAX_TAGS = 8;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

export interface ProfileEditorInitial {
  first_name: string;
  neighborhood: string;
  bio: string;
  instagram_handle: string;
  vibe_tags: string[];
  photo_url: string | null;
}

type Phase = 'idle' | 'saving' | 'error';

// Strip a leading @ and any instagram url chrome so we store a bare handle.
function normalizeHandle(raw: string): string {
  let h = raw.trim();
  h = h.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
  h = h.replace(/[/?#].*$/, '');
  h = h.replace(/^@+/, '');
  return h;
}

export function ProfileEditor({ userId, initial }: { userId: string; initial: ProfileEditorInitial }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initial.first_name);
  const [neighborhood, setNeighborhood] = useState(initial.neighborhood);
  const [bio, setBio] = useState(initial.bio);
  const [instagram, setInstagram] = useState(initial.instagram_handle);
  const [tags, setTags] = useState<string[]>(initial.vibe_tags);
  const [tagInput, setTagInput] = useState('');
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Photo replace state. `pickedFile` is the pre-crop source; `croppedBlob` is
  // the square ready to upload; `photoUrl` is the current/last-saved preview.
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null);
  const [cropping, setCropping] = useState(false);
  const [photoUrl] = useState<string | null>(initial.photo_url);

  const canSave = firstName.trim().length > 0 && phase !== 'saving';

  function commitTags(raw: string) {
    const incoming = raw.split(',').map((t) => t.trim()).filter(Boolean);
    if (incoming.length === 0) return;
    setTags((prev) => {
      const merged = [...prev];
      for (const t of incoming) {
        if (merged.length >= MAX_TAGS) break;
        if (!merged.some((x) => x.toLowerCase() === t.toLowerCase())) merged.push(t);
      }
      return merged;
    });
    setTagInput('');
  }

  function onTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitTags(tagInput);
    } else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      e.preventDefault();
      setTags((prev) => prev.slice(0, -1));
    }
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((x) => x !== tag));
    tagInputRef.current?.focus();
  }

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    const name = f.name.toLowerCase();
    const looksHeic = /image\/hei[cf]/.test(f.type) || name.endsWith('.heic') || name.endsWith('.heif');
    const ok = !looksHeic && (ACCEPTED_TYPES.includes(f.type) || f.type === '');
    if (!ok) {
      toast.error('that format is a no. jpeg or png.');
      e.target.value = '';
      return;
    }
    setPickedFile(f);
    setCroppedBlob(null);
    setCropping(true);
  }

  async function handleSave() {
    const pending = tagInput.trim();
    const finalTags = pending && tags.length < MAX_TAGS && !tags.some((x) => x.toLowerCase() === pending.toLowerCase())
      ? [...tags, pending].slice(0, MAX_TAGS)
      : tags.slice(0, MAX_TAGS);

    const parsed = ProfileInputSchema.safeParse({ first_name: firstName.trim(), bio, vibe_tags: finalTags, prompts: [] });
    if (!parsed.success) {
      setErrorMsg(parsed.error.issues[0]?.message ?? 'something is off up there.');
      setPhase('error');
      return;
    }
    setPhase('saving');
    setErrorMsg('');
    try {
      const client = browserAfter5Client();
      const handle = normalizeHandle(instagram);

      // profiles columns (own row only via RLS).
      await upsertProfile(client, userId, {
        first_name: parsed.data.first_name,
        neighborhood: neighborhood.trim() || null,
        vibe_tags: parsed.data.vibe_tags,
      });

      // profiles_private (bio + instagram_handle). Column-level grants block a
      // PostgREST upsert, so insert-first then update-on-conflict, same as
      // onboarding BasicsStep. The row almost always exists by edit time.
      const privatePatch = { bio: parsed.data.bio, instagram_handle: handle || null };
      const { error: insertError } = await client
        .from('profiles_private')
        .insert({ user_id: userId, ...privatePatch });
      if (insertError && insertError.code === '23505') {
        const { error: updateError } = await client
          .from('profiles_private')
          .update(privatePatch)
          .eq('user_id', userId);
        if (updateError) throw updateError;
      } else if (insertError) {
        throw insertError;
      }

      // Photo replace (optional): upload the new square, regenerate the blur.
      if (croppedBlob) {
        const { error: upErr } = await client.storage
          .from('profile-photos')
          .upload(`${userId}/clear.jpg`, croppedBlob, { upsert: true, contentType: 'image/jpeg' });
        if (upErr) throw new Error(upErr.message);
        const { error: blurErr } = await client.functions.invoke('generate-blur', { body: {} });
        if (blurErr) throw new Error(blurErr.message ?? 'blur_failed');
      }

      setPhase('idle');
      toast.success('saved. looking good.');
      router.refresh();
    } catch (e) {
      console.error('[ProfileEditor] save failed', e);
      const msg = e instanceof Error ? e.message : 'something broke. try again.';
      setErrorMsg(msg);
      setPhase('error');
      toast.error('couldn’t save that.');
    }
  }

  const inputClass = cn(
    'block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-4 py-3 font-body text-[15px] text-shell-ink',
    'placeholder:text-shell-ink/35 focus:outline-none focus:ring-2 focus:ring-shell-accent/60',
  );
  const labelClass = 'mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink';

  return (
    <div>
      {/* PHOTO */}
      <div>
        <p className={labelClass}>your photo</p>
        <p className="mb-3 font-body text-[13px] leading-relaxed text-shell-ink/60">
          blurred in the feed. the clear one shows once you both lock in a night.
        </p>
        {cropping && pickedFile ? (
          <PhotoCropper
            file={pickedFile}
            onConfirm={(blob) => { setCroppedBlob(blob); setCropping(false); }}
            onCancel={() => { setPickedFile(null); setCroppedBlob(null); setCropping(false); }}
          />
        ) : (
          <div className="flex items-center gap-4">
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-shell-accent/20 bg-shell-pink/40">
              {croppedBlob ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={URL.createObjectURL(croppedBlob)} alt="new photo preview" className="h-full w-full object-cover" />
              ) : photoUrl ? (
                <Image src={photoUrl} alt="your current photo" fill sizes="96px" className="object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-shell-ink/30">
                  <ImageUp className="h-6 w-6" aria-hidden />
                </div>
              )}
            </div>
            <label
              htmlFor="photo"
              className={cn(
                'flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-full px-5 font-body text-sm lowercase transition',
                'border border-shell-ink/15 bg-white/70 text-shell-ink hover:border-shell-accent/50',
                'focus-within:ring-2 focus-within:ring-shell-accent/40',
              )}
            >
              <ImageUp className="h-4 w-4 text-shell-accent" aria-hidden />
              <span>{croppedBlob ? 'new photo ready' : photoUrl ? 'swap photo' : 'add a photo'}</span>
              <input id="photo" type="file" accept="image/jpeg,image/png" onChange={onPickPhoto} className="sr-only" aria-label="swap photo" />
            </label>
          </div>
        )}
      </div>

      <div className="mt-7 space-y-5">
        {/* FIRST NAME */}
        <div>
          <label htmlFor="first_name" className={labelClass}>first name</label>
          <input id="first_name" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={40} className={inputClass} />
        </div>

        {/* BIO */}
        <div>
          <label htmlFor="bio" className={labelClass}>short bio</label>
          <textarea
            id="bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} rows={4}
            placeholder="grew up on the lake, still finding new trails. pitch me a patio at sunset and i'm in."
            className={inputClass}
          />
        </div>

        {/* NEIGHBORHOOD */}
        <div>
          <label htmlFor="neighborhood" className={labelClass}>neighborhood</label>
          <input
            id="neighborhood" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} maxLength={80}
            placeholder="your side of town" className={inputClass}
          />
        </div>

        {/* INSTAGRAM */}
        <div>
          <label htmlFor="instagram" className={labelClass}>instagram</label>
          <div className="flex items-center rounded-2xl border border-shell-ink/15 bg-white/80 px-4 focus-within:ring-2 focus-within:ring-shell-accent/60">
            <span aria-hidden className="font-body text-[15px] text-shell-ink/40">@</span>
            <input
              id="instagram" value={instagram} onChange={(e) => setInstagram(e.target.value)} maxLength={60}
              placeholder="yourhandle" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              className="block w-full bg-transparent py-3 pl-1 font-body text-[15px] text-shell-ink placeholder:text-shell-ink/35 focus:outline-none"
            />
          </div>
          <p className="mt-1 font-body text-[12px] text-shell-ink/45">only shared after you both lock in. optional.</p>
        </div>

        {/* VIBE TAGS */}
        <div>
          <label htmlFor="vibe_tags" className={labelClass}>vibe tags</label>
          <div
            role="group"
            aria-labelledby="vibe_tags"
            onClick={() => tagInputRef.current?.focus()}
            className={cn(inputClass, 'flex min-h-[48px] cursor-text flex-wrap items-center gap-1.5 py-2', 'focus-within:ring-2 focus-within:ring-shell-accent/60')}
          >
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-shell-accent/15 px-2.5 py-1 font-body text-[13px] text-shell-ink">
                <span>{tag.toLowerCase()}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                  aria-label={`remove ${tag}`}
                  className="-mr-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-shell-ink/60 transition hover:bg-shell-ink/10 hover:text-shell-ink"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ))}
            <input
              ref={tagInputRef}
              id="vibe_tags"
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={onTagKeyDown}
              onBlur={() => commitTags(tagInput)}
              maxLength={40}
              disabled={tags.length >= MAX_TAGS}
              placeholder={tags.length === 0 ? 'trails, live music, third-wave coffee' : tags.length >= MAX_TAGS ? '' : 'add another…'}
              className="min-w-[120px] flex-1 border-0 bg-transparent p-0 font-body text-[15px] text-shell-ink placeholder:text-shell-ink/35 focus:outline-none focus:ring-0"
            />
          </div>
          <p className="mt-1 flex items-center justify-between font-body text-[12px] text-shell-ink/45">
            <span>comma or enter to add</span>
            <span>{tags.length}/{MAX_TAGS}</span>
          </p>
        </div>
      </div>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-2xl border border-shell-accent/30 bg-white/70 px-4 py-3 font-body text-[13px] text-shell-ink">{errorMsg}</div>
      )}

      <button
        type="button" onClick={handleSave} disabled={!canSave} aria-busy={phase === 'saving'}
        className={cn(
          'mt-7 flex min-h-[48px] items-center justify-center rounded-full px-8 font-body text-[16px] font-semibold lowercase transition',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
          !canSave ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35' : 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95',
        )}
      >
        {phase === 'saving' ? 'saving…' : 'save'}
      </button>
    </div>
  );
}
