import Image from 'next/image';
import { cn } from '@/lib/cn';

// Pure-CSS iPhone shell holding a real app screenshot. Crisp at any size, themes
// to the brand, no PNG-asset alignment to manage. Screenshots live under
// public/screens/ at ~9:19.5; object-cover handles minor ratio drift.

export function PhoneFrame({
  src,
  alt,
  className,
  rotate = 0,
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  /** Slight tilt for the scrapbook/polaroid scatter. */
  rotate?: number;
  priority?: boolean;
}) {
  return (
    <div
      // Width comes from className (e.g. w-[236px]); kept off the base to avoid a
      // Tailwind arbitrary-value width conflict when callers override it.
      className={cn('relative shrink-0', className)}
      style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
    >
      {/* device body */}
      <div className="relative aspect-[9/19.5] rounded-[2.6rem] bg-shell-ink p-[10px] shadow-[0_28px_60px_-18px_rgba(80,40,20,0.45)] ring-1 ring-black/20">
        {/* screen */}
        <div className="relative h-full w-full overflow-hidden rounded-[2.05rem] bg-shell-base">
          <Image src={src} alt={alt} fill sizes="232px" className="object-cover object-top" priority={priority} />
        </div>
        {/* notch */}
        <div className="pointer-events-none absolute left-1/2 top-[10px] h-[22px] w-[96px] -translate-x-1/2 rounded-b-2xl bg-shell-ink" aria-hidden />
      </div>
    </div>
  );
}
