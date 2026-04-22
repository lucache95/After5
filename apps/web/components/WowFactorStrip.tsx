// Landing-page strip that surfaces the wow-factor "twist" baked into every
// plan. Pulls 3 live modifiers (one per difficulty when possible) from the
// modifiers table so the showcase rotates over time as we add new ones.
//
// Visual treatment: index-card / sticky-note feel — warm cream stock,
// slight per-card tilt, washi-tape strip up top, dark difficulty pill.

import { createAdminClient } from '@/lib/supabase/admin';

type Difficulty = 'tame' | 'spicy' | 'chaos';

interface ModifierCard {
  id: string;
  label: string;
  body: string;
  difficulty: Difficulty;
}

const DIFFICULTY_META: Record<Difficulty, { label: string; tone: string }> = {
  tame:  { label: 'Tame',  tone: 'bg-emerald-100 text-emerald-900 ring-emerald-200' },
  spicy: { label: 'Spicy', tone: 'bg-amber-100 text-amber-950 ring-amber-200' },
  chaos: { label: 'Chaos', tone: 'bg-rose-100 text-rose-950 ring-rose-200' },
};

// Deterministic pseudo-random tilt from id. Keeps the same card at the
// same angle between renders so it doesn't flicker on hydration.
function tiltFor(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h) ^ id.charCodeAt(i);
  const r = ((h % 2000) / 1000) - 1; // -1..1
  return Math.round(r * 25) / 10;    // -2.5..+2.5 deg
}

async function loadCards(): Promise<ModifierCard[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('modifiers')
    .select('id, label, body, difficulty')
    .eq('is_active', true);

  if (!data) return [];

  // Stratify by difficulty so the showcase always lands one of each tier
  // when possible. Pick deterministically by hour-of-day so the page
  // changes throughout the day but doesn't churn on every request.
  const buckets: Record<Difficulty, ModifierCard[]> = { tame: [], spicy: [], chaos: [] };
  for (const m of data) {
    const d = m.difficulty as Difficulty;
    if (d in buckets) buckets[d].push(m as ModifierCard);
  }
  const seed = new Date().getUTCHours();
  const pickFrom = (arr: ModifierCard[]) =>
    arr.length === 0 ? null : arr[seed % arr.length];

  const ordered: Difficulty[] = ['tame', 'spicy', 'chaos'];
  const picks: ModifierCard[] = [];
  for (const d of ordered) {
    const card = pickFrom(buckets[d]);
    if (card) picks.push(card);
  }
  // Fall back to filling from any pool if some difficulty was empty.
  if (picks.length < 3) {
    const remaining = data.filter((m) => !picks.find((p) => p.id === m.id));
    while (picks.length < 3 && remaining.length > 0) {
      const next = remaining[(seed + picks.length) % remaining.length];
      picks.push(next as ModifierCard);
      remaining.splice(remaining.indexOf(next), 1);
    }
  }
  return picks;
}

export async function WowFactorStrip() {
  const cards = await loadCards();
  if (cards.length === 0) return null;

  return (
    <section className="relative overflow-hidden border-t border-border bg-surface">
      {/* Ambient warm wash so the cards don't sit flat on a single tone */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-12 h-[360px] w-[360px] rounded-full bg-gradient-to-br from-amber-200/40 via-orange-200/20 to-transparent blur-3xl" />
        <div className="absolute -right-24 bottom-12 h-[360px] w-[360px] rounded-full bg-gradient-to-tl from-rose-200/40 via-amber-100/25 to-transparent blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-content px-6 py-24 md:px-10 md:py-32">
        <div className="max-w-[44ch]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            The wow factor
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold leading-[1.05] tracking-[-0.02em] text-text md:text-5xl">
            Every plan ships with a{' '}
            <em className="font-display font-semibold not-italic text-accent" style={{ fontStyle: 'italic' }}>
              twist.
            </em>
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-secondary">
            One quiet ritual baked into every night — a phone-down rule, a one-word challenge, a story prompt — so the date stops being a checklist and starts being a memory.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-7 md:mt-16 md:grid-cols-3 md:gap-8">
          {cards.map((c) => (
            <TwistCard key={c.id} card={c} />
          ))}
        </div>
      </div>
    </section>
  );
}

function TwistCard({ card }: { card: ModifierCard }) {
  const tilt = tiltFor(card.id);
  const meta = DIFFICULTY_META[card.difficulty];
  return (
    <article
      className="relative rounded-[14px] border border-border bg-background p-7 shadow-[0_18px_36px_-22px_rgba(0,0,0,0.22)] transition-transform duration-300 hover:-translate-y-1 hover:rotate-0 md:p-8"
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      {/* Washi-tape strip — warm tape across the top to sell the index-card feel */}
      <span
        aria-hidden
        className="absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 rounded-[3px] bg-amber-200/85 shadow-[0_2px_4px_-1px_rgba(0,0,0,0.12)]"
        style={{ transform: 'translateX(-50%) rotate(-3deg)' }}
      />

      <div className="flex items-center justify-between gap-3">
        <span className={`inline-flex items-center rounded-pill px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ring-1 ${meta.tone}`}>
          {meta.label}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted">
          Twist
        </span>
      </div>

      <h3 className="mt-5 font-display text-2xl font-bold leading-tight tracking-[-0.01em] text-text">
        {card.label}
      </h3>
      <p className="mt-4 text-base leading-relaxed text-secondary">
        {card.body}
      </p>

      <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        Optional · skip if it&rsquo;s not your night
      </p>
    </article>
  );
}
