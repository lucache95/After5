'use client';
// Tier-1 shell (DESIGN-SYSTEM §1): warm-cream canvas, deep-plum ink, hot-pink as
// punctuation. Centers the wizard in a phone-width column; the lowercase Caprasimo
// wordmark is the only place pink lives in the chrome.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProgressBar } from './ProgressBar';
import { ONBOARDING_STEPS, STEP_ROUTE } from '@/lib/onboarding/steps';

// 1-based step index → route, derived from the canonical step list so this never
// drifts from STEP_ROUTE. Step 1 = 'age_gate', step 2 = 'basics', etc.
// Index 0 is a placeholder (steps are 1-based).
const STEP_ROUTES_BY_INDEX: string[] = [
  '',
  ...ONBOARDING_STEPS.map((s) => STEP_ROUTE[s]),
];

export function OnboardingShell({ step, children }: { step: number; children: React.ReactNode }) {
  const router = useRouter();
  const prevRoute = step > 1 ? STEP_ROUTES_BY_INDEX[step - 1] : null;

  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="border-b border-shell-ink/10 bg-shell-base/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-[420px] items-center justify-between px-5 py-4">
          {prevRoute ? (
            <button
              type="button"
              aria-label="back"
              onClick={() => router.push(prevRoute)}
              className="flex min-h-[44px] min-w-[44px] items-center gap-1 rounded-full px-2 font-body text-sm lowercase text-shell-ink/60 transition-colors hover:text-shell-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40"
            >
              ← back
            </button>
          ) : (
            <Link
              href="/"
              className="font-heading text-2xl lowercase tracking-tight text-shell-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 rounded-full"
            >
              after5
            </Link>
          )}
          {/* Let someone bail out of onboarding without being trapped signed-in.
              Plain server-action form → POST /auth/signout (signs out + redirects to /). */}
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="font-body text-sm lowercase text-shell-ink/60 transition-colors hover:text-shell-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 rounded-full px-2 py-1"
            >
              log out
            </button>
          </form>
        </nav>
      </header>
      <div className="mx-auto max-w-[420px] px-5 pb-24 pt-8">
        <ProgressBar current={step} />
        <div className="mt-7 rounded-3xl bg-white/70 p-6 shadow-fun backdrop-blur-md">
          {children}
        </div>
      </div>
    </main>
  );
}
