// "as others see it" self-view sheet (E3 / D-03). A thin vaul Drawer wrapper
// that reuses ProfileCard verbatim — modelled on matches/[lockId]/RevealModal.tsx.
// Feed it the OWNER's own signed clear photos + identity fields. instagram_handle
// is intentionally NOT a prop (A1) — the self-preview is not a contact card, so no
// PII leaks into this surface. The trigger lives in the hub page (account/page.tsx)
// which owns the open/close state; this wrapper is presentation + dismissal only
// (no data fetching). Self-view stays Tier-3 neutral — ProfileCard is not re-skinned.
'use client';

import { Drawer } from 'vaul';
import { ProfileCard, type ProfileCardPrompt } from '@/components/ProfileCard';

export interface SelfViewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  age: number | null;
  place: string | null;
  pronouns?: string | null;
  occupation?: string | null;
  height_cm?: number | null;
  /** Signed clear-photo URLs, primary first (listMyPhotos + signClearUrls). */
  photos: string[];
  vibe_tags: string[];
  prompts: ProfileCardPrompt[];
}

export function SelfViewSheet({
  open,
  onOpenChange,
  name,
  age,
  place,
  pronouns,
  occupation,
  height_cm,
  photos,
  vibe_tags,
  prompts,
}: SelfViewSheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        {/* vaul sets touch-action:none on Drawer.Content and treats a scrollable
            role="dialog" as a drag target, so Content must NOT be the scroll
            container itself (content past the first screen gets clipped). Same
            pattern as feed/FilterSheet: flex column Content + inner overflow-y-auto. */}
        <Drawer.Content
          aria-label="as others see it"
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-[420px] flex-col overflow-hidden rounded-t-3xl bg-shell-base outline-none"
        >
          <Drawer.Title className="sr-only">as others see it</Drawer.Title>
          <Drawer.Description className="sr-only">
            this is you when you come up in someone&apos;s feed.
          </Drawer.Description>
          <div className="mx-auto mb-3 mt-4 h-1.5 w-12 shrink-0 rounded-full bg-shell-ink/15" aria-hidden />
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10">
            <ProfileCard
              name={name}
              age={age}
              place={place}
              pronouns={pronouns}
              occupation={occupation}
              height_cm={height_cm}
              photos={photos}
              vibe_tags={vibe_tags}
              prompts={prompts}
            />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
