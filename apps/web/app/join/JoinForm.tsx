'use client';

import { useState, type FormEvent } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';

interface FormState {
  first_name: string;
  email: string;
  instagram: string;
  motivation: string;
  best_date_spot: string;
}

const INITIAL: FormState = {
  first_name: '',
  email: '',
  instagram: '',
  motivation: '',
  best_date_spot: '',
};

const fieldClass =
  'w-full rounded-2xl border-2 border-shell-ink/15 bg-white px-4 py-2.5 font-body text-sm text-shell-ink placeholder:text-shell-ink/40 focus:border-shell-accent focus:outline-none focus:ring-4 focus:ring-shell-accent/20';

export function JoinForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/insiders/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          data.error === 'duplicate'
            ? 'looks like you already applied. we\'ll be in touch.'
            : data.error === 'rate_limited'
              ? 'too many tries. come back tomorrow.'
              : data.issues
                ? data.issues.map((i: { message: string }) => i.message).join('. ')
                : 'something broke. try again.';
        setError(msg);
        return;
      }

      setSubmitted(true);
    } catch {
      setError('network error. check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-3xl bg-shell-pink/60 p-10 text-center ring-1 ring-shell-accent/10">
        <CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-shell-accent" />
        <h3 className="font-heading text-xl lowercase text-shell-ink">
          you&apos;re in the pile
        </h3>
        <p className="mt-2 font-body text-sm text-shell-ink/65">
          we read every one by hand. expect to hear back within 48 hours.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* first name */}
      <div>
        <label htmlFor="first_name" className="mb-1.5 block font-body text-sm font-medium lowercase text-shell-ink">
          first name <span className="text-shell-accent">*</span>
        </label>
        <input
          id="first_name"
          type="text"
          required
          value={form.first_name}
          onChange={(e) => set('first_name', e.target.value)}
          className={fieldClass}
          placeholder="your first name"
        />
      </div>

      {/* email */}
      <div>
        <label htmlFor="email" className="mb-1.5 block font-body text-sm font-medium lowercase text-shell-ink">
          email <span className="text-shell-accent">*</span>
        </label>
        <input
          id="email"
          type="email"
          required
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          className={fieldClass}
          placeholder="you@example.com"
        />
      </div>

      {/* instagram */}
      <div>
        <label htmlFor="instagram" className="mb-1.5 block font-body text-sm font-medium lowercase text-shell-ink">
          instagram <span className="font-normal text-shell-ink/45">(optional)</span>
        </label>
        <input
          id="instagram"
          type="text"
          value={form.instagram}
          onChange={(e) => set('instagram', e.target.value)}
          className={fieldClass}
          placeholder="@yourhandle"
        />
      </div>

      {/* motivation */}
      <div>
        <label htmlFor="motivation" className="mb-1.5 block font-body text-sm font-medium lowercase text-shell-ink">
          why do you want to help? <span className="text-shell-accent">*</span>
        </label>
        <textarea
          id="motivation"
          required
          minLength={50}
          maxLength={500}
          rows={3}
          value={form.motivation}
          onChange={(e) => set('motivation', e.target.value)}
          className={fieldClass}
          placeholder="tell us what gets you about building the local date scene..."
        />
        <p className="mt-1 font-body text-xs text-shell-ink/45">
          {form.motivation.length}/500 (min 50)
        </p>
      </div>

      {/* best date spot */}
      <div>
        <label htmlFor="best_date_spot" className="mb-1.5 block font-body text-sm font-medium lowercase text-shell-ink">
          best date spot near you most people don&apos;t know about?{' '}
          <span className="text-shell-accent">*</span>
        </label>
        <textarea
          id="best_date_spot"
          required
          minLength={20}
          maxLength={300}
          rows={2}
          value={form.best_date_spot}
          onChange={(e) => set('best_date_spot', e.target.value)}
          className={fieldClass}
          placeholder="name the spot and why it slaps..."
        />
        <p className="mt-1 font-body text-xs text-shell-ink/45">
          {form.best_date_spot.length}/300 (min 20)
        </p>
      </div>

      {/* error */}
      {error && (
        <div className="rounded-2xl border-2 border-shell-accent/30 bg-shell-pink/50 px-4 py-3 font-body text-sm lowercase text-shell-ink">
          {error}
        </div>
      )}

      {/* submit */}
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center gap-2 rounded-full bg-shell-accent px-8 py-3 font-body text-sm font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            sending...
          </>
        ) : (
          'send it'
        )}
      </button>
    </form>
  );
}
