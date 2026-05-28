// Barbiecore card skeleton for the /feed swipe screen (Tier-1 shell shimmer).
// Skeletons over spinners (DESIGN-SYSTEM §7). Pure CSS shimmer — no JS, no motion
// lib needed at the route-loading boundary; respects reduced-motion via the
// `motion-reduce:animate-none` utilities so it settles to a static placeholder.
export default function FeedLoading() {
  return (
    <main className="min-h-dvh bg-shell-base px-5 py-8">
      <div className="mx-auto max-w-[420px]">
        <div className="mb-6 flex items-baseline justify-between">
          <div className="h-9 w-32 animate-pulse rounded-full bg-shell-ink/10 motion-reduce:animate-none" />
          <div className="h-4 w-16 animate-pulse rounded-full bg-shell-ink/10 motion-reduce:animate-none" />
        </div>

        <div className="relative aspect-[3/4.2] w-full">
          {/* peeking card behind */}
          <div
            className="absolute inset-x-3 top-3 bottom-0 rounded-3xl bg-white/50"
            aria-hidden
          />
          {/* top skeleton card */}
          <div className="absolute inset-0 overflow-hidden rounded-3xl bg-white shadow-fun">
            <div className="h-[56%] w-full animate-pulse bg-shell-ink/10 motion-reduce:animate-none" />
            <div className="space-y-3 p-5">
              <div className="h-7 w-3/4 animate-pulse rounded-full bg-shell-ink/10 motion-reduce:animate-none" />
              <div className="h-4 w-full animate-pulse rounded-full bg-shell-ink/10 motion-reduce:animate-none" />
              <div className="h-4 w-2/3 animate-pulse rounded-full bg-shell-ink/10 motion-reduce:animate-none" />
              <div className="flex gap-2 pt-2">
                <div className="h-7 w-20 animate-pulse rounded-full bg-shell-ink/10 motion-reduce:animate-none" />
                <div className="h-7 w-16 animate-pulse rounded-full bg-shell-ink/10 motion-reduce:animate-none" />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-7 flex items-center justify-center gap-5">
          <div className="h-16 w-16 animate-pulse rounded-full bg-shell-ink/10 motion-reduce:animate-none" />
          <div className="h-16 w-16 animate-pulse rounded-full bg-shell-ink/10 motion-reduce:animate-none" />
        </div>

        <p className="mt-6 text-center font-body text-sm text-shell-ink/50">loading the night…</p>
      </div>
    </main>
  );
}
