'use client';
// Notification preferences form (G, spec §5.3/§6). 2 channel toggles + 5 category
// toggles + quiet-hours start/end. Quiet hours are both-or-neither (decision G-2):
// a single field surfaces a validation error and blocks save. Save upserts the
// full verified column set via the browser RLS client (notif_prefs_owner_all).
// email_enabled is shown though the email half is deferred (spec §9): the column
// exists and dispatch_notification reads it, so the toggle is harmless + ready.
import { useState } from 'react';
import { toast } from 'sonner';
import { browserAfter5Client } from '@/lib/after5/client';
import { cn } from '@/lib/cn';
import { EnableWebPushButton } from './EnableWebPushButton';

export interface PrefsInitial {
  push_enabled: boolean;
  email_enabled: boolean;
  offers_enabled: boolean;
  matches_enabled: boolean;
  messages_enabled: boolean;
  reminders_enabled: boolean;
  account_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

type BoolKey =
  | 'push_enabled' | 'email_enabled' | 'offers_enabled' | 'matches_enabled'
  | 'messages_enabled' | 'reminders_enabled' | 'account_enabled';

const DEFAULTS: Record<BoolKey, boolean> = {
  push_enabled: true, email_enabled: true, offers_enabled: true, matches_enabled: true,
  messages_enabled: true, reminders_enabled: true, account_enabled: true,
};

const CHANNELS: { key: BoolKey; label: string; help: string }[] = [
  { key: 'push_enabled', label: 'push', help: 'real-time alerts on your phone.' },
  { key: 'email_enabled', label: 'email', help: 'a heads-up in your inbox.' },
];

const CATEGORIES: { key: BoolKey; label: string; help: string }[] = [
  { key: 'offers_enabled', label: 'offers', help: 'someone wants you in on a night.' },
  { key: 'matches_enabled', label: 'matches', help: "when it's a match." },
  { key: 'messages_enabled', label: 'messages', help: 'new messages from a match.' },
  { key: 'reminders_enabled', label: 'reminders', help: 'reconfirms, ratings, safety check-ins.' },
  { key: 'account_enabled', label: 'account', help: 'verification, moderation, appeals.' },
];

function Toggle({ label, help, checked, onToggle }: { label: string; help: string; checked: boolean; onToggle: () => void }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-4 py-2">
      <span className="flex flex-col">
        <span className="font-body text-[15px] lowercase text-shell-ink">{label}</span>
        <span className="font-body text-xs text-shell-ink/55">{help}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onToggle}
        className={cn(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50',
          checked ? 'bg-shell-accent' : 'bg-shell-ink/20',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
}

export function PreferencesForm({ userId, initial }: { userId: string; initial: PrefsInitial | null }) {
  const [bools, setBools] = useState<Record<BoolKey, boolean>>(() => ({
    push_enabled: initial?.push_enabled ?? DEFAULTS.push_enabled,
    email_enabled: initial?.email_enabled ?? DEFAULTS.email_enabled,
    offers_enabled: initial?.offers_enabled ?? DEFAULTS.offers_enabled,
    matches_enabled: initial?.matches_enabled ?? DEFAULTS.matches_enabled,
    messages_enabled: initial?.messages_enabled ?? DEFAULTS.messages_enabled,
    reminders_enabled: initial?.reminders_enabled ?? DEFAULTS.reminders_enabled,
    account_enabled: initial?.account_enabled ?? DEFAULTS.account_enabled,
  }));
  const [quietStart, setQuietStart] = useState(initial?.quiet_hours_start ?? '');
  const [quietEnd, setQuietEnd] = useState(initial?.quiet_hours_end ?? '');
  const [saving, setSaving] = useState(false);

  const toggle = (k: BoolKey) => setBools((b) => ({ ...b, [k]: !b[k] }));

  async function save() {
    if (saving) return;
    // both-or-neither (decision G-2): reject a single quiet-hours field.
    if ((quietStart && !quietEnd) || (!quietStart && quietEnd)) {
      toast.error('set both quiet-hours times, or neither.');
      return;
    }
    setSaving(true);
    try {
      const supabase = browserAfter5Client();
      const { error } = await supabase.from('notification_preferences').upsert({
        user_id: userId,
        push_enabled: bools.push_enabled,
        email_enabled: bools.email_enabled,
        offers_enabled: bools.offers_enabled,
        matches_enabled: bools.matches_enabled,
        messages_enabled: bools.messages_enabled,
        reminders_enabled: bools.reminders_enabled,
        account_enabled: bools.account_enabled,
        quiet_hours_start: quietStart || null,
        quiet_hours_end: quietEnd || null,
      }, { onConflict: 'user_id' });
      if (error) toast.error("couldn't save. try again?");
      else toast.success('saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-8">
      <section>
        <h2 className="font-body text-sm font-semibold lowercase tracking-wide text-shell-ink/60">how we reach you</h2>
        <div className="mt-2 divide-y divide-shell-ink/10">
          {CHANNELS.map((c) => (
            <Toggle key={c.key} label={c.label} help={c.help} checked={bools[c.key]} onToggle={() => toggle(c.key)} />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-body text-sm font-semibold lowercase tracking-wide text-shell-ink/60">what reaches you</h2>
        <div className="mt-2 divide-y divide-shell-ink/10">
          {CATEGORIES.map((c) => (
            <Toggle key={c.key} label={c.label} help={c.help} checked={bools[c.key]} onToggle={() => toggle(c.key)} />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-body text-sm font-semibold lowercase tracking-wide text-shell-ink/60">quiet hours</h2>
        <p className="mt-1 font-body text-xs text-shell-ink/55">we hold non-urgent alerts during this window.</p>
        <div className="mt-3 flex items-end gap-4">
          <label className="flex flex-1 flex-col gap-1">
            <span className="font-body text-xs lowercase text-shell-ink/70">quiet hours start</span>
            <input
              type="time"
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
              className="min-h-[44px] rounded-2xl border border-shell-ink/15 bg-white px-3 font-body text-shell-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="font-body text-xs lowercase text-shell-ink/70">quiet hours end</span>
            <input
              type="time"
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
              className="min-h-[44px] rounded-2xl border border-shell-ink/15 bg-white px-3 font-body text-shell-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50"
            />
          </label>
        </div>
        {(quietStart || quietEnd) && (
          <button
            type="button"
            onClick={() => { setQuietStart(''); setQuietEnd(''); }}
            className="mt-2 flex min-h-[44px] items-center font-body text-sm lowercase text-shell-ink/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-ink/30"
          >
            clear quiet hours
          </button>
        )}
      </section>

      <EnableWebPushButton />

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-10 flex min-h-[48px] w-full items-center justify-center rounded-full bg-shell-accent font-body font-semibold lowercase text-white transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-50"
      >
        save
      </button>
    </div>
  );
}
