// Shared route-level loading boundary (loading.tsx body). Server-safe: it only
// composes two client components (HeartLoader, BottomTabShell), so each route's
// loading.tsx stays a 3-liner. `tabs` keeps the bottom bar visually persistent
// during a tab swap — no userId, so the badge appears once the real page lands.
import { HeartLoader } from '@/components/HeartLoader';
import { BottomTabShell } from '@/components/BottomTabShell';

export function RouteLoading({ tabs = false }: { tabs?: boolean }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-shell-base">
      <HeartLoader size={40} />
      {tabs && <BottomTabShell />}
    </main>
  );
}
