// One-beat "how After5 works" explainer (persistent: the loop is understood
// before it's live). Server component (static).
export function MechanicExplainer() {
  const beats = [
    { n: '1', t: 'Pick the night', d: 'We match you around a real Kelowna experience, not a profile.' },
    { n: '2', t: 'Match blind', d: 'Photos are blurred until you both say yes to the same night.' },
    { n: '3', t: 'Go out', d: 'Meet over something you already wanted to do. Less pressure, more spark.' },
  ];
  return (
    <section className="mt-14">
      <p className="mb-5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">How After5 works</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {beats.map((b) => (
          <div key={b.n} className="rounded-card border border-border bg-white/70 p-5">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{b.n}</span>
            <h3 className="mt-3 font-display text-base font-semibold text-text">{b.t}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-secondary">{b.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
