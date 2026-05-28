'use client';
// Step 2 (basics): first name, bio, vibe tags. Validates with ProfileInputSchema,
// persists via upsertProfile (profiles columns) plus a write of bio to
// profiles_private (insert the row, or update it if it already exists), then
// advanceOnboarding('photos'). Idempotent: the server page hydrates `initial`.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProfileInputSchema } from '@after5/validators';
import { cn } from '@/lib/cn';
import { browserAfter5Client, upsertProfile, advanceOnboarding } from '@/lib/after5/client';

export interface BasicsInitial {
  first_name: string;
  bio: string;
  vibe_tags: string[];
  prompts: { prompt_id: string; answer: string }[];
}

export function BasicsStep({ userId, initial }: { userId: string; initial: BasicsInitial }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initial.first_name);
  const [bio, setBio] = useState(initial.bio);
  const [tagsRaw, setTagsRaw] = useState(initial.vibe_tags.join(', '));
  const [phase, setPhase] = useState<'idle' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const canContinue = firstName.length > 0 && phase !== 'saving';

  async function handleContinue() {
    const vibe_tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8);
    const parsed = ProfileInputSchema.safeParse({ first_name: firstName.trim(), bio, vibe_tags, prompts: [] });
    if (!parsed.success) {
      setErrorMsg(parsed.error.issues[0]?.message ?? 'Please check your entries.');
      setPhase('error');
      return;
    }
    setPhase('saving');
    setErrorMsg('');
    try {
      const client = browserAfter5Client();
      await upsertProfile(client, userId, {
        first_name: parsed.data.first_name,
        vibe_tags: parsed.data.vibe_tags,
        prompt_answers: parsed.data.prompts,
      });
      // profiles_private holds the bio. Its write grants are column-level so
      // birthdate stays non-self-settable (the age-gate integrity rule), and
      // PostgREST's upsert needs table-level INSERT+UPDATE — so an upsert 403s
      // here. Insert the row; if it already exists (revisiting the step), update.
      const { error: insertError } = await client
        .from('profiles_private')
        .insert({ user_id: userId, bio: parsed.data.bio });
      if (insertError && insertError.code === '23505') {
        const { error: updateError } = await client
          .from('profiles_private')
          .update({ bio: parsed.data.bio })
          .eq('user_id', userId);
        if (updateError) throw updateError;
      } else if (insertError) {
        throw insertError;
      }
      await advanceOnboarding(client, 'photos');
      router.push('/onboarding/photo');
    } catch (e) {
      // Log the real error (Supabase PostgrestError isn't an Error instance, so
      // its detail is lost if we only read .message) and show a friendly note.
      console.error('[BasicsStep] save failed', e);
      setErrorMsg(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setPhase('error');
    }
  }

  const inputClass = cn(
    'block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-4 py-3 font-body text-[15px] text-shell-ink',
    'placeholder:text-shell-ink/35 focus:outline-none focus:ring-2 focus:ring-shell-accent/60',
  );

  return (
    <div>
      <h1 className="font-heading text-3xl lowercase text-shell-ink">the basics</h1>
      <p className="mt-3 font-body text-[15px] leading-relaxed text-shell-ink/70">name, a line about you, a few tags. that&apos;s it for now.</p>

      <div className="mt-7 space-y-5">
        <div>
          <label htmlFor="first_name" className="mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink">first name</label>
          <input
            id="first_name" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={40}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="bio" className="mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink">short bio</label>
          <textarea
            id="bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} rows={4}
            placeholder="grew up on the lake, still finding new trails. pitch me a patio at sunset and i'm in."
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="vibe_tags" className="mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink">vibe tags <span className="font-normal text-shell-ink/45">(comma-separated)</span></label>
          <input
            id="vibe_tags" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="trails, live music, third-wave coffee"
            className={inputClass}
          />
        </div>
      </div>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-2xl border border-shell-accent/30 bg-white/70 px-4 py-3 font-body text-[13px] text-shell-ink">{errorMsg}</div>
      )}

      <button
        type="button" onClick={handleContinue} disabled={!canContinue} aria-busy={phase === 'saving'}
        className={cn(
          'mt-7 flex min-h-[48px] items-center justify-center rounded-full px-8 font-body text-[16px] font-semibold lowercase transition',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
          !canContinue ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35' : 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95')}
      >
        {phase === 'saving' ? 'saving…' : phase === 'error' ? 'try again' : 'next'}
      </button>
    </div>
  );
}
