'use client';
// Step 2 (basics): first name, bio, vibe tags. Validates with ProfileInputSchema,
// persists via upsertProfile (profiles columns) plus a write of bio to
// profiles_private (insert the row, or update it if it already exists), then
// advanceOnboarding('photos'). Idempotent: the server page hydrates `initial`.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { ProfileInputSchema, MAX_BIO } from '@after5/validators';
import { cn } from '@/lib/cn';
import { PendingButtonContent } from '@/components/PendingButtonContent';
import { browserAfter5Client, upsertProfile, advanceOnboarding } from '@/lib/after5/client';

const MAX_TAGS = 8;

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
  const [tags, setTags] = useState<string[]>(initial.vibe_tags);
  const [tagInput, setTagInput] = useState('');
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const canContinue = firstName.length > 0 && phase !== 'saving';

  // Commit one or more comma-separated values from `raw`. Trims, drops empties,
  // case-insensitive dedupes against existing tags, and caps the total at MAX_TAGS.
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
      // Backspace at an empty input deletes the last chip — YouTube/Twitter pattern.
      e.preventDefault();
      setTags((prev) => prev.slice(0, -1));
    }
  }

  function onTagPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (text.includes(',')) {
      e.preventDefault();
      commitTags(text);
    }
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((x) => x !== tag));
    tagInputRef.current?.focus();
  }

  async function handleContinue() {
    // Commit any in-flight typing first so a user who typed "patio" and hit Next
    // without a comma still gets credit for the tag.
    const pending = tagInput.trim();
    const finalTags = pending && tags.length < MAX_TAGS && !tags.some((x) => x.toLowerCase() === pending.toLowerCase())
      ? [...tags, pending].slice(0, MAX_TAGS)
      : tags.slice(0, MAX_TAGS);

    const parsed = ProfileInputSchema.safeParse({ first_name: firstName.trim(), bio, vibe_tags: finalTags, prompts: [] });
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
            id="bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={MAX_BIO} rows={4}
            placeholder="grew up on the lake, still finding new trails. pitch me a patio at sunset and i'm in."
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="vibe_tags" className="mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink">vibe tags</label>
          {/* Chip-style container. Looks like a single input field; the real <input>
              flows after the chips. Clicking anywhere in the container focuses the input
              so the cursor lands where the user expects. */}
          <div
            role="group"
            aria-labelledby="vibe_tags"
            onClick={() => tagInputRef.current?.focus()}
            className={cn(
              inputClass,
              'flex min-h-[48px] cursor-text flex-wrap items-center gap-1.5 py-2',
              'focus-within:ring-2 focus-within:ring-shell-accent/60',
            )}
          >
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-shell-accent/15 px-2.5 py-1 font-body text-[13px] text-shell-ink"
              >
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
              onPaste={onTagPaste}
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
        type="button" onClick={handleContinue} disabled={!canContinue} aria-busy={phase === 'saving'}
        className={cn(
          'mt-7 flex min-h-[48px] items-center justify-center rounded-full px-8 font-body text-[16px] font-semibold lowercase transition',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
          !canContinue ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35' : 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95')}
      >
        <PendingButtonContent pending={phase === 'saving'} pendingLabel="saving…" accessibilityLabel="saving profile basics">
          {phase === 'error' ? 'try again' : 'next'}
        </PendingButtonContent>
      </button>
    </div>
  );
}
