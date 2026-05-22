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
            ? 'Looks like you already applied. We\'ll be in touch!'
            : data.error === 'rate_limited'
              ? 'Too many submissions. Try again tomorrow.'
              : data.issues
                ? data.issues.map((i: { message: string }) => i.message).join('. ')
                : 'Something went wrong. Please try again.';
        setError(msg);
        return;
      }

      setSubmitted(true);
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-card border border-border bg-surface p-10 text-center">
        <CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-emerald-600" />
        <h3 className="font-display text-xl font-semibold text-text">
          Application received!
        </h3>
        <p className="mt-2 text-sm text-secondary">
          We review every application by hand. Expect to hear back within 48 hours.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* First name */}
      <div>
        <label
          htmlFor="first_name"
          className="mb-1.5 block text-sm font-medium text-text"
        >
          First name <span className="text-accent">*</span>
        </label>
        <input
          id="first_name"
          type="text"
          required
          value={form.first_name}
          onChange={(e) => set('first_name', e.target.value)}
          className="w-full rounded-card border border-border bg-background px-4 py-2.5 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Your first name"
        />
      </div>

      {/* Email */}
      <div>
        <label
          htmlFor="email"
          className="mb-1.5 block text-sm font-medium text-text"
        >
          Email <span className="text-accent">*</span>
        </label>
        <input
          id="email"
          type="email"
          required
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          className="w-full rounded-card border border-border bg-background px-4 py-2.5 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="you@example.com"
        />
      </div>

      {/* Instagram */}
      <div>
        <label
          htmlFor="instagram"
          className="mb-1.5 block text-sm font-medium text-text"
        >
          Instagram handle{' '}
          <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="instagram"
          type="text"
          value={form.instagram}
          onChange={(e) => set('instagram', e.target.value)}
          className="w-full rounded-card border border-border bg-background px-4 py-2.5 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="@yourhandle"
        />
      </div>

      {/* Motivation */}
      <div>
        <label
          htmlFor="motivation"
          className="mb-1.5 block text-sm font-medium text-text"
        >
          Why do you want to help? <span className="text-accent">*</span>
        </label>
        <textarea
          id="motivation"
          required
          minLength={50}
          maxLength={500}
          rows={3}
          value={form.motivation}
          onChange={(e) => set('motivation', e.target.value)}
          className="w-full rounded-card border border-border bg-background px-4 py-2.5 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Tell us what excites you about helping shape Kelowna's date scene..."
        />
        <p className="mt-1 text-xs text-muted">
          {form.motivation.length}/500 characters (min 50)
        </p>
      </div>

      {/* Best date spot */}
      <div>
        <label
          htmlFor="best_date_spot"
          className="mb-1.5 block text-sm font-medium text-text"
        >
          What's the best date spot in Kelowna most people don't know about?{' '}
          <span className="text-accent">*</span>
        </label>
        <textarea
          id="best_date_spot"
          required
          minLength={20}
          maxLength={300}
          rows={2}
          value={form.best_date_spot}
          onChange={(e) => set('best_date_spot', e.target.value)}
          className="w-full rounded-card border border-border bg-background px-4 py-2.5 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Name the spot and tell us why it's special..."
        />
        <p className="mt-1 text-xs text-muted">
          {form.best_date_spot.length}/300 characters (min 20)
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-card border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center gap-2 rounded-pill bg-text px-8 py-3 font-display text-sm font-semibold tracking-wide text-background transition-colors hover:bg-text/90 disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting...
          </>
        ) : (
          'Submit application'
        )}
      </button>
    </form>
  );
}
