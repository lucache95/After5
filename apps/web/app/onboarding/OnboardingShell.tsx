'use client';
// Tier-1 shell (DESIGN-SYSTEM §1): warm-cream canvas, deep-plum ink, hot-pink as
// punctuation. Centers the wizard in a phone-width column; the lowercase Caprasimo
// wordmark is the only place pink lives in the chrome.
import Link from 'next/link';
import { ProgressBar } from './ProgressBar';

export function OnboardingShell({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="border-b border-shell-ink/10 bg-shell-base/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-[420px] items-center justify-between px-5 py-4">
          <Link
            href="/"
            className="font-heading text-2xl lowercase tracking-tight text-shell-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 rounded-full"
          >
            after5
          </Link>
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
