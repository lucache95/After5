'use client';

// Branded heartbeat loader. A filled heart doing a "lub-dub" pulse (scale
// keyframes, no rotation). Replaces generic spinners app-wide. When the logo
// lands, only the inner vector swaps — the API stays the same.

import { Heart } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/cn';

// Single shared animation definition — never re-created per render, so the
// loop never restarts on parent re-renders.
const LUB_DUB = {
  scale: [1, 1.15, 1, 1.25, 1, 1],
  transition: {
    duration: 1.2,
    times: [0, 0.15, 0.3, 0.45, 0.6, 1],
    ease: 'easeInOut' as const,
    repeat: Infinity,
  },
};

const GLOW = {
  opacity: [0.2, 0.45, 0.2, 0.55, 0.2, 0.2],
  transition: LUB_DUB.transition,
};

export interface HeartLoaderProps {
  /** Icon size in px (default 24). */
  size?: number;
  /** CSS color value. Defaults to the shell accent pink. Use "currentColor" to inherit. */
  color?: string;
  /** Extra classes for layout or Tailwind color overrides. */
  className?: string;
  /** Screen-reader label (default "loading"). */
  accessibilityLabel?: string;
}

export function HeartLoader({
  size = 24,
  color,
  className = '',
  accessibilityLabel = 'loading',
}: HeartLoaderProps) {
  const reduce = useReducedMotion();
  const style = {
    width: size,
    height: size,
    ...(color ? { color } : {}),
  };

  return (
    <span
      aria-busy="true"
      aria-label={accessibilityLabel}
      role="progressbar"
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        color ? undefined : 'text-shell-accent',
        className,
      )}
      style={style}
    >
      {!reduce && (
        <motion.span
          aria-hidden
          animate={GLOW}
          className="absolute inset-0 rounded-full bg-current opacity-20 blur-md"
        />
      )}
      <motion.span
        aria-hidden
        animate={reduce ? undefined : LUB_DUB}
        className="relative inline-flex"
        style={{ width: size, height: size }}
      >
        <Heart
          width={size}
          height={size}
          fill="currentColor"
          strokeWidth={0}
        />
      </motion.span>
    </span>
  );
}

/** Centered heart over a translucent blurred backdrop — for route-mount loads. */
export function FullScreenHeartLoader({
  size = 40,
  color,
  className = '',
  accessibilityLabel = 'loading',
}: HeartLoaderProps) {
  return (
    <div
      data-testid="fullscreen-heart-loader"
      aria-busy="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-shell-base/70 backdrop-blur-sm"
    >
      <HeartLoader
        size={size}
        color={color}
        className={className}
        accessibilityLabel={accessibilityLabel}
      />
    </div>
  );
}
