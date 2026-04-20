import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-content flex-col justify-center px-6 py-32 md:px-10">
      <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">404</p>
      <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
        That page is somewhere else.
      </h1>
      <p className="mt-6 max-w-prose text-base text-secondary">
        It moved, was renamed, or never existed. Either way — back to start.
      </p>
      <Link
        href="/"
        className="mt-12 inline-flex w-fit items-center gap-2 rounded-pill bg-primary px-7 py-3.5 text-base font-medium text-background transition-opacity hover:opacity-85"
      >
        Go home
      </Link>
    </main>
  );
}
