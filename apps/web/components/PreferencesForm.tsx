'use client';
// Mode-aware dating preferences form (E4 / D-09). Extracted from PreferencesStep
// so ONE validated form drives both flows:
//   - mode='onboarding' → save, then advanceOnboarding + push('/onboarding/phone')
//     (behavior-preserving for the onboarding step machine).
//   - mode='account'    → save, then sonner toast + router.refresh() — NEVER
//     advances onboarding, never pushes /onboarding/* (Pitfall 2).
// Field UI + validation (PreferencesInputSchema, V5) is identical in both modes;
// only the post-save tail forks. The account context also relocates the dating
// on/off toggle here from EnableDatingButton (A3), gaining the new ON→OFF path.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PreferencesInputSchema, GenderSchema, DealbreakerSchema } from '@after5/validators';
import { cn } from '@/lib/cn';
import { browserAfter5Client, savePreferences, advanceOnboarding } from '@/lib/after5/client';
import { StickerChip } from '@/components/StickerChip';

export interface PreferencesInitial {
  gender: string;
  gender_preferences: string[];
  age_min: number;
  age_max: number;
  distance_pref_km: number;
  dealbreakers: string[];
}

const GENDERS = GenderSchema.options;
const DEALBREAKERS = DealbreakerSchema.options;

// Display labels for the hard-nos section. Keys MUST match DealbreakerSchema values
// exactly — these are stored values; only the visible label changes.
const DEALBREAKER_LABEL: Record<string, string> = {
  smoking: 'smokers',
  wants_kids: 'wants kids',
  no_kids: "doesn't want kids",
  drinks_alcohol: 'drinks',
  no_alcohol: "doesn't drink",
  has_pets: 'has pets',
  no_pets: 'no pets',
};

export interface PreferencesFormProps {
  mode: 'onboarding' | 'account';
  userId: string;
  initial: PreferencesInitial;
  /** Current dating_enabled state — only meaningful (and rendered) in account mode. */
  datingEnabled?: boolean;
}

