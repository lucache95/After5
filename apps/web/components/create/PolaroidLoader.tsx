'use client';

// PolaroidLoader — the "flipping through polaroids" wait animation for /create.
// A fanned 3-card polaroid stack: the front card carries the current "thinking
// step" and re-keys on each step so it flips in fresh (polaroidIn keyframe).
// City-aware: captions and labels weave in the passed `city`. Self-contained —
// runs its own timer, so the parent only mounts it while a night generates.

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/cn';

// Stepped status feed calibrated to the ~10s generate call. The final step
// never auto-completes — it holds "active" until the parent unmounts the loader,
// so a slow call never leaves the user on a finished-but-still-waiting screen.
function loadSteps(city: string): { label: string; doneAt: number }[] {
  return [
    { label: `pulling vetted ${city} spots`, doneAt: 1500 },
    { label: 'checking what’s actually open tonight', doneAt: 3000 },
    { label: 'filtering for your vibe and budget', doneAt: 4500 },
    { label: 'calculating drive time between every pair', doneAt: 6500 },
    { label: 'sequencing so nothing closes mid-date', doneAt: 8500 },
    { label: 'surfacing the hidden gems most people miss', doneAt: 10500 },
    { label: 'pairing food, drinks and a wow moment', doneAt: 12500 },
    { label: 'writing why each plan works for you', doneAt: 15000 },
    { label: 'adding the small details that make it a story', doneAt: Infinity },
  ];
}

// Cycled through the stack — more images than steps so scenes keep rotating.
const LOAD_IMAGES = [
  '/pins/couple-trail.jpg',
  '/pins/couple-lake-kiss.jpg',
  '/pins/couple-wakeboard.jpg',
  '/pins/couple-field.jpg',
  '/vibes/vibe-romantic.jpg',
  '/vibes/vibe-cozy.jpg',
  '/vibes/vibe-boujee.jpg',
  '/vibes/vibe-adventurous.jpg',
  '/vibes/vibe-chill.jpg',
] as const;

export function PolaroidLoader({ city = 'your city' }: { city?: string }) {
  const cityLabel = city.trim() ? city.trim().toLowerCase() : 'your city';
  const steps = useMemo(() => loadSteps(cityLabel), [cityLabel]);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setNow(Date.now() - start), 120);
    return () => clearInterval(id);
  }, []);

  const rawIdx = steps.findIndex((s) => now < s.doneAt);
  const activeIdx = rawIdx === -1 ? steps.length - 1 : rawIdx;
  const total = steps.length;

  return (
    <div className="flex flex-col items-center text-center" aria-live="polite" aria-busy="true">
      <p className="font-body text-xs font-semibold lowercase tracking-[0.2em] text-shell-accent">
        building your night
      </p>
      <h2 className="mt-2 font-heading text-3xl lowercase leading-[1.05] text-shell-ink">
        flipping through every{' '}
        <span className="text-shell-accent">{cityLabel}</span> spot
      </h2>

      <PolaroidStack steps={steps} activeIdx={activeIdx} cityLabel={cityLabel} />

      {/* progress dots — one per step */}
      <div className="mt-8 flex items-center gap-1.5">
        {steps.map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 rounded-pill transition-all duration-300',
              i < activeIdx
                ? 'w-1.5 bg-shell-accent'
                : i === activeIdx
                  ? 'w-6 bg-shell-accent'
                  : 'w-1.5 bg-shell-ink/15',
            )}
          />
        ))}
      </div>
      <p className="mt-3 font-body text-[11px] lowercase tracking-[0.18em] text-shell-ink/55 tabular-nums">
        step {Math.min(activeIdx + 1, total)} of {total}
      </p>

      {/* keyframes — global so re-keying the active layer replays them */}
      <style jsx global>{`
        @keyframes polaroidIn {
          0% {
            opacity: 0;
            transform: translate(0, -24px) rotate(-8deg) scale(0.92);
          }
          100% {
            opacity: 1;
            transform: translate(0, 0) rotate(-2deg) scale(1);
          }
        }
      `}</style>
    </div>
  );
}

function PolaroidStack({
  steps,
  activeIdx,
  cityLabel,
}: {
  steps: { label: string; doneAt: number }[];
  activeIdx: number;
  cityLabel: string;
}) {
  const total = steps.length;

  function imgFor(stepIdx: number): string {
    return LOAD_IMAGES[stepIdx % LOAD_IMAGES.length];
  }
  function labelFor(stepIdx: number): string {
    const cities = [
      cityLabel,
      'lakeside',
      'downtown',
      'the strip',
      'uptown',
      'the docks',
      'midtown',
      'the hills',
      'old town',
    ];
    return cities[stepIdx % cities.length];
  }

  return (
    <div className="relative mt-10 flex h-[340px] w-full items-center justify-center">
      {activeIdx + 2 < total && (
        <PolaroidLayer
          src={imgFor(activeIdx + 2)}
          label={labelFor(activeIdx + 2)}
          step={steps[activeIdx + 2]?.label ?? ''}
          z={1}
          rotate={-8}
          translateX={-30}
          translateY={20}
          scale={0.9}
          opacity={0.55}
        />
      )}
      {activeIdx + 1 < total && (
        <PolaroidLayer
          src={imgFor(activeIdx + 1)}
          label={labelFor(activeIdx + 1)}
          step={steps[activeIdx + 1]?.label ?? ''}
          z={2}
          rotate={5}
          translateX={20}
          translateY={10}
          scale={0.95}
          opacity={0.78}
        />
      )}
      <PolaroidLayer
        key={`active-${activeIdx}`}
        src={imgFor(activeIdx)}
        label={labelFor(activeIdx)}
        step={steps[activeIdx]?.label ?? ''}
        z={3}
        rotate={-2}
        translateX={0}
        translateY={0}
        scale={1}
        opacity={1}
        active
      />
    </div>
  );
}

function PolaroidLayer({
  src,
  label,
  step,
  z,
  rotate,
  translateX,
  translateY,
  scale,
  opacity,
  active = false,
}: {
  src: string;
  label: string;
  step: string;
  z: number;
  rotate: number;
  translateX: number;
  translateY: number;
  scale: number;
  opacity: number;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        'absolute transition-all duration-500 ease-out',
        active && 'animate-[polaroidIn_.6s_cubic-bezier(0.2,0.8,0.2,1)_both]',
      )}
      style={{
        zIndex: z,
        transform: `translate(${translateX}px, ${translateY}px) rotate(${rotate}deg) scale(${scale})`,
        opacity,
      }}
    >
      <div className="relative w-[240px] rounded-sm bg-white px-3 pb-11 pt-3 shadow-fun ring-1 ring-shell-ink/5">
        <div className="relative h-[240px] w-full overflow-hidden rounded-sm bg-shell-pink">
          <Image
            src={src}
            alt=""
            fill
            sizes="240px"
            className="object-cover"
          />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-shell-ink/70 via-shell-ink/15 to-transparent"
          />
          {active && (
            <p className="absolute inset-x-3 bottom-3 text-left font-body text-sm lowercase leading-snug text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
              {step}
              <span className="ml-1 inline-block animate-pulse">…</span>
            </p>
          )}
        </div>
        <p className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap font-heading text-[11px] lowercase tracking-[0.14em] text-shell-ink/70">
          {label}
        </p>
      </div>
    </div>
  );
}
