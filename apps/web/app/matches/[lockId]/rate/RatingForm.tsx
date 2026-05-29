'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { submitRating, MatchError, messageForCode } from '@/lib/after5/match';

type Tri = boolean | null;

const QUESTIONS: { key: 'showed_up' | 'on_time' | 'cancelled_with_notice' | 'unsafe_or_disrespectful'; label: string }[] = [
  { key: 'showed_up', label: 'did they show up?' },
  { key: 'on_time', label: 'were they on time?' },
  { key: 'cancelled_with_notice', label: 'if they cancelled, did they give notice?' },
  { key: 'unsafe_or_disrespectful', label: 'did they make you feel unsafe or disrespected?' },
];

export function RatingForm({ lockId, rateeId }: { lockId: string; rateeId: string }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, Tri>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function set(key: string, value: boolean) {
    setAnswers((a) => ({ ...a, [key]: a[key] === value ? null : value }));
  }

  async function onSubmit() {
    setBusy(true);
    try {
      const result = await submitRating({
        lockId, rateeId,
        showed_up: answers.showed_up ?? null,
        on_time: answers.on_time ?? null,
        cancelled_with_notice: answers.cancelled_with_notice ?? null,
        unsafe_or_disrespectful: answers.unsafe_or_disrespectful ?? null,
      });
      if (result === 'already_rated') { setDone(true); return; }
      toast('thanks. that helps keep things safe.');
      router.push(`/matches/${lockId}`);
    } catch (e) {
      toast.error(messageForCode(e instanceof MatchError ? e.code : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-[420px] py-16 text-center">
        <h1 className="font-heading text-3xl lowercase text-shell-ink">you already rated this date</h1>
        <p className="mt-3 font-body text-shell-ink/70">thanks for the feedback.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[420px] px-4 py-6">
      <h1 className="font-heading text-3xl lowercase text-shell-ink">how&apos;d it go?</h1>
      <p className="mt-2 font-body text-shell-ink/70">honest answers keep everyone safe. skip anything you&apos;d rather not say.</p>
      <div className="mt-6 space-y-5">
        {QUESTIONS.map((q) => (
          <fieldset key={q.key} aria-label={q.label}>
            <legend className="font-body font-semibold lowercase text-shell-ink">{q.label}</legend>
            <div className="mt-2 flex gap-2">
              {[true, false].map((val) => {
                const selected = answers[q.key] === val;
                return (
                  <button
                    key={String(val)}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => set(q.key, val)}
                    className={cn(
                      'min-h-[44px] flex-1 rounded-full border-2 font-body font-semibold lowercase transition',
                      'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                      selected ? 'border-shell-accent bg-shell-pink text-shell-ink' : 'border-shell-ink/15 bg-white text-shell-ink/70',
                    )}
                  >
                    {val ? 'yes' : 'no'}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onSubmit}
        className="mt-7 min-h-[48px] w-full rounded-full bg-shell-accent font-body font-semibold lowercase text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
      >
        submit
      </button>
    </div>
  );
}