export function PreferencesForm({ mode, userId, initial, datingEnabled = false }: PreferencesFormProps) {
  const router = useRouter();
  const [gender, setGender] = useState(initial.gender || 'woman');
  const [wants, setWants] = useState<string[]>(initial.gender_preferences.length ? initial.gender_preferences : ['man']);
  // Ages live as STRINGS while editing (real-user fix): a controlled number
  // input renders Number('') as 0 and typing appends ("019"); a string field
  // can be deleted to '' and re-typed. Digits only, leading zeros stripped on
  // change; parsed to numbers at submit, where '' blocks with the usual alert.
  const [ageMin, setAgeMin] = useState(String(initial.age_min || 25));
  const [ageMax, setAgeMax] = useState(String(initial.age_max || 40));
  const [distance, setDistance] = useState(initial.distance_pref_km || 40);
  const [dealbreakers, setDealbreakers] = useState<string[]>(initial.dealbreakers);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function toggle(list: string[], v: string, set: (n: string[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  function cleanAge(v: string): string {
    return v.replace(/\D+/g, '').replace(/^0+/, '');
  }

  async function handleSave() {
    if (ageMin === '' || ageMax === '') {
      setErrorMsg('age range needs both numbers (18 to 99).');
      setPhase('error');
      return;
    }
    const candidate = { gender, gender_preferences: wants, age_min: Number(ageMin), age_max: Number(ageMax), distance_pref_km: distance, dealbreakers };
    const parsed = PreferencesInputSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrorMsg(parsed.error.issues[0]?.message ?? 'Please check your preferences.');
      setPhase('error');
      return;
    }
    setPhase('saving');
    setErrorMsg('');
    try {
      const client = browserAfter5Client();
      await savePreferences(client, userId, parsed.data);
      // P0 (empty-feed): the wizard never sets primary_city_id and the feed RPC
      // NULLs out every row for a city-less viewer. Default the launch city
      // server-side at the one write point every dating signup hits. Idempotent
      // (the route never overwrites a set city) and non-blocking: a hiccup here
      // must never stall the save or the funnel.
      try {
        await fetch('/api/profile/default-city', { method: 'POST' });
      } catch (cityErr) {
        console.warn('[preferences] default-city backfill skipped', cityErr);
      }
      if (mode === 'onboarding') {
        await advanceOnboarding(client, 'phone_verify');
        router.push('/onboarding/phone');
      } else {
        toast.success('preferences saved');
        router.refresh();
        setPhase('idle');
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Something went wrong.');
      setPhase('error');
    }
  }

  const numberClass = cn(
    'mt-1.5 block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-3 py-2 font-body text-shell-ink',
    '[font-variant-numeric:tabular-nums] focus:outline-none focus:ring-2 focus:ring-shell-accent/60',
  );

  return (
    <div>
      {mode === 'onboarding' && (
        <>
          <h1 className="font-heading text-3xl lowercase text-shell-ink">who you&apos;re into</h1>
          <p className="mt-3 font-body text-[15px] leading-relaxed text-shell-ink/70">this shapes who we line up for you. tweak it anytime.</p>
        </>
      )}

      {mode === 'account' && (
        <DatingToggle userId={userId} datingEnabled={datingEnabled} />
      )}

      <fieldset className="mt-7">
        <legend className="mb-3 font-body text-sm font-semibold lowercase text-shell-ink">i&apos;m a</legend>
        <div className="flex flex-wrap gap-2.5">
          {GENDERS.map((g) => (
            <StickerChip key={g} label={g} role="radio" selected={gender === g} onToggle={() => setGender(g)} />
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="mb-3 font-body text-sm font-semibold lowercase text-shell-ink">show me</legend>
        <div className="flex flex-wrap gap-2.5">
          {GENDERS.map((g) => (
            <StickerChip key={g} label={g} role="checkbox" selected={wants.includes(g)} onToggle={() => toggle(wants, g, setWants)} />
          ))}
        </div>
      </fieldset>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <label className="font-body text-sm font-semibold lowercase text-shell-ink">age from
          <input type="text" inputMode="numeric" autoComplete="off" maxLength={2} value={ageMin}
            onChange={(e) => setAgeMin(cleanAge(e.target.value))}
            className={numberClass} />
        </label>
        <label className="font-body text-sm font-semibold lowercase text-shell-ink">age to
          <input type="text" inputMode="numeric" autoComplete="off" maxLength={2} value={ageMax}
            onChange={(e) => setAgeMax(cleanAge(e.target.value))}
            className={numberClass} />
        </label>
      </div>

      <label className="mt-6 block font-body text-sm font-semibold lowercase text-shell-ink">within {distance} km
        <input type="range" min={1} max={150} value={distance} onChange={(e) => setDistance(Number(e.target.value))}
          className="mt-2 w-full accent-shell-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40" />
      </label>

      <fieldset className="mt-6">
        <legend className="mb-1 font-body text-sm font-semibold lowercase text-shell-ink">hard nos</legend>
        {/* Clarifier (real-user fix). Deliberately promise-free: dealbreakers are
            stored but matching does not enforce them yet, so no "we'll never show
            you" claims here until the feed/match SQL actually filters on them. */}
        <p className="mb-3 font-body text-[13px] text-shell-ink/60">anyone who matches one of these is an instant no for you.</p>
        <div className="flex flex-wrap gap-2.5">
          {DEALBREAKERS.map((d) => (
            <StickerChip key={d} label={DEALBREAKER_LABEL[d] ?? d.replace(/_/g, ' ')} role="checkbox"
              selected={dealbreakers.includes(d)} onToggle={() => toggle(dealbreakers, d, setDealbreakers)} />
          ))}
        </div>
      </fieldset>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-2xl border border-shell-accent/30 bg-white/70 px-4 py-3 font-body text-[13px] text-shell-ink">{errorMsg}</div>
      )}

      <button type="button" onClick={handleSave} disabled={phase === 'saving'} aria-busy={phase === 'saving'}
        className={cn(
          'mt-7 flex min-h-[48px] items-center justify-center rounded-full px-8 font-body text-[16px] font-semibold lowercase transition',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
          phase === 'saving' ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35' : 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95')}>
        {phase === 'saving' ? 'saving…' : mode === 'onboarding' ? (phase === 'error' ? 'try again' : 'next') : 'save'}
      </button>
    </div>
  );
}

// Relocated dating on/off control (A3 / D-09) — formerly home/EnableDatingButton.
// The account context needs BOTH directions; the old button was ON-only. Writes
// the gated dating_enabled flag via the RLS'd client (the DB age-gate trigger
// stays the hard ON gate — we do not bypass it).
function DatingToggle({ userId, datingEnabled }: { userId: string; datingEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(datingEnabled);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState('');

  async function write(next: boolean) {
    setBusy(true);
    setMsg('');
    const client = browserAfter5Client();
    // A3: OFF = stop new exposure only; does NOT withdraw active offers/locks. Founder-overridable.
    const { error } = await client.from('profiles').update({ dating_enabled: next }).eq('id', userId);
    setBusy(false);
    setConfirming(false);
    if (error) { setMsg(error.message); return; }
    setEnabled(next);
    router.refresh();
  }

  return (
    <section className="rounded-3xl border border-shell-ink/10 bg-white/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading text-xl lowercase text-shell-ink">
            {enabled ? 'dating is on' : 'dating is off'}
          </p>
          <p className="mt-0.5 font-body text-[13px] text-shell-ink/60">
            {enabled ? 'you show up in feeds.' : 'you’re hidden from feeds.'}
          </p>
        </div>
        {enabled ? (
          <button type="button" onClick={() => setConfirming(true)} disabled={busy}
            className={cn('min-h-[44px] shrink-0 rounded-full border border-shell-ink/20 px-4 py-2 font-body text-[13px] font-semibold lowercase text-shell-ink transition',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
              busy ? 'cursor-not-allowed opacity-50' : 'hover:border-shell-ink/40 active:scale-95')}>
            pause dating
          </button>
        ) : (
          <button type="button" onClick={() => write(true)} disabled={busy}
            className={cn('min-h-[44px] shrink-0 rounded-full px-4 py-2 font-body text-[13px] font-semibold lowercase transition',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
              busy ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/50' : 'bg-shell-accent text-white hover:scale-[1.03] active:scale-95 motion-reduce:hover:scale-100')}>
            {busy ? 'turning on…' : 'turn dating on'}
          </button>
        )}
      </div>

      {confirming && (
        <div role="alertdialog" aria-label="pause dating" className="mt-3 rounded-2xl border border-shell-ink/15 bg-shell-base px-4 py-3">
          <p className="font-body text-[13px] text-shell-ink">pause dating? you&apos;ll stop showing up in feeds till you flip it back on.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => write(false)} disabled={busy}
              className={cn('min-h-[40px] rounded-full border border-shell-ink/20 px-4 font-body text-[13px] font-semibold lowercase text-shell-ink transition',
                busy ? 'cursor-not-allowed opacity-50' : 'hover:border-shell-ink/40 active:scale-95')}>
              {busy ? 'pausing…' : 'pause'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy}
              className="min-h-[40px] rounded-full px-4 font-body text-[13px] lowercase text-shell-ink/70 transition hover:text-shell-ink active:scale-95">
              nah, leave it
            </button>
          </div>
        </div>
      )}

      {msg && <p role="alert" className="mt-2 font-body text-[12px] text-shell-ink">{msg}</p>}
    </section>
  );
}
