'use client';
import { motion, useReducedMotion } from 'framer-motion';
import { Drawer } from 'vaul';
import { ProfileCard, type ProfileCardPrompt } from '@/components/ProfileCard';
import type { PartyProfile } from '../lock-view';

// Soft expo-out: the un-blur should land like a breath, not a loading bar (UI-SPEC).
const REVEAL_EASE = [0.22, 1, 0.36, 1] as const;

export function RevealModal({
  open, onOpenChange, person, photos, prompts, ceremony = false, photoError = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  person: PartyProfile;
  // Signed clear-photo URLs (primary first) + prompt answers joined to labels,
  // both prepared server-side on the reveal page (M6). Empty arrays render the
  // Polaroid gradient fallback / no prompts.
  photos: string[];
  prompts: ProfileCardPrompt[];
  // E16 (REQ-E16 / D-04): when true (justLocked), play the un-blur ceremony — a
  // framer-motion blur(12px)->blur(0) dissolve + one pink flourish, gated on this
  // flag so return visits open static (Pitfall 5). Reduced-motion shows the clear
  // photo immediately with a short opacity cross-fade; the flourish stays static.
  ceremony?: boolean;
  // States (UI-SPEC §States): no clear photo made it down (zero gallery rows +
  // no legacy mirror, or signing failed). This modal only renders POST-LOCK, so
  // identity is already revealed: never blur, never imply the reveal is still
  // gated. ProfileCard's empty-photos branch shows the initial-letter avatar;
  // this just adds a quiet "no photo yet." line.
  photoError?: boolean;
}) {
  const reduce = useReducedMotion();
  const name = person.first_name ?? 'your match';
  const place = person.neighborhood ?? person.city ?? null;

  // The dissolve animates the WRAPPER (CSS filter/scale/opacity) over the
  // already-signed clear photo. ceremony=false -> open static (return visit).
  const animate = ceremony && !reduce && !photoError;
  const crossFade = ceremony && reduce && !photoError;

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content
          aria-label={`profile of ${name}`}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-shell-base p-4 pb-10 outline-none"
        >
          <Drawer.Title className="sr-only">{name}&apos;s profile</Drawer.Title>
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-shell-ink/15" aria-hidden />

          <div className="relative">
            {/* Flourish: one soft hot-pink radial glow behind the polaroid. Pink is
                punctuation, not a wash (UI-SPEC §Color). Static under reduced-motion. */}
            {ceremony && !photoError && (
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -top-2 mx-auto h-40 w-40 rounded-full bg-shell-accent/25 blur-3xl"
                initial={animate ? { opacity: 0, scale: 0.85 } : false}
                animate={animate ? { opacity: 1, scale: 1 } : { opacity: 1, scale: 1 }}
                transition={animate ? { duration: 0.6, delay: 0.2, ease: REVEAL_EASE } : undefined}
              />
            )}

            {/* The reveal photo wrapper. Ceremony un-blurs it; otherwise it renders
                clear immediately. photoError renders clear too (post-lock: nothing
                left to hide) — the avatar fallback lives in ProfileCard. */}
            <motion.div
              className="relative"
              initial={
                animate
                  ? { filter: 'blur(12px)', scale: 1.02, opacity: 0.85 }
                  : crossFade
                    ? { opacity: 0 }
                    : false
              }
              animate={
                animate
                  ? { filter: 'blur(0px)', scale: 1, opacity: 1 }
                  : crossFade
                    ? { opacity: 1 }
                    : { opacity: 1 }
              }
              transition={
                animate
                  ? { duration: 0.9, ease: REVEAL_EASE }
                  : crossFade
                    ? { duration: 0.2, ease: 'easeOut' }
                    : undefined
              }
            >
              <ProfileCard
                name={name}
                age={person.age}
                place={place}
                pronouns={person.pronouns ?? null}
                photos={photos}
                vibe_tags={person.vibe_tags}
                prompts={prompts}
                verification={person.verification}
                reliability_score={person.reliability_score ?? null}
              />
            </motion.div>
          </div>

          {photoError && photos.length === 0 && (
            <p className="mt-4 text-center font-body text-sm lowercase text-shell-ink/60">
              no photo yet.
            </p>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
