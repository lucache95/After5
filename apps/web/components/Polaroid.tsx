// Reusable polaroid-style framed photo. White border, deterministic tilt,
// warm shadow, optional bottom label kerned in display caps. Used as
// editorial accents across marketing/auth/dashboard surfaces.
//
// Tilt is derived from a hash of the label/src so the same instance
// always tilts the same way (no jitter on re-render) but a row of
// polaroids gets a natural variety of angles.

import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/cn';

const SIZES = {
  sm:  { wrap: 'w-[110px] pb-7  pt-1.5', img: 'h-[96px]  w-[100px]', label: 'text-[9px]'  },
  md:  { wrap: 'w-[136px] pb-9  pt-2',   img: 'h-[120px] w-[124px]', label: 'text-[10px]' },
  lg:  { wrap: 'w-[200px] pb-11 pt-2.5', img: 'h-[180px] w-[188px]', label: 'text-[11px]' },
  xl:  { wrap: 'w-[260px] pb-12 pt-3',   img: 'h-[240px] w-[248px]', label: 'text-[11px]' },
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
  src: string;
  alt: string;
  label?: string;
  size?: Size;
  rotation?: number;
  href?: string;
  className?: string;
}

export function Polaroid({
  src,
  alt,
  label,
  size = 'md',
  rotation,
  href,
  className,
}: PolaroidProps) {
  const tilt = rotation ?? tiltFor(label ?? src);
  const s = SIZES[size];

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
        <Image
          src={src}
          alt={alt}
          fill
          sizes="260px"
          className="object-cover"
        />
      </div>
      {label && (
        <p
          className={cn(
            'absolute bottom-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap font-display font-medium tracking-[0.14em] text-text/70',
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
