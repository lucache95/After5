'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { BottomTabShell } from '@/components/BottomTabShell';
import { motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { Sparkles, Pause, Play, ChevronDown } from 'lucide-react';
import {
  browserAfter5Client, postNight, reachPreview, updateItineraryStops, ambientSoundUrl, type AmbientSound,
} from '@/lib/after5/client';
import { stickerRotation } from '@/lib/sticker';
import { cn } from '@/lib/cn';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

// Tier-1 shell surface (DESIGN-SYSTEM §1): Barbiecore pink chrome.
// Creator flow — pick a plan, set a time, post it. People nearby can slide in; you choose who.

interface Plan {
  id: string;
  title: string | null;
  cover_image_url: string | null;
  vibe_tags: string[] | null;
  // Picker meta + inline preview, straight off the itineraries row (stops is a
  // JSON column there). Optional so a thinner row degrades to title-only.
  stops?: unknown;
  total_cost_pp?: number | null;
  total_duration_min?: number | null;
}

// How many plans show before the "show all N plans" expander. Six keeps the
// picker one comfortable screen at 420px instead of a radio wall.
const PLANS_FOLD = 6;

interface PlanStopLine {
  name: string;
  time: string | null;
}

// Defensive parse of the stops JSON column. Stops written by the planner carry
// place_name + start_time; anything malformed falls back quietly.
function parsePlanStops(raw: unknown): PlanStopLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s, i) => {
    if (typeof s !== 'object' || s === null) return [];
    const o = s as Record<string, unknown>;
    const name =
      typeof o.place_name === 'string' && o.place_name.trim() !== ''
        ? o.place_name
        : `stop ${i + 1}`;
    const time = typeof o.start_time === 'string' && o.start_time !== '' ? o.start_time : null;
    return [{ name, time }];
  });
}

