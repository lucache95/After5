'use client';
// The customization canvas: the generated night is the hero; edit chips open
// focused sheets. Publish carries the customized itinerary into /nights/new.
// Copy rule: never the word "regenerate".
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import type { Itinerary } from '@/lib/itinerary-types';
import { TitleEditor } from './TitleEditor';
import { CoverEditor } from './CoverEditor';
import { StopsEditor } from './StopsEditor';

type Sheet = 'title' | 'image' | 'stops' | null;

export function DateCanvas({ itinerary, onStartOver }: { itinerary: Itinerary; onStartOver?: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Itinerary>(itinerary);
  const [sheet, setSheet] = useState<Sheet>(null);
  const id = draft.id ?? '';

  const chip = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-pill bg-white/80 px-4 py-2 font-body text-sm lowercase text-shell-ink ring-1 ring-shell-ink/10 transition active:scale-95';

  function startOver() {
    if (!window.confirm("start over? you'll lose your tweaks.")) return;
    if (onStartOver) onStartOver();
    else router.replace('/create');
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] bg-shell-base px-5 pb-28 pt-4">
      <header className="mb-4 flex items-center justify-between">
        <span className="font-heading text-xl lowercase text-shell-ink">your night</span>
        {id ? (
          <Link
            href={`/nights/new?itinerary=${id}`}
            className="inline-flex min-h-[44px] items-center rounded-pill bg-shell-accent px-5 font-body text-sm font-semibold lowercase text-white shadow-fun active:scale-95"
          >
            publish →
          </Link>
        ) : (
          // No persisted id means there's nothing to publish yet — never link to
          // /nights/new?itinerary= with an empty id (lands the user on a dead form).
          <span
            aria-disabled="true"
            className="inline-flex min-h-[44px] items-center rounded-pill bg-shell-ink/10 px-5 font-body text-sm font-semibold lowercase text-shell-ink/35"
          >
            publish →
          </span>
        )}
      </header>

      <section className="overflow-hidden rounded-3xl bg-shell-pink/40 ring-1 ring-shell-ink/10">
        <div className="relative aspect-[4/3] w-full">
          {draft.cover_image_url && (
            <Image src={draft.cover_image_url} alt="" fill sizes="480px" className="object-cover" />
          )}
        </div>
        <div className="p-5">
          <h1 className="font-heading text-2xl lowercase leading-tight text-shell-ink">{draft.title}</h1>
          {draft.hook && <p className="mt-1 font-body text-sm text-shell-ink/70">{draft.hook}</p>}
          <ol className="mt-4 space-y-1.5">
            {draft.stops.map((s, i) => (
              <li key={`${s.place_id}-${i}`} className="font-body text-sm lowercase text-shell-ink">
                {i > 0 && <span className="mr-2 text-shell-ink/30">↓</span>}
                {s.place_name}
              </li>
            ))}
          </ol>
          <p className="mt-3 font-body text-xs lowercase tabular-nums text-shell-ink/55">
            {Math.round((draft.total_duration_min / 60) * 10) / 10} hr · ${Math.round(draft.total_cost_pp)}
          </p>
        </div>
      </section>

      <p className="mt-6 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-ink/55">make it yours</p>
      <div className="mt-3 flex flex-wrap gap-2.5">
        <button type="button" className={chip} onClick={() => setSheet('title')}>
          ✏️ title
        </button>
        <button type="button" className={chip} onClick={() => setSheet('image')}>
          🖼 image
        </button>
        <button type="button" className={chip} onClick={() => setSheet('stops')}>
          📍 stops
        </button>
      </div>
      <p className="mt-3 font-body text-xs lowercase text-shell-ink/45">tap any chip to make it yours</p>

      <div className="mt-10 text-center">
        <button
          type="button"
          onClick={startOver}
          className="min-h-[44px] font-body text-xs lowercase text-shell-ink/40 underline underline-offset-2 active:scale-95"
        >
          start over
        </button>
      </div>

      {sheet === 'title' && (
        <TitleEditor
          itineraryId={id}
          current={{ title: draft.title, hook: draft.hook }}
          onApply={(t) => setDraft((d) => ({ ...d, title: t.title, hook: t.hook }))}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'image' && (
        <CoverEditor
          stops={draft.stops}
          onApply={(url) => setDraft((d) => ({ ...d, cover_image_url: url }))}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'stops' && (
        <StopsEditor
          itineraryId={id}
          stops={draft.stops}
          onApply={(stops) => setDraft((d) => ({ ...d, stops }))}
          onClose={() => setSheet(null)}
        />
      )}
    </main>
  );
}
