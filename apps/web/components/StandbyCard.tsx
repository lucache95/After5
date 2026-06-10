// apps/web/components/StandbyCard.tsx
// Client leaf (E24 / REQ-E24): ONE compact row for one of the candidate's plain
// `interested` queue rows. Mounted by /inbox StandbyList. The row shows the
// NIGHT itself — cover thumb, title, a countdown to starts_at (the de-facto
// expiry: nights leave the feed once it passes, so the countdown reads as
// urgency), and the queue position — and the whole row taps open into the
// blind-safe NightDetailSheet in read-only mode (no skip / i'm-in bar; the
// viewer is already in line). `pull my interest` stays, demoted to a small
// inline secondary action behind the same vaul confirm → the withdraw_interest
// DEFINER RPC.
//
// Tier-1 SHELL surface (warm-cream / shell.* tokens) — this is app chrome, NOT a
// per-vibe experience surface (UI-SPEC §E24 / DESIGN-SYSTEM §1). The position
// line makes NO auto-promotion promise (promotion logic is deferred).
//
// BLIND CONTRACT (T-07-16): everything shown here (title / cover / hour-trunc
// starts_at / vibe) comes from get_night_detail's blind-safe projection — no
// host name, photo, or identifying field exists on the entry. A null title AND
// starts_at means the night is no longer readable (expired/cancelled); the row
// degrades to the identity-free fallback label with only the pull action.
//
// The UI gate is convenience only: withdraw_interest re-checks p_actor =
// auth.uid() server-side and deletes ONLY the actor's own interested row.
'use client';
import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Drawer } from 'vaul';
import { toast } from 'sonner';
import { browserAfter5Client, withdrawInterest, type FeedNight } from '@/lib/after5/client';
import { NightDetailSheet } from '@/app/feed/NightDetailSheet';
import { LocalTime } from '@/components/LocalTime';
import { nightCountdown } from '@/lib/countdown';
import { coverImageForNight } from '@/lib/place-image';

/** One of the candidate's own pending-interest queue rows, plus the blind-safe
 *  night summary StandbyList read for it via get_night_detail. */
export interface StandbyEntry {
  /** date_instances.id — the night this interest is on. */
  instance_id: string;
  /** creator-assigned rank; null until shortlisted. */
  rank: number | null;
  /** queue lifecycle status (always 'interested' on the standby surface). */
  status: string;
  /** the night's title (itinerary title — blind-safe, carries no host identity).
   *  null when get_night_detail can no longer read the night (expired/cancelled). */
  title: string | null;
  /** hour-truncated starts_at (get_night_detail's time_window_start). */
  starts_at: string | null;
  /** blind-safe cover, for the row thumb + sheet hero fallback. */
  cover_image_url: string | null;
  vibe_tags: string[] | null;
}

// Map a withdraw RPC error to dry, specific candidate copy. The RPC raises with a
// PG errcode (.code) + short message (.message); fall back to a generic line. No
// filler, no adverbs (stop-slop).
function errorCopy(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  switch (e?.code) {
    case 'P0002':
      return "that night's gone.";
    case 'P0001':
      // already off the list, or nothing to pull — the RPC message is specific.
      return "you're already off this one.";
    default:
      return "that didn't go through. try again?";
  }
}

function positionLine(rank: number | null): string {
  if (rank === 1) return "you're next in line";
  if (rank != null && rank > 1) return `you're #${rank} in line`;
  // no rank yet (not shortlisted) — still soft, no promise.
  return "you're in line";
}

