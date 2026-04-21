// "Meet your curators" card — the After5 Kelowna team puts a human face
// on the otherwise faceless plan. Lives in the sticky right rail
// alongside the actions.
//
// Specifics build trust: a count of plans curated, a one-line ethos,
// and a link to learn more. No fake hostess avatars.

import Link from 'next/link';

export function CuratorCard() {
  return (
    <div className="rounded-[16px] border border-border bg-surface p-5 md:p-6">
      <div className="flex items-start gap-3">
        {/* Stacked initials avatars — three Kelowna locals */}
        <div className="flex -space-x-2 shrink-0">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-rose-500 text-sm font-semibold text-white ring-2 ring-surface">L</span>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-500 text-sm font-semibold text-white ring-2 ring-surface">A</span>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-sm font-semibold text-white ring-2 ring-surface">M</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-semibold text-text">
            Curated by After5
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-secondary">
            3 Kelownans who've actually done every stop. We don't list it unless we'd send our friends.
          </p>
        </div>
      </div>

      <Link
        href="/about"
        className="mt-4 inline-flex w-full items-center justify-center rounded-pill border border-border bg-background px-5 py-2 text-xs font-medium text-text transition-colors hover:border-text/40"
      >
        Meet the team →
      </Link>
    </div>
  );
}
