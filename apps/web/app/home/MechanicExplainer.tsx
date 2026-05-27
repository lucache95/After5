// One-beat "how After5 works" explainer (persistent: the loop is understood
// before it's live). Server component (static).
export function MechanicExplainer() {
  const beats = [
    { n: '1', t: 'pick the night', d: 'you match around a real experience, not a profile.' },
    { n: '2', t: 'match blind', d: 'photos stay blurred until you both say yes to the same night.' },
    { n: '3', t: 'go out', d: 'meet over something you already wanted to do. less pressure, more spark.' },
  ];
  return (
    <section className="mt-14">
      <h2 className="mb-4 font-heading text-2xl lowercase text-shell-ink">how it works</h2>
      <ol className="grid grid-cols-1 gap-3">
        {beats.map((b) => (
          <li key={b.n} className="flex items-start gap-4 rounded-3xl bg-white p-5 shadow-fun ring-1 ring-shell-ink/5">
            <span aria-hidden className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-shell-accent font-heading text-base text-white">{b.n}</span>
            <div className="min-w-0">
              <h3 className="font-heading text-lg lowercase leading-none text-shell-ink">{b.t}</h3>
              <p className="mt-1.5 font-body text-[13px] leading-relaxed text-shell-ink/65">{b.d}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
