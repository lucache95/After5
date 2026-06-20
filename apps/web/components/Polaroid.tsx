// Reusable polaroid-style framed photo. White border, deterministic tilt,
// warm shadow, optional bottom label kerned in display caps. Used as
// editorial accents across marketing/auth/dashboard surfaces.
//
// Tilt is derived from a hash of the label/src so the same instance
// always tilts the same way (no jitter on re-render) but a row of
// polaroids gets a natural variety of angles.

'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { cn } from '@/lib/cn';

// `sizes` matches the rendered CSS width of each variant so next/image serves
// a correctly-small srcset candidate (a flat 260px was making the optimizer
// ship ~4x the pixels a sm polaroid needs).
const SIZES = {
  sm:  { wrap: 'w-[110px] pb-7  pt-1.5', img: 'h-[96px]  w-[100px]', sizes: '100px', label: 'text-[9px]'  },
  md:  { wrap: 'w-[136px] pb-9  pt-2',   img: 'h-[120px] w-[124px]', sizes: '124px', label: 'text-[10px]' },
  lg:  { wrap: 'w-[200px] pb-11 pt-2.5', img: 'h-[180px] w-[188px]', sizes: '188px', label: 'text-[11px]' },
  xl:  { wrap: 'w-[260px] pb-12 pt-3',   img: 'h-[240px] w-[248px]', sizes: '248px', label: 'text-[11px]' },
} as const;

type Size = keyof typeof SIZES;

function tiltFor(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash) + seed.charCodeAt(i);
    hash = hash & hash;
  }
  // -7° to +7° range
  const range = 14;
  return ((Math.abs(hash) % (range * 100)) / 100) - range / 2;
}

interface PolaroidProps {
  src: string | null | undefined;
  alt: string;
  label?: string;
  size?: Size;
  rotation?: number;
  href?: string;
  className?: string;
  /**
   * Brand theming for the caption + broken-image fallback. 'planner' (default)
   * keeps the warm-cream/terracotta + Fraunces look; 'dating' uses the
   * warm-filmic dating tokens (Fredoka caption, pink/cream fallback) so
   * polaroids on dating surfaces don't flash the planner brand.
   */
  tone?: 'planner' | 'dating';
  /** Set on above-the-fold polaroids so next/image preloads them (no lazy delay). */
  priority?: boolean;
}

/** Local fallback image used when the primary src fails to load. */
const FALLBACK_SRC = '/places/place-walk.jpg';

export function Polaroid({
  src,
  alt,
  label,
  size = 'md',
  rotation,
  href,
  className,
  tone = 'planner',
  priority = false,
}: PolaroidProps) {
  const tilt = rotation ?? tiltFor(label ?? src ?? '');
  const s = SIZES[size];
  const dating = tone === 'dating';

  const [imgError, setImgError] = useState(false);

  // When the primary image fails (expired Google URL, missing Supabase
  // cover, network blip, etc.) swap to the local fallback. If even the
  // fallback errors out we show the gradient placeholder so users never
  // see broken alt-text.
  const [fallbackError, setFallbackError] = useState(false);
  // Also show the gradient placeholder immediately when src is falsy
  // (empty string, null, undefined) — avoids passing '' to next/image.
  const noSrc = !src;
  const showGradient = noSrc || (imgError && fallbackError);
  const displaySrc = imgError ? FALLBACK_SRC : (src ?? '');

  // Supabase storage photos already arrive pre-resized via the /render/image
  // transform (e.g. 400×400, ~60KB — see lib/after5/photos.ts). Routing those
  // through the next/image optimizer adds a SECOND pipeline (a Vercel hop +
  // re-encode) that goes cold every ~30min when the signed-url token rotates,
  // which is what made the avatar slow to paint. Bypass the optimizer for
  // transformed storage urls so the browser loads them straight from Supabase's
  // CDN (cached by path+transform, immune to token rotation). Local-stack and
  // non-transformed object urls (covers, /object/...) keep optimization.
  const isTransformedStorageUrl = /\/storage\/v1\/render\/image\//.test(displaySrc);

  const handleError = useCallback(() => {
    if (!imgError) {
      setImgError(true);
    } else {
      // Even the local fallback failed — show gradient placeholder.
      setFallbackError(true);
    }
  }, [imgError]);

  const inner = (
    <div
      className={cn(
        'relative inline-block bg-white px-2 ring-1 ring-black/5 shadow-[0_18px_44px_-14px_rgba(80,40,20,0.32)] transition-transform duration-500',
        s.wrap,
        href && 'hover:!rotate-[2deg] hover:-translate-y-0.5 hover:shadow-[0_24px_56px_-14px_rgba(80,40,20,0.4)]',
        className,
      )}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <div className={cn('relative overflow-hidden bg-surface', s.img)}>
        {showGradient ? (
          /* Warm on-brand gradient with the date title overlaid so the
             polaroid looks intentional rather than broken. Themed per `tone`
             so dating surfaces fall back to pink/cream, not planner terracotta. */
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center bg-gradient-to-br p-2',
              dating
                ? 'from-shell-pink via-shell-pink to-shell-accent/30'
                : 'from-[#F4ECDD] via-[#E8CFBA] to-[#C2552B]/40',
            )}
          >
            <span
              className={cn(
                'line-clamp-2 text-center text-[11px] font-semibold',
                dating
                  ? 'font-heading lowercase text-shell-ink/50'
                  : 'font-display uppercase tracking-[0.16em] text-text/50',
              )}
            >
              {label ?? alt}
            </span>
          </div>
        ) : (
          <Image
            src={displaySrc}
            alt={alt}
            fill
            sizes={s.sizes}
            priority={priority}
            unoptimized={isTransformedStorageUrl}
            className="object-cover"
            onError={handleError}
          />
        )}
      </div>
      {label && (
        <p
          className={cn(
            'absolute bottom-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap',
            dating
              ? 'font-body font-semibold lowercase text-shell-ink/65'
              : 'font-display font-medium tracking-[0.14em] text-text/70',
            s.label,
          )}
        >
          {label}
        </p>
      )}
    </div>
  );

  if (href) {
    return <Link href={href} aria-label={alt} className="inline-block">{inner}</Link>;
  }
  return inner;
}
