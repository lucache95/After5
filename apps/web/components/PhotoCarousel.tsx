'use client';
// Multi-photo strip for ProfileCard. Scroll-snap carousel (no new dependency)
// PLUS explicit affordances — chevrons + dots — because a CSS scroll container
// with a hidden scrollbar is swipe-only: desktop mouse users cannot drag it at
// all (live founder repro on the self-view sheet). Arrows/dots work on every
// input; touch swipe + snap stay untouched.
import { useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export function PhotoCarousel({ name, photos }: { name: string; photos: string[] }) {
  const strip = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  // One snap cell = first child's width + the flex gap; derived live so the
  // 78%-width cells track viewport resizes without a layout effect.
  const cellWidth = () => {
    const el = strip.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return 1;
    const gap = parseFloat(getComputedStyle(el).columnGap || '0') || 0;
    return first.offsetWidth + gap;
  };

  const scrollTo = (i: number) => {
    const el = strip.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(photos.length - 1, i));
    el.scrollTo({ left: idx * cellWidth(), behavior: 'smooth' });
  };

  return (
    <div className="relative">
      <div
        // data-vaul-no-drag: inside a vaul sheet (SelfViewSheet, RevealModal) the
        // drawer's drag handler only recognizes VERTICALLY scrollable ancestors, so
        // horizontal swipes on this strip would start a drawer drag instead of
        // panning the carousel. The attribute is inert outside vaul.
        data-vaul-no-drag
        ref={strip}
        onScroll={() => {
          const el = strip.current;
          if (el) setActive(Math.max(0, Math.min(photos.length - 1, Math.round(el.scrollLeft / cellWidth()))));
        }}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pt-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label={`${name}'s photos`}
      >
        {photos.map((url, i) => (
          <div key={url} className="relative aspect-[4/5] w-[78%] shrink-0 snap-center overflow-hidden rounded-2xl bg-shell-pink/30">
            <Image src={url} alt={i === 0 ? name : `${name}, photo ${i + 1}`} fill sizes="320px" className="object-cover" />
          </div>
        ))}
      </div>

      {/* chevrons — 44px hit areas, hidden at the ends */}
      {active > 0 && (
        <button
          type="button"
          aria-label="previous photo"
          onClick={() => scrollTo(active - 1)}
          className="absolute left-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-profile-ink shadow-fun backdrop-blur-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
      )}
      {active < photos.length - 1 && (
        <button
          type="button"
          aria-label="next photo"
          onClick={() => scrollTo(active + 1)}
          className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-profile-ink shadow-fun backdrop-blur-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      )}

      {/* dots — tappable position indicator */}
      <div className="mt-2 flex justify-center gap-1.5" role="tablist" aria-label="photo position">
        {photos.map((url, i) => (
          <button
            key={url}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-label={`photo ${i + 1} of ${photos.length}`}
            onClick={() => scrollTo(i)}
            className={cn(
              'h-2 rounded-full transition-all',
              i === active ? 'w-5 bg-shell-accent' : 'w-2 bg-profile-ink/20',
            )}
          />
        ))}
      </div>
    </div>
  );
}
