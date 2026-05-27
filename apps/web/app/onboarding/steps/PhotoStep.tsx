'use client';
// Step 3 (photos): upload a clear photo to profile-photos/<uid>/clear.jpg, then
// invoke generate-blur (server produces <uid>/blurred.jpg + profiles.blurred_photo_url
// for the blind feed). On success advanceOnboarding('preferences').
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { browserAfter5Client, advanceOnboarding } from '@/lib/after5/client';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

export function PhotoStep({ userId }: { userId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f) {
      const name = f.name.toLowerCase();
      const looksHeic = /image\/hei[cf]/.test(f.type) || name.endsWith('.heic') || name.endsWith('.heif');
      // Allow JPEG/PNG; allow empty MIME (some browsers omit it) unless the name is HEIC.
      const ok = !looksHeic && (ACCEPTED_TYPES.includes(f.type) || f.type === '');
      if (!ok) {
        setFile(null);
        setErrorMsg('That photo format is not supported. Please choose a JPEG or PNG.');
        setPhase('error');
        e.target.value = '';
        return;
      }
    }
    setFile(f);
    setPhase('idle');
    setErrorMsg('');
  }

  async function handleUpload() {
    if (!file) return;
    setPhase('uploading');
    setErrorMsg('');
    try {
      const client = browserAfter5Client();
      const { error: upErr } = await client.storage
        .from('profile-photos')
        .upload(`${userId}/clear.jpg`, file, { upsert: true, contentType: file.type || 'image/jpeg' });
      if (upErr) throw new Error(upErr.message);
      const { error: blurErr } = await client.functions.invoke('generate-blur', { body: {} });
      if (blurErr) throw new Error(blurErr.message ?? 'blur_failed');
      await advanceOnboarding(client, 'preferences');
      router.push('/onboarding/preferences');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "We couldn't process that photo.");
      setPhase('error');
    }
  }

  return (
    <div>
      <h1 className="font-heading text-3xl lowercase text-shell-ink">drop a photo</h1>
      <p className="mt-3 font-body text-[15px] leading-relaxed text-shell-ink/70">
        it&apos;s blurred in the feed. your clear photo only shows up once you&apos;ve both matched on a night out.
      </p>

      <label
        htmlFor="photo"
        className={cn(
          'mt-7 flex min-h-[44px] cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed px-6 py-10 text-center font-body text-sm transition',
          'focus-within:ring-2 focus-within:ring-shell-accent/40 motion-reduce:transition-none',
          file ? 'border-shell-accent/50 bg-shell-pink/40 text-shell-ink' : 'border-shell-ink/20 bg-white/60 text-shell-ink/60 hover:border-shell-accent/60',
        )}
      >
        <ImageUp className="h-6 w-6 text-shell-accent" aria-hidden />
        <span>{file ? file.name : 'pick a photo'}</span>
        <input id="photo" type="file" accept="image/jpeg,image/png" onChange={onPick} className="sr-only" aria-label="pick a photo" />
      </label>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-2xl border border-shell-accent/30 bg-white/70 px-4 py-3 font-body text-[13px] text-shell-ink">{errorMsg}</div>
      )}

      <button
        type="button" onClick={handleUpload} disabled={!file || phase === 'uploading'} aria-busy={phase === 'uploading'}
        className={cn(
          'mt-7 flex min-h-[48px] items-center justify-center rounded-full px-8 font-body text-[16px] font-semibold lowercase transition',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
          !file || phase === 'uploading' ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35' : 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95')}
      >
        {phase === 'uploading' ? 'uploading…' : phase === 'error' ? 'try again' : 'next'}
      </button>
    </div>
  );
}