// The card meta line: `3 stops · ~2.5 hr · $45 pp`. Missing fields drop their
// segment; an itinerary with nothing derivable renders no line at all.
function planMetaLine(plan: Plan, stopCount: number): string | null {
  const parts: string[] = [];
  if (stopCount > 0) parts.push(`${stopCount} ${stopCount === 1 ? 'stop' : 'stops'}`);
  if (plan.total_duration_min != null && plan.total_duration_min > 0) {
    parts.push(`~${Math.round((plan.total_duration_min / 60) * 10) / 10} hr`);
  }
  if (plan.total_cost_pp != null) parts.push(`$${Math.round(plan.total_cost_pp)} pp`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ISO string for the datetime-local min attribute (now, rounded to the minute)
function nowMin(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  // datetime-local format: YYYY-MM-DDTHH:mm
  return d.toISOString().slice(0, 16);
}

// E11 creator-control option sets.
const PAY_OPTIONS: { id: string; label: string }[] = [
  { id: 'i_pay', label: 'i pay' },
  { id: 'they_pay', label: 'they pay' },
  { id: 'split', label: 'split' },
];
const GENDER_OPTIONS: { id: string; label: string }[] = [
  { id: 'women', label: 'women' },
  { id: 'men', label: 'men' },
  { id: 'nonbinary', label: 'nonbinary' },
  { id: 'everyone', label: 'everyone' },
];

export function PostNightForm({
  plans,
  ambientSounds = [],
  itineraryId,
  primaryCityId = null,
  cityName = null,
  userId,
}: {
  plans: Plan[];
  ambientSounds?: AmbientSound[];
  /** Tier-1 bottom nav (standing rule: every in-app surface keeps the bottom menu). */
  userId?: string;
  // E11: when the host arrives from the Door-2 publish CTA (/nights/new?itinerary=)
  // the canvas plan is pre-selected.
  itineraryId?: string;
  // E10/D-01: the host's home city scopes the reach-preview count. null = unknown
  // (no city on the profile), in which case the reach line stays quiet.
  primaryCityId?: string | null;
  cityName?: string | null;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(
    () => (itineraryId && plans.some((p) => p.id === itineraryId) ? itineraryId : ''),
  );
  const [startsAt, setStartsAt] = useState('');

  // ── Fold: first PLANS_FOLD plans, then a one-way "show all" expander. A
  // ?itinerary= preselect that lands beyond the fold auto-expands so the
  // selected card is always visible.
  const [showAllPlans, setShowAllPlans] = useState(() => {
    if (!itineraryId) return false;
    return plans.findIndex((p) => p.id === itineraryId) >= PLANS_FOLD;
  });
  const visiblePlans = showAllPlans ? plans : plans.slice(0, PLANS_FOLD);

  // ── E11 creator controls ──────────────────────────────────────────────────
  // Targeting defaults are inclusive + overridable (never reads as exclusion):
  // open to everyone, age unbounded, radius = city default (left blank = server default).
  const [paySetting, setPaySetting] = useState('split');
  const [genders, setGenders] = useState<string[]>(['everyone']);
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [radiusKm, setRadiusKm] = useState('');
  const [whyNote, setWhyNote] = useState('');

  // ── E10/D-01 reach preview ────────────────────────────────────────────────
  // A quiet, encouraging count of who the current targeting reaches in the host's
  // city. Debounced as the host edits gender/age/radius. Never gates the publish
  // CTA (D-01: keep the feed liquid). null reach = idle (nothing computed yet).
  const [reach, setReach] = useState<number | null>(null);
  const [reachLoading, setReachLoading] = useState(false);

  useEffect(() => {
    // No city on the profile → no scope to count against; stay quiet.
    if (!primaryCityId) return;

    // {everyone} normalization (defense-in-depth; the RPC also normalizes): the
    // open case must send empty/omitted target_genders so an open night counts
    // everyone instead of undercounting to ~0 on the literal 'everyone' value.
    const open = genders.length === 0 || genders.includes('everyone');
    const targetGenders = open ? [] : genders;

    const min = ageMin.trim() === '' ? null : Number(ageMin);
    const max = ageMax.trim() === '' ? null : Number(ageMax);
    const ageRange = min != null || max != null ? `[${min ?? 18},${max ?? 100}]` : undefined;
    const radius = radiusKm.trim() === '' ? undefined : Number(radiusKm);

    let cancelled = false;
    setReachLoading(true);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const n = await reachPreview(browserAfter5Client(), {
            target_genders: targetGenders,
            target_age_range: ageRange,
            city: primaryCityId,
            radius_km: radius,
          });
          if (!cancelled) setReach(n);
        } catch {
          // the reach line is a non-essential nudge; a failure leaves it quiet
          // and never blocks posting.
          if (!cancelled) setReach(null);
        } finally {
          if (!cancelled) setReachLoading(false);
        }
      })();
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [genders, ageMin, ageMax, radiusKm, primaryCityId]);

  // The four reach copy states (04-UI-SPEC §Copywriting). Encouraging, never a
  // warning, no em-dash (stop-slop). A low count is framed positively.
  const where = cityName?.trim().toLowerCase() || 'your city';
  let reachLine: string | null = null;
  if (primaryCityId) {
    if (reachLoading && reach === null) {
      reachLine = 'counting who’s around…';
    } else if (reach === 0) {
      reachLine = `no one fits this yet in ${where}. loosen the targeting and they’ll show up.`;
    } else if (reach !== null && reach <= 5) {
      reachLine = `~${reach} match this in ${where}. a focused crowd, widen anytime.`;
    } else if (reach !== null) {
      reachLine = `~${reach} people match this in ${where}`;
    }
  }

  // who-pays radiogroup roving-tabindex.
  const payRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const paySelectedIndex = Math.max(0, PAY_OPTIONS.findIndex((o) => o.id === paySetting));
  function focusPay(index: number) {
    const count = PAY_OPTIONS.length;
    const wrapped = ((index % count) + count) % count;
    setPaySetting(PAY_OPTIONS[wrapped]!.id);
    requestAnimationFrame(() => { payRefs.current[wrapped]?.focus(); });
  }
  function handlePayKeyDown(index: number, e: React.KeyboardEvent<HTMLButtonElement>) {
    switch (e.key) {
      case 'ArrowDown': case 'ArrowRight': e.preventDefault(); focusPay(index + 1); break;
      case 'ArrowUp': case 'ArrowLeft': e.preventDefault(); focusPay(index - 1); break;
      case 'Home': e.preventDefault(); focusPay(0); break;
      case 'End': e.preventDefault(); focusPay(PAY_OPTIONS.length - 1); break;
      default: break;
    }
  }

  // target-gender multi-select. Picking "everyone" clears the others; picking a
  // specific gender drops "everyone". Empty selection falls back to everyone.
  function toggleGender(id: string) {
    setGenders((prev) => {
      if (id === 'everyone') return ['everyone'];
      const without = prev.filter((g) => g !== 'everyone');
      const next = without.includes(id) ? without.filter((g) => g !== id) : [...without, id];
      return next.length === 0 ? ['everyone'] : next;
    });
  }
  const [phase, setPhase] = useState<'idle' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const reduceMotion = useReducedMotion();

  // '' = no preference (the default → server applies the vibe-auto fallback).
  const [ambientId, setAmbientId] = useState('');
  // Which sound is currently previewing (null = none). One shared <audio>.
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  function stopPreview() {
    const el = previewRef.current;
    if (el) { el.pause(); }
    setPreviewingId(null);
  }

  function togglePreview(id: string, path: string) {
    const url = ambientSoundUrl(path, SUPABASE_URL);
    if (!url) return;
    if (previewingId === id) { stopPreview(); return; }
    let el = previewRef.current;
    if (!el) { el = new Audio(); previewRef.current = el; el.addEventListener('ended', () => setPreviewingId(null)); }
    el.pause();
    el.src = url;
    el.currentTime = 0;
    void el.play().catch(() => { /* 404 before assets land → no-op */ });
    setPreviewingId(id);
  }

  // Stop preview on unmount.
  useEffect(() => () => { previewRef.current?.pause(); }, []);

  // Soundtrack radiogroup options: "no preference" first, then each sound.
  const ambientOptions: { id: string; label: string }[] = [
    { id: '', label: 'no preference' },
    ...ambientSounds.map((s) => ({ id: s.id, label: s.name })),
  ];
  const ambientRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const ambientSelectedIndex = Math.max(0, ambientOptions.findIndex((o) => o.id === ambientId));

  function focusAmbient(index: number) {
    const count = ambientOptions.length;
    if (count === 0) return;
    const wrapped = ((index % count) + count) % count;
    const opt = ambientOptions[wrapped];
    if (!opt) return;
    setAmbientId(opt.id);
    requestAnimationFrame(() => { ambientRefs.current[wrapped]?.focus(); });
  }

  function handleAmbientKeyDown(index: number, e: React.KeyboardEvent<HTMLButtonElement>) {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault(); focusAmbient(index + 1); break;
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault(); focusAmbient(index - 1); break;
      case 'Home':
        e.preventDefault(); focusAmbient(0); break;
      case 'End':
        e.preventDefault(); focusAmbient(ambientOptions.length - 1); break;
      default: break;
    }
  }

  // Roving-tabindex refs for the radiogroup. Only one radio is in the tab
  // order at a time (the selected one, or the first if none selected — per
  // WAI-ARIA Authoring Practices); arrow keys move both focus and selection
  // together (select-follows-focus is the standard pattern for radios).
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = visiblePlans.findIndex((p) => p.id === selectedId);
  // If nothing is selected, the first radio holds the tabstop.
  const tabStopIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function setRadioRef(index: number, el: HTMLButtonElement | null) {
    radioRefs.current[index] = el;
  }

  function focusRadio(index: number) {
    const count = visiblePlans.length;
    if (count === 0) return;
    const wrapped = ((index % count) + count) % count;
    const next = visiblePlans[wrapped];
    if (!next) return;
    setSelectedId(next.id);
    // Defer focus until React commits the new selection so the ring follows.
    requestAnimationFrame(() => {
      radioRefs.current[wrapped]?.focus();
    });
  }

  function handleRadioKeyDown(index: number, e: React.KeyboardEvent<HTMLButtonElement>) {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        focusRadio(index + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        focusRadio(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusRadio(0);
        break;
      case 'End':
        e.preventDefault();
        focusRadio(visiblePlans.length - 1);
        break;
      default:
        break;
    }
  }

  const isDateFuture = startsAt !== '' && new Date(startsAt) > new Date();
  const canPost = selectedId !== '' && isDateFuture && phase !== 'saving';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canPost) return;
    setPhase('saving');
    setErrorMsg('');
    stopPreview();
    try {
      const client = browserAfter5Client();
      // E11/D-10: pay_setting + why_note + vibe_tags live on the itinerary — persist
      // them best-effort onto the forked plan before posting. Read the current stops
      // first so the update doesn't clobber them (update_itinerary_stops replaces the
      // stops array). A failure here is non-fatal — the night still posts.
      const min = ageMin.trim() === '' ? null : Number(ageMin);
      const max = ageMax.trim() === '' ? null : Number(ageMax);
      const ageRange = min != null || max != null
        ? `[${min ?? 18},${max ?? 100}]`
        : null;
      const radius = radiusKm.trim() === '' ? null : Number(radiusKm);

      try {
        const { data: it } = await client
          .from('itineraries')
          .select('stops, vibe_tags')
          .eq('id', selectedId)
          .maybeSingle();
        if (it) {
          await updateItineraryStops(client, {
            itinerary_id: selectedId,
            stops: (it.stops ?? []) as never,
            pay_setting: paySetting,
            why_note: whyNote.trim() || undefined,
            vibe_tags: (it.vibe_tags as string[] | null) ?? undefined,
          });
        }
      } catch (metaErr) {
        console.warn('[PostNightForm] creator-meta update skipped', metaErr);
      }

      await postNight(client, {
        itinerary_id: selectedId,
        starts_at: new Date(startsAt).toISOString(),
        ambient_sound_id: ambientId || null,
        target_genders: genders,
        target_age_range: ageRange,
        search_radius_km: radius,
      });
      toast.success("posted. it's live.");
      // Land on the night you just posted (/my-nights upcoming), not generic home —
      // the post-publish payoff is SEEING your night live, and home's cold-start
      // copy ("we're warming up your first nights") contradicts the toast.
      router.push('/my-nights');
    } catch (err) {
      console.error('[PostNightForm] post failed', err);
      const msg =
        err instanceof Error ? err.message : "couldn't post that. try again?";
      setErrorMsg(msg);
      setPhase('error');
      toast.error("couldn't post that. try again?");
    }
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (plans.length === 0) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-6 pb-28 text-center">
        <div className="mx-auto max-w-[420px]">
          <h1 className="font-heading text-4xl lowercase leading-[1.05] text-shell-ink">
            no plans yet.
          </h1>
          <p className="mt-3 font-body text-[15px] text-shell-ink/70">
            go cook one first, then post it.
          </p>
          <Link
            href="/create"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-shell-accent px-7 py-3 font-body text-[15px] font-semibold text-white shadow-fun transition hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none"
          >
            build a plan
          </Link>
        </div>
        <BottomTabShell userId={userId} />
      </main>
    );
  }

  // ── Main form ────────────────────────────────────────────────────────────
  return (
    <main className="min-h-dvh bg-shell-base px-5 pb-28 pt-8">
      <div className="mx-auto max-w-[420px]">
        {/* Header */}
        <header className="mb-7">
          <h1 className="font-heading text-3xl lowercase leading-[1.05] text-shell-ink">
            post a night
          </h1>
          <p className="mt-2 font-body text-[14px] text-shell-ink/65">
            pick a plan. set the time. people nearby can say they&apos;re in. you choose who makes the cut.
          </p>
        </header>

        <form onSubmit={submit} className="space-y-6" noValidate>
          {/* ── Plan picker ── */}
          <fieldset>
            <legend className="mb-3 font-body text-sm font-semibold lowercase text-shell-ink">
              which plan?
            </legend>

            <div
              className="space-y-3"
              role="radiogroup"
              aria-label="pick a plan"
            >
              {visiblePlans.map((plan, idx) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  selected={selectedId === plan.id}
                  onSelect={() => setSelectedId(plan.id)}
                  index={idx}
                  reduceMotion={!!reduceMotion}
                  isTabStop={idx === tabStopIndex}
                  onKeyDown={(e) => handleRadioKeyDown(idx, e)}
                  setRef={(el) => setRadioRef(idx, el)}
                />
              ))}
            </div>

            {/* One-way expander past the fold. Selection keeps working across
                it: expanding only appends radios to the same radiogroup. */}
            {!showAllPlans && plans.length > PLANS_FOLD && (
              <button
                type="button"
                aria-expanded={false}
                onClick={() => setShowAllPlans(true)}
                className={cn(
                  'mt-3 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full bg-white/60 font-body text-[13px] font-semibold lowercase text-shell-ink/65 ring-1 ring-shell-ink/10 transition',
                  'hover:ring-shell-accent/40 hover:text-shell-ink active:scale-95',
                  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                  'motion-reduce:transition-none',
                )}
              >
                show all {plans.length} plans
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </fieldset>

          {/* ── When picker ── */}
          <div>
            <label
              htmlFor="starts-at"
              className="mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink"
            >
              when&apos;s the night?
            </label>
            <input
              id="starts-at"
              type="datetime-local"
              value={startsAt}
              min={nowMin()}
              onChange={(e) => setStartsAt(e.target.value)}
              className={cn(
                'block w-full rounded-2xl border bg-white/80 px-4 py-3 font-body text-[15px] text-shell-ink',
                'focus:outline-none focus:ring-2 focus:ring-shell-accent/60',
                'border-shell-ink/15',
              )}
              aria-describedby={startsAt && !isDateFuture ? 'time-hint' : undefined}
            />
            {startsAt && !isDateFuture && (
              <p id="time-hint" className="mt-1.5 font-body text-xs text-shell-accent">
                that&apos;s already gone. pick something later.
              </p>
            )}
          </div>

          {/* ── who's this for? (E11 targeting + who-pays) ── */}
          <fieldset>
            <legend className="mb-3 font-body text-sm font-semibold lowercase text-shell-ink">
              who&apos;s this for?
            </legend>

            {/* who pays */}
            <p className="mb-2 font-body text-[13px] lowercase text-shell-ink/65">who pays?</p>
            <div role="radiogroup" aria-label="who pays" className="mb-5 flex flex-wrap gap-2">
              {PAY_OPTIONS.map((opt, idx) => {
                const selected = paySetting === opt.id;
                return (
                  <button
                    key={opt.id}
                    ref={(el) => { payRefs.current[idx] = el; }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={idx === paySelectedIndex ? 0 : -1}
                    onClick={() => setPaySetting(opt.id)}
                    onKeyDown={(e) => handlePayKeyDown(idx, e)}
                    style={{ transform: `rotate(${stickerRotation(opt.id)}deg)` }}
                    className={cn(
                      'min-h-[44px] rounded-full px-4 font-body text-[14px] font-semibold lowercase transition',
                      'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                      'motion-reduce:transition-none',
                      selected
                        ? 'bg-shell-accent text-white shadow-fun'
                        : 'bg-white/80 text-shell-ink ring-1 ring-shell-ink/10 hover:ring-shell-accent/40',
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* target genders (multi-select) */}
            <p className="mb-2 font-body text-[13px] lowercase text-shell-ink/65">open to</p>
            <div role="group" aria-label="target gender(s)" className="flex flex-wrap gap-2">
              {GENDER_OPTIONS.map((opt) => {
                const selected = genders.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => toggleGender(opt.id)}
                    style={{ transform: `rotate(${stickerRotation(opt.id)}deg)` }}
                    className={cn(
                      'min-h-[44px] rounded-full px-4 font-body text-[14px] font-semibold lowercase transition',
                      'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                      'motion-reduce:transition-none',
                      selected
                        ? 'bg-shell-accent text-white shadow-fun'
                        : 'bg-white/80 text-shell-ink ring-1 ring-shell-ink/10 hover:ring-shell-accent/40',
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 font-body text-xs lowercase text-shell-ink/55">
              open to everyone unless you narrow it.
            </p>

            {/* target age range */}
            <div className="mt-5 flex items-end gap-3">
              <label htmlFor="age-min" className="flex-1">
                <span className="mb-1.5 block font-body text-[13px] lowercase text-shell-ink/65">
                  youngest
                </span>
                <input
                  id="age-min"
                  type="number"
                  inputMode="numeric"
                  min={18}
                  max={100}
                  placeholder="18"
                  value={ageMin}
                  onChange={(e) => setAgeMin(e.target.value)}
                  className="block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-4 py-3 font-body text-[15px] tabular-nums text-shell-ink focus:outline-none focus:ring-2 focus:ring-shell-accent/60"
                />
              </label>
              <span aria-hidden className="pb-3 font-body text-shell-ink/40">–</span>
              <label htmlFor="age-max" className="flex-1">
                <span className="mb-1.5 block font-body text-[13px] lowercase text-shell-ink/65">
                  oldest
                </span>
                <input
                  id="age-max"
                  type="number"
                  inputMode="numeric"
                  min={18}
                  max={100}
                  placeholder="100"
                  value={ageMax}
                  onChange={(e) => setAgeMax(e.target.value)}
                  className="block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-4 py-3 font-body text-[15px] tabular-nums text-shell-ink focus:outline-none focus:ring-2 focus:ring-shell-accent/60"
                />
              </label>
            </div>

            {/* radius */}
            <label htmlFor="radius-km" className="mt-5 block">
              <span className="mb-1.5 block font-body text-[13px] lowercase text-shell-ink/65">
                how far? (km)
              </span>
              <input
                id="radius-km"
                type="number"
                inputMode="numeric"
                min={1}
                placeholder="city default"
                value={radiusKm}
                onChange={(e) => setRadiusKm(e.target.value)}
                className="block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-4 py-3 font-body text-[15px] tabular-nums text-shell-ink focus:outline-none focus:ring-2 focus:ring-shell-accent/60"
              />
            </label>

            {/* E10/D-01 reach line: a quiet, encouraging count of who this targeting
                reaches. aria-live so the update is announced without stealing focus
                (mirrors SwipeDeck's {remaining} left region). NOT accent, NOT a
                warning color, and it NEVER gates the publish CTA. */}
            <p className="mt-3 min-h-[1.25rem] font-body text-[13px] lowercase text-shell-ink/65" aria-live="polite">
              {reachLine}
            </p>
          </fieldset>

          {/* ── the why? (E11) ── */}
          <div>
            <label
              htmlFor="why-note"
              className="mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink"
            >
              the why?
            </label>
            <textarea
              id="why-note"
              value={whyNote}
              onChange={(e) => setWhyNote(e.target.value)}
              rows={2}
              maxLength={140}
              placeholder="one line on why this night's worth it."
              className="block w-full resize-none rounded-2xl border border-shell-ink/15 bg-white/80 px-4 py-3 font-body text-[15px] text-shell-ink placeholder:text-shell-ink/35 focus:outline-none focus:ring-2 focus:ring-shell-accent/60"
            />
          </div>

          {/* ── Soundtrack picker (optional) ── */}
          {ambientSounds.length > 0 && (
            <fieldset>
              <legend className="mb-3 font-body text-sm font-semibold lowercase text-shell-ink">
                soundtrack? (optional)
              </legend>
              <div
                className="space-y-2"
                role="radiogroup"
                aria-label="pick a soundtrack"
              >
                {ambientOptions.map((opt, idx) => {
                  const selected = ambientId === opt.id;
                  const sound = opt.id ? ambientSounds.find((s) => s.id === opt.id) : null;
                  const isPreviewing = previewingId === opt.id;
                  return (
                    <div key={opt.id || 'none'} className="flex items-center gap-2">
                      <button
                        ref={(el) => { ambientRefs.current[idx] = el; }}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        tabIndex={idx === ambientSelectedIndex ? 0 : -1}
                        onClick={() => setAmbientId(opt.id)}
                        onKeyDown={(e) => handleAmbientKeyDown(idx, e)}
                        className={cn(
                          'flex flex-1 items-center justify-between gap-3 rounded-2xl bg-white/80 px-4 py-3 text-left font-body text-[15px] lowercase text-shell-ink transition',
                          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                          'motion-reduce:transition-none',
                          selected
                            ? 'ring-2 ring-shell-accent shadow-fun'
                            : 'ring-1 ring-shell-ink/10 hover:ring-shell-accent/40',
                        )}
                      >
                        <span>{opt.label.toLowerCase()}</span>
                        <span
                          aria-hidden
                          className={cn(
                            'h-4 w-4 shrink-0 rounded-full border-2 transition',
                            selected ? 'border-shell-accent bg-shell-accent' : 'border-shell-ink/20',
                          )}
                        />
                      </button>
                      {sound && (
                        <button
                          type="button"
                          aria-label={`preview ${sound.name}`}
                          aria-pressed={isPreviewing}
                          onClick={() => togglePreview(sound.id, sound.storage_path)}
                          className={cn(
                            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/80 text-shell-ink shadow-subtle transition',
                            'hover:ring-2 hover:ring-shell-accent/40 active:scale-95',
                            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                            'motion-reduce:transition-none',
                          )}
                        >
                          {isPreviewing
                            ? <Pause className="h-4 w-4" aria-hidden />
                            : <Play className="h-4 w-4" aria-hidden />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          {/* ── Error alert ── */}
          {phase === 'error' && errorMsg && (
            <div
              role="alert"
              className="rounded-2xl border border-shell-accent/30 bg-white/70 px-4 py-3 font-body text-[13px] text-shell-ink"
            >
              {errorMsg}
            </div>
          )}

          {/* ── Submit CTA ── */}
          <button
            type="submit"
            disabled={!canPost}
            className={cn(
              'mt-1 flex min-h-[48px] w-full items-center justify-center rounded-full font-body text-[16px] font-semibold lowercase transition',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
              'motion-reduce:transition-none',
              canPost
                ? 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95'
                : 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35',
            )}
            aria-busy={phase === 'saving'}
          >
            {phase === 'saving'
              ? 'posting…'
              : phase === 'error'
              ? 'try again'
              : 'post it'}
          </button>
        </form>
      </div>
      <BottomTabShell userId={userId} />
    </main>
  );
}

// ── PlanCard ─────────────────────────────────────────────────────────────────

interface PlanCardProps {
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
  index: number;
  reduceMotion: boolean;
  isTabStop: boolean;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  setRef: (el: HTMLButtonElement | null) => void;
}

function PlanCard({
  plan,
  selected,
  onSelect,
  index,
  reduceMotion,
  isTabStop,
  onKeyDown,
  setRef,
}: PlanCardProps) {
  const tags = (plan.vibe_tags ?? []).filter(Boolean).slice(0, 4);
  const title = plan.title?.toLowerCase() ?? 'untitled plan';
  const stops = parsePlanStops(plan.stops);
  const meta = planMetaLine(plan, stops.length);
  // Inline stop preview — expands in place, no navigation.
  const [previewOpen, setPreviewOpen] = useState(false);
  const stopsId = `plan-stops-${plan.id}`;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={reduceMotion ? false : { opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 6) * 0.04, type: 'spring', stiffness: 400, damping: 32 }}
      className={cn(
        'rounded-3xl bg-white/80 transition',
        'motion-reduce:transition-none',
        // Selected ring
        selected
          ? 'ring-2 ring-shell-accent shadow-fun'
          : 'ring-1 ring-shell-ink/10 shadow-subtle hover:ring-shell-accent/40',
      )}
    >
      {/* The radio proper. preview + remix live OUTSIDE this button (siblings,
          not nested interactives) so tapping them never changes selection. */}
      <motion.button
        ref={setRef}
        type="button"
        role="radio"
        aria-checked={selected}
        tabIndex={isTabStop ? 0 : -1}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        whileTap={reduceMotion ? undefined : { scale: 0.98 }}
        className={cn(
          // Base: full-width tappable target, ≥44px (72px thumb), left-aligned
          'flex w-full items-start gap-3 rounded-t-3xl p-3 text-left transition',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
          'motion-reduce:transition-none',
        )}
      >
        {/* Thumbnail */}
        <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-2xl bg-shell-base">
          {plan.cover_image_url ? (
            <Image
              src={plan.cover_image_url}
              alt=""
              fill
              sizes="72px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Sparkles
                className="h-6 w-6 text-shell-accent/40"
                aria-hidden
              />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="font-heading text-[17px] lowercase leading-tight text-shell-ink line-clamp-2">
            {title}
          </p>

          {meta && (
            <p className="mt-1 font-body text-[12px] lowercase text-shell-ink/55 [font-variant-numeric:tabular-nums]">
              {meta}
            </p>
          )}

          {tags.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="vibe tags">
              {tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full bg-shell-accent px-2.5 py-0.5 font-body text-[11px] font-semibold text-white shadow-md"
                  style={{ transform: `rotate(${stickerRotation(tag)}deg)` }}
                >
                  {tag.toLowerCase()}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Selection indicator */}
        <div
          aria-hidden
          className={cn(
            'mt-1 h-5 w-5 shrink-0 rounded-full border-2 transition',
            selected
              ? 'border-shell-accent bg-shell-accent'
              : 'border-shell-ink/20 bg-transparent',
          )}
        />
      </motion.button>

      {/* Quiet footer: peek inside, or take it to the canvas to remix before
          posting. Both ≥44px targets, both separate from the radio. */}
      <div className="flex items-center justify-between border-t border-shell-ink/10 px-1.5">
        <button
          type="button"
          aria-expanded={previewOpen}
          aria-controls={previewOpen ? stopsId : undefined}
          aria-label={`preview ${title}`}
          onClick={(e) => {
            e.stopPropagation();
            setPreviewOpen((v) => !v);
          }}
          className={cn(
            'flex min-h-[44px] items-center gap-1 rounded-full px-2.5 font-body text-[13px] lowercase text-shell-ink/60 transition',
            'hover:text-shell-ink active:scale-95',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
            'motion-reduce:transition-none',
          )}
        >
          preview
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition', previewOpen && 'rotate-180')}
            aria-hidden
          />
        </button>
        <Link
          href={`/plans/${plan.id}/edit`}
          aria-label={`remix ${title}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'flex min-h-[44px] items-center rounded-full px-2.5 font-body text-[13px] lowercase text-shell-ink/60 transition',
            'hover:text-shell-accent active:scale-95',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
            'motion-reduce:transition-none',
          )}
        >
          remix →
        </Link>
      </div>

      {/* Inline stop preview: the ordered run of the night, name · time. */}
      {previewOpen && (
        stops.length > 0 ? (
          <ol id={stopsId} className="space-y-1.5 border-t border-shell-ink/10 px-4 py-3">
            {stops.map((s, i) => (
              <li
                key={`${s.name}-${i}`}
                className="font-body text-[13px] lowercase text-shell-ink/70 [font-variant-numeric:tabular-nums]"
              >
                {s.time ? `${s.name.toLowerCase()} · ${s.time}` : s.name.toLowerCase()}
              </li>
            ))}
          </ol>
        ) : (
          <p id={stopsId} className="border-t border-shell-ink/10 px-4 py-3 font-body text-[13px] lowercase text-shell-ink/55">
            no stops on this one yet. remix it to add some.
          </p>
        )
      )}
    </motion.div>
  );
}
