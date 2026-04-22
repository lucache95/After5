'use client';

// Unified share UI. One button, one sheet, three sections:
//   1. Quick share — native share / copy link / email / SMS
//   2. Vote with friends — creates a vote_session for the 3 plans (only
//      shown when caller passes itineraryIds with length >= 2)
//   3. Send to a friend on After5 — coming soon placeholder
//
// Replaces the prior split between ShareForVoteButton (results page) and
// the inline Share This Plan button (sticky aside on /dates/[slug]). One
// trigger anywhere on the site, one consistent sheet.

import { useEffect, useRef, useState } from 'react';
import {
  Share2,
  Check,
  Copy,
  Mail,
  MessageSquare,
  Users,
  X,
  UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/cn';

interface ShareSheetProps {
  /** Required — the canonical URL for "this single plan" share. */
  shareUrl: string;
  /** Required — readable title for native share + email subject. */
  title: string;
  /** Optional — short pitch for email/SMS body. */
  hook?: string;
  /** Optional — pass when there are sibling plans to vote on. Without this,
   *  the Vote section is hidden. */
  itineraryIds?: string[];
  /** Visual variant: subtle (default) renders as outlined pill; emphasis
   *  renders as filled dark pill. */
  variant?: 'subtle' | 'emphasis';
  /** Optional class extension for the trigger button. */
  className?: string;
  /** Label override for the trigger button. */
  label?: string;
}

export function ShareSheet({
  shareUrl,
  title,
  hook,
  itineraryIds,
  variant = 'subtle',
  className,
  label = 'Share',
}: ShareSheetProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-pill px-5 py-3 text-sm font-medium transition-all',
          variant === 'emphasis'
            ? 'bg-text text-background hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-10px_rgba(0,0,0,0.4)]'
            : 'border border-border bg-background text-text hover:border-text/40',
          className,
        )}
      >
        <Share2 className="h-4 w-4" strokeWidth={2} />
        {label}
      </button>

      {open && (
        <ShareSheetModal
          onClose={() => setOpen(false)}
          shareUrl={shareUrl}
          title={title}
          hook={hook}
          itineraryIds={itineraryIds}
        />
      )}
    </>
  );
}

function ShareSheetModal({
  onClose,
  shareUrl,
  title,
  hook,
  itineraryIds,
}: {
  onClose: () => void;
  shareUrl: string;
  title: string;
  hook?: string;
  itineraryIds?: string[];
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape + body scroll lock.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const subject = title;
  const body = `${hook ? hook + '\n\n' : ''}${shareUrl}`;
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const sms = `sms:?&body=${encodeURIComponent(`${subject} — ${shareUrl}`)}`;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center md:items-center"
      role="dialog"
      aria-modal="true"
    >
      {/* Dedicated backdrop — handles click-outside-to-close. Separate from
          the panel so the panel never has to play stopPropagation games. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-sm"
      />

      <div
        ref={sheetRef}
        className="relative w-full max-h-[92vh] overflow-y-auto rounded-t-[20px] border-t border-border bg-background pb-8 pt-6 shadow-[0_-24px_64px_-20px_rgba(0,0,0,0.35)] md:max-w-[520px] md:rounded-[20px] md:border md:pb-7"
        style={{ animation: 'sheetIn .3s cubic-bezier(0.2, 0.8, 0.2, 1)' }}
      >
        {/* Mobile drag handle */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border md:hidden" aria-hidden />

        <div className="flex items-start justify-between px-7 pb-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
              Share this plan
            </p>
            <h2 className="mt-1.5 font-display text-xl font-bold leading-tight text-text">
              How would you like to send it?
            </h2>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close"
            className="relative z-10 -mr-1 -mt-1 inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-text active:bg-surface"
          >
            <X className="pointer-events-none h-5 w-5" strokeWidth={2.25} />
          </button>
        </div>

        <div className="space-y-5 px-7 pt-5">
          <QuickShareSection shareUrl={shareUrl} mailto={mailto} sms={sms} title={title} hook={hook} />

          {itineraryIds && itineraryIds.length >= 2 && (
            <VoteSection itineraryIds={itineraryIds} />
          )}

          <FriendSection />
        </div>
      </div>

      <style jsx global>{`
        @keyframes sheetIn {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @media (min-width: 768px) {
          @keyframes sheetIn {
            from { transform: translateY(12px) scale(0.98); opacity: 0; }
            to   { transform: translateY(0) scale(1);       opacity: 1; }
          }
        }
      `}</style>
    </div>
  );
}

// ─── Quick share section (link + native + email + sms) ──────────────

function QuickShareSection({
  shareUrl,
  mailto,
  sms,
  title,
  hook,
}: {
  shareUrl: string;
  mailto: string;
  sms: string;
  title: string;
  hook?: string;
}) {
  const [copied, setCopied] = useState(false);
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, text: hook ?? title, url: shareUrl });
    } catch {
      /* user dismissed */
    }
  }

  return (
    <section>
      <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        Quick share
      </p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <ShareTile
          icon={<Copy className="h-4 w-4" strokeWidth={2} />}
          label={copied ? 'Copied' : 'Copy link'}
          onClick={copyLink}
          highlight={copied}
        />
        {canNativeShare && (
          <ShareTile
            icon={<Share2 className="h-4 w-4" strokeWidth={2} />}
            label="Share"
            onClick={nativeShare}
          />
        )}
        <ShareTile
          as="a"
          href={mailto}
          icon={<Mail className="h-4 w-4" strokeWidth={2} />}
          label="Email"
        />
        <ShareTile
          as="a"
          href={sms}
          icon={<MessageSquare className="h-4 w-4" strokeWidth={2} />}
          label="SMS"
        />
      </div>
      <p className="mt-3 break-all rounded-card border border-border bg-surface px-3 py-2 text-[11px] text-muted">
        {shareUrl}
      </p>
    </section>
  );
}

