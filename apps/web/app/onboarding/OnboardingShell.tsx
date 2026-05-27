'use client';
import Link from 'next/link';
import { ProgressBar } from './ProgressBar';

export function OnboardingShell({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4 md:px-10">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight text-text">After5</Link>
        </nav>
      </header>
      <div className="mx-auto max-w-xl px-6 pb-24 pt-10 md:pt-14">
        <ProgressBar current={step} />
        <div className="mt-8 rounded-card border border-border bg-white/70 p-6 shadow-subtle backdrop-blur-md md:p-8">
          {children}
        </div>
      </div>
    </main>
  );
}
