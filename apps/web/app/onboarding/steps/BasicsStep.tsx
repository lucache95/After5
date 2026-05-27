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

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-text">The basics</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-secondary">Add your first name, a short bio, and a few tags.</p>

      <div className="mt-7 space-y-5">
        <div>
          <label htmlFor="first_name" className="mb-1.5 block text-sm font-medium text-text">First name</label>
          <input
            id="first_name" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={40}
            className="block w-full rounded-card border border-border bg-white px-4 py-3 text-[15px] outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15"
          />
        </div>
        <div>
          <label htmlFor="bio" className="mb-1.5 block text-sm font-medium text-text">Short bio</label>
          <textarea
            id="bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} rows={4}
            placeholder="Grew up on the lake, still finding new trails. Pitch me a patio at sunset and I'm in."
            className="block w-full rounded-card border border-border bg-white px-4 py-3 text-[15px] outline-none placeholder:text-muted focus:border-accent focus:ring-[3px] focus:ring-accent/15"
          />
        </div>
        <div>
          <label htmlFor="vibe_tags" className="mb-1.5 block text-sm font-medium text-text">Vibe tags <span className="text-muted">(comma-separated)</span></label>
          <input
            id="vibe_tags" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="trails, live music, third-wave coffee"
            className="block w-full rounded-card border border-border bg-white px-4 py-3 text-[15px] outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15"
          />
        </div>
      </div>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{errorMsg}</div>
      )}

      <button
        type="button" onClick={handleContinue} disabled={!canContinue}
        className={cn('mt-7 inline-flex items-center justify-center rounded-pill px-7 py-3 text-[15px] font-medium transition-all',
          !canContinue ? 'cursor-not-allowed bg-border text-muted' : 'bg-text text-background hover:-translate-y-0.5')}
      >
        {phase === 'saving' ? 'Saving…' : phase === 'error' ? 'Try again' : 'Continue'}
      </button>
    </div>
  );
}
