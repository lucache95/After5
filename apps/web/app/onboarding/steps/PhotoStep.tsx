'use client';
// Step 3 (photos): upload a clear photo to profile-photos/<uid>/clear.jpg, then
// invoke generate-blur (server produces <uid>/blurred.jpg + profiles.blurred_photo_url
// for the blind feed). On success advanceOnboarding('preferences').
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { browserAfter5Client, advanceOnboarding } from '@/lib/after5/client';

export function PhotoStep({ userId }: { userId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
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
      <h1 className="font-display text-2xl font-bold text-text">Add a photo</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-secondary">
        We blur it for the blind feed. We reveal your clear photo only after you both match on a night out.
      </p>

      <label htmlFor="photo" className="mt-7 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-border bg-white/60 px-6 py-10 text-center text-sm text-secondary hover:border-accent">
        <ImageUp className="h-6 w-6 text-muted" />
        <span>{file ? file.name : 'Choose a photo'}</span>
        <input id="photo" type="file" accept="image/*" onChange={onPick} className="sr-only" aria-label="Choose a photo" />
      </label>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{errorMsg}</div>
      )}

      <button
        type="button" onClick={handleUpload} disabled={!file || phase === 'uploading'}
        className={cn('mt-7 inline-flex items-center justify-center rounded-pill px-7 py-3 text-[15px] font-medium transition-all',
          !file || phase === 'uploading' ? 'cursor-not-allowed bg-border text-muted' : 'bg-text text-background hover:-translate-y-0.5')}
      >
        {phase === 'uploading' ? 'Uploading…' : phase === 'error' ? 'Try again' : 'Upload & continue'}
      </button>
    </div>
  );
}