export function StandbyCard({ entry }: { entry: StandbyEntry }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // null title AND starts_at ⇒ get_night_detail returned nothing — the night
  // expired or was pulled since. Nothing left to open; the row keeps only the
  // identity-free fallback label and the pull action.
  const readable = entry.title != null || entry.starts_at != null;
  const title = entry.title?.toLowerCase() ?? 'a night you slid in on';

  // Same resolver the feed card uses — never '' (next/image-safe).
  const cover = coverImageForNight({
    cover_image_url: entry.cover_image_url,
    vibe_tags: entry.vibe_tags,
    seedKey: entry.instance_id,
  });

  // Blind FeedNight summary for the sheet's instant fallback; on open the sheet
  // re-fetches get_night_detail(p_instance) itself for the full plan. Host-hint
  // and distance slots stay null — this surface never holds identity data.
  const night: FeedNight = {
    date_instance_id: entry.instance_id,
    city_id: '',
    time_window_start: entry.starts_at ?? '',
    pay_setting: null,
    vibe_tags: entry.vibe_tags,
    why_note: null,
    cover_image_url: entry.cover_image_url,
    title: entry.title,
    venue_neighborhood: null,
    is_seed: false,
    distance_m: null,
    ambient_sound_path: null,
    ambient_sound_name: null,
    fit: false,
    host_blurred_photo_url: null,
    host_first_name: null,
    host_age: null,
    city_name: null,
  };

  async function doWithdraw() {
    if (busy) return;
    setBusy(true);
    try {
      await withdrawInterest(browserAfter5Client(), { instance_id: entry.instance_id });
      toast.success("pulled. you're off this one.");
      setConfirmOpen(false);
      router.refresh();
    } catch (err) {
      console.error('[StandbyCard] withdraw failed', err);
      toast.error(errorCopy(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <article className="relative flex items-center gap-3 rounded-3xl bg-shell-ink/5 p-3 shadow-warm">
        <span className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-shell-pink">
          <Image src={cover} alt="" fill sizes="56px" className="object-cover" draggable={false} />
        </span>

        {/* main tap target — stretched over the whole row (after:inset-0) so the
            card itself opens the night detail; ≥44px via the row's own height. */}
        <button
          type="button"
          disabled={!readable}
          onClick={() => setDetailOpen(true)}
          className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:rounded-3xl focus-visible:outline-none focus-visible:after:ring-4 focus-visible:after:ring-shell-accent/40 disabled:cursor-default"
        >
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-heading text-lg lowercase leading-tight text-shell-ink">
              {title}
            </span>
            {entry.starts_at && (
              <LocalTime
                iso={entry.starts_at}
                format={(d) => nightCountdown(d)}
                fallback=""
                className="shrink-0 font-body text-[11px] font-bold lowercase text-shell-accent"
              />
            )}
          </span>
          <span className="mt-0.5 block truncate font-body text-sm text-shell-ink/60">
            {readable ? positionLine(entry.rank) : "this night's gone"}
          </span>
        </button>

        {/* demoted withdraw — small inline text; relative+z lifts it above the
            stretched tap target, -my keeps the 44px hit area from inflating the row. */}
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="relative z-10 -my-2 flex min-h-[44px] shrink-0 items-center px-1 font-body text-xs font-semibold lowercase text-shell-ink/55 underline decoration-shell-ink/25 underline-offset-2 transition hover:text-shell-ink/80 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none"
        >
          pull my interest
        </button>
      </article>

      {/* read-only reuse of the feed's blind-safe detail sheet (no onCommit — the
          viewer already slid in, so no skip / i'm-in bar). */}
      {readable && (
        <NightDetailSheet night={night} open={detailOpen} onOpenChange={setDetailOpen} />
      )}

      <Drawer.Root open={confirmOpen} onOpenChange={(o) => { if (!o) setConfirmOpen(false); }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[420px] rounded-t-3xl bg-shell-base px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3 outline-none">
            <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-shell-ink/20" />
            <Drawer.Title className="font-heading text-3xl lowercase text-shell-ink">
              pull your interest?
            </Drawer.Title>
            <Drawer.Description className="mt-1 font-body text-sm text-shell-ink/70">
              you&apos;ll drop off this night&apos;s list. you can always slide back in later.
            </Drawer.Description>

            <button
              type="button"
              disabled={busy}
              onClick={() => void doWithdraw()}
              className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-full border-2 border-shell-ink/20 font-body font-semibold lowercase text-shell-ink/70 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-50"
            >
              {busy ? 'pulling…' : 'yep, pull it'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-full font-body lowercase text-shell-ink/70 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/30"
            >
              never mind
            </button>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
