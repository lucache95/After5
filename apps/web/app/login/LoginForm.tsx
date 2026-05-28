'use client';

// Two-method sign in: Google OAuth (primary) + email magic link (fallback
// for users without a Google account). On success, both flows route through
// /auth/callback which redirects to ?next=... (defaults to /account).

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Avatar } from '@/components/Avatar';
import { cn } from '@/lib/cn';

export function LoginForm() {
  return (
    <Suspense fallback={null}>
      <LoginFormInner />
    </Suspense>
  );
}

function LoginFormInner() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/account';
  const callbackError = searchParams.get('error');
  const callbackReason = searchParams.get('reason');

  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [claimed, setClaimed] = useState<number | null>(null);
  const [recent, setRecent] = useState<{ first_name: string; city: string | null }[]>([]);
  // Resend cooldown — Supabase enforces a 60s gap between OTP sends to the
  // same email. Showing a countdown beats letting users mash the button and
  // hit a "rate limit exceeded" error (the bug Jocelyn reported on Apr 23).
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Live spots-remaining + recent signups for the early-access callout
  // and social-proof strip. Banner is hidden on /login — this page carries
  // the offer + proof inline at the highest-intent moment.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled || !data) return;
        if (typeof data.remaining === 'number') setRemaining(data.remaining);
        if (typeof data.claimed === 'number') setClaimed(data.claimed);
        if (Array.isArray(data.recent)) setRecent(data.recent);
      })
      .catch(() => { /* no-op */ });
    return () => { cancelled = true; };
  }, []);

  async function handleGoogle() {
    const supabase = createClient();
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setErrorMsg(error.message);
      setPhase('error');
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    if (cooldown > 0) return;
    setPhase('sending');
    setErrorMsg('');
    const supabase = createClient();
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      // Translate the most common Supabase auth error (rate limit) into
      // language a normal person can act on. The raw message reads like
      // a 500 error to non-technical users.
      const raw = error.message ?? '';
      const isRateLimit = /rate.?limit|over_email|too.?many|over_request/i.test(raw);
      setErrorMsg(
        isRateLimit
          ? 'You just requested a link a moment ago. Check your spam folder, or wait 60 seconds and try again.'
          : raw || 'Something went wrong. Please try again.',
      );
      setPhase('error');
      // Cooldown anyway — the user is likely about to mash the button.
      setCooldown(60);
    } else {
      setPhase('sent');
      setCooldown(60);
    }
  }

  // "Signed up this week" figure — for the social-proof row. Falls back
  // to the total claimed count so it reads reasonably from day one.
  const othersJoined = recent.length > 3 ? recent.length - 3 : (claimed && claimed > 3 ? claimed - 3 : 0);

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      {/* Ambient warm gradient — soft amber/rose pools in opposite corners.
          Gives the page atmosphere without fighting the card for attention. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-gradient-to-br from-amber-200/50 via-orange-200/30 to-transparent blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-[560px] w-[560px] rounded-full bg-gradient-to-tl from-rose-200/55 via-amber-100/30 to-transparent blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-[320px] w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/5 blur-3xl" />
      </div>

      <header className="relative z-10">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6 md:px-10">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight text-text">
            After5
          </Link>
          <Link
            href="/"
            className="text-[11px] font-medium uppercase tracking-[0.22em] text-secondary transition-colors hover:text-text"
          >
            ← Home
          </Link>
        </nav>
      </header>

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-96px)] max-w-5xl items-center justify-center px-6 pb-14 md:px-10">
        <div className="relative w-full max-w-[500px]">
          {/* Floating polaroid accent — upper-right of card, tilts just
              enough to feel like a friend tucked a memory into an envelope. */}
          <div className="pointer-events-none absolute -right-3 -top-10 z-20 hidden md:block">
            <div className="rotate-[6deg] rounded-[3px] bg-white px-2 pb-9 pt-2 shadow-[0_20px_48px_-12px_rgba(80,40,20,0.35)] ring-1 ring-black/5 transition-transform duration-500 hover:rotate-[2deg]">
              <Image
                src="/pins/couple-trail.jpg"
                alt=""
                width={124}
                height={124}
                className="h-[110px] w-[110px] object-cover"
              />
              <p className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap font-display text-[10px] font-medium tracking-[0.12em] text-text/70">
                KELOWNA · 26
              </p>
            </div>
          </div>

          <div className="animate-card-in relative rounded-[20px] border border-amber-100/80 bg-white/85 px-7 pb-9 pt-9 shadow-[0_32px_72px_-20px_rgba(194,85,43,0.22)] backdrop-blur-md md:px-10 md:pb-11 md:pt-11">
            {/* Early-access chip */}
            <div className="inline-flex items-center gap-2 rounded-pill bg-gradient-to-r from-amber-100 via-rose-100 to-amber-100 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-amber-950 ring-1 ring-amber-200/60">
              <span aria-hidden className="text-sm leading-none">★</span>
              <span>First 100 Kelowna users</span>
              {remaining !== null && remaining > 0 && (
                <span className="flex items-center gap-1.5 border-l border-amber-800/25 pl-2 [font-variant-numeric:tabular-nums]">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-600 animate-pulse" />
                  {remaining} left
                </span>
              )}
              {remaining === 0 && (
                <span className="flex items-center gap-1.5 border-l border-amber-800/25 pl-2">
                  Waitlist
                </span>
              )}
            </div>

            {callbackError && (
              <div className="mt-5 rounded-card border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-[13px] font-semibold text-red-900">Sign-in didn&apos;t go through</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-red-800">
                  {callbackReason ? `Reason: ${decodeURIComponent(callbackReason)}` : `Error code: ${callbackError}`}.
                  Try again, or use the email link below.
                </p>
              </div>
            )}

            <h1 className="mt-7 font-display text-[40px] font-bold leading-[1.02] tracking-[-0.03em] text-text md:text-[48px]">
              Good to{' '}
              <span className="italic font-semibold text-accent">see</span>
              {' '}you.
            </h1>
            <p className="mt-4 max-w-[400px] text-[15px] leading-relaxed text-secondary">
              Save plans, vote with friends, and skip the email gate next time you build a date.
            </p>

            {phase === 'sent' ? (
              <div className="mt-9 rounded-[14px] border border-emerald-200 bg-emerald-50/80 p-5">
                <p className="font-display text-base font-semibold text-emerald-900">
                  Check your inbox.
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-emerald-900/80">
                  We sent a sign-in link to <span className="font-medium text-emerald-900">{email}</span>. It expires in an hour.{' '}
                  <button
                    type="button"
                    onClick={() => setPhase('idle')}
                    className="underline decoration-emerald-700/40 underline-offset-[3px] transition-colors hover:decoration-emerald-900"
                  >
                    Use a different email
                  </button>
                  .
                </p>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleGoogle}
                  className="group mt-8 flex w-full items-center justify-center gap-3 rounded-pill border border-text/15 bg-white px-6 py-3.5 text-[15px] font-medium text-text transition-all hover:-translate-y-0.5 hover:border-text/30 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.15)]"
                >
                  <GoogleIcon />
                  <span>Continue with Google</span>
                </button>

                <div className="my-6 flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.24em] text-muted">
                  <span className="h-px flex-1 bg-gradient-to-r from-transparent to-border" />
                  or email
                  <span className="h-px flex-1 bg-gradient-to-l from-transparent to-border" />
                </div>

                <form onSubmit={handleMagicLink} className="space-y-3">
                  <label
                    htmlFor="login-email"
                    className="block text-[11px] font-medium uppercase tracking-[0.22em] text-secondary"
                  >
                    email
                  </label>
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="block w-full rounded-pill border border-text/15 bg-white/80 px-5 py-3.5 text-[15px] text-text outline-none transition-all placeholder:text-muted focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/15"
                    required
                  />
                  <button
                    type="submit"
                    disabled={phase === 'sending'}
                    className={cn(
                      'inline-flex w-full items-center justify-center gap-2 rounded-pill px-7 py-3.5 text-[15px] font-medium transition-all',
                      phase === 'sending'
                        ? 'bg-border text-muted cursor-not-allowed'
                        : 'bg-text text-background hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-10px_rgba(0,0,0,0.4)]',
                    )}
                  >
                    {phase === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
                  </button>
                </form>

                {errorMsg && (
                  <p className="mt-4 text-sm text-red-600">{errorMsg}</p>
                )}
              </>
            )}

            {/* Social-proof strip — real first-names + hashed-color avatars.
                Shown only when we have at least one recent signup. */}
            {recent.length > 0 && (
              <div className="mt-9 flex items-center gap-3 border-t border-amber-100/80 pt-5">
                <div className="flex -space-x-2">
                  {recent.slice(0, 3).map((r, i) => (
                    <Avatar
                      key={`${r.first_name}-${i}`}
                      name={r.first_name}
                      size="sm"
                      className="ring-2 ring-white"
                    />
                  ))}
                </div>
                <p className="text-[12px] leading-relaxed text-secondary">
                  <span className="font-medium text-text">
                    {recent.slice(0, 3).map((r) => r.first_name).join(', ')}
                  </span>
                  {othersJoined > 0 && (
                    <>
                      {' '}and{' '}
                      <span className="font-medium text-text [font-variant-numeric:tabular-nums]">
                        {othersJoined}+ others
                      </span>
                    </>
                  )}
                  {' '}joined recently.
                </p>
              </div>
            )}
          </div>

          <p className="mt-6 text-center text-[11px] leading-relaxed text-muted">
            By signing in you agree to our{' '}
            <Link
              href="/terms"
              className="underline decoration-border underline-offset-[3px] transition-colors hover:text-text hover:decoration-text"
            >
              terms
            </Link>
            {' '}and{' '}
            <Link
              href="/privacy"
              className="underline decoration-border underline-offset-[3px] transition-colors hover:text-text hover:decoration-text"
            >
              privacy policy
            </Link>
            .
          </p>
        </div>
      </div>

      <style jsx global>{`
        @keyframes card-in {
          from { opacity: 0; transform: translateY(14px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
        .animate-card-in {
          animation: card-in 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
        }
      `}</style>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}
