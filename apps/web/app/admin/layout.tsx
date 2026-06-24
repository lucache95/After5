// Lightweight admin shell — sticky top bar with section nav, cream canvas.
// Each child page still calls requireAdmin() for the actual auth check.

import Link from 'next/link';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between gap-6 px-6 py-3 md:px-10">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="font-display text-base font-semibold tracking-tight text-text"
            >
              After5
            </Link>
            <span className="rounded-pill bg-text px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-background">
              Curator
            </span>
          </div>
          <ul className="flex items-center gap-1 text-sm">
            <NavItem href="/admin/waitlist" label="Waitlist" />
            <NavItem href="/admin/venues" label="Venues" />
            <NavItem href="/admin/places" label="Places" />
            <NavItem href="/admin/dates" label="Dates" />
            <NavItem href="/admin/feedback" label="Inbox" />
            <NavItem href="/admin/insiders" label="Insiders" />
            <NavItem href="/admin/eval" label="Eval" />
            <NavItem href="/admin/alerts" label="Alerts" />
            <NavItem href="/admin/reports" label="Reports" />
          </ul>
        </nav>
      </header>
      {children}
    </div>
  );
}

function NavItem({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="rounded-pill px-3 py-1.5 font-medium text-secondary transition-colors hover:bg-surface hover:text-text"
      >
        {label}
      </Link>
    </li>
  );
}
