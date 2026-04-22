'use client';

// Sticky anchor nav — appears on scroll past the gallery hero. Section
// links scroll-spy via IntersectionObserver: whichever section is most
// in view gets the active underline. Mirrors Airbnb's Photos / Amenities /
// Reviews / Location pattern.
//
// Sections we anchor: #stops (timeline), #map, #why, #more.

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

interface Section {
  id: string;
  label: string;
}

const SECTIONS: Section[] = [
  { id: 'why',      label: 'Why it works' },
  { id: 'route',    label: 'Map' },
  { id: 'timeline', label: 'Stops' },
  { id: 'know',     label: 'Know' },
  { id: 'more',     label: 'Similar' },
];

export function AnchorNav() {
  const [active, setActive] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Show the bar only after the user scrolls past the gallery hero.
  // Sentinel sits at the top of the bar; when it leaves the viewport,
  // the bar becomes pinned.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setPinned(!entry.isIntersecting),
      { threshold: 0, rootMargin: '-1px 0px 0px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Scroll-spy for active section. Active = the section whose top is
  // closest to the bar but still above center of viewport.
  useEffect(() => {
    const targets = SECTIONS
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        // Pick the entry that's most visible AND above the middle.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-120px 0px -50% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    targets.forEach((t) => obs.observe(t));
    return () => obs.disconnect();
  }, []);

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="h-0" />
      <div
        className={cn(
          'sticky top-0 z-40 -mx-6 transition-all duration-200 md:-mx-10 md:mt-2',
          pinned
            ? 'border-b border-border bg-background/90 backdrop-blur-md'
            : 'border-b border-transparent',
        )}
      >
        <div className="mx-auto max-w-content px-6 md:px-10">
          <ul className="flex items-center gap-7 overflow-x-auto py-3 text-sm">
            {SECTIONS.map((s) => {
              const isActive = active === s.id;
              return (
                <li key={s.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => scrollTo(s.id)}
                    className={cn(
                      'relative -mx-1 px-1 pb-1 pt-2 font-medium transition-colors',
                      isActive ? 'text-text' : 'text-secondary hover:text-text',
                    )}
                  >
                    {s.label}
                    <span
                      aria-hidden
                      className={cn(
                        'pointer-events-none absolute inset-x-0 -bottom-3 h-0.5 rounded-full transition-all',
                        isActive ? 'bg-text' : 'bg-transparent',
                      )}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}
