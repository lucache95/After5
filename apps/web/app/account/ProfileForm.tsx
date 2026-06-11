'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/cn';
import { PendingButtonContent } from '@/components/PendingButtonContent';

export function ProfileForm({
  initial,
}: {
  initial: { first_name: string; city: string; neighborhood: string };
}) {
  const [firstName, setFirstName] = useState(initial.first_name);
  const [city, setCity] = useState(initial.city);
  const [neighborhood, setNeighborhood] = useState(initial.neighborhood);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setPhase('saving');
    setErrorMsg('');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setErrorMsg('Session expired. Reload the page.');
      setPhase('error');
      return;
    }
    const { error } = await supabase
      .from('profiles')
      .update({
        first_name: firstName || null,
        city: city || null,
        neighborhood: neighborhood || null,
      })
      .eq('id', user.id);
    if (error) {
      setErrorMsg(error.message);
      setPhase('error');
    } else {
      setPhase('saved');
      // Mirror to localStorage so the plan flow gate sees them too.
      if (typeof window !== 'undefined') {
        if (firstName) localStorage.setItem('after5_first_name', firstName);
        if (city) localStorage.setItem('after5_city', city);
      }
      setTimeout(() => setPhase('idle'), 2000);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 rounded-card border border-border bg-surface p-7 md:p-9">
      <Field label="First name">
        <input
          type="text"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="Sarah"
          className="block w-full rounded-card border border-border bg-background px-5 py-3 text-base text-text outline-none transition-colors focus:border-accent"
        />
      </Field>

      <Field label="City">
        <input
          type="text"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Kelowna"
          className="block w-full rounded-card border border-border bg-background px-5 py-3 text-base text-text outline-none transition-colors focus:border-accent"
        />
      </Field>

      <Field label="Neighborhood" hint="Helps us tune plans to your side of town.">
        <input
          type="text"
          value={neighborhood}
          onChange={(e) => setNeighborhood(e.target.value)}
          placeholder="Glenmore"
          className="block w-full rounded-card border border-border bg-background px-5 py-3 text-base text-text outline-none transition-colors focus:border-accent"
        />
      </Field>

      <div className="flex items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={phase === 'saving'}
          className={cn(
            'inline-flex items-center justify-center gap-2 rounded-pill px-7 py-3 text-sm font-medium transition-opacity',
            phase === 'saving'
              ? 'bg-border text-muted cursor-not-allowed'
              : 'bg-primary text-background hover:opacity-85',
          )}
        >
          <PendingButtonContent pending={phase === 'saving'} pendingLabel="Saving…" accessibilityLabel="saving profile" size={14}>
            Save
          </PendingButtonContent>
        </button>
        {phase === 'saved' && (
          <span className="text-sm text-emerald-600">Saved.</span>
        )}
        {phase === 'error' && errorMsg && (
          <span className="text-sm text-red-600">{errorMsg}</span>
        )}
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
