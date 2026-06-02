'use client';
import { Drawer } from 'vaul';
import { ProfileCard, type ProfileCardPrompt } from '@/components/ProfileCard';
import type { PartyProfile } from '../lock-view';

export function RevealModal({
  open, onOpenChange, person, photos, prompts,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  person: PartyProfile;
  // Signed clear-photo URLs (primary first) + prompt answers joined to labels,
  // both prepared server-side on the reveal page (M6). Empty arrays render the
  // Polaroid gradient fallback / no prompts.
  photos: string[];
  prompts: ProfileCardPrompt[];
}) {
  const name = person.first_name ?? 'your match';
  const place = person.neighborhood ?? person.city ?? null;
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
          <ProfileCard
            name={name}
            age={person.age}
            place={place}
            pronouns={person.pronouns ?? null}
            photos={photos}
            vibe_tags={person.vibe_tags}
            prompts={prompts}
          />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
