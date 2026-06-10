'use client';
// Shared sticker chip (DESIGN-SYSTEM §5b): slapped-on rotation + shadow; selected
// = pink fill. Lifted out of PreferencesStep so both the onboarding step and the
// new /account/preferences form render identical chips (E4 / D-09).
import { cn } from '@/lib/cn';
import { stickerRotation } from '@/lib/sticker';

export function StickerChip({
  label, selected, onToggle, role,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
  role?: 'radio' | 'checkbox';
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      onClick={onToggle}
      style={{ transform: `rotate(${stickerRotation(label)}deg)` }}
      className={cn(
        'rounded-full px-4 py-2 font-body text-sm lowercase shadow-md transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
        'active:scale-95 hover:-translate-y-0.5',
        selected
          ? 'bg-shell-accent text-white'
          : 'bg-white text-shell-ink ring-1 ring-shell-ink/10 hover:ring-shell-accent/40',
      )}
    >
      {label}
    </button>
  );
}
