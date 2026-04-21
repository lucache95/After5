// Initial-based avatar used in social-proof toasts. Color is derived
// deterministically from the name so the same person always gets the
// same swatch — adds visual stability when the toast rotates.
//
// No network calls, no generated-face services, no AI slop. Matches
// Gmail/Slack/Linear pattern of showing a colored circle with initials.

import { cn } from '@/lib/cn';

// Hand-picked palette that plays nicely with the site's warm-neutral
// theme. All high-contrast enough for white text on top.
const PALETTE = [
  'bg-rose-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-orange-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-fuchsia-500',
  'bg-lime-500',
] as const;

function colorFor(name: string): string {
  // Simple djb2 hash → palette index. Deterministic per name.
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash) + name.charCodeAt(i);
    hash = hash & hash;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const initial = (name[0] ?? '?').toUpperCase();
  const color = colorFor(name);
  const sizes = {
    sm: 'h-7 w-7 text-[11px]',
    md: 'h-9 w-9 text-sm',
    lg: 'h-11 w-11 text-base',
  };

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        color,
        sizes[size],
        className,
      )}
    >
      {initial}
    </span>
  );
}