// ─── Vote section ─────────────────────────────────────────────────────

function VoteSection({ itineraryIds }: { itineraryIds: string[] }) {
  const [state, setState] = useState<'idle' | 'creating' | 'ready' | 'error'>('idle');
  const [voteUrl, setVoteUrl] = useState('');
  const [copied, setCopied] = useState(false);

  async function create() {
    if (state === 'creating') return;
    setState('creating');
    try {
      const res = await fetch('/api/vote-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itinerary_ids: itineraryIds }),
      });
      if (!res.ok) throw new Error('create failed');
      const data = (await res.json()) as { id?: string };
      if (!data.id) throw new Error('no id returned');
      const url = `${window.location.origin}/vote/${data.id}`;
      setVoteUrl(url);
      setState('ready');
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* clipboard blocked */
      }
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 2500);
    }
  }

  async function copyAgain() {
    try {
      await navigator.clipboard.writeText(voteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <section className="border-t border-border pt-5">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        Vote with friends
      </p>
      <p className="mb-3 text-[13px] leading-relaxed text-secondary">
        Send all 3 plans to your group — they tap their favorite. You see the winner.
      </p>
      {state === 'ready' ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={copyAgain}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-pill border px-5 py-3 text-sm font-medium transition-colors',
              copied
                ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                : 'border-border bg-background text-text hover:border-text/40',
            )}
          >
            {copied ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Copy className="h-4 w-4" strokeWidth={2} />}
            {copied ? 'Vote link copied' : 'Copy vote link again'}
          </button>
          <p className="break-all rounded-card border border-border bg-surface px-3 py-2 text-[11px] text-muted">
            {voteUrl}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={create}
          disabled={state === 'creating'}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-pill px-5 py-3 text-sm font-medium transition-all',
            state === 'creating'
              ? 'bg-border text-muted cursor-wait'
              : 'bg-text text-background hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-10px_rgba(0,0,0,0.4)]',
          )}
        >
          <Users className="h-4 w-4" strokeWidth={2} />
          {state === 'creating' ? 'Creating vote link…' : 'Create a vote link'}
        </button>
      )}
      {state === 'error' && (
        <p className="mt-2 text-xs text-red-600">Couldn&apos;t create the vote link. Try again.</p>
      )}
    </section>
  );
}

// ─── Friends-on-After5 section (placeholder for v2) ──────────────────

function FriendSection() {
  return (
    <section className="border-t border-border pt-5">
      <div className="rounded-card border border-dashed border-border bg-surface/60 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-900">
            <UserPlus className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">
              Send to a friend on After5
              <span className="ml-2 rounded-pill bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                Coming soon
              </span>
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-secondary">
              Add friends from your account, send a plan, they get a notification.
              Building this next.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Tile primitive ───────────────────────────────────────────────────

type ShareTileBaseProps = {
  icon: React.ReactNode;
  label: string;
  highlight?: boolean;
};

function ShareTile(
  props:
    | (ShareTileBaseProps & { as?: 'button'; onClick: () => void })
    | (ShareTileBaseProps & { as: 'a'; href: string; onClick?: never }),
) {
  const cls = cn(
    'flex flex-col items-center justify-center gap-1.5 rounded-card border px-3 py-3.5 text-[12px] font-medium transition-all',
    props.highlight
      ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
      : 'border-border bg-background text-text hover:border-text/40 hover:-translate-y-0.5',
  );

  if (props.as === 'a') {
    return (
      <a href={props.href} className={cls}>
        {props.icon}
        <span>{props.label}</span>
      </a>
    );
  }
  return (
    <button type="button" onClick={props.onClick} className={cls}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}
