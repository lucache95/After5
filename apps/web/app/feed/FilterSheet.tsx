'use client';
import { Drawer } from 'vaul';
import { Wallet, MapPin, Sparkles } from 'lucide-react';

// PLACEHOLDER filter sheet (DESIGN-SYSTEM §4, spec 2026-06-03 §3).
// The real filter logic — hard filters (host gender, max price, max distance) in
// WHERE, soft filters (vibe, who-pays, time) in ORDER BY, persisted to
// profiles.feed_filters — is a LATER phase. This is the wired-up shell: the gear
// opens a Barbiecore bottom-sheet with the planned quick chips shown disabled,
// so the entry point + IA exist now and the logic drops in behind it.

const QUICK_CHIPS = [
  { icon: Wallet, label: 'budget' },
  { icon: MapPin, label: 'distance' },
  { icon: Sparkles, label: 'who pays' },
] as const;

export function FilterSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-shell-ink/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[80dvh] w-full max-w-[420px] flex-col rounded-t-3xl bg-shell-base text-shell-ink shadow-fun outline-none">
          <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-shell-ink/20" aria-hidden />
          <div className="flex flex-col gap-5 px-6 pb-8 pt-5">
            <div>
              <Drawer.Title className="font-heading text-3xl lowercase text-shell-ink">
                filters
              </Drawer.Title>
              <Drawer.Description className="mt-1 font-body text-[15px] text-shell-ink/65">
                coming soon. for now it&rsquo;s everyone, everywhere.
              </Drawer.Description>
            </div>

            <ul className="flex flex-wrap gap-2" aria-label="planned filters">
              {QUICK_CHIPS.map(({ icon: Icon, label }) => (
                <li key={label}>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-4 py-2 font-body text-sm font-semibold lowercase text-shell-ink/45 ring-1 ring-shell-ink/10">
                    <Icon className="h-4 w-4" aria-hidden />
                    {label}
                  </span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="mt-1 flex h-14 items-center justify-center rounded-full bg-shell-accent px-7 font-heading text-lg lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100"
            >
              fine, show me everything
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
